/* Solar Scenepacks — front-end */
(function () {
  let packs = [];
  let config = { discord: "" };
  let activeCategory = "All";
  let searchTerm = "";
  let sortMode = "newest"; // "newest" | "popular"
  let downloads = {}; // packId -> count
  let currentPack = null;
  let showFavsOnly = false;
  let shownCount = 0;          // how many cards are currently rendered (pagination)
  const PAGE_SIZE = 12;        // cards per "Load more" batch

  // ── Favorites (saved in the visitor's browser, no login) ──
  const FAVS_KEY = "solar-favs";
  let favs = new Set();
  try { favs = new Set(JSON.parse(localStorage.getItem(FAVS_KEY) || "[]")); } catch (e) {}
  function isFav(id) { return favs.has(String(id)); }
  function toggleFav(id) {
    id = String(id);
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    try { localStorage.setItem(FAVS_KEY, JSON.stringify([...favs])); } catch (e) {}
  }

  // A pack counts as "new" if dated within the last 7 days
  function isNew(pack) {
    if (!pack.date) return false;
    const d = new Date(pack.date);
    if (isNaN(d)) return false;
    return (Date.now() - d.getTime()) < 7 * 24 * 60 * 60 * 1000;
  }

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
    updateStats();
    fetch(COUNTER_API + "/" + counterKey(pack) + "/up").catch(() => {});
  }

  function updateModalCount(pack) {
    const el = document.getElementById("modalDownloads");
    if (el) el.textContent = fmtCount(downloads[pack.id] || 0) + " downloads";
  }

  function updateStats() {
    const totalDl = Object.values(downloads).reduce((a, b) => a + b, 0);
    const el = id => document.getElementById(id);
    if (el("statPacks")) el("statPacks").textContent = fmtCount(packs.length);
    if (el("statDownloads")) el("statDownloads").textContent = fmtCount(totalDl);
    if (el("statCategories")) el("statCategories").textContent = String(Math.max(categories().length - 1, 0));
  }

  function categories() {
    const cats = new Set(packs.map(p => p.category).filter(Boolean));
    return ["All", ...cats];
  }

  function renderFilters() {
    filtersEl.innerHTML = "";
    categories().forEach(cat => {
      const btn = document.createElement("button");
      btn.className = "filter-btn" + (!showFavsOnly && cat === activeCategory ? " active" : "");
      btn.textContent = cat;
      btn.addEventListener("click", () => {
        activeCategory = cat;
        showFavsOnly = false;
        shownCount = 0;
        renderFilters();
        renderGrid();
      });
      filtersEl.appendChild(btn);
    });

    // ❤ Favorites chip — only appears once the visitor has saved something
    if (favs.size) {
      const favBtn = document.createElement("button");
      favBtn.className = "filter-btn filter-fav" + (showFavsOnly ? " active" : "");
      favBtn.innerHTML = '<span class="fav-heart">♥</span> Favorites <span class="fav-chip-count">' + favs.size + "</span>";
      favBtn.addEventListener("click", () => {
        showFavsOnly = !showFavsOnly;
        shownCount = 0;
        renderFilters();
        renderGrid();
      });
      filtersEl.appendChild(favBtn);
    }
  }

  function visiblePacks() {
    const list = packs.filter(p => {
      if (showFavsOnly && !isFav(p.id)) return false;
      const matchCat = showFavsOnly || activeCategory === "All" || p.category === activeCategory;
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
    if (shownCount <= 0) shownCount = PAGE_SIZE;
    const visible = list.slice(0, shownCount);

    grid.innerHTML = "";
    emptyState.hidden = list.length > 0;
    packCount.textContent = list.length + (list.length === 1 ? " scenepack" : " scenepacks");
    gridTitle.textContent = showFavsOnly
      ? "Your Favorites"
      : sortMode === "popular"
        ? (activeCategory === "All" ? "Most Popular Scenepacks" : "Popular " + activeCategory + " Scenepacks")
        : (activeCategory === "All" ? "Latest Scenepacks" : activeCategory + " Scenepacks");

    visible.forEach((pack, i) => {
      const card = document.createElement("div");
      card.className = "pack-card";
      card.style.animationDelay = Math.min(i * 40, 400) + "ms";
      const dl = downloads[pack.id] || 0;
      card.innerHTML = `
        <div class="thumb-wrap">
        ${isNew(pack) ? '<span class="badge-new">NEW</span>' : ""}
        <button class="fav-btn${isFav(pack.id) ? " faved" : ""}" type="button" aria-label="Save to favorites" title="Save to favorites">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        </button>
        <img class="pack-thumb" src="${escapeHtml(pack.image || "")}" alt="${escapeHtml(pack.title)}" loading="lazy"
             onerror="this.src='data:image/svg+xml,${encodeURIComponent('<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 160 100\"><rect width=\"160\" height=\"100\" fill=\"%230b0d12\"/><text x=\"80\" y=\"55\" font-size=\"30\" text-anchor=\"middle\">🎬</text></svg>')}'">
        </div>
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
      // Heart toggles favorite without opening the pack
      const favBtn = card.querySelector(".fav-btn");
      favBtn.addEventListener("click", e => {
        e.stopPropagation();
        toggleFav(pack.id);
        favBtn.classList.toggle("faved", isFav(pack.id));
        renderFilters();
        // If we're in the favorites view and just un-favorited, drop the card
        if (showFavsOnly && !isFav(pack.id)) renderGrid();
      });
      card.addEventListener("click", () => {
        location.href = "show.html?pack=" + encodeURIComponent(pack.id);
      });
      grid.appendChild(card);
    });

    renderLoadMore(list.length);
  }

  // "Load more" button — reveals the next batch of cards
  function renderLoadMore(total) {
    let btn = document.getElementById("loadMoreBtn");
    if (shownCount < total) {
      if (!btn) {
        btn = document.createElement("button");
        btn.id = "loadMoreBtn";
        btn.className = "load-more";
        btn.addEventListener("click", () => {
          shownCount += PAGE_SIZE;
          renderGrid();
        });
        grid.parentNode.insertBefore(btn, grid.nextSibling);
      }
      btn.textContent = "Load more (" + (total - shownCount) + " more)";
      btn.hidden = false;
    } else if (btn) {
      btn.hidden = true;
    }
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
      shownCount = 0;
      document.querySelectorAll(".sort-btn").forEach(b =>
        b.classList.toggle("active", b === btn)
      );
      renderGrid();
    });
  });

  searchInput.addEventListener("input", e => {
    searchTerm = e.target.value;
    shownCount = 0;
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
      document.getElementById("discordCta")
    ];
    links.forEach(a => {
      if (!a) return;
      a.href = config.discord || "#";
    });
    // Announcement banner (set from the admin panel)
    const bar = document.getElementById("announceBar");
    const barText = document.getElementById("announceText");
    if (bar && barText) {
      const show = config.announcementOn && (config.announcement || "").trim();
      bar.hidden = !show;
      if (show) barText.textContent = config.announcement;
    }
  }

  applyConfig();

  // Back to top button
  const backToTop = document.getElementById("backToTop");
  if (backToTop) {
    window.addEventListener("scroll", () => {
      backToTop.hidden = window.scrollY < 400;
    }, { passive: true });
    backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  // Scroll-reveal: sections fade up entering the viewport, fade out leaving it
  const revealEls = document.querySelectorAll(
    ".grid-header, .info-section .section-title, .info-section .section-sub, .info-card, .faq-section .section-title, .faq-section .section-sub, .faq-item, .cta-inner"
  );
  revealEls.forEach(el => el.classList.add("reveal"));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach((entry, idx) => {
        if (entry.isIntersecting) {
          entry.target.style.transitionDelay = Math.min((idx % 6) * 80, 400) + "ms";
          entry.target.classList.add("visible");
          entry.target.classList.remove("fade-out");
        } else if (entry.target.classList.contains("visible")) {
          // Element left the viewport — fade it out so it animates again next time
          entry.target.style.transitionDelay = "0ms";
          entry.target.classList.add("fade-out");
          entry.target.classList.remove("visible");
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -4% 0px" });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add("visible"));
  }

  // Load data
  Promise.all([
    fetch("packs.json?v=" + Date.now()).then(r => r.json()).catch(() => []),
    fetch("config.json?v=" + Date.now()).then(r => r.json()).catch(() => ({}))
  ]).then(([p, c]) => {
    packs = (Array.isArray(p) ? p : []).filter(x => !x.hidden);
    config = Object.assign(config, c);
    applyConfig();
    renderFilters();
    renderGrid();
    updateStats();
    // Deep link: old ?pack=<id> links redirect to the pack's show page
    const packParam = new URLSearchParams(location.search).get("pack");
    if (packParam && packs.some(x => String(x.id) === packParam)) {
      location.replace("show.html?pack=" + encodeURIComponent(packParam));
      return;
    }
    // Fetch download counts, then re-render so numbers appear
    loadDownloadCounts().then(() => { renderGrid(); updateStats(); });
  });
})();
