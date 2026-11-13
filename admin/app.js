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
  statPlays: document.getElementById("stat-plays"),
  statFavourites: document.getElementById("stat-favourites"),
  liveList: document.getElementById("live-list"),
  collectionMeta: document.getElementById("collection-meta"),
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
    const plays = (data.eventsToday?.play || 0) + (data.eventsToday?.live_play || 0);
    els.statPlays.textContent = plays.toLocaleString();
    els.statFavourites.textContent = (data.eventsToday?.favorite || 0).toLocaleString();

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
