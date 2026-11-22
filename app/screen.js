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
export const SCREENS = ["settings", "pocket", "flight-page", "log", "fromto", "ride-preview", "preview", "search", "ride", "landed", "parked"]; // W210 pocket2: "pocket", was the long-haul screen's "haul"

/** What can cover the chart, top first. `node`: its element (a dialog is open with [open], anything else without [hidden]),
 *  unless a module owns it (`own`), when `node` only names its element. `reload`: a reload loses nothing of it (the search
 *  and the preview come back, W28 resume; a panel is one tap), so it never holds an update off. `rest`: any other dialog
 *  or panel on the screen (a share menu, the QR code, a question), by its role. */
export const COVERS = [
  { id: "feedback", name: "Send feedback", node: "#feedback" },
  { id: "changelog", name: "What's new", node: "#changelog", reload: true },
  { id: "tradeoffs", name: "Trade-offs", node: "#tradeoffs", reload: true }, // W199 prefs: Settings › Routing's page
  { id: "install", name: "the install guide", node: "#install-guide", reload: true },
  { id: "settings", name: "Settings", node: "#about-sheet" },
  { id: "welcome", name: "the welcome", node: "#welcome" },
  { id: "pocket", name: "Pocket", node: "#pocketed", owned: true }, // W210 pocket2 (SPEC §386): was the long-haul screen, "haul"
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

/** W239 leftovers7 (SPEC §502): what paints above the Layers panel and the weather sheet. Escape, as Back, goes to the topmost thing
 *  on screen, and what is on top is what is painted on top, which COVERS' order (by meaning) doesn't say: the From/To editor, the
 *  share menu and the QR are listed after the two panels and paint over them; the search's results, listed after them too, are under
 *  Layers and hide the weather sheet; the Log is listed before Layers and paints under it. Both panels are children of body in index.html: Layers z 7 (layers.css), the weather sheet z 6 (weather.css).
 *  Each row: `id`; open by `cover` (COVERS' id) or `sel` (matches only while it shows); how it stacks: `z` set by `rule` in `css`,
 *  `at` "html" (index.html, where its id is) or "end" (made by its module and appended to body, after both panels), or `top` (a
 *  modal dialog or a popover: the top layer, over any z-index), and `hides` (the panels a rule in weather.css hides while it is
 *  open); `zPreview` with `rulePreview`: its z while a route's preview is open. `layers`, `weather`: true if it paints above (or
 *  hides) that panel, "preview" if only while a preview is open. `apart`: why it is never open with them, or takes its own key
 *  first, so onTop() skips it. app/tests/screen-stack.test.mjs holds every row to the CSS. */
export const PANELS = { layers: { node: "#layerspick", z: 7, css: "layers.css", layers: false, weather: true }, weather: { node: "#wxsheet", z: 6, css: "weather.css", layers: false, weather: false } }; // and against each other: Layers paints above the weather sheet
export const STACK = [
  { id: "feedback", cover: "feedback", node: "#feedback", z: 12, css: "settings.css", rule: ":is(#feedback, #changelog, #install-guide)", at: "html", layers: true, weather: true },
  { id: "changelog", cover: "changelog", node: "#changelog", z: 12, css: "settings.css", rule: ":is(#feedback, #changelog, #install-guide)", at: "html", layers: true, weather: true },
  { id: "install", cover: "install", node: "#install-guide", z: 12, css: "settings.css", rule: ":is(#feedback, #changelog, #install-guide)", at: "html", layers: true, weather: true },
  { id: "tradeoffs", cover: "tradeoffs", node: "#tradeoffs", z: 12, css: "settings.css", rule: "#tradeoffs", at: "html", layers: true, weather: true },
  { id: "settings", cover: "settings", node: "#about-sheet", z: 11, css: "settings.css", rule: "#about-sheet", at: "html", layers: true, weather: true },
  { id: "welcome", cover: "welcome", node: "#welcome", top: "welcome.js showModal", layers: true, weather: true },
  { id: "pocket", cover: "pocket", node: "#pocketed", z: 20, css: "mission.css", rule: "#pocketed", at: "end", layers: true, weather: true },
  { id: "flight-page", cover: "flight-page", node: "#log-flight", z: 4, css: "log.css", rule: "#log-flight", at: "end", hides: ["weather"], layers: false, weather: true },
  { id: "log", cover: "log", node: "#log-page", z: 4, css: "log.css", rule: "#log-page", at: "end", hides: ["weather"], layers: false, weather: true },
  { id: "nogps", cover: "nogps", node: "#nogps", z: 3, css: "app.css", rule: "#nogps", at: "html", zPreview: 6, rulePreview: ["course.css", 'body[data-open~="preview"] #nogps'], layers: false, weather: "preview" },
  { id: "turns", cover: "turns", node: ".cturns-fly", z: 4, css: "turns.css", rule: ".cturns-fly", at: "end", layers: false, weather: false },
  { id: "fromto", cover: "fromto", node: ".cfromto", z: 7, css: "fromto.css", rule: ".cfromto", at: "end", layers: true, weather: true },
  { id: "preview", cover: "preview", node: ".csheet", z: 5, css: "course.css", rule: ".csheet", at: "end", layers: false, weather: false },
  { id: "search", cover: "search", node: ".cresults", z: 6, css: "course.css", rule: ".cresults", at: "end", hides: ["weather"], layers: false, weather: true },
  { id: "share", sel: ".cshare", node: ".cshare", z: 8, css: "around.css", rule: ".cshare", at: "end", layers: true, weather: true },
  { id: "qr", sel: ".cqr", node: ".cqr", z: 20, css: "around.css", rule: ".cqr", at: "end", layers: true, weather: true },
  { id: "launchcard", sel: ".fcard", node: ".fcard", z: 8, css: "launch.css", rule: ".fcard", at: "end", layers: true, weather: true }, // the first Launch's card (tips.js firstLaunch), placed after #gobar
  { id: "modal", sel: "dialog:modal", top: "showModal: the favorite's nickname (starred.js), the Log's question (log.js), a page over one (subpage.js)", layers: true, weather: true },
  { id: "startnote", sel: "#startnote:popover-open", node: "#startnote", top: "startfault.js showPopover", layers: true, weather: true },
  { id: "peek", sel: ".cpeek", node: ".cpeek", z: 7, css: "hints.css", rule: ".chint, .cpeek", at: "end", layers: true, weather: true }, // a stop's or a comet's pop-up (removed when it goes)
  { id: "placecard", sel: ".cpeek-place", node: ".cpeek-place", z: 7, css: "hints.css", rule: ".cpeek-place", at: "end", layers: true, weather: true }, // a place's pop-up: from a tap, or with none (a pasted link in Where to?, a #pin= link), so Layers can be open under it
  { id: "tip", sel: ".ftip[data-tip]", node: ".ftip", z: 9, css: "launch.css", rule: ".ftip", at: "end", layers: true, weather: true, apart: "a first-time tip never shows over them (main.js tipGate: nothing in COVERS)" },
  { id: "bubble", sel: "#loctip:popover-open", node: "#loctip", top: "tip.js showPopover", layers: true, weather: true, apart: "its own listener goes first (tip.js); an explanation takes the key, a status lets it go on (§391)" },
];
/** W239 leftovers7: true when nothing that paints above `id` ("layers" or "weather") is open, so its Escape is its own. */
export function onTop(id, doc = globalThis.document) {
  return !STACK.some((s) => !s.apart && (s[id] === true || (s[id] === "preview" && isOpen("preview"))) && (s.cover ? isOpen(s.cover) : !!doc?.querySelector?.(s.sel)))
    && !Object.entries(PANELS).some(([k, P]) => P[id] === true && isOpen(k)); // the other panel, if it paints above this one
}

/** What covers the chart now, top first, by id: all of it, but those in `except`, and with `reload`, only what a reload would
 *  lose. */
export function covered({ except = [], reload = false, doc } = {}) {
  const opening = parts.get("tab")?.() === "log"; // W211 noflash (SPEC §392): the Log a tap is opening covers it already, for the update's hold and the tips' gate
  return COVERS.filter((c) => !except.includes(c.id) && !(reload && c.reload) && (on(c, doc) || (opening && c.id === "log"))).map((c) => c.id);
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

/** W203 popups (SPEC §369): the tab the rider is on: "settings" (its pages too), "log" (a ride's page too) or "chart". */
export const tab = () => parts.get("tab")?.() || (isOpen("settings", "feedback", "changelog", "tradeoffs", "install") ? "settings" : isOpen("log", "flight-page") ? "log" : "chart"); // W203 popups; W211 noflash (SPEC §392): first, the tab a tap is opening while it comes unseen (app/log.js), so a note that tap raised is that tab's
/** W203 popups (her row 6: "I wouldn't want that pop-up to follow me if I am moving to different tabs"): a bar stays on the tab
 *  it was raised on: `end()` runs once the rider is on another tab (the screen's change, before it paints). Its tab is the one
 *  the tap that raised it opens: read once that tap's task is over, so a note a tab's own tap raised (End made final, Log full)
 *  shows on the tab it opened. Returns the switch that stops listening. */
export function onTabLeave(end) { // W203 popups
  let at = null; // W203 popups: till the tap's task is over
  const born = setTimeout(() => { at = tab(); }), off = () => { clearTimeout(born); removeEventListener("starchart:screen", check); }, check = () => { if (at && tab() !== at) { off(); end(); } }; // W203 popups
  addEventListener("starchart:screen", check); // W203 popups
  return off; // W203 popups
} // W203 popups

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
