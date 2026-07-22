// Solar Scenepacks — Cloudflare Worker
// Serves the static site + handles the admin API at /api/admin.
// Required secrets (Cloudflare dashboard → project → Settings → Variables and Secrets):
//   ADMIN_PASSWORD  - the admin panel password
//   GITHUB_TOKEN    - GitHub personal access token with repo access
//   GITHUB_REPO     - e.g. "ywddss/solar-scenepacks"

const ALLOWED_FILES = { packs: "packs.json", config: "config.json" };

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

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

const SITE_ORIGIN = "https://solarscenepacks.xyz";

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/admin") {
      return handleAdmin(request, env);
    }
    if (url.pathname === "/sitemap.xml") {
      return handleSitemap(request, env);
    }
    // Everything else: static files, packs/config json never cached
    const res = await env.ASSETS.fetch(request);
    if (/\/(packs|config)\.json$/.test(url.pathname)) {
      const fresh = new Response(res.body, res);
      fresh.headers.set("Cache-Control", "no-store");
      return fresh;
    }
    // Admin panel + its script: never index, never cache
    if (url.pathname.startsWith("/85h6juzkf") || url.pathname === "/admin.js") {
      const fresh = new Response(res.body, res);
      fresh.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      fresh.headers.set("Cache-Control", "no-store");
      return fresh;
    }
    return res;
  }
};
