// Starchart's service worker: the app shell from build.json, in a cache named for the bundle.
//
// - install: precache every file build.json lists, except the tiles and the map packs (W81 packstore; they live in OPFS, see
//   app/offline.js), the lazy voice lines (build.json `lazy`) and the install sheet's screenshots
//   (W22 pwa). The new version waits until the page says "skip-waiting", which it does only while
//   parked and with no landed sticker showing (app/main.js, "updates"): never mid-flight.
//   W26 downloads: a file whose SHA-256 the newest older Starchart cache's build.json gives too is copied from that
//   cache (and checked against the hash); only new, changed, missing and broken files come from the network.
// - activate: delete every older Starchart cache, and the lazy lines this build no longer has.
// - fetch: the shell from the cache; data/manifest.json from the network first; tiles straight
//   through to the network (HTTP Range), as is a request with `cache: "no-store"` (W46 updates: Check for updates). A lazy line comes from the voice cache, else from the network
//   on its first play, and then goes in the voice cache. That cache is keyed by each file's SHA-256 and
//   keeps its name across versions, so an update does not throw the lines away. W26 downloads: the label glyph ranges the
//   chart doesn't need (build.json `lazy` too, chart/style/glyph-ranges.mjs) work the same way, in a glyph cache.
// app/build.mjs writes the bundle hash into this file, so a new build is a new service worker.

const BUNDLE = "73c29b31f9db6a95b6baee1d3451148876c3854cfa59a0ae768c9d8d9ffb40af";
const CACHE = `starchart-${BUNDLE.slice(0, 16)}`;
const VOICE = "starchart-voice"; // survives a version change
const LINGO = "starchart.lingo"; // W60 d: the lingo mode the page last chose (app/calls.js keepLingo), for the install; not "starchart-", so no version change deletes it
const GLYPHS = "starchart-glyphs"; // W26 downloads: the same, for the lazy glyph ranges
const GLYPH_DIR = "chart/style/glyphs/";
const SCOPE = new URL("./", self.location).href;
const NETWORK_FIRST = new Set(["data/manifest.json"]);
const SHARED = "starchart.share"; // W67 routefile: what another app shared to Starchart (the manifest's share_target), kept for the page; not "starchart-", so no version change deletes it

let build = null; // this version's build.json
const buildJson = () => (build ??= caches.match("build.json", { cacheName: CACHE }).then((r) => r || fetch("build.json"))
  .then((r) => r.json()).catch((e) => { build = null; throw e; }));
/** The voice (or glyph) cache's key for a lazy file: its SHA-256, so a changed recording is a new entry. */
const voiceKey = (sha) => `${SCOPE}voice-cache/${sha}`;
const glyphKey = (sha) => `${SCOPE}glyph-cache/${sha}`; // W26 downloads

/** W26 downloads: the install's plan. Each path to precache is copied from the old version's cache when the old
 *  build.json gives it the same SHA-256 ("./" is index.html), else fetched. No old build.json: fetch them all. */
