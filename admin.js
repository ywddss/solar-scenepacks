/* Solar Scenepacks — admin panel */
(function () {
  const API = "/api/admin";
  const COUNTER_API = "https://api.counterapi.dev/v1/solar-scenepacks";
  let packs = [];
  let config = { discord: "", announcement: "", announcementOn: false };
  let downloads = {}; // packId -> count
  let editingId = null;
  let listQuery = "";
  let listCat = "";

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

  // ── Tabs ──
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  function switchTab(name) {
    document.querySelectorAll(".tab-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-view").forEach(v =>
      v.classList.toggle("active", v.id === "tab-" + name));
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
    loadDownloadCounts();
  }

  // ── Data ──
  async function loadData() {
    const [p, c] = await Promise.all([
      fetch("packs.json?v=" + Date.now()).then(r => r.json()).catch(() => []),
      fetch("config.json?v=" + Date.now()).then(r => r.json()).catch(() => ({}))
    ]);
    packs = Array.isArray(p) ? p : [];
    packs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    config = Object.assign({ discord: "", announcement: "", announcementOn: false }, c);
    $("fDiscord").value = config.discord || "";
    $("fAnnounce").value = config.announcement || "";
    $("fAnnounceOn").checked = !!config.announcementOn;
    renderAll();
  }

  function counterKey(pack) {
    return "dl-" + String(pack.id || pack.title || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  }

  function loadDownloadCounts() {
    Promise.all(packs.map(pack =>
      fetch(COUNTER_API + "/" + counterKey(pack) + "/")
        .then(r => r.json())
        .then(d => { downloads[pack.id] = d.count || 0; })
        .catch(() => { downloads[pack.id] = 0; })
    )).then(renderAll);
  }

  function fmtCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function renderAll() {
    renderDashboard();
    renderList();
    renderCategoryFilter();
  }

  // ── Dashboard ──
  function renderDashboard() {
    const visible = packs.filter(p => !p.hidden);
    const hidden = packs.filter(p => p.hidden);
    const totalDl = packs.reduce((sum, p) => sum + (downloads[p.id] || 0), 0);
    const cats = new Set(packs.map(p => p.category).filter(Boolean));
    $("dashPacks").textContent = visible.length;
    $("dashHidden").textContent = hidden.length;
    $("dashDownloads").textContent = fmtCount(totalDl);
    $("dashCategories").textContent = cats.size;

    const top = packs.slice()
      .sort((a, b) => (downloads[b.id] || 0) - (downloads[a.id] || 0))
      .slice(0, 5);
    renderMiniList($("topList"), top, (p, i) =>
      `<span class="top-rank">${i + 1}</span>` , p => fmtCount(downloads[p.id] || 0) + " dl");

    const recent = packs.slice(0, 5); // already sorted newest first
    renderMiniList($("recentList"), recent, () => "", p => esc(p.date || ""));
  }

  function renderMiniList(el, list, leftFn, rightFn) {
    if (!list.length) {
      el.innerHTML = '<p style="color:var(--text-soft)">No packs yet.</p>';
      return;
    }
    el.innerHTML = list.map((p, i) => `
      <div class="top-item">
        ${leftFn(p, i)}
        <img src="${esc(p.image || "")}" alt="" onerror="this.style.visibility='hidden'">
        <span class="t">${esc(p.title)}${p.hidden ? ' <span class="badge hidden-badge">hidden</span>' : ""}</span>
        <span class="d">${rightFn(p)}</span>
      </div>`).join("");
  }

  // ── Pack list ──
  function renderCategoryFilter() {
    const sel = $("listCategory");
    const cats = [...new Set(packs.map(p => p.category).filter(Boolean))].sort();
    const cur = sel.value;
    sel.innerHTML = '<option value="">All categories</option>' +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    sel.value = cats.includes(cur) ? cur : "";
  }

  $("listSearch").addEventListener("input", e => { listQuery = e.target.value; renderList(); });
  $("listCategory").addEventListener("change", e => { listCat = e.target.value; renderList(); });

  function renderList() {
    const list = $("adminList");
    $("adminCount").textContent = packs.length;
    $("tabPackCount").textContent = packs.length ? "(" + packs.length + ")" : "";
    const q = listQuery.trim().toLowerCase();
    const filtered = packs.filter(p => {
      const matchQ = !q || (p.title || "").toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q);
      const matchC = !listCat || p.category === listCat;
      return matchQ && matchC;
    });
    list.innerHTML = "";
    if (!packs.length) {
      list.innerHTML = '<p style="color:var(--text-soft)">No packs yet — post your first one in the New Pack tab!</p>';
      return;
    }
    if (!filtered.length) {
      list.innerHTML = '<p style="color:var(--text-soft)">No packs match your search.</p>';
      return;
    }
    filtered.forEach(pack => {
      const row = document.createElement("div");
      row.className = "pack-row" + (pack.hidden ? " is-hidden" : "");
      row.innerHTML = `
        <img src="${esc(pack.image || "")}" alt="" onerror="this.style.visibility='hidden'">
        <div class="pack-row-info">
          <div class="pack-row-title">${esc(pack.title)}${pack.hidden ? ' <span class="badge hidden-badge">hidden</span>' : ""}</div>
          <div class="pack-row-sub">
            <span>${esc(pack.category || "")}</span>
            <span>${esc(pack.date || "")}</span>
            <span>⬇ ${fmtCount(downloads[pack.id] || 0)}</span>
          </div>
        </div>
        <div class="pack-row-actions">
          <button class="btn btn-secondary btn-sm" data-view="${esc(pack.id)}" title="Open on site">👁 View</button>
          <button class="btn btn-secondary btn-sm" data-hide="${esc(pack.id)}">${pack.hidden ? "Show" : "Hide"}</button>
          <button class="btn btn-secondary btn-sm" data-dupe="${esc(pack.id)}">Duplicate</button>
          <button class="btn btn-secondary btn-sm" data-edit="${esc(pack.id)}">Edit</button>
          <button class="btn btn-danger btn-sm" data-del="${esc(pack.id)}">Delete</button>
        </div>`;
      list.appendChild(row);
    });
    list.querySelectorAll("[data-view]").forEach(b =>
      b.addEventListener("click", () => window.open("index.html?pack=" + encodeURIComponent(b.dataset.view), "_blank")));
    list.querySelectorAll("[data-hide]").forEach(b =>
      b.addEventListener("click", () => toggleHide(b.dataset.hide)));
    list.querySelectorAll("[data-dupe]").forEach(b =>
      b.addEventListener("click", () => dupePack(b.dataset.dupe)));
    list.querySelectorAll("[data-edit]").forEach(b =>
      b.addEventListener("click", () => startEdit(b.dataset.edit)));
    list.querySelectorAll("[data-del]").forEach(b =>
      b.addEventListener("click", () => delPack(b.dataset.del)));
  }

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
    $("fHidden").checked = !!pack.hidden;
    switchTab("new");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    editingId = null;
    $("formHeading").textContent = "➕ Post a new scenepack";
    $("saveBtn").textContent = "Publish pack";
    $("cancelEditBtn").hidden = true;
    ["fTitle", "fCategory", "fImage", "fDownload", "fDesc"].forEach(id => $(id).value = "");
    $("fHidden").checked = false;
    $("imgPreview").style.display = "none";
  }
  $("cancelEditBtn").addEventListener("click", resetForm);

  $("saveBtn").addEventListener("click", async () => {
    const title = $("fTitle").value.trim();
    const category = $("fCategory").value.trim();
    const image = $("fImage").value.trim();
    const download = $("fDownload").value.trim();
    const description = $("fDesc").value.trim();
    const hidden = $("fHidden").checked;

    if (!title || !category || !image || !download) {
      setStatus($("saveStatus"), "Please fill in all required fields (*).", false);
      return;
    }

    const pack = {
      id: editingId || newId(),
      title, category, image, download, description,
      hidden,
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

  async function toggleHide(id) {
    const pack = packs.find(p => p.id === id);
    if (!pack) return;
    pack.hidden = !pack.hidden;
    await savePacks($("saveStatus"), pack.hidden ? "Pack hidden from the site." : "Pack is now visible. ✅");
  }

  async function dupePack(id) {
    const pack = packs.find(p => p.id === id);
    if (!pack) return;
    const copy = Object.assign({}, pack, {
      id: newId(),
      title: pack.title + " (copy)",
      hidden: true,
      date: todayISO()
    });
    packs.unshift(copy);
    await savePacks($("saveStatus"), "Duplicated as hidden draft. ✅");
  }

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
      renderAll();
      setStatus(statusEl, okMsg, true);
    } catch (e) {
      setStatus(statusEl, "Error: " + e.message, false);
      await loadData(); // resync
    }
    $("saveBtn").disabled = false;
  }

  // ── Settings ──
  $("saveConfigBtn").addEventListener("click", async () => {
    config.discord = $("fDiscord").value.trim();
    config.announcement = $("fAnnounce").value.trim();
    config.announcementOn = $("fAnnounceOn").checked;
    $("saveConfigBtn").disabled = true;
    try {
      await api("saveConfig", { config });
      setStatus($("configStatus"), "Settings saved! ✅", true);
    } catch (e) {
      setStatus($("configStatus"), "Error: " + e.message, false);
    }
    $("saveConfigBtn").disabled = false;
  });

  // ── Backup: export / import ──
  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(packs, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "solar-packs-backup-" + todayISO() + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus($("backupStatus"), "Backup downloaded. ✅", true);
  });

  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setStatus($("backupStatus"), "That file isn't valid JSON.", false);
      return;
    }
    if (!Array.isArray(data)) {
      setStatus($("backupStatus"), "File must contain a list of packs.", false);
      return;
    }
    if (!confirm("Replace ALL " + packs.length + " current packs with " + data.length + " packs from this file?")) return;
    packs = data;
    try {
      await api("savePacks", { packs });
      renderAll();
      setStatus($("backupStatus"), "Imported " + data.length + " packs. ✅", true);
    } catch (err) {
      setStatus($("backupStatus"), "Error: " + err.message, false);
      await loadData();
    }
  });

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  // Auto-login if password stored this session
  if (getPass()) tryLogin(getPass());
})();
