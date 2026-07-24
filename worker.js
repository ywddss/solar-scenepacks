// Solar Scenepacks — Cloudflare Worker
// Serves the static site + admin API (/api/admin) + Discord login & gated downloads (/api/auth/*, /api/download).
//
// Required secrets (Cloudflare dashboard → project → Settings → Variables and Secrets,
// or `wrangler secret put NAME`):
//   ADMIN_PASSWORD        - the admin panel password
//   GITHUB_TOKEN          - GitHub personal access token with repo access
//   GITHUB_REPO           - e.g. "ywddss/solar-scenepacks"
//   DISCORD_CLIENT_ID     - Discord application Client ID
//   DISCORD_CLIENT_SECRET - Discord application Client Secret
//   DISCORD_GUILD_ID      - the Discord server ID users must be a member of
//   SESSION_SECRET        - any long random string (signs the login cookie)

const ALLOWED_FILES = { packs: "packs.json", config: "config.json" };
const SITE_ORIGIN = "https://solarscenepacks.xyz";
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days, in seconds
const COOKIE_NAME = "solar_session";

function b64(str) {
  // UTF-8 safe base64
  return btoa(unescape(encodeURIComponent(str)));
}

function fmtBytes(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + " TB";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  return Math.round(n / 1e3) + " KB";
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders }
  });
}

// ─────────────────────────── GitHub save (admin) ───────────────────────────

async function githubRequest(env, path, options = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "solar-scenepacks-admin",
      ...(options.headers || {})
    }
  });
}

async function saveFile(env, filename, content, message) {
  const repo = env.GITHUB_REPO;
  const path = `/repos/${repo}/contents/${filename}`;

  // Get current SHA (needed for updates)
  let sha;
  const getRes = await githubRequest(env, path);
  if (getRes.ok) {
    const data = await getRes.json();
    sha = data.sha;
  }

  const body = {
    message,
    content: b64(JSON.stringify(content, null, 2) + "\n"),
    ...(sha ? { sha } : {})
  };

  const putRes = await githubRequest(env, path, {
    method: "PUT",
    body: JSON.stringify(body)
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`GitHub save failed (${putRes.status}): ${err.slice(0, 200)}`);
  }
}

// Read packs.json from the deployed static assets (full data, incl. download URLs).
async function readPacks(request, env) {
  try {
    const res = await env.ASSETS.fetch(new URL("/packs.json", request.url).toString());
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
    }
  } catch { /* ignore */ }
  return [];
}

// ─────────────────────────── Session cookie (HMAC-signed) ───────────────────────────

function bytesToB64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

// Create a signed token: base64url(payload).base64url(hmac)
async function signSession(env, payload) {
  const key = await hmacKey(env.SESSION_SECRET || "");
  const data = bytesToB64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return data + "." + bytesToB64Url(new Uint8Array(sig));
}

// Verify a signed token, returning the payload or null.
async function verifySession(env, token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [data, sig] = token.split(".");
  try {
    const key = await hmacKey(env.SESSION_SECRET || "");
    const ok = await crypto.subtle.verify(
      "HMAC", key, b64UrlToBytes(sig), new TextEncoder().encode(data)
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64UrlToBytes(data)));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function sessionCookie(value, maxAge) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];
  return parts.join("; ");
}

async function getUser(request, env) {
  return verifySession(env, getCookie(request, COOKIE_NAME));
}

// ─────────────────────────── Discord OAuth ───────────────────────────

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bytesToB64Url(bytes);
}