function copyPlan(paths, files, oldFiles) {
  const copy = [], get = [];
  for (const p of paths) {
    const f = p === "./" ? "index.html" : p;
    (oldFiles && files[f] && oldFiles[f] === files[f] ? copy : get).push(p);
  }
  return { copy, fetch: get };
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** W26 downloads: the newest older Starchart cache that has its build.json, and that build.json, or null. */
async function oldCache() {
  for (const k of (await caches.keys()).reverse()) {
    if (!k.startsWith("starchart-") || k === VOICE || k === GLYPHS) continue;
    const c = await caches.open(k), r = await c.match("build.json");
    const b = r && await r.json().catch(() => null);
    if (b?.files) return { cache: c, files: b.files };
  }
  return null;
}

/** W40 settings: a file to precache, from the browser's HTTP cache when it has it with the SHA-256 build.json gives (a first
 *  install's page has just loaded about 1 MB of the shell, which `reload` fetched again), else from the network.
 *  W74 integrity: the network's copy is checked too. One that doesn't match (a CDN edge still holding the last release's
 *  file) fails the install, as addAll would: the running version stays, and the next update check tries again. */
async function checked(p, sha) {
  for (const cache of ["default", "reload"]) {
    const r = await fetch(new Request(p, { cache }));
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    if (hex(await crypto.subtle.digest("SHA-256", buf)) === sha) return new Response(buf, { status: r.status, statusText: r.statusText, headers: r.headers }); // W74 integrity: on both passes
  }
  throw new Error(`${p}: not the file build.json lists`); // W74 integrity: fail closed
}

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const res = await fetch("build.json", { cache: "reload" });
    const json = await res.clone().json();
    if (json.bundle_hash !== BUNDLE) throw new Error("build.json: not this worker's build"); // W74 integrity: a CDN edge's last-release build.json beside the new sw.js would put N's files under N+1's cache; fail closed
    const lazy = new Set(json.lazy || []);
    // W60 d: and the other lingo mode's own lines: a SCUL pilot never downloads Plain's, nor a Plain pilot SCUL's
    const mode = await caches.match("mode", { cacheName: LINGO }).then((r) => (r ? r.text() : "scul")).catch(() => "scul");
    for (const p of json.voice?.[mode === "meatspace" ? "scul" : "meatspace"] || []) lazy.add(p);
    for (const p of Object.values(json.voices || {}).flatMap((v) => [...v.scul, ...v.meatspace])) lazy.add(p); // W97 voices: never precached, only a pick's
    const paths = ["./", ...Object.keys(json.files).filter((p) => !p.startsWith("data/tiles/") && !p.startsWith("data/packs/") && !p.startsWith("screenshots/") && p !== "sw.js" && p !== "build.json" && !lazy.has(p))]; // W81 packstore: never a map pack (app/packs.js)
    const old = await oldCache(); // W26 downloads
    const plan = copyPlan(paths, json.files, old?.files);
    const cache = await caches.open(CACHE);
    for (const p of plan.copy) { // a missing or broken entry is fetched instead
      const r = await old.cache.match(p), buf = r?.ok && await r.arrayBuffer();
      if (buf && hex(await crypto.subtle.digest("SHA-256", buf)) === json.files[p === "./" ? "index.html" : p]) {
        await cache.put(p, new Response(buf, { status: r.status, statusText: r.statusText, headers: r.headers }));
      } else plan.fetch.push(p);
    }
    const got = await Promise.all(plan.fetch.map((p) => checked(p, json.files[p === "./" ? "index.html" : p]))); // W40 settings: all or none, as addAll
    for (const [i, p] of plan.fetch.entries()) await cache.put(p, got[i]);
    await cache.put("build.json", res);
  })());
});

// W74 integrity: never while a tab flies. A flying tab holds the Web Lock FLYING (app/main.js, "updates"), so another tab's
// skip-waiting (its start, Check for updates) can't take its cache away mid-flight; the update waits for the next ask.
const FLYING = "starchart:flying";
const flying = () => Promise.resolve(self.navigator?.locks?.query()).then((q) => !!q?.held?.some((l) => l.name === FLYING), () => false);
self.addEventListener("message", (e) => { if (e.data === "skip-waiting") e.waitUntil(flying().then((f) => { if (!f) return self.skipWaiting(); })); }); // W74 integrity: flying

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("starchart-") && k !== CACHE && k !== VOICE && k !== GLYPHS) await caches.delete(k);
    const b = await buildJson().catch(() => null);
    if (b) { // keep only the lazy lines (W26 downloads: and glyph ranges) this version still has
      const keep = new Set([...(b.lazy || []), ...Object.values(b.voice || {}).flat(), ...Object.values(b.voices || {}).flatMap((v) => [...v.scul, ...v.meatspace])].flatMap((p) => [voiceKey(b.files[p]), glyphKey(b.files[p])])); // W60 d: voice; W97 voices: and the picked voices'
      for (const name of [VOICE, GLYPHS]) {
        const kept = await caches.open(name);
        for (const req of await kept.keys()) if (!keep.has(req.url)) await kept.delete(req);
      }
    }
    await self.clients.claim();
  })());
});

