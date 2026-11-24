// admin/app.js — vanilla JS admin SPA.
const API_PREFIX = "/api/admin";
/** Bumped on every deploy so a stale browser can be spotted instantly. */
const ADMIN_BUILD = "2026-11-24 per-link-v4";

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
  genreStatus: document.getElementById("genre-status"),
  genreListCard: document.getElementById("genre-list-card"),
  genreSearch: document.getElementById("genre-search"),
  genreList: document.getElementById("genre-list"),
  genreEditor: document.getElementById("genre-editor"),
  genreEditorTitle: document.getElementById("genre-editor-title"),
  genreEditorSource: document.getElementById("genre-editor-source"),
  genreEditorBack: document.getElementById("genre-editor-back"),
  genreChips: document.getElementById("genre-chips"),
  genreInput: document.getElementById("genre-input"),
  genreSuggestions: document.getElementById("genre-suggestions"),
  genreAdd: document.getElementById("genre-add"),
  genreSave: document.getElementById("genre-save"),
  genreClear: document.getElementById("genre-clear"),
  genreNote: document.getElementById("genre-note"),
  djTwitch: document.getElementById("dj-twitch"),
  djTwitchLink: document.getElementById("dj-twitch-link"),
  djSuggestion: document.getElementById("dj-suggestion"),
  djSuggestionNotes: document.getElementById("dj-suggestion-notes"),
  djSuggestionSources: document.getElementById("dj-suggestion-sources"),
  djApprove: document.getElementById("dj-approve"),
  djDecline: document.getElementById("dj-decline"),
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
      const badge = r.suggestion
        ? '<span class="dj-badge dj-badge-suggested">suggested</span>'
        : count
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


/**
 * Show each field's full URL as clickable text beside the label. An <input> only
 * displays the characters that fit, so this is the only way to read a long link
 * without scrolling inside the box.
 */

/**
 * Tag the fields whose value came from a suggestion, and give each one its own
 * accept/reject pair so a single bad guess never has to be approved in bulk.
 */
function markSuggestedFields(suggestion) {
  const suggested = (suggestion && suggestion.socials) || {};
  for (const label of els.djForm.querySelectorAll(".field")) {
    const input = label.querySelector("[data-social]");
    const head = label.querySelector(".field-head");
    if (!input || !head) continue;
    head.querySelector(".field-tag")?.remove();
    head.querySelector(".field-actions")?.remove();
    const key = input.dataset.social;
    if (!suggested[key]) continue;

    const tag = document.createElement("span");
    tag.className = "field-tag";
    tag.dataset.state = "suggested";
    tag.textContent = "suggested";
    head.appendChild(tag);

    const actions = document.createElement("span");
    actions.className = "field-actions";
    actions.innerHTML =
      `<button type="button" class="link-btn link-accept" data-key="${key}" title="Save this suggested link on its own">Approve</button>` +
      `<button type="button" class="link-btn link-reject" data-key="${key}" title="Discard this suggested link">Reject</button>`;
    head.appendChild(actions);
  }
}

/** How many suggested links are still un-reviewed in the open editor. */
function pendingSuggestions() {
  return els.djForm.querySelectorAll('.field-tag[data-state="suggested"]').length;
}

/** Reject one suggested link: clear the field and remember the refusal. */
async function rejectSuggestionKey(key) {
  if (!editingDj) return;
  const input = els.djForm.querySelector(`[data-social="${key}"]`);
  if (input) input.value = "";
  const label = input?.closest(".field");
  label?.querySelector(".field-actions")?.remove();
  const tag = label?.querySelector(".field-tag");
  if (tag) tag.remove();
  if (editingDj.suggestion && editingDj.suggestion.socials) delete editingDj.suggestion.socials[key];
  renderFieldLinks();
  renderSuggestions(editingDj.suggestion);
  setNote(`Rejected the suggested ${key} link.`, null);
  try {
    await api(`${API_PREFIX}/content/suggestions/decline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dj: editingDj.id, keys: [key] }),
    });
  } catch (e) {
    console.error("Failed to record the rejection:", e);
  }
}

/**
 * Accept one suggested link: this writes that link on its own, right now. The other
 * suggestions stay pending, and the normal Save button is not involved.
 */
async function acceptSuggestionKey(key) {
  if (!editingDj) return;
  const input = els.djForm.querySelector(`[data-social="${key}"]`);
  const value = (input?.value || "").trim();
  if (!/^https?:\/\//i.test(value)) {
    setNote("That field is empty — nothing to approve.", "error");
    return;
  }

  const djId = editingDj.id;
  setNote(`Saving the ${key} link…`, null);
  try {
    const res = await api(`${API_PREFIX}/content/socials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dj: djId, socials: { [key]: value }, partial: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote(data.error || "Could not save that link", "error");
      return;
    }

    const label = input?.closest(".field");
    label?.querySelector(".field-actions")?.remove();
    const tag = label?.querySelector(".field-tag");
    if (tag) {
      tag.dataset.state = "saved";
      tag.textContent = "saved";
    }

    // The suggestion for this key is now stored, so it is no longer pending.
    if (editingDj.suggestion && editingDj.suggestion.socials) {
      delete editingDj.suggestion.socials[key];
      if (!Object.keys(editingDj.suggestion.socials).length) editingDj.suggestion = null;
    }
    editingDj.socials = { ...(editingDj.socials || {}), [key]: value };
    if (typeof contentStatusText === "function") els.contentStatus.textContent = contentStatusText();
    renderSuggestions(editingDj.suggestion);
    renderDjList();
    setNote(`Saved the ${key} link.`, "ok");
  } catch (e) {
    setNote("Network error", "error");
    console.error("Failed to approve one link:", e);
  }
}

