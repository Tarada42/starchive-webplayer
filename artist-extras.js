/* STArchive - artist page extras.
 * Adds a small Twitch metadata block under the "N sets" line on an artist page:
 * time on Twitch, the channel link, the bio (clamped) and social icons.
 * Loaded from index.html. No build step, no dependencies.
 */
(function () {
  "use strict";

  var ICONS = {
    twitch: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z",
    x: "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z",
    instagram: "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077",
    youtube: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
    discord: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
    tiktok: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"
  };

  var PROFILE_TTL = 60000;
  var profileCache = Object.create(null);
  var pending = Object.create(null);

  var LABELS = {
    twitch: "Twitch", x: "X", twitter: "X", instagram: "Instagram",
    youtube: "YouTube", discord: "Discord", tiktok: "TikTok", website: "Website"
  };

  function injectStyles() {
    if (document.getElementById("ax-styles")) return;
    var css = [
      ".ax-extras{margin-top:10px;display:flex;flex-direction:column;gap:8px;max-width:620px}",
      ".ax-meta{display:flex;align-items:center;gap:10px;font-size:.8rem;color:var(--text2);flex-wrap:wrap}",
      ".ax-since{color:var(--text2)}",
      ".ax-dot{width:3px;height:3px;border-radius:50%;background:var(--text3);display:inline-block}",
      ".ax-twitch{display:inline-flex;align-items:center;gap:6px;color:var(--accent2);text-decoration:none;border-bottom:1px solid transparent;transition:.15s}",
      ".ax-twitch svg{width:15px;height:15px;flex:0 0 auto}",
      ".ax-twitch:hover{color:var(--text);border-bottom-color:var(--accent2)}",
      ".ax-bio{margin:0;font-size:.85rem;line-height:1.5;color:var(--text2);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}",
      ".ax-bio.is-open{display:block;-webkit-line-clamp:unset;overflow:visible}",
      ".ax-more{align-self:flex-start;background:none;border:0;padding:0;font:inherit;font-size:.78rem;color:var(--accent2);cursor:pointer;opacity:.9}",
      ".ax-more:hover{color:var(--text)}",
      ".ax-socials{display:flex;align-items:center;gap:12px;margin-top:2px}",
      ".ax-social{color:var(--text3);display:inline-flex;transition:color .15s,transform .15s}",
      ".ax-social:hover{color:var(--accent2);transform:translateY(-1px)}",
      ".ax-social svg{width:16px;height:16px;display:block}",
      ".ax-live-row{display:flex;align-items:center;gap:10px;margin:14px 0 6px;padding:12px 14px;border:1px solid var(--border);border-left:3px solid var(--red);border-radius:12px;background:var(--surface);text-decoration:none;color:var(--text);transition:.15s}",
      ".ax-live-row:hover{background:var(--surface2);border-color:var(--accent)}",
      ".ax-live-dot{width:8px;height:8px;border-radius:50%;background:var(--red);animation:axPulse 2s infinite}",
      "@keyframes axPulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.55)}70%{box-shadow:0 0 0 8px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}",
      ".ax-live-label{font-size:.72rem;font-weight:700;letter-spacing:.08em;color:var(--red)}",
      ".ax-live-title{font-size:.9rem;color:var(--text2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".ax-live-go{font-size:.8rem;color:var(--accent2)}",
      ".ax-live-badge{margin-left:auto;background:var(--red);color:#fff;font-size:.68rem;font-weight:700;line-height:1;min-width:18px;height:18px;padding:0 5px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-family:'DM Sans',sans-serif}",
      ".ax-genre-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0 2px}",
      ".ax-chip{border:1px solid var(--border);background:var(--surface);color:var(--text2);border-radius:999px;padding:5px 11px;font:inherit;font-size:.78rem;line-height:1.2;cursor:pointer;transition:.15s;white-space:nowrap}",
      ".ax-chip:hover{color:var(--text);border-color:var(--accent)}",
      ".ax-chip.is-on{background:var(--accent);border-color:var(--accent);color:#fff}",
      ".ax-chip .ax-n{opacity:.6;margin-left:5px;font-size:.72rem}",
      ".ax-filter-note{margin-left:auto;font-size:.74rem;color:var(--text3)}",
      ".ax-genres{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}",
      ".ax-genre-tag{font-size:.72rem;line-height:1;padding:5px 9px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text2);text-decoration:none;transition:.15s}",
      ".ax-genre-tag:hover{color:var(--text);border-color:var(--accent)}",
      ".artist-hero-name{display:flex;align-items:baseline;flex-wrap:wrap;gap:0 14px}",
      ".ax-tribute{font-size:.74rem;font-weight:400;font-style:italic;letter-spacing:0;text-transform:none;color:var(--text3);line-height:1.35;max-width:520px}"
    ].join("");
    var s = document.createElement("style");
    s.id = "ax-styles";
    s.textContent = css;
    document.head.appendChild(s);
  }

  function svgFromPath(d) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
    return svg;
  }

  function websiteIcon() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("aria-hidden", "true");
    var c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "12"); c.setAttribute("cy", "12"); c.setAttribute("r", "8.5");
    var e = document.createElementNS(ns, "ellipse");
    e.setAttribute("cx", "12"); e.setAttribute("cy", "12"); e.setAttribute("rx", "3.6"); e.setAttribute("ry", "8.5");
    var l = document.createElementNS(ns, "path");
    l.setAttribute("d", "M3.5 12h17");
    svg.appendChild(c); svg.appendChild(e); svg.appendChild(l);
    return svg;
  }

  function timeOnTwitch(iso) {
    var t = Date.parse(iso || "");
    if (!t || isNaN(t)) return null;
    var days = (Date.now() - t) / 86400000;
    if (!isFinite(days) || days < 1) return null;
    if (days >= 365.25) {
      var y = Math.round(days / 365.25);
      return y + (y === 1 ? " year" : " years") + " on Twitch";
    }
    var m = Math.max(1, Math.round(days / 30.44));
    return m + (m === 1 ? " month" : " months") + " on Twitch";
  }

  function getProfile(dj) {
    var hit = profileCache[dj];
    if (hit && Date.now() - hit.at < PROFILE_TTL) return Promise.resolve(hit.data);
    if (pending[dj]) return pending[dj];
    var p = fetch("/api/dj-profile?dj=" + encodeURIComponent(dj), { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { profileCache[dj] = { at: Date.now(), data: d }; delete pending[dj]; return d; })
      .catch(function () { profileCache[dj] = { at: Date.now(), data: null }; delete pending[dj]; return null; });
    pending[dj] = p;
    return p;
  }

  function render(block, dj, data) {
    block.textContent = "";
    if (!data) return;
    var profile = data.profile || {};
    var socials = data.socials || {};

    var meta = document.createElement("div");
    meta.className = "ax-meta";

    var since = timeOnTwitch(profile.createdAt);
    if (since) {
      var s = document.createElement("span");
      s.className = "ax-since";
      s.textContent = since;
      meta.appendChild(s);
      var dot = document.createElement("span");
      dot.className = "ax-dot";
      meta.appendChild(dot);
    }

    var link = document.createElement("a");
    link.className = "ax-twitch";
    var twitchUrl = profile.url || socials.twitch;
    if (typeof twitchUrl !== "string" || !/^https?:/i.test(twitchUrl)) {
      twitchUrl = "https://www.twitch.tv/" + dj;
    }
    link.href = twitchUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (ICONS.twitch) link.appendChild(svgFromPath(ICONS.twitch));
    link.appendChild(document.createTextNode("twitch.tv/" + dj));
    meta.appendChild(link);

    if (meta.children.length) block.appendChild(meta);

    var genreSlot = document.createElement("div");
    genreSlot.className = "ax-genre-slot";
    block.appendChild(genreSlot);
    genreTagsFor(genreSlot, dj);

    var bioText = (data.bio || "").trim();
    if (bioText) {
      var bio = document.createElement("p");
      bio.className = "ax-bio";
      bio.textContent = bioText;
      block.appendChild(bio);

      var more = document.createElement("button");
      more.type = "button";
      more.className = "ax-more";
      more.textContent = "Show more";
      more.addEventListener("click", function () {
        var open = bio.classList.toggle("is-open");
        more.textContent = open ? "Show less" : "Show more";
      });
      block.appendChild(more);
      requestAnimationFrame(function () {
        if (bio.scrollHeight <= bio.clientHeight + 2) more.style.display = "none";
      });
    }

    var keys = Object.keys(socials).filter(function (k) { return socials[k] && k !== "twitch"; });
    if (keys.length) {
      var row = document.createElement("div");
      row.className = "ax-socials";
      keys.forEach(function (k) {
        var href = socials[k];
        if (typeof href !== "string" || !/^https?:/i.test(href)) return;
        var name = k === "twitter" ? "x" : k;
        var a = document.createElement("a");
        a.className = "ax-social";
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.title = LABELS[k] || k;
        a.setAttribute("aria-label", LABELS[k] || k);
        var ic = name === "website" ? websiteIcon() : (ICONS[name] ? svgFromPath(ICONS[name]) : null);
        if (!ic) return;
        a.appendChild(ic);
        row.appendChild(a);
      });
      if (row.children.length) block.appendChild(row);
    }
  }

  function currentDj() {
    var h2 = document.querySelector(".artist-hero-name");
    if (!h2) return null;
    var clone = h2.cloneNode(true);
    var tag = clone.querySelector(".ax-tribute");
    if (tag) tag.remove();
    var t = (clone.textContent || "").trim().toLowerCase();
    return /^[a-z0-9_]+$/.test(t) ? t : null;
  }

  function addLiveRow(dj) {
    var list = document.querySelector(".tracks-container");
    if (!list || !list.parentElement) return;
    var existing = document.querySelector(".ax-live-row");
    if (existing) {
      if (existing.getAttribute("data-dj") === dj) return;
      existing.remove();
    }
    var row = document.createElement("a");
    row.className = "ax-live-row";
    row.setAttribute("data-dj", dj);
    row.href = "/live?play=" + encodeURIComponent(dj);
    var dot = document.createElement("span");
    dot.className = "ax-live-dot";
    var label = document.createElement("span");
    label.className = "ax-live-label";
    label.textContent = "LIVE NOW";
    var title = document.createElement("span");
    title.className = "ax-live-title";
    title.textContent = "Listen to " + dj + " live";
    var go = document.createElement("span");
    go.className = "ax-live-go";
    go.textContent = "Open live page";
    row.appendChild(dot);
    row.appendChild(label);
    row.appendChild(title);
    row.appendChild(go);
    list.parentElement.insertBefore(row, list);
  }

  function checkArtistLive(dj) {
    fetch("/api/live", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) {
        if (!Array.isArray(list)) return;
        var hit = list.some(function (x) { return String((x && x.id) || "").toLowerCase() === dj; });
        if (hit) addLiveRow(dj);
      })
      .catch(function () {});
  }

  var liveCount = 0;

  function ensureLiveBadge(count) {
    var nav = document.querySelector(".sidebar-nav");
    if (!nav) return;
    var btn = null;
    var items = nav.querySelectorAll(".nav-item");
    for (var i = 0; i < items.length; i++) {
      // Match the label span, not the whole button: once the badge is attached the
      // button's textContent becomes e.g. "Live2" and an exact match would fail.
      var label = items[i].querySelector("span:not(.ax-live-badge)") || items[i];
      if (/^live$/i.test((label.textContent || "").trim())) { btn = items[i]; break; }
    }
    if (!btn) return;
    var badge = btn.querySelector(".ax-live-badge");
    if (count <= 0) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "ax-live-badge";
      btn.appendChild(badge);
    }
    badge.textContent = String(count);
    badge.title = count + (count === 1 ? " DJ live" : " DJs live");
  }

  function refreshLiveBadge() {
    fetch("/api/live", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) {
        if (!Array.isArray(list)) return;
        liveCount = list.length;
        ensureLiveBadge(liveCount);
      })
      .catch(function () {});
  }

  // ---- tribute line (artist-sources.json -> "tribute") --------------------
  var sourcesData = null;
  var sourcesPromise = null;

  function loadSources() {
    if (sourcesPromise) return sourcesPromise;
    sourcesPromise = fetch("/artist-sources.json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { sourcesData = (d && d.artists) || {}; return sourcesData; })
      .catch(function () { sourcesData = {}; return sourcesData; });
    return sourcesPromise;
  }

  function ensureTribute(dj) {
    if (!sourcesData) return;
    var cfg = sourcesData[String(dj).toLowerCase()];
    var text = cfg && cfg.tribute;
    var h = document.querySelector(".artist-hero-name");
    if (!h) return;
    var existing = h.querySelector(".ax-tribute");
    if (!text) { if (existing) existing.remove(); return; }
    if (existing) {
      if (existing.textContent !== text) existing.textContent = text;
      return;
    }
    var s = document.createElement("span");
    s.className = "ax-tribute";
    s.textContent = text;
    h.appendChild(s);
  }

  // ---- genre browsing (multi-select) --------------------------------------
  var GENRE_KEY = "starchive_genres";
  var genreData = null;
  var genreSel = [];
  try { genreSel = JSON.parse(localStorage.getItem(GENRE_KEY) || "[]") || []; } catch (e) { genreSel = []; }
  var genreStamp = 0;
  var lastApply = "";

  function loadGenres() {
    if (genreData) return Promise.resolve(genreData);
    return fetch("/genres.json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { genreData = (d && d.artists) || {}; return genreData; })
      .catch(function () { genreData = {}; return genreData; });
  }

  // Cards expose the artist as "andy gravity" (img alt) while genres.json keys are
  // "andy_gravity" — compare on a stripped alphanumeric key.
  function normKey(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  var genreIndex = null;
  function genreIndexOf() {
    if (genreIndex) return genreIndex;
    genreIndex = Object.create(null);
    Object.keys(genreData || {}).forEach(function (k) {
      genreIndex[normKey(k)] = (genreData[k] && genreData[k].genres) || [];
    });
    return genreIndex;
  }

  function cardName(card) {
    var img = card.querySelector("img[alt]");
    if (img && img.getAttribute("alt")) return img.getAttribute("alt");
    var t = card.textContent || "";
    return t.trim().split("\n")[0];
  }

  function genresOf(name) {
    return genreIndexOf()[normKey(name)] || [];
  }

  function saveGenreSel() {
    try { localStorage.setItem(GENRE_KEY, JSON.stringify(genreSel)); } catch (e) {}
  }

  function makeChip(label, count, active, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ax-chip" + (active ? " is-on" : "");
    b.appendChild(document.createTextNode(label));
    if (count != null) {
      var n = document.createElement("span");
      n.className = "ax-n";
      n.textContent = String(count);
      b.appendChild(n);
    }
    b.addEventListener("click", function (e) { e.preventDefault(); onClick(); });
    return b;
  }

  function buildGenreBar() {
    var list = document.querySelector(".artist-list");
    var header = list && list.querySelector(".list-header-row");
    if (!list || !header) return;

    var bar = list.querySelector(".ax-genre-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "ax-genre-bar";
      header.parentNode.insertBefore(bar, header.nextSibling);
    }

    var counts = {};
    var totalArtists = 0;
    var cards = document.querySelectorAll(".artist-card");
    for (var ci = 0; ci < cards.length; ci++) {
      var g = genresOf(cardName(cards[ci]));
      if (g.length) totalArtists++;
      g.forEach(function (x) { counts[x] = (counts[x] || 0) + 1; });
    }
    var names = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b);
    });

    var sig = names.join("|") + "::" + genreSel.join(",") + "::" + totalArtists + "::" +
      cards.length + "::" + (cards[0] ? cardName(cards[0]) : "");
    if (bar.getAttribute("data-sig") === sig) return;
    bar.setAttribute("data-sig", sig);
    bar.innerHTML = "";

    bar.appendChild(makeChip("All", cards.length, genreSel.length === 0, function () {
      genreSel = [];
      saveGenreSel();
      lastApply = "";
      buildGenreBar();
      applyGenreFilter();
    }));

    names.forEach(function (g) {
      var on = genreSel.indexOf(g) !== -1;
      bar.appendChild(makeChip(g, counts[g], on, function () {
        var i = genreSel.indexOf(g);
        if (i === -1) genreSel.push(g); else genreSel.splice(i, 1);
        saveGenreSel();
        lastApply = "";
        buildGenreBar();
        applyGenreFilter();
      }));
    });

    var note = document.createElement("div");
    note.className = "ax-filter-note";
    bar.appendChild(note);
  }

  function applyGenreFilter() {
    var cards = document.querySelectorAll(".artist-card");
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var g = genresOf(cardName(c));
      var ok = genreSel.length === 0 || g.some(function (x) { return genreSel.indexOf(x) !== -1; });
      c.style.display = ok ? "" : "none";
      c.__axFiltered = true;
      if (ok) shown++;
    }
    var note = document.querySelector(".ax-filter-note");
    if (note) {
      note.textContent = genreSel.length
        ? "Showing " + shown + " of " + cards.length
        : "";
    }
  }

  function genreTick() {
    if (!genreData) return;
    if (!document.querySelector(".artist-list")) return;
    buildGenreBar();
    var cards = document.querySelectorAll(".artist-card");
    var first = cards[0];
    var sig = genreSel.join(",") + "|" + cards.length + "|" + (first && first.__axFiltered ? "same" : "new");
    if (sig !== lastApply) {
      lastApply = sig;
      applyGenreFilter();
    }
  }
  function paintGenreTags(slot, dj) {
    if (!slot || !slot.isConnected) return;
    var g = genresOf(dj);
    if (!g.length) return;
    slot.textContent = "";
    var row = document.createElement("div");
    row.className = "ax-genres";
    g.forEach(function (name) {
      var a = document.createElement("a");
      a.className = "ax-genre-tag";
      a.href = "/";
      a.textContent = name;
      a.title = "Browse " + name + " DJs";
      a.addEventListener("click", function (e) {
        e.preventDefault();
        try { localStorage.setItem("starchive_genres", JSON.stringify([name])); } catch (err) {}
        window.location.href = "/";
      });
      row.appendChild(a);
    });
    slot.appendChild(row);
  }

  function genreTagsFor(slot, dj) {
    if (genreData) { paintGenreTags(slot, dj); return; }
    loadGenres().then(function () { paintGenreTags(slot, dj); });
  }

  // -------------------------------------------------------------------------

  function sync() {
    var dj = currentDj();
    if (!dj) return;
    var sub = document.querySelector(".artist-hero-sub");
    if (!sub || !sub.parentElement) return;
    var host = sub.parentElement;
    var existing = host.querySelector(".ax-extras");
    if (existing && existing.getAttribute("data-dj") === dj) return;
    if (existing) existing.remove();
    injectStyles();
    var block = document.createElement("div");
    block.className = "ax-extras";
    block.setAttribute("data-dj", dj);
    host.appendChild(block);
    var staleLive = document.querySelector(".ax-live-row");
    if (staleLive && staleLive.getAttribute("data-dj") !== dj) staleLive.remove();
    checkArtistLive(dj);
    getProfile(dj).then(function (d) {
      if (block.isConnected && block.getAttribute("data-dj") === dj) render(block, dj, d);
    });
  }

  var timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      sync();
      ensureLiveBadge(liveCount);
      genreTick();
      var d = currentDj();
      if (d) ensureTribute(d);
    }, 80);
  }

  injectStyles();
  refreshLiveBadge();
  setInterval(refreshLiveBadge, 60000);
  loadGenres().then(function () { genreTick(); });
  loadSources().then(function () { var d = currentDj(); if (d) ensureTribute(d); });

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule);
  else schedule();
})();
