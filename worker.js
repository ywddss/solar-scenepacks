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
        date: String(p.date || "").slice(0, 10)
      }));
      await saveFile(env, ALLOWED_FILES.packs, clean, "Update packs via admin panel");
      return json({ ok: true });
    }

    if (action === "saveConfig") {
      const config = body.config;
      if (!config || typeof config !== "object") {
        return json({ error: "config must be an object" }, 400);
      }
      const clean = { discord: String(config.discord || "").slice(0, 500) };
      await saveFile(env, ALLOWED_FILES.config, clean, "Update site settings via admin panel");
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/admin") {
      return handleAdmin(request, env);
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