function renderFieldLinks() {
  const pairs = [];
  if (els.djTwitch && els.djTwitchLink) pairs.push([els.djTwitch, els.djTwitchLink]);
  for (const input of els.djForm.querySelectorAll("[data-social]")) {
    const link = els.djForm.querySelector(`.field-url[data-url="${input.dataset.social}"]`);
    if (link) pairs.push([input, link]);
  }

  for (const [input, link] of pairs) {
    const url = (input.value || "").trim();
    if (/^https?:\/\//i.test(url)) {
      link.href = url;
      link.textContent = url;
      link.hidden = false;
    } else {
      link.removeAttribute("href");
      link.textContent = "";
      link.hidden = true;
    }
  }
}

function renderSuggestions(suggestion) {
  const banner = els.djSuggestion;
  if (!banner) return;

  renderFieldLinks();

  if (!suggestion) {
    banner.classList.add("hidden");
    return;
  }
  if (!Object.keys(suggestion.socials || {}).length) {
    banner.classList.add("hidden");
    return;
  }
  banner.classList.remove("hidden");
  els.djSuggestionNotes.textContent = suggestion.notes || "";
  // The pending links are the review list: each row carries its own Approve / Reject,
  // so approval happens right where the admin is looking, not only on the fields below.
  const entries = Object.entries(suggestion.socials || {});
  els.djSuggestionSources.innerHTML = entries
    .map(
      ([key, src]) => `<li class="suggestion-row">
        <span class="suggestion-key">${escapeHtml(key)}</span>
        <a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src)}</a>
        <span class="suggestion-actions">
          <button type="button" class="link-btn link-accept" data-key="${escapeHtml(key)}">Approve</button>
          <button type="button" class="link-btn link-reject" data-key="${escapeHtml(key)}">Reject</button>
        </span>
      </li>`
    )
    .join("");

  const title = els.djSuggestion.querySelector(".suggestion-title");
  if (title) {
    title.textContent = `Suggested from public sources — ${entries.length} link${entries.length === 1 ? "" : "s"} to review. Approve each one, or use Approve & save below.`;
  }
}

