// admin/app.js — vanilla JS admin SPA.
const API_PREFIX = "/api/admin";

let csrfToken = "";
let currentUser = null;

const els = {
  app: document.getElementById("app"),
  loginOverlay: document.getElementById("login-overlay"),
  loginForm: document.getElementById("login-form"),
  cloudflareCard: document.getElementById("cloudflare-card"),
  loginUser: document.getElementById("login-user"),
  loginPassword: document.getElementById("login-password"),
  loginError: document.getElementById("login-error"),
  userPill: document.getElementById("user-pill"),
  logoutForm: document.getElementById("logout-form"),
  logoutCsrf: document.getElementById("logout-csrf"),
  sidebar: document.getElementById("sidebar"),
  menuToggle: document.getElementById("menu-toggle"),
  navLinks: document.querySelectorAll(".nav-link"),
  pageTitle: document.getElementById("page-title"),
  pages: document.querySelectorAll(".page"),
  statArtists: document.getElementById("stat-artists"),
  statLive: document.getElementById("stat-live"),
  liveList: document.getElementById("live-list"),
  collectionMeta: document.getElementById("collection-meta"),
  contentStatus: document.getElementById("content-status"),
  contentListCard: document.getElementById("content-list-card"),
  djSearch: document.getElementById("dj-search"),
  djList: document.getElementById("dj-list"),
  djEditor: document.getElementById("dj-editor"),
  djEditorTitle: document.getElementById("dj-editor-title"),
  djEditorBack: document.getElementById("dj-editor-back"),
  djForm: document.getElementById("dj-form"),
  djDelete: document.getElementById("dj-delete"),
  djFormNote: document.getElementById("dj-form-note"),
  djTwitch: document.getElementById("dj-twitch"),
};

async function api(url, options = {}) {
  const opts = {
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  };
  if (csrfToken && !options.noCsrf) {
    opts.headers["x-csrf-token"] = csrfToken;
  }
  const res = await fetch(url, opts);
  return res;
}

function showLogin() {
  showCloudflareCard(true);
  els.loginUser.focus();
}

function showCloudflareCard(passwordLogin) {
  els.loginOverlay.classList.remove("hidden");
  els.app.classList.add("hidden");
  els.cloudflareCard.classList.remove("hidden");
  if (passwordLogin) {
    els.loginForm.classList.remove("hidden");
  } else {
    els.loginForm.classList.add("hidden");
  }
}

function showApp(user) {
  currentUser = user;
  els.loginOverlay.classList.add("hidden");
  els.app.classList.remove("hidden");
  els.userPill.textContent = user;
  els.logoutCsrf.value = csrfToken;
}

async function loadSession() {
  try {
    const res = await fetch(`${API_PREFIX}/me`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showCloudflareCard(data.passwordLogin === true);
      return false;
    }
    const data = await res.json();
    csrfToken = data.csrf || "";
    showApp(data.user);
    return true;
  } catch (e) {
    showCloudflareCard(false);
    return false;
  }
}

async function loadOverview() {
  try {
    const res = await fetch(`${API_PREFIX}/overview`, {
      headers: { "x-csrf-token": csrfToken },
    });
    if (!res.ok) return;
    const data = await res.json();

    els.statArtists.textContent = typeof data.artists === "number" ? data.artists.toLocaleString() : "—";
    els.statLive.textContent = typeof data.liveNow === "number" ? data.liveNow.toLocaleString() : "—";
    if (Array.isArray(data.liveDJs) && data.liveDJs.length) {
      els.liveList.innerHTML = data.liveDJs
        .map((name) => `<li><span class="live-dot" aria-hidden="true"></span>${escapeHtml(name)}</li>`)
        .join("");
    } else {
      els.liveList.innerHTML = `<li class="empty">No DJs are live right now.</li>`;
    }

    const date = new Date(data.generatedAt || Date.now());
    els.collectionMeta.textContent = `Data collection started ${date.toLocaleDateString()} — generated at ${date.toLocaleTimeString()}`;
  } catch (e) {
    console.error("Failed to load overview:", e);
  }
}


function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}








// ---- Content: DJ social links ----------------------------------------------
let djRows = [];
let editingDj = null;

function contentStatusText() {
  const withLinks = djRows.filter((r) => Object.keys(r.socials || {}).length).length;
  return `${djRows.length} DJs · ${withLinks} with links`;
}

function renderDjList() {
  if (!els.djList) return;
  const q = (els.djSearch.value || "").trim().toLowerCase();
  const rows = djRows.filter(
    (r) => !q || r.name.toLowerCase().includes(q) || r.id.includes(q)
  );
  if (!rows.length) {
    els.djList.innerHTML = '<li class="empty">No DJs match that filter.</li>';
    return;
  }
  els.djList.innerHTML = rows
    .map((r) => {
      const count = Object.keys(r.socials || {}).length;
      const badge = count
        ? `<span class="dj-badge">${count} link${count === 1 ? "" : "s"}</span>`
        : '<span class="dj-id">no links</span>';
      return `<li>
        <button class="btn btn-secondary dj-open" type="button" data-dj="${escapeHtml(r.id)}">
          <span class="dj-name">${escapeHtml(r.name)}</span>
          <span class="dj-id">${escapeHtml(r.id)}</span>
        </button>
        ${badge}
      </li>`;
    })
    .join("");
}

