// W48 feedback (design/app-ui/SPEC.md §60): what the app was doing, for a pilot's feedback. A small ring buffer of the last
// 200 entries or about 20 KB, each a time, a kind and a short detail: the screens and sheets opening and closing; Launch,
// Land, Undo, a course set and a re-plot; the GPS's state (good, rough, lost: never the position); WebGL losses and the
// ship guard's recoveries; updates taken; errors. It lives in memory only. W74 flightlog (F11): a GPS flight takes its own
// entries from Launch on, kept with the flight (app/blackbox.js), so a reload doesn't lose them. (app/log.js is the flight Log.)
//
//   note(kind, detail)     adds an entry
//   changed(kind, detail)  adds one only when detail differs from the last of its kind (the GPS's state, read each second)
//   trailLog.text()        the entries, one a line, oldest first
//   watchApp({ map, version })  the listeners: errors, WebGL, screens, the network and updates
//
// Nothing here runs per frame. A number with three or more decimals (a coordinate to 100 m or better) never gets in: it
// becomes "#", so even an error's message can't carry the position.
export const MAX_ENTRIES = 200, MAX_BYTES = 20_000, MAX_DETAIL = 240;

/** Any number with 3 or more decimals becomes "#": a coordinate, wherever it comes from. */
export const scrub = (s) => String(s ?? "").replace(/\d*\.\d{3,}/g, "#").replace(/-#/g, "#");

const two = (n) => String(n).padStart(2, "0");
/** One entry as its line: "21:04:07 gps lost". */
export const line = (e) => { const d = new Date(e.t); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} ${e.kind} ${e.detail}`.trimEnd(); };

export class TrailLog {
  constructor({ now = () => Date.now(), max = MAX_ENTRIES, bytes = MAX_BYTES } = {}) {
    Object.assign(this, { now, max, bytes, list: [], size: 0, last: {}, seq: 0 }); // W74 flightlog: seq, each entry's number (i)
  }
  add(kind, detail = "") {
    const e = { t: this.now(), kind: scrub(kind).slice(0, 16), detail: scrub(detail).replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL) };
    e.n = line(e).length + 1;
    e.i = ++this.seq; // W74 flightlog
    this.list.push(e);
    this.size += e.n;
    while (this.list.length > this.max || this.size > this.bytes) this.size -= this.list.shift().n;
    return e;
  }
  changed(kind, detail) {
    if (this.last[kind] === detail) return null;
    this.last[kind] = detail;
    return this.add(kind, detail);
  }
  text() { return this.list.map(line).join("\n"); }
}

export const trailLog = new TrailLog();
export const note = (kind, detail) => trailLog.add(kind, detail);
export const changed = (kind, detail) => trailLog.changed(kind, detail);

/** An error's message and the top two lines of its stack, with the site's address left out. */
export function errorLine(err, fallback = "") {
  const msg = err?.message ?? (typeof err === "string" ? err : fallback || String(err));
  const top = String(err?.stack ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !l.includes(msg)).slice(0, 2);
  const at = globalThis.location?.origin;
  return [msg, ...top].join(" | ").split(at || "\u0000").join("");
}

/** W88 feedbackinfo (SPEC §180): the last 10 uncaught errors and rejected promises, each its message and its stack's first line
 *  with no address's query, scrubbed; and the fetches that failed (no answer, or an error status), counted by host. */
export const errors = [], failedFetches = {};
export const errorShort = (err, fallback = "") => scrub(errorLine(err, fallback).split(" | ").slice(0, 2).join(" | ")
  .replace(/(\S)\?[^\s)]+?(?=(?::\d+){1,2}\)?(?:\s|$)|[\s)]|$)/g, "$1")).slice(0, MAX_DETAIL);
export const keepError = (err, fallback) => { errors.push(errorShort(err, fallback)); if (errors.length > 10) errors.shift(); };
/** W88 feedbackinfo: `fetch`, counting by host the requests that fail; an aborted one, an opaque answer and the page's own data: and
 *  blob: addresses aside (their URL's host is empty). */
export function countFailures(f = globalThis.fetch, base = globalThis.location?.href) {
  return (input, init) => {
    const p = f(input, init), fail = (e) => {
      if (e?.name === "AbortError") return;
      let host = ""; try { host = new URL(input?.url ?? String(input), base).host; } catch { /* not an address */ }
      if (host) failedFetches[host] = (failedFetches[host] || 0) + 1;
    };
    p.then((r) => { if (!r.ok && r.type !== "opaque") fail(); }, fail);
    return p;
  };
}

const SCREENS = [["#feedback[open]", "Send feedback"], ["#about-sheet[open]", "Settings"], ["#welcome[open]", "the welcome"], // W88 settings3: W76's More page went
  ["body.log-flight", "a flight in the Log"], ["body.log-page", "the Log"], ["#nogps:not([hidden])", "No location"],
  ["body.has-cfromto", "From and To"], ["body.has-csheet", "the course preview"], ["body.has-csearch", "search"]];
/** What covers the chart now, top first: "Settings, the course preview", or "the chart". */
export function screenNow(doc = document) {
  const on = SCREENS.filter(([sel]) => doc.querySelector(sel)).map(([, name]) => name);
  return on.length ? on.join(", ") : "the chart";
}

/** The app's listeners: errors, WebGL, the screens (a class or an open attribute changing, never per frame), the network, updates. */
export function watchApp({ map, version = "" } = {}) {
  note("start", `${version} · ${innerWidth} × ${innerHeight}`);
  addEventListener("error", (e) => { note("error", errorLine(e.error, e.message)); keepError(e.error, e.message); }); // W88 feedbackinfo: keepError
  addEventListener("unhandledrejection", (e) => { note("error", `unhandled: ${errorLine(e.reason)}`); keepError(e.reason); }); // W88 feedbackinfo: keepError
  if (globalThis.fetch) globalThis.fetch = countFailures(); // W88 feedbackinfo
  document.addEventListener("click", (e) => { // W88 feedbackinfo: a tap on a control, by its id (or its nearest id'd box's), never its words
    const c = e.target.closest?.("button, a, summary, input, select, [role=button], [role=switch], [role=tab]");
    if (c) note("tap", c.id || `in ${c.closest("[id]")?.id || "the page"}`);
  }, true);
  const canvas = map?.getCanvas?.();
  canvas?.addEventListener("webglcontextlost", () => note("webgl", "context lost"));
  canvas?.addEventListener("webglcontextrestored", () => note("webgl", "context restored"));
  addEventListener("online", () => note("net", "online"));
  addEventListener("offline", () => note("net", "offline"));
  let had = !!navigator.serviceWorker?.controller; // the first install takes control too: that's no update
  navigator.serviceWorker?.addEventListener("controllerchange", () => { if (had) note("update", "a new version took over"); had = true; });
  let shown = null;
  const look = () => { const s = screenNow(); if (s !== shown) { shown = s; note("screen", s); } };
  const mo = new MutationObserver(look);
  mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  for (const n of document.querySelectorAll("dialog, #nogps")) mo.observe(n, { attributes: true, attributeFilter: ["open", "hidden"] });
  look();
  return mo;
}
