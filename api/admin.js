// Solar Scenepacks — admin API (Vercel serverless function)
// Saves packs.json / config.json to the GitHub repo, which triggers a redeploy.
// Required env vars on Vercel:
//   ADMIN_PASSWORD  - the admin panel password
//   GITHUB_TOKEN    - GitHub personal access token with repo access
//   GITHUB_REPO     - e.g. "username/solar-scenepacks"

const ALLOWED_FILES = { packs: "packs.json", config: "config.json" };

async function githubRequest(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "solar-scenepacks-admin",
      ...(options.headers || {})
    }
  });
  return res;
}

async function saveFile(filename, content, message) {
  const repo = process.env.GITHUB_REPO;
  const path = `/repos/${repo}/contents/${filename}`;

  // Get current SHA (needed for updates)
  let sha;
  const getRes = await githubRequest(path);
  if (getRes.ok) {
    const data = await getRes.json();
    sha = data.sha;
  }

  const body = {
    message,
    content: Buffer.from(JSON.stringify(content, null, 2) + "\n").toString("base64"),
    ...(sha ? { sha } : {})
  };

  const putRes = await githubRequest(path, {
    method: "PUT",
    body: JSON.stringify(body)
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`GitHub save failed (${putRes.status}): ${err.slice(0, 200)}`);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, password } = req.body || {};

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: "ADMIN_PASSWORD is not configured on the server" });
  }
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }

  try {
    if (action === "verify") {
      return res.status(200).json({ ok: true });
    }

    if (action === "savePacks") {
      const packs = req.body.packs;
      if (!Array.isArray(packs)) {
        return res.status(400).json({ error: "packs must be an array" });
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
      await saveFile(ALLOWED_FILES.packs, clean, "Update packs via admin panel");
      return res.status(200).json({ ok: true });
    }

    if (action === "saveConfig") {
      const config = req.body.config;
      if (!config || typeof config !== "object") {
        return res.status(400).json({ error: "config must be an object" });
      }
      const clean = { discord: String(config.discord || "").slice(0, 500) };
      await saveFile(ALLOWED_FILES.config, clean, "Update site settings via admin panel");
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