async function loadContent(force = false) {
  if (!els.djList) return;
  if (djRows.length && !force) {
    renderDjList();
    return;
  }
  els.contentStatus.textContent = "Loading…";
  try {
    const res = await api(`${API_PREFIX}/content/djs`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    djRows = Array.isArray(data.djs) ? data.djs : [];
    els.contentStatus.textContent = contentStatusText();
    renderDjList();
  } catch (e) {
    els.contentStatus.textContent = "Could not load DJs";
    els.djList.innerHTML = '<li class="empty">Failed to load. Try again.</li>';
    console.error("Failed to load content:", e);
  }
}

function setNote(text, kind) {
  if (!els.djFormNote) return;
  els.djFormNote.textContent = text || "";
  els.djFormNote.classList.toggle("ok", kind === "ok");
  els.djFormNote.classList.toggle("error", kind === "error");
}

function openEditor(id) {
  const row = djRows.find((r) => r.id === id);
  if (!row) return;
  editingDj = row;
  els.djEditorTitle.textContent = `${row.name} · ${row.id}`;
  if (els.djTwitch) els.djTwitch.value = `https://www.twitch.tv/${row.id}`;
  for (const input of els.djForm.querySelectorAll("[data-social]")) {
    input.value = (row.socials || {})[input.dataset.social] || "";
  }
  setNote("", null);
  els.contentListCard.classList.add("hidden");
  els.djEditor.classList.remove("hidden");
}

function closeEditor() {
  editingDj = null;
  els.djEditor.classList.add("hidden");
  els.contentListCard.classList.remove("hidden");
  setNote("", null);
}

async function saveSocials() {
  if (!editingDj) return;
  const socials = {};
  for (const input of els.djForm.querySelectorAll("[data-social]")) {
    const value = input.value.trim();
    if (value) socials[input.dataset.social] = value;
  }
  setNote("Saving…", null);
  try {
    const res = await api(`${API_PREFIX}/content/socials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dj: editingDj.id, socials }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote(data.error || "Save failed", "error");
      return;
    }
    editingDj.socials = data.socials || {};
    const count = Object.keys(editingDj.socials).length;
    setNote(count ? `Saved ${count} link${count === 1 ? "" : "s"}.` : "All links removed.", "ok");
    els.contentStatus.textContent = contentStatusText();
    renderDjList();
    const savedId = editingDj.id;
    window.setTimeout(() => {
      if (editingDj && editingDj.id === savedId) closeEditor();
    }, 900);
  } catch (e) {
    setNote("Network error", "error");
    console.error("Failed to save socials:", e);
  }
}

async function deleteSocials() {
  if (!editingDj) return;
  if (!window.confirm(`Remove all links for ${editingDj.name}?`)) return;
  setNote("Removing…", null);
  try {
    const res = await api(`${API_PREFIX}/content/socials/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dj: editingDj.id }),
    });
    if (!res.ok && res.status !== 404) {
      const data = await res.json().catch(() => ({}));
      setNote(data.error || "Delete failed", "error");
      return;
    }
    editingDj.socials = {};
    for (const input of els.djForm.querySelectorAll("[data-social]")) input.value = "";
    setNote("All links removed.", "ok");
    els.contentStatus.textContent = contentStatusText();
    renderDjList();
    const clearedId = editingDj.id;
    window.setTimeout(() => {
      if (editingDj && editingDj.id === clearedId) closeEditor();
    }, 900);
  } catch (e) {
    setNote("Network error", "error");
    console.error("Failed to delete socials:", e);
  }
}

if (els.djList && els.djSearch && els.djForm) {
  els.djList.addEventListener("click", (e) => {
    const btn = e.target.closest(".dj-open");
    if (btn) openEditor(btn.dataset.dj);
  });
  els.djSearch.addEventListener("input", renderDjList);
  els.djEditorBack?.addEventListener("click", closeEditor);
  els.djForm.addEventListener("submit", (e) => {
    e.preventDefault();
    saveSocials();
  });
  els.djDelete?.addEventListener("click", deleteSocials);
}

function setRoute(route) {
  for (const link of els.navLinks) {
    link.classList.toggle("active", link.dataset.route === route);
  }
  for (const page of els.pages) {
    page.classList.add("hidden");
  }
  const activePage = document.getElementById(`page-${route}`);
  if (activePage) {
    activePage.classList.remove("hidden");
    els.pageTitle.textContent = activePage.querySelector(".card-title, h2")?.textContent || route;
  }
  if (route === "overview") {
    loadOverview();
  } else if (route === "content") {
    loadContent();
  }
}

function routeFromHash() {
  const hash = window.location.hash || "#/overview";
  return hash.replace(/^#\//, "").split("/")[0] || "overview";
}

function updateRoute() {
  setRoute(routeFromHash());
}

els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.loginError.textContent = "";
  const body = new URLSearchParams();
  body.set("user", els.loginUser.value.trim());
  body.set("password", els.loginPassword.value);

  try {
    const res = await fetch("/login", {
      method: "POST",
      body,
    });
    if (res.ok) {
      await loadSession();
      updateRoute();
    } else {
      const data = await res.json().catch(() => ({}));
      els.loginError.textContent = data.error || "Sign in failed";
    }
  } catch (err) {
    els.loginError.textContent = "Network error. Please try again.";
  }
  els.loginPassword.value = "";
});

els.logoutForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await fetch("/logout", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
    });
  } finally {
    currentUser = null;
    csrfToken = "";
    window.location.hash = "#/overview";
    showLogin();
  }
});



els.menuToggle.addEventListener("click", () => {
  const expanded = els.sidebar.classList.toggle("open");
  els.menuToggle.setAttribute("aria-expanded", String(expanded));
});

window.addEventListener("hashchange", updateRoute);

document.addEventListener("DOMContentLoaded", async () => {
  const ok = await loadSession();
  if (ok) updateRoute();
});