async function declineSuggestion() {
  if (!editingDj) return;
  const djId = editingDj.id;
  if (!window.confirm(`Decline the suggested links for ${editingDj.name}? The fields will be cleared.`)) return;

  setNote("Declining…", null);
  try {
    const res = await api(`${API_PREFIX}/content/suggestions/decline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dj: djId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setNote(data.error || "Decline failed", "error");
      return;
    }
    const row = djRows.find((r) => r.id === djId);
    if (row) row.suggestion = null;
    for (const input of els.djForm.querySelectorAll("[data-social]")) input.value = "";
    renderSuggestions(null);
    renderFieldLinks();
    setNote("Suggestion declined. Fields cleared.", "ok");
    renderDjList();
  } catch (e) {
    setNote("Network error", "error");
    console.error("Failed to decline suggestion:", e);
  }
}

function openEditor(id) {
  const row = djRows.find((r) => r.id === id);
  if (!row) return;
  editingDj = row;
  els.djEditorTitle.textContent = `${row.name} · ${row.id}`;
  if (els.djTwitch) els.djTwitch.value = `https://www.twitch.tv/${row.id}`;

  const suggestion = row.suggestion || null;
  // Stored links always win; the suggestion only fills the keys that have no value yet.
  const values = { ...(row.socials || {}), ...((suggestion && suggestion.socials) || {}) };
  for (const input of els.djForm.querySelectorAll("[data-social]")) {
    input.value = values[input.dataset.social] || "";
  }
  markSuggestedFields(suggestion);
  renderSuggestions(suggestion);
  renderFieldLinks();
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

  const pending = pendingSuggestions();
  if (pending > 0) {
    const ok = window.confirm(
      `This will approve ${pending} suggested link${pending === 1 ? "" : "s"} for ${editingDj.name}.\n\n` +
        "Only continue if you have opened and verified every one of them. " +
        "To approve them one by one, close this and use the ✓ / ✕ buttons beside each field."
    );
    if (!ok) return;
  }
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
    editingDj.suggestion = null;
    renderSuggestions(null);
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
  els.djForm.addEventListener("input", renderFieldLinks);
  els.djSuggestionSources?.addEventListener("click", (e) => {
    const accept = e.target.closest(".link-accept");
    if (accept) return acceptSuggestionKey(accept.dataset.key);
    const reject = e.target.closest(".link-reject");
    if (reject) return rejectSuggestionKey(reject.dataset.key);
  });
  els.djForm.addEventListener("click", (e) => {
    const accept = e.target.closest(".link-accept");
    if (accept) return acceptSuggestionKey(accept.dataset.key);
    const reject = e.target.closest(".link-reject");
    if (reject) return rejectSuggestionKey(reject.dataset.key);
  });
  els.djEditorBack?.addEventListener("click", closeEditor);
  els.djForm.addEventListener("submit", (e) => {
    e.preventDefault();
    saveSocials();
  });
  els.djDelete?.addEventListener("click", deleteSocials);
  els.djApprove?.addEventListener("click", saveSocials);
  els.djDecline?.addEventListener("click", declineSuggestion);
}


// ---- Genres -----------------------------------------------------------------
let genreRows = [];
let genreVocab = [];
let editingGenreDj = null;
let draftGenres = [];

function genreNote(text, kind) {
  if (!els.genreNote) return;
  els.genreNote.textContent = text || "";
  els.genreNote.classList.toggle("ok", kind === "ok");
  els.genreNote.classList.toggle("error", kind === "error");
}

function renderGenreList() {
  if (!els.genreList) return;
  const q = (els.genreSearch.value || "").trim().toLowerCase();
  const rows = genreRows.filter(
    (r) => !q || r.name.toLowerCase().includes(q) || r.id.includes(q)
  );
  if (!rows.length) {
    els.genreList.innerHTML = '<li class="empty">No DJs match that filter.</li>';
    return;
  }
  els.genreList.innerHTML = rows
    .map((r) => {
      const chips = (r.genres || [])
        .map((g) => `<span class="genre-chip">${escapeHtml(g)}</span>`)
        .join("");
      const badge =
        r.source === "manual"
          ? '<span class="dj-badge dj-badge-suggested">manual</span>'
          : r.genres && r.genres.length
            ? '<span class="dj-id">auto</span>'
            : '<span class="dj-id">untagged</span>';
      return `<li>
        <button class="btn btn-secondary dj-open genre-open" type="button" data-dj="${escapeHtml(r.id)}">
          <span class="dj-name">${escapeHtml(r.name)}</span>
          <span class="dj-id">${escapeHtml(r.id)}</span>
        </button>
        <span class="genre-chips-inline">${chips}</span>
        ${badge}
      </li>`;
    })
    .join("");
}

async function loadGenres(force = false) {
  if (!els.genreList) return;
  if (genreRows.length && !force) {
    renderGenreList();
    return;
  }
  els.genreStatus.textContent = "Loading…";
  try {
    const res = await api(`${API_PREFIX}/content/genres`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    genreRows = Array.isArray(data.djs) ? data.djs : [];
    genreVocab = Array.isArray(data.vocabulary) ? data.vocabulary : [];
    const manual = genreRows.filter((r) => r.source === "manual").length;
    const untagged = genreRows.filter((r) => !r.genres || !r.genres.length).length;
    els.genreStatus.textContent = `${genreRows.length} DJs · ${manual} manual · ${untagged} untagged`;
    if (els.genreSuggestions) {
      els.genreSuggestions.innerHTML = genreVocab
        .map((g) => `<option value="${escapeHtml(g.name)}"></option>`)
        .join("");
    }
    renderGenreList();
  } catch (e) {
    els.genreStatus.textContent = "Could not load genres";
    els.genreList.innerHTML = '<li class="empty">Failed to load. Try again.</li>';
    console.error("Failed to load genres:", e);
  }
}

function renderGenreChips() {
  if (!els.genreChips) return;
  if (!draftGenres.length) {
    els.genreChips.innerHTML = '<span class="dj-id">No genres yet — add at least one.</span>';
    return;
  }
  els.genreChips.innerHTML = draftGenres
    .map(
      (g, i) =>
        `<button type="button" class="genre-chip genre-chip-edit" data-index="${i}" title="Remove ${escapeHtml(g)}">${escapeHtml(g)} <span aria-hidden="true">×</span></button>`
    )
    .join("");
}

function openGenreEditor(id) {
  const row = genreRows.find((r) => r.id === id);
  if (!row) return;
  editingGenreDj = row;
  draftGenres = [...(row.genres || [])];
  els.genreEditorTitle.textContent = `${row.name} · ${row.id}`;
  els.genreEditorSource.textContent =
    row.source === "manual"
      ? "Manual override — these win over the Twitch tags."
      : row.tags && row.tags.length
        ? `Detected from Twitch tags: ${row.tags.join(", ")}`
        : "No usable Twitch tags for this DJ.";
  els.genreListCard.classList.add("hidden");
  els.genreEditor.classList.remove("hidden");
  renderGenreChips();
  genreNote("", null);
}

function closeGenreEditor() {
  editingGenreDj = null;
  draftGenres = [];
  els.genreEditor.classList.add("hidden");
  els.genreListCard.classList.remove("hidden");
  genreNote("", null);
}

function addGenreFromInput() {
  const value = (els.genreInput.value || "").trim();
  if (!value) return;
  if (draftGenres.some((g) => g.toLowerCase() === value.toLowerCase())) {
    genreNote("Already in the list.", "error");
    els.genreInput.value = "";
    return;
  }
  if (draftGenres.length >= 6) {
    genreNote("Six genres is the maximum.", "error");
    return;
  }
  draftGenres.push(value);
  els.genreInput.value = "";
  genreNote("", null);
  renderGenreChips();
}

async function saveGenres() {
  if (!editingGenreDj) return;
  if (!draftGenres.length) {
    genreNote("Add at least one genre, or use Clear.", "error");
    return;
  }
  genreNote("Saving…", null);
  try {
    const res = await api(`${API_PREFIX}/content/genres`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dj: editingGenreDj.id, genres: draftGenres }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      genreNote(data.error || "Save failed", "error");
      return;
    }
    editingGenreDj.genres = data.genres || [];
    editingGenreDj.source = "manual";
    updateGenreStatus();
    renderGenreList();
    genreNote(`Saved: ${editingGenreDj.genres.join(", ")}`, "ok");
  } catch (e) {
    genreNote("Network error", "error");
    console.error("Failed to save genres:", e);
  }
}

async function clearGenres() {
  if (!editingGenreDj) return;
  if (!window.confirm(`Clear the manual genres for ${editingGenreDj.name}? Auto-detected tags take over again.`)) return;
  genreNote("Clearing…", null);
  try {
    const res = await api(`${API_PREFIX}/content/genres/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dj: editingGenreDj.id }),
    });
    if (!res.ok && res.status !== 404) {
      const data = await res.json().catch(() => ({}));
      genreNote(data.error || "Clear failed", "error");
      return;
    }
    await loadGenres(true);
    const refreshed = genreRows.find((r) => r.id === editingGenreDj.id);
    if (refreshed) {
      editingGenreDj = refreshed;
      draftGenres = [...(refreshed.genres || [])];
      renderGenreChips();
    }
    genreNote("Manual override cleared.", "ok");
  } catch (e) {
    genreNote("Network error", "error");
    console.error("Failed to clear genres:", e);
  }
}

function updateGenreStatus() {
  if (!els.genreStatus) return;
  const manual = genreRows.filter((r) => r.source === "manual").length;
  const untagged = genreRows.filter((r) => !r.genres || !r.genres.length).length;
  els.genreStatus.textContent = `${genreRows.length} DJs · ${manual} manual · ${untagged} untagged`;
}

if (els.genreList && els.genreSearch && els.genreEditor) {
  els.genreList.addEventListener("click", (e) => {
    const btn = e.target.closest(".genre-open");
    if (btn) openGenreEditor(btn.dataset.dj);
  });
  els.genreSearch.addEventListener("input", renderGenreList);
  els.genreEditorBack.addEventListener("click", closeGenreEditor);
  els.genreAdd.addEventListener("click", addGenreFromInput);
  els.genreInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addGenreFromInput();
    }
  });
  els.genreChips.addEventListener("click", (e) => {
    const chip = e.target.closest(".genre-chip-edit");
    if (!chip) return;
    draftGenres.splice(Number(chip.dataset.index), 1);
    renderGenreChips();
  });
  els.genreSave.addEventListener("click", saveGenres);
  els.genreClear.addEventListener("click", clearGenres);
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
  } else if (route === "genres") {
    loadGenres();
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

// Show the build in the sidebar so "am I on the current admin?" is answerable at a glance.
(function stampBuild() {
  const brand = document.querySelector(".sidebar-brand");
  if (!brand || document.getElementById("admin-build")) return;
  const el = document.createElement("span");
  el.id = "admin-build";
  el.className = "admin-build";
  el.textContent = ADMIN_BUILD;
  brand.appendChild(el);
})();

document.addEventListener("DOMContentLoaded", async () => {
  const ok = await loadSession();
  if (ok) updateRoute();
});
