/* Solar Scenepacks — admin panel */
(function () {
  const API = "/api/admin";
  let packs = [];
  let config = { discord: "" };
  let editingId = null;

  const $ = id => document.getElementById(id);
  const loginView = $("loginView");
  const panelView = $("panelView");

  function getPass() { return sessionStorage.getItem("sv_admin_pass") || ""; }
  function setPass(p) { sessionStorage.setItem("sv_admin_pass", p); }
  function clearPass() { sessionStorage.removeItem("sv_admin_pass"); }

  function setStatus(el, msg, ok) {
    el.textContent = msg;
    el.className = "status-msg " + (ok ? "ok" : "err");
    if (msg) setTimeout(() => { el.textContent = ""; }, 5000);
  }

  async function api(action, data) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action, password: getPass() }, data))
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Request failed (" + res.status + ")");
    return json;
  }

  // ── Login ──
  async function tryLogin(pass) {
    setPass(pass);
    try {
      await api("verify");
      showPanel();
      return true;
    } catch (e) {
      clearPass();
      return false;
    }
  }

  $("loginBtn").addEventListener("click", async () => {
    const pass = $("passwordInput").value;
    if (!pass) return;
    $("loginBtn").disabled = true;
    const ok = await tryLogin(pass);
    $("loginBtn").disabled = false;
    if (!ok) setStatus($("loginStatus"), "Wrong password.", false);
  });
  $("passwordInput").addEventListener("keydown", e => {
    if (e.key === "Enter") $("loginBtn").click();
  });

  $("logoutBtn").addEventListener("click", () => {
    clearPass();
    panelView.hidden = true;
    loginView.hidden = false;
  });

  async function showPanel() {
    loginView.hidden = true;
    panelView.hidden = false;
    await loadData();
  }

  // ── Data ──
  async function loadData() {
    const [p, c] = await Promise.all([
      fetch("packs.json?v=" + Date.now()).then(r => r.json()).catch(() => []),
      fetch("config.json?v=" + Date.now()).then(r => r.json()).catch(() => ({}))
    ]);
    packs = Array.isArray(p) ? p : [];
    packs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    config = Object.assign({ discord: "" }, c);
    $("fDiscord").value = config.discord || "";
    renderList();
  }

  function renderList() {
    const list = $("adminList");
    $("adminCount").textContent = packs.length;
    list.innerHTML = "";
    if (!packs.length) {
      list.innerHTML = '<p style="color:var(--text-soft)">No packs yet — publish your first one above!</p>';
      return;
    }
    packs.forEach(pack => {
      const row = document.createElement("div");
      row.className = "pack-row";
      row.innerHTML = `
        <img src="${esc(pack.image || "")}" alt="" onerror="this.style.visibility='hidden'">
        <div class="pack-row-info">
          <div class="pack-row-title">${esc(pack.title)}</div>
          <div class="pack-row-sub">${esc(pack.category || "")} · ${esc(pack.date || "")}</div>
        </div>
        <div class="pack-row-actions">
          <button class="btn btn-secondary btn-sm" data-edit="${esc(pack.id)}">Edit</button>
          <button class="btn btn-danger btn-sm" data-del="${esc(pack.id)}">Delete</button>
        </div>`;
      list.appendChild(row);
    });
    list.querySelectorAll("[data-edit]").forEach(b =>
      b.addEventListener("click", () => startEdit(b.dataset.edit)));
    list.querySelectorAll("[data-del]").forEach(b =>
      b.addEventListener("click", () => delPack(b.dataset.del)));
  }

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ── Image preview ──
  $("fImage").addEventListener("input", () => {
    const url = $("fImage").value.trim();
    const prev = $("imgPreview");
    if (url) { prev.src = url; prev.style.display = "block"; }
    else prev.style.display = "none";
  });

  // ── Publish / edit ──
  function startEdit(id) {
    const pack = packs.find(p => p.id === id);
    if (!pack) return;
    editingId = id;
    $("formHeading").textContent = "✏️ Edit pack";
    $("saveBtn").textContent = "Save changes";
    $("cancelEditBtn").hidden = false;
    $("fTitle").value = pack.title || "";
    $("fCategory").value = pack.category || "";
    $("fImage").value = pack.image || "";
    $("fImage").dispatchEvent(new Event("input"));
    $("fDownload").value = pack.download || "";
    $("fDesc").value = pack.description || "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    editingId = null;
    $("formHeading").textContent = "➕ Post a new scenepack";
    $("saveBtn").textContent = "Publish pack";
    $("cancelEditBtn").hidden = true;
    ["fTitle", "fCategory", "fImage", "fDownload", "fDesc"].forEach(id => $(id).value = "");
    $("imgPreview").style.display = "none";
  }
  $("cancelEditBtn").addEventListener("click", resetForm);

  $("saveBtn").addEventListener("click", async () => {
    const title = $("fTitle").value.trim();
    const category = $("fCategory").value.trim();
    const image = $("fImage").value.trim();
    const download = $("fDownload").value.trim();
    const description = $("fDesc").value.trim();

    if (!title || !category || !image || !download) {
      setStatus($("saveStatus"), "Please fill in all required fields (*).", false);
      return;
    }

    const pack = {
      id: editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      title, category, image, download, description,
      date: editingId
        ? (packs.find(p => p.id === editingId) || {}).date || todayISO()
        : todayISO()
    };

    if (editingId) {
      const i = packs.findIndex(p => p.id === editingId);
      if (i > -1) packs[i] = pack;
    } else {
      packs.unshift(pack);
    }

    await savePacks($("saveStatus"), editingId ? "Pack updated! ✅" : "Pack published! ✅");
    resetForm();
  });

  async function delPack(id) {
    const pack = packs.find(p => p.id === id);
    if (!pack) return;
    if (!confirm('Delete "' + pack.title + '"?')) return;
    packs = packs.filter(p => p.id !== id);
    await savePacks($("saveStatus"), "Pack deleted.");
  }

  async function savePacks(statusEl, okMsg) {
    $("saveBtn").disabled = true;
    try {
      await api("savePacks", { packs });
      renderList();
      setStatus(statusEl, okMsg, true);
    } catch (e) {
      setStatus(statusEl, "Error: " + e.message, false);
      await loadData(); // resync
    }
    $("saveBtn").disabled = false;
  }

  $("saveConfigBtn").addEventListener("click", async () => {
    config.discord = $("fDiscord").value.trim();
    $("saveConfigBtn").disabled = true;
    try {
      await api("saveConfig", { config });
      setStatus($("configStatus"), "Settings saved! ✅", true);
    } catch (e) {
      setStatus($("configStatus"), "Error: " + e.message, false);
    }
    $("saveConfigBtn").disabled = false;
  });

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  // Auto-login if password stored this session
  if (getPass()) tryLogin(getPass());
})();
