// W190 screenstate (design/app-ui/SPEC.md §330): which screen the app is on, and what covers the chart, told once.
//
// The audit of 2026-10-29 found the screen told by 14 classes and selectors set by 7 modules, each CSS rule combining its own
// mix, and "is something open over the chart?" asked by 8 hand-written lists that disagreed: a first-time tip opened over
// Layers and Weather, and the feedback report said "the chart" there. Now:
// - each module that holds a part of it says how to tell it, `own(id, fn)`, and calls `sync()` when it changes; the panels
//   and dialogs of index.html (COVERS' `node`s) are watched here (`watch()`);
// - `sync()` writes <html data-screen> (the screen on top, one of SCREENS), <html data-flight> (parked, flying or landed:
//   was html.bar and body.fx-flying) and <body data-open> (what covers the chart, by COVERS' ids, top first, and
//   "ride-preview"), and fires `starchart:screen` ({ screen, open }) once per change. The CSS reads `[data-open~="preview"]`
//   where it read `.has-csheet`, on the same element, so every rule kept its place in the cascade;
// - the readers ask `covered()`, `isOpen()` and `screenNow()`: the first-time tips' gate, the changelog's note, the update's
//   reload (main.js), the feedback report's Screen (trail-log.js), a hold on the chart (course.js) and the tabs (log.js).

/** The screens, top first: `<html data-screen>` is the first that is on. */
export const SCREENS = ["settings", "haul", "flight-page", "log", "fromto", "ride-preview", "preview", "search", "ride", "landed", "parked"];

/** What can cover the chart, top first. `node`: its element (a dialog is open with [open], anything else without [hidden]),
 *  unless a module owns it (`own`), when `node` only names its element. `reload`: a reload loses nothing of it (the search
 *  and the preview come back, W28 resume; a panel is one tap), so it never holds an update off. `rest`: any other dialog
 *  or panel on the screen (a share menu, the QR code, a question), by its role. */
export const COVERS = [
  { id: "feedback", name: "Send feedback", node: "#feedback" },
  { id: "changelog", name: "What's new", node: "#changelog", reload: true },
  { id: "install", name: "the install guide", node: "#install-guide", reload: true },
  { id: "settings", name: "Settings", node: "#about-sheet" },
  { id: "welcome", name: "the welcome", node: "#welcome" },
  { id: "haul", name: "long haul", node: "#haul", owned: true },
  { id: "flight-page", name: "a flight in the Log", node: "#log-flight", owned: true },
  { id: "log", name: "the Log", node: "#log-page", owned: true },
  { id: "layers", name: "Layers", node: "#layerspick", reload: true },
  { id: "weather", name: "Weather", node: "#wxsheet", reload: true },
  { id: "nogps", name: "No location", node: "#nogps", reload: true },
  { id: "turns", name: "the turn list", node: ".cturns-fly", owned: true, reload: true },
  { id: "fromto", name: "From and To", node: ".cfromto", owned: true },
  { id: "preview", name: "the course preview", node: ".csheet", owned: true, reload: true },
  { id: "search", name: "search", node: ".cresults:not(.cfromto)", owned: true, reload: true },
  { id: "panel", name: "a panel", node: 'dialog, [role="dialog"]', rest: true, reload: true },
];

const parts = new Map(); // id → () => on, from the module that holds it; "flight" → the flight's state
let last = "", said = false;

/** A module's part: `fn()` says whether it is on now ("flight": the flight's state). */
export function own(id, fn) { parts.set(id, fn); }

const named = COVERS.filter((c) => !c.rest).map((c) => c.node).join(", ");
const shows = (n) => (n.tagName === "DIALOG" ? n.open : !n.hidden);
function on(c, doc = globalThis.document) {
  if (c.owned) return !!parts.get(c.id)?.();
  if (!doc?.querySelectorAll) return false;
  if (c.rest) return [...doc.querySelectorAll(c.node)].some((n) => !n.matches(named) && (n.tagName === "DIALOG" ? n.open : n.getClientRects().length > 0));
  const n = doc.querySelector(c.node);
  return !!n && shows(n);
}

/** Whether any of `ids` (COVERS' or "ride-preview") is open now. */
export function isOpen(...ids) {
  return ids.some((id) => (id === "ride-preview" ? !!parts.get(id)?.() : on(COVERS.find((c) => c.id === id) ?? {})));
}

/** What covers the chart now, top first, by id: all of it, but those in `except`, and with `reload`, only what a reload would
 *  lose. */
export function covered({ except = [], reload = false, doc } = {}) {
  return COVERS.filter((c) => !except.includes(c.id) && !(reload && c.reload) && on(c, doc)).map((c) => c.id);
}

/** What covers the chart now, top first, in words: "Settings, the course preview", or "the chart" (the feedback report). */
export function screenNow(doc) {
  const names = COVERS.filter((c) => on(c, doc)).map((c) => c.name);
  return names.length ? names.join(", ") : "the chart";
}

/** The screen on top now, one of SCREENS. */
export function screen() {
  const f = parts.get("flight")?.() || "parked";
  return SCREENS.find((s) => (s === "ride" ? f === "flying" : s === "landed" || s === "parked" ? f === s : isOpen(s))) ?? "parked";
}

/** Writes the screen to the page and says so, once per change. Each part's setter calls it. */
export function sync() {
  const doc = globalThis.document, html = doc?.documentElement, body = doc?.body;
  if (!html?.dataset || !body?.dataset) return;
  const open = [...COVERS.filter((c) => !c.rest && on(c, doc)).map((c) => c.id), ...(parts.get("ride-preview")?.() ? ["ride-preview"] : [])].join(" ");
  const s = screen(), flight = parts.get("flight")?.() || "parked";
  if (html.dataset.screen !== s) html.dataset.screen = s;
  if (html.dataset.flight !== flight) html.dataset.flight = flight;
  if (body.dataset.open !== open) body.dataset.open = open;
  if (said) return;
  said = true;
  queueMicrotask(() => { // once for a burst: a preview drawn again closes and opens its sheet in one go
    said = false;
    const d = { screen: html.dataset.screen, flight: html.dataset.flight, open: body.dataset.open }, now = `${d.screen}|${d.flight}|${d.open}`;
    if (now === last) return;
    last = now;
    dispatchEvent(new CustomEvent("starchart:screen", { detail: { ...d, open: d.open ? d.open.split(" ") : [] } }));
  });
}

/** The dialogs and panels of index.html, however they open or close (main.js, once). */
export function watch(doc = document) {
  const mo = new MutationObserver(() => sync());
  for (const c of COVERS) if (!c.owned && !c.rest) for (const n of doc.querySelectorAll(c.node)) mo.observe(n, { attributes: true, attributeFilter: ["open", "hidden"] });
  sync();
  return mo;
}
