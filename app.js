/* Solar Scenepacks — front-end */
(function () {
  let packs = [];
  let config = { discord: "" };
  let activeCategory = "All";
  let searchTerm = "";
  let sortMode = "newest"; // "newest" | "popular"
  let downloads = {}; // packId -> count
  let currentPack = null;

  // Free counter service — counts persist online, shared for all visitors
  const COUNTER_NS = "solar-scenepacks";
  const COUNTER_API = "https://api.counterapi.dev/v1/" + COUNTER_NS;

  const grid = document.getElementById("packsGrid");
  const filtersEl = document.getElementById("filters");
  const emptyState = document.getElementById("emptyState");
  const packCount = document.getElementById("packCount");
  const gridTitle = document.getElementById("gridTitle");
  const searchInput = document.getElementById("searchInput");

  // Modal elements
  const overlay = document.getElementById("modalOverlay");
  const modalImg = document.getElementById("modalImg");
  const modalTitle = document.getElementById("modalTitle");
  const modalCategory = document.getElementById("modalCategory");
  const modalDate = document.getElementById("modalDate");
  const modalDesc = document.getElementById("modalDesc");
  const modalDownload = document.getElementById("modalDownload");

  document.getElementById("year").textContent = new Date().getFullYear();

  // Mobile menu
  const menuToggle = document.getElementById("menuToggle");
  if (menuToggle) {
    menuToggle.addEventListener("click", () =>
      document.querySelector(".nav").classList.toggle("open")
    );
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function fmtCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function counterKey(pack) {
    return "dl-" + String(pack.id || pack.title || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  }

  function loadDownloadCounts() {
    // Fetch current count for each pack (read-only, doesn't increment)
    return Promise.all(packs.map(pack =>
      fetch(COUNTER_API + "/" + counterKey(pack) + "/")
        .then(r => r.json())
        .then(d => { downloads[pack.id] = d.count || 0; })
        .catch(() => { downloads[pack.id] = 0; })
    ));
  }

  function trackDownload(pack) {
    downloads[pack.id] = (downloads[pack.id] || 0) + 1;
    renderGrid();
    updateModalCount(pack);
    fetch(COUNTER_API + "/" + counterKey(pack) + "/up").catch(() => {});
  }

  function updateModalCount(pack) {
    const el = document.getElementById("modalDownloads");
    if (el) el.textContent = fmtCount(downloads[pack.id] || 0) + " downloads";
  }

  function categories() {
    const cats = new Set(packs.map(p => p.category).filter(Boolean));
    return ["All", ...cats];
  }

  function renderFilters() {
    filtersEl.innerHTML = "";
    categories().forEach(cat => {
      const btn = document.createElement("button");
      btn.className = "filter-btn" + (cat === activeCategory ? " active" : "");
      btn.textContent = cat;
      btn.addEventListener("click", () => {
        activeCategory = cat;
        renderFilters();
        renderGrid();
      });
      filtersEl.appendChild(btn);
    });
  }

  function visiblePacks() {
    const list = packs.filter(p => {
      const matchCat = activeCategory === "All" || p.category === activeCategory;
      const q = searchTerm.trim().toLowerCase();
      const matchSearch =
        !q ||
        (p.title || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
    if (sortMode === "popular") {
      list.sort((a, b) => (downloads[b.id] || 0) - (downloads[a.id] || 0));
    } else {
      list.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    }
    return list;
  }

  function renderGrid() {
    const list = visiblePacks();
    grid.innerHTML = "";
    emptyState.hidden = list.length > 0;
    packCount.textContent = list.length + (list.length === 1 ? " scenepack" : " scenepacks");
    gridTitle.textContent =
      sortMode === "popular"
        ? (activeCategory === "All" ? "Most Popular Scenepacks" : "Popular " + activeCategory + " Scenepacks")
        : (activeCategory === "All" ? "Latest Scenepacks" : activeCategory + " Scenepacks");

    list.forEach(pack => {
      const card = document.createElement("div");
      card.className = "pack-card";
      const dl = downloads[pack.id] || 0;
      card.innerHTML = `
        <img class="pack-thumb" src="${escapeHtml(pack.image || "")}" alt="${escapeHtml(pack.title)}" loading="lazy"
             onerror="this.src='data:image/svg+xml,${encodeURIComponent('<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 160 100\"><rect width=\"160\" height=\"100\" fill=\"%23e3f0fc\"/><text x=\"80\" y=\"55\" font-size=\"30\" text-anchor=\"middle\">🎬</text></svg>')}'">
        <div class="pack-info">
          <div class="pack-title">${escapeHtml(pack.title)}</div>
          <div class="pack-meta">
            <span class="tag">${escapeHtml(pack.category || "Pack")}</span>
            <span class="pack-downloads" title="Downloads">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              ${fmtCount(dl)}
            </span>
          </div>
        </div>`;
      card.addEventListener("click", () => openModal(pack));
      grid.appendChild(card);
    });
  }

  function openModal(pack, updateUrl = true) {
    currentPack = pack;
    modalImg.src = pack.image || "";
    modalImg.alt = pack.title;
    modalTitle.textContent = pack.title;
    modalCategory.textContent = pack.category || "Pack";
    modalDate.textContent = fmtDate(pack.date);
    modalDesc.textContent = pack.description || "";
    modalDownload.href = pack.download || "#";
    updateModalCount(pack);
    resetShareBtn();
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    // Shareable link: ?pack=<id>
    if (updateUrl && pack.id) {
      const url = new URL(location.href);
      url.searchParams.set("pack", pack.id);
      history.replaceState(null, "", url);
    }
  }

  function closeModal() {
    overlay.hidden = true;
    document.body.style.overflow = "";
    // Remove ?pack= from the URL
    const url = new URL(location.href);
    if (url.searchParams.has("pack")) {
      url.searchParams.delete("pack");
      history.replaceState(null, "", url);
    }
  }

  document.getElementById("modalClose").addEventListener("click", closeModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

  modalDownload.addEventListener("click", () => {
    if (currentPack) trackDownload(currentPack);
  });

  // Share button — copies a direct link to this pack
  const shareBtn = document.getElementById("modalShare");
  const shareText = document.getElementById("modalShareText");
  function resetShareBtn() {
    if (shareText) shareText.textContent = "Share";
    if (shareBtn) shareBtn.classList.remove("copied");
  }
  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      if (!currentPack) return;
      const url = new URL(location.origin + location.pathname);
      url.searchParams.set("pack", currentPack.id);
      const link = url.toString();
      const done = () => {
        shareText.textContent = "Link copied!";
        shareBtn.classList.add("copied");
        setTimeout(resetShareBtn, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done).catch(() => fallbackCopy(link, done));
      } else {
        fallbackCopy(link, done);
      }
    });
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) {}
    document.body.removeChild(ta);
  }

  // Sort buttons (Newest / Most Popular)
  document.querySelectorAll(".sort-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      sortMode = btn.dataset.sort;
      document.querySelectorAll(".sort-btn").forEach(b =>
        b.classList.toggle("active", b === btn)
      );
      renderGrid();
    });
  });

  searchInput.addEventListener("input", e => {
    searchTerm = e.target.value;
    renderGrid();
  });

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function applyConfig() {
    const links = [
      document.getElementById("discordLink"),
      document.getElementById("discordLinkFooter"),
      document.getElementById("requestLink"),
      document.getElementById("requestLinkFooter")
    ];
    links.forEach(a => {
      if (!a) return;
      a.href = config.discord || "#";
    });
  }

  applyConfig();

  // Load data
  Promise.all([
    fetch("packs.json?v=" + Date.now()).then(r => r.json()).catch(() => []),
    fetch("config.json?v=" + Date.now()).then(r => r.json()).catch(() => ({}))
  ]).then(([p, c]) => {
    packs = Array.isArray(p) ? p : [];
    config = Object.assign(config, c);
    applyConfig();
    renderFilters();
    renderGrid();
    // Deep link: open ?pack=<id> directly (shared links)
    const packParam = new URLSearchParams(location.search).get("pack");
    if (packParam) {
      const shared = packs.find(x => String(x.id) === packParam);
      if (shared) openModal(shared, false);
    }
    // Fetch download counts, then re-render so numbers appear
    loadDownloadCounts().then(renderGrid);
  });
})();
