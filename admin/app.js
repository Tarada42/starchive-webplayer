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
  popPlays: document.getElementById("pop-plays"),
  popFavourites: document.getElementById("pop-favourites"),
  popLive: document.getElementById("pop-live"),
  popPages: document.getElementById("pop-pages"),
  popArtistsBody: document.getElementById("pop-artists-body"),
  popTracksBody: document.getElementById("pop-tracks-body"),
  popDays: document.getElementById("pop-days"),
  livePeak: document.getElementById("live-peak"),
  liveAverage: document.getElementById("live-average"),
  liveSamples: document.getElementById("live-samples"),
  liveDays: document.getElementById("live-days"),
  liveSparkline: document.getElementById("live-sparkline"),
  liveSparklineLine: document.getElementById("live-sparkline-line"),
  liveSparklineEmpty: document.getElementById("live-sparkline-empty"),
  liveDjsBody: document.getElementById("live-djs-body"),
  liveDaysSelector: document.getElementById("live-days-selector"),
  trafficTotal: document.getElementById("traffic-total"),
  trafficStream: document.getElementById("traffic-stream"),
  trafficStatic: document.getElementById("traffic-static"),
  trafficApi: document.getElementById("traffic-api"),
  trafficBody: document.getElementById("traffic-body"),
  trafficDays: document.getElementById("traffic-days"),
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

