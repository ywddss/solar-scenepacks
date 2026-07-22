/* Solar Scenepacks — show page (scenepack detail) */
(function () {
  let packs = [];
  let config = { discord: "" };
  let downloads = {};
  let current = null;   // the pack opened via ?pack=<id>
  let group = [];       // all packs of the same show/title group

  const COUNTER_NS = "solar-scenepacks";
  const COUNTER_API = "https://api.counterapi.dev/v1/" + COUNTER_NS;

  const $ = id => document.getElementById(id);
  document.getElementById("year").textContent = new Date().getFullYear();

  const menuToggle = $("menuToggle");
  if (menuToggle) {
    menuToggle.addEventListener("click", () =>
      document.querySelector(".nav").classList.toggle("open"));
  }

  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function counterKey(pack) {
    return "dl-" + String(pack.id || pack.title || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  }

  // ── Favorites (shared with the home page via localStorage) ──
  const FAVS_KEY = "solar-favs";
  let favs = new Set();
  try { favs = new Set(JSON.parse(localStorage.getItem(FAVS_KEY) || "[]")); } catch (e) {}
  function isFav(id) { return favs.has(String(id)); }
  function toggleFav(id) {
    id = String(id);
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    try { localStorage.setItem(FAVS_KEY, JSON.stringify([...favs])); } catch (e) {}
  }

  function isNew(pack) {
    if (!pack.date) return false;
    const d = new Date(pack.date);
    if (isNaN(d)) return false;
    return (Date.now() - d.getTime()) < 7 * 24 * 60 * 60 * 1000;
  }

  function loadDownloadCounts(list) {
    return Promise.all(list.map(pack =>
      fetch(COUNTER_API + "/" + counterKey(pack) + "/")
        .then(r => r.json())
        .then(d => { downloads[pack.id] = d.count || 0; })
        .catch(() => { downloads[pack.id] = 0; })
    ));
  }

  function trackDownload(pack) {
    downloads[pack.id] = (downloads[pack.id] || 0) + 1;
    renderTable();
    renderStats();
    fetch(COUNTER_API + "/" + counterKey(pack) + "/up").catch(() => {});
  }

  // Group name: explicit `show` field, otherwise the pack's own title
  function groupName(p) {
    return (p.show || p.title || "").trim().toLowerCase();
  }

  function applyConfig() {
    ["discordLink", "discordLinkFooter", "requestLink"].forEach(id => {
      const a = $(id);
      if (a) a.href = config.discord || "#";
    });
    const bar = $("announceBar"), barText = $("announceText");
    if (bar && barText) {
      const show = config.announcementOn && (config.announcement || "").trim();
      bar.hidden = !show;
      if (show) barText.textContent = config.announcement;
    }
  }

  function renderHero() {
    const p = current;
    const showName = p.show || p.title;
    document.title = showName + " Scenepacks — Solar Scenepacks";

    $("showBackdrop").style.backgroundImage = "url('" + (p.image || "") + "')";
    $("showPoster").src = p.image || "";
    $("showPoster").alt = showName;
    $("showTitle").textContent = showName;
    $("showYear").textContent = p.year ? "(" + p.year + ")" : "";

    // Meta badges: category, genres, quality, encoding, clips
    const meta = $("showMeta");
    meta.innerHTML = "";
    const badges = [];
    if (p.category) badges.push(p.category);
    if (p.genres) String(p.genres).split(",").map(s => s.trim()).filter(Boolean).forEach(g => badges.push(g));
    if (p.quality) badges.push(p.quality);
    if (p.encoding) badges.push(p.encoding);
    badges.forEach(b => {
      const span = document.createElement("span");
      span.className = "show-badge";
      span.textContent = b;
      meta.appendChild(span);
    });

    $("showPlot").textContent = p.description || "";
    $("heroDownload").href = p.download || "#";
    $("heroDownload").target = "_blank";
    $("heroDownload").rel = "noopener";
    $("heroDownload").addEventListener("click", () => trackDownload(p));
  }

  function renderStats() {
    $("statPackCount").textContent = group.length;
    const total = group.reduce((s, p) => s + (downloads[p.id] || 0), 0);
    $("statDlCount").textContent = fmtCount(total);
  }

  function renderTable() {
    const rows = $("packRows");
    const showName = current.show || current.title;
    $("tableTitle").textContent = showName + " scenepacks";
    $("tableCount").textContent = group.length + (group.length === 1 ? " pack" : " packs");
    rows.innerHTML = "";
    group.forEach(p => {
      const tr = document.createElement("tr");
      if (p.id === current.id) tr.className = "row-current";
      tr.innerHTML = `
        <td>
          <div class="scp-cell-title">
            <div>
              <div class="scp-name">${esc(p.title)}</div>
              <div class="scp-sub">${esc(p.date || "")}</div>
            </div>
          </div>
        </td>
        <td class="col-opt">${p.quality ? '<span class="scp-pill">' + esc(p.quality) + "</span>" : "–"}</td>
        <td class="col-opt">${p.encoding ? '<span class="scp-pill scp-pill-alt">' + esc(p.encoding) + "</span>" : "–"}</td>
        <td class="col-opt">${esc(p.size || "–")}</td>
        <td class="scp-dl-count">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          ${fmtCount(downloads[p.id] || 0)}
        </td>
        <td>
          <a class="btn-download btn-table-dl" href="${esc(p.download || "#")}" target="_blank" rel="noopener" data-dl="${esc(p.id)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download
          </a>
        </td>`;
      rows.appendChild(tr);
    });
    rows.querySelectorAll("[data-dl]").forEach(a =>
      a.addEventListener("click", () => {
        const p = packs.find(x => x.id === a.dataset.dl);
        if (p) trackDownload(p);
      }));
  }

  function renderRelated() {
    const others = packs.filter(p => groupName(p) !== groupName(current)).slice(0, 8);
    if (!others.length) return;
    $("relatedWrap").hidden = false;
    const grid = $("relatedGrid");
    grid.innerHTML = "";
    others.forEach(p => {
      const card = document.createElement("a");
      card.className = "pack-card";
      card.href = "show.html?pack=" + encodeURIComponent(p.id);
      card.innerHTML = `
        <div class="thumb-wrap">
          ${isNew(p) ? '<span class="badge-new">NEW</span>' : ""}
          <button class="fav-btn${isFav(p.id) ? " faved" : ""}" type="button" aria-label="Save to favorites" title="Save to favorites">
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </button>
          <img class="pack-thumb" src="${esc(p.image || "")}" alt="${esc(p.title)}" loading="lazy">
        </div>
        <div class="pack-info">
          <div class="pack-title">${esc(p.title)}</div>
          <div class="pack-meta">
            <span class="tag">${esc(p.category || "Pack")}</span>
            <span class="pack-downloads">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              ${fmtCount(downloads[p.id] || 0)}
            </span>
          </div>
        </div>`;
      const favBtn = card.querySelector(".fav-btn");
      favBtn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        toggleFav(p.id);
        favBtn.classList.toggle("faved", isFav(p.id));
      });
      grid.appendChild(card);
    });
  }

  // Favorite button (hero)
  const favBtn = $("showFav"), favText = $("showFavText");
  function syncHeroFav() {
    if (!favBtn || !current) return;
    const on = isFav(current.id);
    favBtn.classList.toggle("faved", on);
    if (favText) favText.textContent = on ? "Favorited" : "Favorite";
  }
  if (favBtn) {
    favBtn.addEventListener("click", () => {
      if (!current) return;
      toggleFav(current.id);
      syncHeroFav();
    });
  }

  // Share button
  const shareBtn = $("showShare"), shareText = $("showShareText");
  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      if (!current) return;
      const link = location.origin + "/show.html?pack=" + encodeURIComponent(current.id);
      const done = () => {
        shareText.textContent = "Link copied!";
        shareBtn.classList.add("copied");
        setTimeout(() => { shareText.textContent = "Share"; shareBtn.classList.remove("copied"); }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done).catch(() => {});
      }
    });
  }

  // ── Load ──
  Promise.all([
    fetch("packs.json?v=" + Date.now()).then(r => r.json()).catch(() => []),
    fetch("config.json?v=" + Date.now()).then(r => r.json()).catch(() => ({}))
  ]).then(([p, c]) => {
    packs = (Array.isArray(p) ? p : []).filter(x => !x.hidden);
    config = Object.assign(config, c);
    applyConfig();

    const id = new URLSearchParams(location.search).get("pack");
    current = packs.find(x => String(x.id) === id);
    if (!current) {
      $("showHero").style.display = "none";
      document.querySelector(".scp-table-wrap").style.display = "none";
      $("notFound").hidden = false;
      return;
    }
    group = packs.filter(p => groupName(p) === groupName(current));
    renderHero();
    syncHeroFav();
    renderStats();
    renderTable();
    renderRelated();
    loadDownloadCounts(packs).then(() => { renderStats(); renderTable(); renderRelated(); });
  });
})();