// Step 1: send the user to Discord's authorization screen.
async function handleAuthLogin(request, env) {
  if (!env.DISCORD_CLIENT_ID) {
    return new Response("Login is not configured yet.", { status: 500 });
  }
  const url = new URL(request.url);
  // Where to return the user after login (defaults to home).
  const returnTo = url.searchParams.get("returnTo") || "/";
  const state = randomState();

  const authUrl = new URL("https://discord.com/oauth2/authorize");
  authUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", SITE_ORIGIN + "/api/auth/callback");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "identify guilds");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "consent");

  // Stash state + returnTo in a short-lived cookie to check on callback (CSRF protection).
  const stateCookie = `solar_oauth=${encodeURIComponent(state + "|" + returnTo)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl.toString(), "Set-Cookie": stateCookie }
  });
}

// Step 2: Discord redirects back here with a code.
async function handleAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookie = getCookie(request, "solar_oauth") || "";
  const [savedState, returnTo] = cookie.split("|");
  const dest = returnTo || "/";

  const fail = (msg) => {
    const to = new URL(dest, SITE_ORIGIN);
    to.searchParams.set("login", "error");
    if (msg) to.searchParams.set("reason", msg);
    return new Response(null, {
      status: 302,
      headers: { Location: to.toString(), "Set-Cookie": `solar_oauth=; Path=/; Max-Age=0` }
    });
  };

  if (!code || !state || state !== savedState) return fail("state");

  // Exchange the code for an access token.
  let token;
  try {
    const body = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: SITE_ORIGIN + "/api/auth/callback"
    });
    const res = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    if (!res.ok) return fail("token");
    token = await res.json();
  } catch {
    return fail("token");
  }

  // Fetch the user's identity.
  let me;
  try {
    const res = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });
    if (!res.ok) return fail("user");
    me = await res.json();
  } catch {
    return fail("user");
  }

  // Check server membership via the user's guild list (needs the `guilds` scope).
  let inGuild = false;
  try {
    const res = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });
    if (res.ok) {
      const guilds = await res.json();
      inGuild = Array.isArray(guilds) && guilds.some(g => g.id === env.DISCORD_GUILD_ID);
    }
  } catch { /* treat as not in guild */ }

  const avatar = me.avatar
    ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64`
    : null;
  const name = me.global_name || me.username || "Member";

  // If they're not in the server, don't create a session — bounce them with a flag.
  if (!inGuild) {
    const to = new URL(dest, SITE_ORIGIN);
    to.searchParams.set("login", "notmember");
    to.searchParams.set("name", name);
    return new Response(null, {
      status: 302,
      headers: { Location: to.toString(), "Set-Cookie": `solar_oauth=; Path=/; Max-Age=0` }
    });
  }

  // Create the signed session.
  const now = Math.floor(Date.now() / 1000);
  const session = await signSession(env, {
    id: me.id,
    name,
    avatar,
    member: true,
    iat: now,
    exp: now + SESSION_TTL
  });

  const to = new URL(dest, SITE_ORIGIN);
  to.searchParams.set("login", "ok");
  const headers = new Headers({ Location: to.toString() });
  headers.append("Set-Cookie", sessionCookie(session, SESSION_TTL));
  headers.append("Set-Cookie", `solar_oauth=; Path=/; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}

function handleAuthLogout() {
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": sessionCookie("", 0) }
  });
}

// Who am I? — used by the front-end to show login state.
async function handleAuthMe(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ loggedIn: false });
  return json({
    loggedIn: true,
    member: !!user.member,
    user: { id: user.id, name: user.name, avatar: user.avatar }
  });
}

// Gated download: only logged-in members get the real URL.
async function handleDownload(request, env) {
  const user = await getUser(request, env);
  if (!user || !user.member) {
    return json({ error: "You must log in with Discord and join the server to download." }, 401);
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("pack");
  if (!id) return json({ error: "Missing pack id" }, 400);

  const packs = await readPacks(request, env);
  const pack = packs.find(p => String(p.id) === String(id) && !p.hidden);
  if (!pack || !pack.download) return json({ error: "Pack not found" }, 404);

  // Redirect straight to the real file/link.
  return new Response(null, { status: 302, headers: { Location: pack.download, "Cache-Control": "no-store" } });
}

// ─────────────────────────── Admin API ───────────────────────────

async function handleAdmin(request, env) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const { action, password } = body || {};

  if (!env.ADMIN_PASSWORD) {
    return json({ error: "ADMIN_PASSWORD is not configured on the server" }, 500);
  }
  if (!password || password !== env.ADMIN_PASSWORD) {
    return json({ error: "Invalid password" }, 401);
  }

  try {
    if (action === "verify") {
      return json({ ok: true });
    }

    // Full packs data (incl. download URLs) for the admin panel, since the public
    // packs.json no longer contains download links.
    if (action === "loadPacks") {
      const packs = await readPacks(request, env);
      return json({ ok: true, packs });
    }

    // Auto-detect file metadata (size / quality / encoding) from a download link
    if (action === "fetchMeta") {
      const url = String(body.url || "");
      if (!/^https:\/\/[^\s]+$/i.test(url)) {
        return json({ error: "Invalid URL" }, 400);
      }
      const meta = { size: "", quality: "", encoding: "" };
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,*/*"
          },
          redirect: "follow",
          signal: AbortSignal.timeout(10000)
        });

        // Direct file? Use Content-Length
        const type = res.headers.get("content-type") || "";
        const len = Number(res.headers.get("content-length") || 0);
        if (!type.includes("text/html") && len > 0) {
          meta.size = fmtBytes(len);
        } else {
          const html = (await res.text()).slice(0, 300000);
          const text = html.replace(/<[^>]+>/g, " ");
          // File size, e.g. "4.82 GB" / "512.3 MB"
          const sizeMatch = text.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*(GB|MB|TB)\b/i);
          if (sizeMatch) meta.size = sizeMatch[1].replace(",", ".") + " " + sizeMatch[2].toUpperCase();
          // Quality, e.g. 2160p / 1080p / 4K
          const qMatch = text.match(/\b(2160p|1440p|1080p|720p|480p)\b/i) || text.match(/\b(4k|uhd)\b/i);
          if (qMatch) meta.quality = /4k|uhd/i.test(qMatch[1]) ? "2160p" : qMatch[1].toLowerCase();
          // Encoding, e.g. H.265 / HEVC / x264 / AV1 / ProRes
          const eMatch = text.match(/\b(h\.?265|hevc|x265)\b/i) ? "H.265"
            : text.match(/\b(h\.?264|avc|x264)\b/i) ? "H.264"
            : text.match(/\bav1\b/i) ? "AV1"
            : text.match(/\bprores\b/i) ? "ProRes" : "";
          if (eMatch) meta.encoding = eMatch;
        }
      } catch (e) {
        return json({ error: "Could not reach that link" }, 502);
      }
      // Sensible default: high res packs are usually H.265, everything else H.264
      if (!meta.encoding) meta.encoding = meta.quality === "2160p" ? "H.265" : "H.264";
      return json({ ok: true, meta });
    }

    if (action === "savePacks") {
      const packs = body.packs;
      if (!Array.isArray(packs)) {
        return json({ error: "packs must be an array" }, 400);
      }
      // Basic sanitization: keep only expected fields
      const clean = packs.map(p => ({
        id: String(p.id || ""),
        title: String(p.title || "").slice(0, 200),
        category: String(p.category || "").slice(0, 60),
        description: String(p.description || "").slice(0, 1000),
        image: String(p.image || "").slice(0, 1000),
        download: String(p.download || "").slice(0, 1000),
        date: String(p.date || "").slice(0, 10),
        hidden: !!p.hidden,
        show: String(p.show || "").slice(0, 200),
        year: String(p.year || "").slice(0, 20),
        genres: String(p.genres || "").slice(0, 200),
        quality: String(p.quality || "").slice(0, 20),
        encoding: String(p.encoding || "").slice(0, 20),
        size: String(p.size || "").slice(0, 30)
      }));
      await saveFile(env, ALLOWED_FILES.packs, clean, "Update packs via admin panel");
      return json({ ok: true });
    }

    if (action === "saveConfig") {
      const config = body.config;
      if (!config || typeof config !== "object") {
        return json({ error: "config must be an object" }, 400);
      }
      const clean = {
        discord: String(config.discord || "").slice(0, 500),
        announcement: String(config.announcement || "").slice(0, 180),
        announcementOn: !!config.announcementOn
      };
      await saveFile(env, ALLOWED_FILES.config, clean, "Update site settings via admin panel");
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ─────────────────────────── Public packs.json (download URLs stripped) ───────────────────────────

// The public packs.json must NOT expose real download links. We serve a scrubbed
// copy: `download` is replaced with a flag so the UI knows a download exists.
async function handlePublicPacks(request, env) {
  const res = await env.ASSETS.fetch(request);
  let data;
  try {
    data = await res.json();
  } catch {
    return new Response(res.body, res);
  }
  if (Array.isArray(data)) {
    data = data.map(p => {
      const { download, ...rest } = p || {};
      return { ...rest, hasDownload: !!download };
    });
  }
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

// ─────────────────────────── Sitemap ───────────────────────────

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Build sitemap.xml on the fly: static pages + one entry per (non-hidden) pack.
async function handleSitemap(request, env) {
  let packs = [];
  try {
    const res = await env.ASSETS.fetch(new URL("/packs.json", request.url).toString());
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) packs = data.filter(p => p && p.id && !p.hidden);
    }
  } catch { /* fall back to just the static pages */ }

  const staticPages = [
    { loc: "/", changefreq: "daily", priority: "1.0" },
    { loc: "/dmca.html", changefreq: "yearly", priority: "0.2" },
    { loc: "/terms.html", changefreq: "yearly", priority: "0.2" }
  ];

  const urls = staticPages.map(p =>
    `  <url>\n    <loc>${SITE_ORIGIN}${p.loc}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
  );

  packs.forEach(p => {
    const loc = `${SITE_ORIGIN}/show.html?pack=${encodeURIComponent(p.id)}`;
    const lastmod = /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? `\n    <lastmod>${p.date}</lastmod>` : "";
    urls.push(`  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmod}\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`);
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}

// ─────────────────────────── Router ───────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Auth + downloads
    if (path === "/api/auth/login") return handleAuthLogin(request, env);
    if (path === "/api/auth/callback") return handleAuthCallback(request, env);
    if (path === "/api/auth/logout") return handleAuthLogout();
    if (path === "/api/auth/me") return handleAuthMe(request, env);
    if (path === "/api/download") return handleDownload(request, env);

    // Admin
    if (path === "/api/admin") return handleAdmin(request, env);

    if (path === "/sitemap.xml") return handleSitemap(request, env);

    // Public packs.json — strip download URLs before serving.
    if (path === "/packs.json") return handlePublicPacks(request, env);

    // Everything else: static files; config.json never cached
    const res = await env.ASSETS.fetch(request);
    if (/\/config\.json$/.test(path)) {
      const fresh = new Response(res.body, res);
      fresh.headers.set("Cache-Control", "no-store");
      return fresh;
    }
    // Admin panel + its script: never index, never cache
    if (path.startsWith("/85h6juzkf") || path === "/admin.js") {
      const fresh = new Response(res.body, res);
      fresh.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      fresh.headers.set("Cache-Control", "no-store");
      return fresh;
    }
    return res;
  }
};
