/**
 * STArchive clone — localStorage shim for favorites / history endpoints.
 *
 * Injected before the app bundle. The original web-app's serverless favorites/
 * history backend is gone, and Vercel Hobby serverless storage is ephemeral, so we
 * serve these per-session stores from the browser itself (same localStorage that the
 * app already uses for its session id). Fully offline-friendly, zero server state.
 */
(function () {
  if (window.__starchiveShim) return;
  window.__starchiveShim = true;

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { return []; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  const FAV = "starchive_favorites";
  const AFV = "starchive_artist_favorites";
  const HIS = "starchive_history";

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input.url || "";
    const method = ((init && init.method) || "GET").toUpperCase();
    let body = null;
    if (init && init.body) { try { body = JSON.parse(init.body); } catch (e) {} }

    // ---- /api/favorites ----
    if (url.startsWith("/api/favorites")) {
      const isQuery = url.includes("?");
      if (method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(read(FAV)), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
      if (method === "POST" && body) {
        const list = read(FAV);
        if (!list.some((t) => t.track_id === body.track_id)) {
          list.push({
            track_id: body.track_id,
            artist: body.artist || "",
            title: body.title || "",
            url: body.url || "",
            thumbnail_url: body.thumbnail_url || "",
          });
          write(FAV, list);
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      if (method === "DELETE" && body) {
        write(FAV, read(FAV).filter((t) => t.track_id !== body.track_id));
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
    }

    // ---- /api/artist-favorites ----
    if (url.startsWith("/api/artist-favorites")) {
      if (method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(read(AFV)), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
      if (method === "POST" && body) {
        const list = read(AFV);
        if (!list.some((a) => a.artist_id === body.artist_id)) {
          list.push({
            artist_id: body.artist_id,
            display_name: body.display_name || body.artist_id,
            thumbnail_url: body.thumbnail_url || "",
          });
          write(AFV, list);
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      if (method === "DELETE" && body) {
        write(AFV, read(AFV).filter((a) => a.artist_id !== body.artist_id));
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
    }

    // ---- /api/history ----
    if (url.startsWith("/api/history")) {
      if (method === "GET") {
        const list = read(HIS);
        list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return Promise.resolve(new Response(JSON.stringify(list), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
      if (method === "POST" && body) {
        const list = read(HIS);
        list.push({
          track_id: body.track_id,
          artist: body.artist || "",
          title: body.title || "",
          url: body.url || "",
          thumbnail_url: body.thumbnail_url || "",
          timestamp: new Date().toISOString(),
        });
        write(HIS, list);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      if (method === "DELETE") {
        write(HIS, []);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
    }

    return realFetch(input, init);
  };
})();
