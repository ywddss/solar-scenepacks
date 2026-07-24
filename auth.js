/* Solar Scenepacks — shared Discord login + gated downloads.
   Included on every page before app.js / show.js. Exposes window.SolarAuth. */
window.SolarAuth = (function () {
  let state = { loggedIn: false, member: false, user: null, loaded: false };
  const waiting = [];

  // ── Nav UI: swap the "Log in" button for the account box ──
  function renderNav() {
    const loginBtn = document.getElementById("loginBtn");
    const accountBox = document.getElementById("accountBox");
    if (loginBtn) {
      loginBtn.hidden = state.loggedIn;
      loginBtn.href = loginUrl();
    }
    if (accountBox) {
      accountBox.hidden = !state.loggedIn;
      if (state.loggedIn && state.user) {
        const avatar = document.getElementById("accountAvatar");
        const name = document.getElementById("accountName");
        if (avatar) {
          if (state.user.avatar) { avatar.src = state.user.avatar; avatar.hidden = false; }
          else avatar.hidden = true;
        }
        if (name) name.textContent = state.user.name || "Member";
      }
    }
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn && !logoutBtn._wired) {
      logoutBtn._wired = true;
      logoutBtn.addEventListener("click", () => { location.href = "/api/auth/logout"; });
    }
  }

  function loginUrl() {
    return "/api/auth/login?returnTo=" + encodeURIComponent(location.pathname + location.search);
  }

  // ── Toast (login feedback / gate messages) ──
  let toastTimer = null;
  function toast(html, kind) {
    let el = document.getElementById("solarToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "solarToast";
      el.className = "solar-toast";
      document.body.appendChild(el);
    }
    el.className = "solar-toast" + (kind ? " toast-" + kind : "");
    el.innerHTML = html;
    // force reflow so the transition replays
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 6000);
  }

  // ── Handle ?login=ok|error|notmember flags left by the OAuth callback ──
  function handleReturnFlags() {
    const p = new URLSearchParams(location.search);
    const login = p.get("login");
    if (!login) return;
    const discord = (window.__solarDiscordInvite || "").trim();
    const joinLink = discord
      ? ' <a href="' + discord + '" target="_blank" rel="noopener">Join the server</a>'
      : "";
    if (login === "ok") {
      toast("✓ Logged in with Discord.", "ok");
    } else if (login === "notmember") {
      const name = p.get("name") ? " " + p.get("name") : "";
      toast("Almost there" + name + "! You need to join our Discord server to download." + joinLink, "warn");
    } else if (login === "error") {
      toast("Login failed — please try again.", "err");
    }
    // Clean the flags out of the URL
    ["login", "reason", "name"].forEach(k => p.delete(k));
    const qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  }

  // ── Gated download: routes through /api/download, prompting login/join as needed ──
  // onProceed() runs only when the download is actually allowed (member) — use it
  // to bump the download counter.
  function gateDownload(packId, onProceed) {
    if (!state.loaded) { toast("One sec…", ""); return; }
    if (!state.loggedIn) {
      toast("Log in with Discord to download…", "");
      setTimeout(() => { location.href = loginUrl(); }, 700);
      return;
    }
    if (!state.member) {
      const discord = (window.__solarDiscordInvite || "").trim();
      const joinLink = discord
        ? ' <a href="' + discord + '" target="_blank" rel="noopener">Join the server</a>'
        : "";
      toast("You need to join our Discord server to download." + joinLink, "warn");
      return;
    }
    if (typeof onProceed === "function") onProceed();
    location.href = "/api/download?pack=" + encodeURIComponent(packId);
  }

  function onReady(cb) {
    if (state.loaded) cb(state); else waiting.push(cb);
  }

  // ── Boot ──
  async function load() {
    try {
      const r = await fetch("/api/auth/me", { credentials: "same-origin" });
      const d = await r.json();
      state = { loggedIn: !!d.loggedIn, member: !!d.member, user: d.user || null, loaded: true };
    } catch (e) {
      state.loaded = true;
    }
    renderNav();
    handleReturnFlags();
    waiting.splice(0).forEach(cb => { try { cb(state); } catch (e) {} });
  }
  load();

  return {
    onReady,
    gateDownload,
    loginUrl,
    get state() { return state; }
  };
})();