/** A lazy line: from the voice cache, else the network, cached once it is in. W26 downloads: a glyph range, in its own. */
async function lazyLine(req, sha, glyph = false) {
  const voice = await caches.open(glyph ? GLYPHS : VOICE), key = glyph ? glyphKey(sha) : voiceKey(sha);
  const hit = await voice.match(key);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok && r.status === 200) await voice.put(key, r.clone());
  return r;
}

/** W67 routefile (SPEC §94): Android's "Share to Starchart", a POST to ./?share-target (multipart: files, title, text, url),
 *  kept in the SHARED cache for the page (app/share-in.js), which opens at ./?shared=1. Nothing leaves the phone. */
async function takeShare(req) { // W67 routefile
  try { // W67 routefile
    const form = await req.formData(), c = await caches.open(SHARED), str = (k) => (typeof form.get(k) === "string" ? form.get(k) : ""); // W67 routefile
    const files = form.getAll("files").filter((f) => typeof f !== "string"); // W67 routefile
    for (const k of await c.keys()) await c.delete(k); // W67 routefile: one share at a time, the newest
    await Promise.all(files.map((f, i) => c.put(`${SCOPE}shared/${i}`, new Response(f, { headers: { "content-type": f.type || "application/octet-stream" } })))); // W67 routefile
    await c.put(`${SCOPE}shared/meta`, new Response(JSON.stringify({ at: Date.now(), title: str("title"), text: str("text"), url: str("url"), files: files.map((f) => ({ name: f.name || "shared file", type: f.type || "" })) }))); // W67 routefile
  } catch { /* W67 routefile: an unreadable share opens the app as ever */ } // W67 routefile
  return Response.redirect(`${SCOPE}?shared=1`, 303); // W67 routefile
} // W67 routefile

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method === "POST" && req.url.startsWith(SCOPE) && new URL(req.url).searchParams.has("share-target")) return e.respondWith(takeShare(req)); // W67 routefile
  if (req.method !== "GET" || !req.url.startsWith(SCOPE) || req.cache === "no-store") return; // W46 updates: no-store asks the server
  const path = new URL(req.url).pathname.slice(new URL(SCOPE).pathname.length);
  if (path.startsWith("data/tiles/") || path.startsWith("data/packs/")) return; // Range requests go to the network; W81 packstore: and a map pack's
  if (NETWORK_FIRST.has(path)) {
    e.respondWith(fetch(req, { cache: "no-cache" }).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req, { cacheName: CACHE }).then((r) => r || Response.error())));
    return;
  }
  if (path.startsWith("design/sound/voice/") && path.endsWith(".ogg")) {
    e.respondWith(buildJson().then((b) => (b.lazy?.includes(path) ? lazyLine(req, b.files[path])
      : caches.match(req, { cacheName: CACHE }).then((r) => r || (Object.values(b.voice || {}).some((v) => v.includes(path)) || Object.values(b.voices || {}).some((v) => v.scul.includes(path) || v.meatspace.includes(path)) ? lazyLine(req, b.files[path]) : fetch(req))))) // W60 d: a lingo mode's line the install left out; W97 voices: or a picked voice's
      .catch(() => fetch(req)));
    return;
  }
  if (path.startsWith(GLYPH_DIR)) { // W26 downloads: a lazy range is kept on first use, as a lazy line
    const p = decodeURIComponent(path);
    e.respondWith(buildJson().then((b) => (b.lazy?.includes(p) ? lazyLine(req, b.files[p], true)
      : caches.match(req, { cacheName: CACHE }).then((r) => r || fetch(req)))).catch(() => fetch(req)));
    return;
  }
  // the app shell: index.html for every page in scope, ignoring the query (?sim=demo and the rest)
  const key = req.mode === "navigate" ? "./" : req;
  e.respondWith(caches.match(key, { cacheName: CACHE, ignoreSearch: req.mode === "navigate" })
    .then((r) => r || fetch(req)));
});