function formatBytes(n) {
  if (n === 0 || !Number.isFinite(n)) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setDaySelector(container, days) {
  if (!container) return;
  for (const btn of container.querySelectorAll("button")) {
    btn.classList.toggle("is-active", Number(btn.dataset.days) === days);
  }
}

function emptyRow(cols, text) {
  return `<tr class="empty-row"><td colspan="${cols}">${escapeHtml(text)}</td></tr>`;
}

async function loadPopularity(days = 7) {
  try {
    const res = await fetch(`${API_PREFIX}/popularity?days=${days}`, {
      headers: { "x-csrf-token": csrfToken },
    });
    if (!res.ok) return;
    const data = await res.json();
    setDaySelector(els.popDays, data.days);
    els.popPlays.textContent = (data.totals?.plays || 0).toLocaleString();
    els.popFavourites.textContent = (data.totals?.favorites || 0).toLocaleString();
    els.popLive.textContent = (data.totals?.livePlays || 0).toLocaleString();
    els.popPages.textContent = (data.totals?.pages || 0).toLocaleString();

    if (Array.isArray(data.artists) && data.artists.length) {
      els.popArtistsBody.innerHTML = data.artists
        .map((a, i) => `<tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(a.artist)}</td>
          <td class="num">${(a.plays || 0).toLocaleString()}</td>
          <td class="num">${(a.favorites || 0).toLocaleString()}</td>
          <td class="num">${(a.livePlays || 0).toLocaleString()}</td>
          <td class="num">${(a.score || 0).toLocaleString()}</td>
        </tr>`)
        .join("");
    } else {
      els.popArtistsBody.innerHTML = emptyRow(6, "No data collected yet — beacons start recording after the next deploy");
    }

    if (Array.isArray(data.tracks) && data.tracks.length) {
      els.popTracksBody.innerHTML = data.tracks
        .map((t, i) => `<tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(t.artist)}</td>
          <td>${escapeHtml(t.track)}</td>
          <td class="num">${(t.plays || 0).toLocaleString()}</td>
        </tr>`)
        .join("");
    } else {
      els.popTracksBody.innerHTML = emptyRow(4, "No data collected yet — beacons start recording after the next deploy");
    }
  } catch (e) {
    console.error("Failed to load popularity:", e);
  }
}

function renderSparkline(samples) {
  if (!Array.isArray(samples) || samples.length < 2) {
    els.liveSparkline.style.display = "none";
    els.liveSparklineEmpty.style.display = "block";
    return;
  }
  const values = samples.map((s) => (Number.isFinite(s.total) ? s.total : 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 800;
  const height = 160;
  const padding = 4;
  const usableH = height - padding * 2;
  const stepX = width / (values.length - 1);
  const range = Math.max(1, max - min);
  const points = values
    .map((v, i) => {
      const x = Math.round(i * stepX);
      const y = Math.round(height - padding - ((v - min) / range) * usableH);
      return `${x},${y}`;
    })
    .join(" ");
  els.liveSparklineLine.setAttribute("points", points);
  els.liveSparkline.style.display = "block";
  els.liveSparklineEmpty.style.display = "none";
}

async function loadLive(days = 7) {
  try {
    const res = await fetch(`${API_PREFIX}/live?days=${days}`, {
      headers: { "x-csrf-token": csrfToken },
    });
    if (!res.ok) return;
    const data = await res.json();
    setDaySelector(els.liveDaysSelector, data.days);
    els.liveDays.textContent = `${data.days}d`;
    els.livePeak.textContent = (data.peak?.total || 0).toLocaleString();
    els.liveAverage.textContent = Number(data.average || 0).toFixed(1);
    els.liveSamples.textContent = (data.samples || 0).toLocaleString();

    if (Array.isArray(data.byDay) && data.byDay.length) {
      renderSparkline(data.byDay);
    } else {
      renderSparkline([]);
    }

    if (Array.isArray(data.djs) && data.djs.length) {
      els.liveDjsBody.innerHTML = data.djs
        .map((d) => `<tr>
          <td>${escapeHtml(d.artist)}</td>
          <td class="num">${(d.minutes || 0).toLocaleString()}</td>
          <td class="num">${(d.peak || 0).toLocaleString()}</td>
        </tr>`)
        .join("");
    } else {
      els.liveDjsBody.innerHTML = emptyRow(3, "No data collected yet — beacons start recording after the next deploy");
    }
  } catch (e) {
    console.error("Failed to load live stats:", e);
  }
}

async function loadTraffic(days = 7) {
  try {
    const res = await fetch(`${API_PREFIX}/traffic?days=${days}`, {
      headers: { "x-csrf-token": csrfToken },
    });
    if (!res.ok) return;
    const data = await res.json();
    setDaySelector(els.trafficDays, data.days);
    const t = data.totals || {};
    els.trafficTotal.textContent = formatBytes(t.total || 0);
    els.trafficStream.textContent = formatBytes(t.stream || 0);
    els.trafficStatic.textContent = formatBytes(t.static || 0);
    els.trafficApi.textContent = formatBytes(t.api || 0);

    if (Array.isArray(data.daysList) && data.daysList.length) {
      els.trafficBody.innerHTML = data.daysList
        .map((d) => `<tr>
          <td>${escapeHtml(d.date)}</td>
          <td class="num">${formatBytes(d.stream || 0)}</td>
          <td class="num">${formatBytes(d.static || 0)}</td>
          <td class="num">${formatBytes(d.api || 0)}</td>
          <td class="num">${formatBytes(d.page || 0)}</td>
          <td class="num">${formatBytes(d.total || 0)}</td>
        </tr>`)
        .join("");
    } else {
      els.trafficBody.innerHTML = emptyRow(6, "No data collected yet — beacons start recording after the next deploy");
    }
  } catch (e) {
    console.error("Failed to load traffic:", e);
  }
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
  } else if (route === "popularity") {
    loadPopularity();
  } else if (route === "live") {
    loadLive();
  } else if (route === "traffic") {
    loadTraffic();
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

function bindDaySelector(container, loader) {
  if (!container) return;
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-days]");
    if (!btn) return;
    const days = Number(btn.dataset.days);
    loader(days);
  });
}

bindDaySelector(els.popDays, loadPopularity);
bindDaySelector(els.liveDaysSelector, loadLive);
bindDaySelector(els.trafficDays, loadTraffic);

els.menuToggle.addEventListener("click", () => {
  const expanded = els.sidebar.classList.toggle("open");
  els.menuToggle.setAttribute("aria-expanded", String(expanded));
});

window.addEventListener("hashchange", updateRoute);

document.addEventListener("DOMContentLoaded", async () => {
  const ok = await loadSession();
  if (ok) updateRoute();
});
