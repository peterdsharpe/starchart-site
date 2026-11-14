// W23 touch: what things on the chart are (design/app-ui/SPEC.md §27). arclight, 2026-10-16: "I would hope that either
// tapping them (on mobile) or mouse-hovering over them (on desktop) would reveal what they are."
//
// - The tooltip: with a mouse (hover: hover and pointer: fine), the name and plain kind of what is under it. The
//   chart is asked once a frame at most, and only while the mouse moves; touch screens get no hover handlers at all.
// - The peek: a tap on anything with a name or kind (an icon, a road, a park, water) shows a small card near the tap,
//   and the camera stays put. W26 peek: it gives a road's facts and the distance from you;
//   W27 card: and a road's flying conditions, its comfort. Parked, a tap on it goes
//   straight to the course preview; in flight it is a hint only, which taps pass through, and it keeps off the ship and
//   the road ahead. It sits clear of every control, and goes on the next tap or after 4 s, plus 1.5 s a line of facts.
// - The routes in the preview: a hover (or, on touch, a press) on a dim route or its callout brightens that route.
// - With a mouse, an icon-only button shows its name on hover (its aria-label, as a title).
// course.js calls peek() from its chart click handler. W219 placecard (SPEC §427): a live card is its words, a grey line, then its
// tiles in a row (course.js's: a place's Star, Copy link and Go, a road's Prefer, Avoid and Never); the words aren't a button any more.
// iconAt(x, y) is the place's icon a hold means (course.js holdAt).

import { hintLayer, hintOf, hintText, pickHint, peekOf, roadFacts, flyingOf, plainKind, nearestPx, geomLines, asChart, isIcon, heldIcon, HOLD_BOX } from "./hint-logic.js"; // R2 ridenames: asChart; W84 roadtap: roadFacts, flyingOf, plainKind, nearestPx, geomLines; W219 placecard: isIcon, heldIcon, HOLD_BOX
import { labelFor } from "../chart/lingo/lingo.js"; // W84 roadtap
import { pick as pickWords, lingo as wordMode } from "./lingo-mode.js"; // W60 b; W84 roadtap: wordMode
import { placeName } from "./course-logic.js"; // W67 places: a place's own peek; W219 placecard: no distance (metres, distLabel)
import { say } from "./tip.js"; // W73 a11y
import { swipeAway, ALL, BOTTOM } from "./swipe.js"; // W201 gestures; W219 stationcard3: BOTTOM, a docked card's
import { backOnTouch } from "./dom.js"; // W210 popups3
import { offLine } from "./stops-logic.js"; // W209 water3
import { asStation } from "./map-pics.js"; // W218 stations2: a station's two networks as one icon, read as the whole station
import { comfortInk, GOOD, CALM } from "./comfort-along.js"; // W90 comfort: the bars in the comfort scale; W156 qualitysteps: comfortInk, GOOD; W160 quality2: CALM
import { peekSpot, inBox, placeCard, placeAgain } from "./card-place.js"; // W227 tapshows2 (SPEC §476): where a card goes, as one rule
export { peekSpot }; // W227 tapshows2: course.js's stop pop-up and the tests take it from here, as before

const SVG = "http://www.w3.org/2000/svg"; // W84 roadtap
const PEEK_MS = 4000, LINE_MS = 1500; // W26 peek: and 1.5 s more for each line of facts, to read them
const NARROW = () => Math.min(320, innerWidth - 76); // W226 tapshows: a place's card's width (hints.css .cpeek-place), the narrowest a wide card is tried at
// What a peek must never cover: the controls, the readout, the cards, sheets and callouts.
const AVOID = "button, .btn, [role=button], #stack, #banner > *, #scale, #nofix, #dlnote, #readout, #snack, .cturn, .csheet, .csearch, .cresults, #bar, .ccall, .cpin"; // W26 downloads: #dlnote

export const canHover = () => matchMedia("(hover: hover) and (pointer: fine)").matches;
/** W29 comets: app/comets.js's peeks, once main.js has mounted them: { at(x, y, than), cometPeek(c, relayout), stationPeek(f, t, relayout) }. */
export const cometHooks = {};

export const TAIL = 10, ICON_R = 12; // W84 roadtap: the tail's length, px; an icon's reach, so a tail points at an icon from its edge
/** W84 roadtap (SPEC §164): the peek's outline as one path, its rounded box (w × h, corners `r`) with a tail on the edge nearest
 *  the point `pt` (box px), at the point's x (or y), clear of the corners, reaching the point (angled, when a corner is in the way,
 *  up to 2.6 × `len`), its tip `stop` px short of it (an icon's edge); `len` long toward it when the peek had to sit farther off.
 *  { side, tip, d }, or null: the point is under it. */
export function tailOf(w, h, r, pt, len = TAIL, half = 6, stop = 0) {
  const out = { top: -pt[1], bottom: pt[1] - h, left: -pt[0], right: pt[0] - w };
  const side = Object.keys(out).reduce((a, b) => (out[b] > out[a] ? b : a));
  if (out[side] <= 0) return null;
  r = Math.max(0, Math.min(r, w / 2, h / 2) - 0.5);
  const x0 = 0.5, y0 = 0.5, x1 = w - 0.5, y1 = h - 0.5, flat = side === "top" || side === "bottom", L = flat ? x1 - x0 : y1 - y0;
  const b = Math.max(2.5, Math.min(half, (L - 2 * r) / 2)), c = Math.max(r + b, Math.min(L - r - b, (flat ? pt[0] : pt[1]) - 0.5)) + 0.5;
  const base = flat ? [c, side === "top" ? y0 : y1] : [side === "left" ? x0 : x1, c], n = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side];
  let vx = pt[0] - base[0], vy = pt[1] - base[1];
  const dist = Math.hypot(vx, vy) || 1, out1 = (vx * n[0] + vy * n[1]) / dist;
  if (out1 < 0.34) { const t = [-n[1], n[0]], s = Math.sign(vx * t[0] + vy * t[1]) || 1; vx = (n[0] * 0.34 + t[0] * s * 0.94) * dist; vy = (n[1] * 0.34 + t[1] * s * 0.94) * dist; } // at most 70° off the edge's normal
  const reach = Math.max(0, dist - stop), k = reach <= 2.6 * len ? reach / dist : (len + 0.5) / dist, tip = [base[0] + vx * k, base[1] + vy * k], f = (q) => `${+q[0].toFixed(2)},${+q[1].toFixed(2)}`;
  const at = (s, a, z) => (side === s ? ` L${f(a)} L${f(tip)} L${f(z)}` : "");
  const d = `M${f([x0 + r, y0])}${at("top", [c - b, y0], [c + b, y0])} L${f([x1 - r, y0])} A${r} ${r} 0 0 1 ${f([x1, y0 + r])}`
    + `${at("right", [x1, c - b], [x1, c + b])} L${f([x1, y1 - r])} A${r} ${r} 0 0 1 ${f([x1 - r, y1])}`
    + `${at("bottom", [c + b, y1], [c - b, y1])} L${f([x0 + r, y1])} A${r} ${r} 0 0 1 ${f([x0, y1 - r])}`
    + `${at("left", [x0, c + b], [x0, c - b])} L${f([x0, y0 + r])} A${r} ${r} 0 0 1 ${f([x0 + r, y0])} Z`;
  return { side, tip, d };
}

// W196 cards2 (SPEC §349): no routes (W111 tiles16, W140 routelit)
// W84 roadtap: roads(lonlat, m), the chart's z15 roads near a point, nearest first
// W77 hours: hours(f, lonlat, place), a promise of its line or ""
// W67 places: acts(f, lonlat), a live peek's star and share; W219 placecard: its tiles, Go among them (no open, no you)
// W226 tapshows: room(), where the route's sheet can step aside for a card (the camera still): null, or { as, put } (course.js; W227 tapshows2)
export function mountHints({ map, lingo, flight, ship = () => null, acts = () => [], hours = () => null, roads = async () => [], room = () => null }) {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const state = { hover: false, queries: 0, tip: null, peek: null }; // for tests, as window.starchartHints
  let layers = null;
  const ids = () => (layers ??= map.getLayersOrder().filter((id) => hintLayer(map.getLayer(id))));
  map.on?.("styledata", () => { layers = null; names = null; }); // W122 homerow: a layer added later (the racks file's, at z16) is read too
  const project = (c) => { const q = map.project(c); return [q.x, q.y]; };
  /** The feature to name at a point of the chart, or null. W33 peeks: a rotary's ring is its street, never its black hole. */
  const query = (x, y, r, layers = ids()) => { state.queries++; return map.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers }).map((f) => asStation(asChart(f))); }; // W218 stations2: asStation; R2 ridenames: asChart
  let names = null; // W108 glyphs: the squares' names, text only (no icon), so a tap counts on their box, not by the distance to their point
  const at = (x, y, r) => pick(query(x, y, r), x, y, r, map.queryRenderedFeatures([x, y], { layers: (names ??= ids().filter((id) => /^constellation/.test(id))) })); // W108 glyphs
  const pick = (fs, x, y, r, under) => pickHint(lingo, fs, [x, y], project, r, under); // W108 glyphs: under
  /** W219 placecard (SPEC §427): the place's icon a hold at (x, y) means (hint-logic.js heldIcon), of the hint layers' and `more`
   *  layers' (course.js: the favourites' marks), or null. */
  const iconAt = (x, y, more = []) => { // W219 placecard
    const { w, h, r } = HOLD_BOX, d = Math.max(w / 2, r); // W219 placecard
    const fs = map.queryRenderedFeatures([[x - d, y - h], [x + d, y + r]], { layers: [...ids(), ...more.filter((id) => map.getLayer(id))] }).map(asChart).filter((f) => (more.includes(f.layer.id) ? f.geometry?.type === "Point" : isIcon(lingo, f))); // W219 placecard
    state.queries++; // W219 placecard
    return fs[heldIcon(fs.map((f) => project(f.geometry.coordinates)), [x, y])] ?? null; // W219 placecard
  }; // W219 placecard
  /** W27 card: a road's flying conditions: seven bars that rise, lit up to its level, and the word; a screen reader hears
   *  "Flying conditions: fair, 4 of 7". W90 comfort: the lit bars in the level's colour of the comfort scale, as the course. */
  const flyingLine = (fl) => {
    const s = el("small", "cfly"), bars = el("i", "bars"), word = el("b", "", pickWords(`${fl.word} flying`, `${fl.word} riding`)); /* W60 b */
    bars.setAttribute("aria-hidden", "true"); word.setAttribute("aria-hidden", "true");
    for (let k = 1; k <= 7; k++) bars.append(el("i", k <= fl.level ? "on" : ""));
    s.dataset.level = fl.level;
    s.style.setProperty("--fly", comfortInk(fl.good ? GOOD : fl.calm ? Math.max(fl.at, CALM) : fl.at)); // W173 quality3: at its score, as the layer (was its level) // W160 quality2: a footpath's at least average; W90 comfort: lit in the comfort scale's colour, the course's (app/comfort-along.js); W156 qualitysteps: a lane, track or path in the bike blue
    s.append(bars, word, el("span", "sr", fl.said));
    return s;
  };
  const words = (n, h) => { const t = el("span", "t"); t.append(el("b", "", h.name || h.what), ...(h.name && h.what ? [el("span", "", ` · ${h.what}`)] : [])); n.replaceChildren(t); };

  // ---- the routes in the preview ----
  const BASE = map.getLayer("course-alt") ? map.getPaintProperty("course-alt", "line-opacity") : 0.5;
  let lit = "";
  function highlight(styles) {
    const key = styles?.join(" ") || "";
    if (key === lit || !map.getLayer("course-alt")) return;
    lit = key;
    map.setPaintProperty("course-alt", "line-opacity", key ? ["match", ["get", "style"], styles, 1, BASE] : BASE); // W201 routelook: the whole accent (was 0.9, over 0.4)
  }
  const calloutStyles = (t) => t?.closest?.(".ccall:not(.on) .cmin")?.dataset.styles?.split(" ") || null;
  const altAt = (x, y) => (map.getLayer("course-alt-hit") ? map.queryRenderedFeatures([x, y], { layers: ["course-alt-hit"] })[0]?.properties.style : null);
  // A press highlights before the release, on every screen; the click that follows picks the route (course.js).
  addEventListener("pointerdown", (e) => {
    const s = calloutStyles(e.target);
    if (s) return highlight(s);
    if (e.target === map.getCanvas()) { const r = map.getCanvas().getBoundingClientRect(), a = altAt(e.clientX - r.left, e.clientY - r.top); if (a) highlight([a]); }
  }, true);
  for (const t of ["pointerup", "pointercancel"]) addEventListener(t, () => { if (!state.hover) highlight(null); }, true);

  let peekEl = null, peekTimer = 0, peekDue = 0; // W77 hours: peekDue, when a timed peek goes (performance.now())

  // ---- the tooltip, with a mouse only ----
  const tip = el("div", "chint");
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  const hideTip = () => { if (tip.hidden) return; tip.hidden = true; state.tip = null; };
  if (canHover()) {
    state.hover = true;
    const canvas = map.getCanvas();
    let px = null, cx = 0, cy = 0, raf = 0;
    let hoverIds = null, size = [0, 0];
    const look = () => {
      raf = 0;
      if (!px) return;
      const [x, y] = px, fs = query(x, y, 12, hoverIds ??= [...ids(), ...(map.getLayer("course-alt-hit") ? ["course-alt-hit"] : [])]), alt = fs.find((f) => f.layer.id === "course-alt-hit")?.properties.style;
      highlight(alt ? [alt] : null);
      const f = alt ? null : pick(fs, x, y, 12), h = f && hintOf(lingo, f), cursor = alt || h ? "pointer" : "";
      if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
      if (!h || peekEl) return hideTip(); // a peek says it already
      const text = hintText(h);
      if (text !== state.tip) { words(tip, h); state.tip = text; tip.hidden = false; size = [tip.offsetWidth, tip.offsetHeight]; } // the words and their layout only when they change
      const [w, ht] = size;
      tip.style.transform = `translate(${Math.round(Math.min(cx + 14, innerWidth - w - 8))}px, ${Math.round(cy + 20 + ht > innerHeight - 8 ? cy - 12 - ht : cy + 20)}px)`;
    };
    canvas.addEventListener("mousemove", (e) => {
      if (e.buttons) { px = null; return hideTip(); } // a pan
      px = [e.offsetX, e.offsetY]; cx = e.clientX; cy = e.clientY; // the canvas fills the map's box
      raf ||= requestAnimationFrame(look);
    });
    canvas.addEventListener("mouseleave", () => { px = null; hideTip(); highlight(null); canvas.style.cursor = ""; });
    map.on("movestart", hideTip); // the chart moves under a still mouse: the tip would name the wrong thing
    document.addEventListener("mouseover", (e) => {
      const s = calloutStyles(e.target);
      if (s || e.target.closest?.(".ccall")) highlight(s);
      // an icon-only button says what it does, from its aria-label as it is now ("Location: following")
      const b = e.target.closest?.("button[aria-label]");
      if (b && b.innerText.trim().length < 3 && !b.matches(".cpeek-place .go")) b.title = b.getAttribute("aria-label"); // W219 placecard: a card's Go keeps its title, "Get directions"; its label carries the card's words
    });
    document.addEventListener("mouseout", (e) => { if (calloutStyles(e.target)) highlight(null); });
  }

  // ---- the peek ----
  let liveClose = null; // W29 comets: stops a live peek's refreshing
  let asks = 0; // W84 roadtap: the peeks asked for, so a slow road's answer knows it is stale
  /** W84 roadtap: where a peek of `f` (a feature, or null) tapped at `pt` points: a line's nearest point, an icon's own; how far off
   *  it sits, and how far short of the point its tail stops (an icon's edge). */
  const aim = (f, pt) => (f?.layer?.type === "line" ? { p: nearestPx(geomLines(f.geometry).map((l) => l.map(project)), pt).p, gap: TAIL, stop: 0, dot: true } // W84 roadtap
    : f?.geometry?.type === "Point" ? { p: project(f.geometry.coordinates), gap: TAIL + ICON_R, stop: ICON_R } : f ? { p: pt, gap: TAIL, stop: 0 } : { p: pt, gap: TAIL + ICON_R, stop: ICON_R }); // W84 roadtap: an area's, the tap; a comet's, the tap as an icon's
  let asideBack = null, downs = 0; // W226 tapshows (SPEC §476): brings the sheet back once the card it stepped aside for is closed; W227 tapshows2: the presses down
  /** W226 tapshows: the sheet back as it was, once the tap that closed the card has done what it does: a card it opens keeps the sheet aside
   *  (until the last closes); a tap on the thin panel or a pull of the sheet is hers, and course.js then brings nothing back over it. */
  function asideAfter(back) { // W226 tapshows
    let t = 0; const go = () => { removeEventListener("click", go, true); clearTimeout(t); setTimeout(() => { if (peekEl) asideBack ??= back; else back(); }); }; // W226 tapshows
    addEventListener("click", go, true); t = setTimeout(go, downs ? 700 : 0); // W226 tapshows: after the click a press ends in (none: a pan, a hold)
  } // W226 tapshows
  const sheetGlides = () => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.target?.matches?.(".cpreview")); // W226 tapshows
  /** W226 tapshows: `f()` with the sheet's glide at its end (where it goes), the glide then going on from where it was. */
  const settled = (f) => { const as = sheetGlides(), ts = as.map((a) => a.currentTime); for (const a of as) a.currentTime = a.effect.getComputedTiming().endTime - 1; try { return f(); } finally { as.forEach((a, i) => { a.currentTime = ts[i]; }); } }; // W226 tapshows
  /** W226 tapshows (SPEC §476): a cut card's key shows only where a row of its list shows whole. W227 tapshows2: its list always shows (a cut
   *  keeps its first strip and 24 px of its first row, as 0.1.116's); at its least (class `least`, comets.css) list and key take no room. */
  const keyed = (n, list) => {
    const k = n.querySelector(".cst-key"), r = list?.querySelector(".cdep"); if (!k) return; // W226 tapshows
    k.style.visibility = n.style.maxHeight && r && r.getBoundingClientRect().bottom > list.getBoundingClientRect().bottom + 1 ? "hidden" : ""; // W227 tapshows2: a list with no row (its reason alone) has no key to hide
  };
  function hidePeek() {
    clearTimeout(peekTimer);
    asks++; // W84 roadtap: a course peek still asking for its road gives way (another tap, a pan)
    liveClose?.(); liveClose = null; // W29 comets
    peekBack?.destroy(); peekBack = null; // W210 popups3
    peekEl?.remove();
    peekEl = state.peek = state.facts = state.flying = state.hours = state.tail = null; // W77 hours; W84 roadtap: tail
    if (asideBack) { asideAfter(asideBack); asideBack = null; } // W226 tapshows
  }
  let peekBack = null; // W210 popups3 (SPEC §391): Android's back closes the peek, not the app (nor the sheet under it)
  let closedByTap = false; // W112 taps (SPEC §225): this press on the chart closed a peek, so its click only closes (no new peek)
  let through = false; // rel-0.1.118 (SPEC §476): this press fell through a card laid over its own point to the chart: it takes no hold
  for (const t of ["pointerup", "pointercancel"]) addEventListener(t, () => { downs = Math.max(0, downs - 1); }, true); // W226 tapshows
  addEventListener("pointerdown", (e) => { // any other tap; W84 roadtap: one still asking for its road too
    const more = !e.isPrimary && downs > 0; downs = more ? downs + 1 : 1; // W227 tapshows2: a second finger, while the first is down
    closedByTap = !!peekEl && !peekEl.contains(e.target) && e.target === map.getCanvas();
    through = (more && through) || (closedByTap && peekEl.classList.contains("over") && inBox(peekEl.getBoundingClientRect(), e.clientX, e.clientY)); // W227 tapshows2 (the review's finding 6): for as long as the press that fell through is down, so a second finger held still takes no hold either
    if (!peekEl?.contains(e.target)) hidePeek();
  }, true);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && peekEl && !document.querySelector("dialog:modal")) { e.preventDefault(); e.stopImmediatePropagation(); hidePeek(); } }, true); // W92 panels: Escape closes the peek, and only the peek; W206 favnames: not a question's over it (the nickname's)
  map.on("movestart", (e) => { if (e.originalEvent) hidePeek(); }); // a pan or a pinch, not the camera following the ship
  /** A tap on the chart at a MapLibre click event: show what is there, if it has a name or a kind. W26 peek: its facts and
   *  its distance from you too; `live`, a tap on it sets a course there (open), else it is information only. W84 roadtap:
   *  `line`, the course's line under the tap ([lon, lat]s): the road the course runs on there (peekCourse). */
  function peek(e, live = !flight.flying, { line = null } = {}) { // W84 roadtap: line
    hidePeek();
    hideTip();
    if (line) return peekCourse(e, live, line); // W84 roadtap
    const f = at(e.point.x, e.point.y, 16), spot0 = f?.geometry.type === "Point" ? f.geometry.coordinates : e.lngLat.toArray(); // W219 placecard: no me
    const q = f?.geometry.type === "Point" ? project(spot0) : null, comet = cometHooks.at?.(e.point.x, e.point.y, q ? Math.hypot(q[0] - e.point.x, q[1] - e.point.y) : Infinity); // W29 comets: a comet nearer than the icon wins
    if (comet) { const c = cometHooks.cometPeek(comet, () => relayout?.()); return show(c.node, e, false, { lines: [], ...c, aim: aim(null, [e.point.x, e.point.y]) }); } // W29 comets: information only; W84 roadtap: aim
    const h = f && peekOf(lingo, f); // W219 placecard: no distance
    if (!h) return false;
    const { n, go, lines, live: tiled } = card(h, live, live ? acts(f, e.lngLat.toArray()) : []); // W67 places: card(), and a live peek's star and share; W196 cards2 (SPEC §349): no route rows (W140 routelit); W219 placecard: its tiles
    const st = ["comet_station", "sandworm_nest"].includes(f.properties?.kind) && cometHooks.stationPeek?.(f, go.firstChild, () => relayout?.(), hidePeek); // W29 comets: its next trains; W33 peeks: a nest's sandworms; W67 places: go; W219 stationcard3: hidePeek, its ×
    const shown = show(n, e, tiled, { lines, ms: st?.ms, close: st?.close, stay: !!st?.stay, dock: !!st?.dock, text: hintText(h), flying: h.flying, aim: aim(f, [e.point.x, e.point.y]) }); // W77 hours; W84 roadtap: aim; W219 placecard: tiled; W219 stationcard3: stay, dock
    if (shown && !st && f.geometry.type === "Point") addHours(n, go, h, tiled, () => hours(f, e.lngLat.toArray())); // W77 hours: a place's, not a road's or a station's
    return shown; // W77 hours
  }
  /** W84 roadtap: a tap on the course's line: the road under the line's nearest point, from the chart's own z15 roads (roads()),
   *  which have the name and the facts at every zoom (the rendered tiles drop names below z13, and a sidepath has only its
   *  street's); else the rendered road nearest that point. An unnamed one is named by its kind, with its flying conditions. */
  async function peekCourse(e, live, line) { // W84 roadtap
    const seq = asks, ll = map.unproject(nearestPx([line.map(project)], [e.point.x, e.point.y]).p).toArray(); // W84 roadtap
    let on = project(ll); // W84 roadtap
    const near = (fs) => fs.map((f) => ({ f, d: nearestPx(geomLines(f.geometry).map((l) => l.map(project)), on).d })).sort((a, b) => a.d - b.d)[0]?.f; // W84 roadtap
    const z15 = (await roads(ll, 15).catch(() => []))[0]; // W84 roadtap
    if (seq !== asks) return false; // W84 roadtap: another tap, or a pan, meanwhile
    on = project(ll); // W84 roadtap: where the line's point is now (the camera following the ship)
    const f = z15 ? { type: "Feature", geometry: z15.geometry, properties: { ...z15.properties, name: z15.properties.name || z15.properties.street || "" }, source: "chart", sourceLayer: "roads", layer: { id: "starpath", type: "line", "source-layer": "roads" } } // W84 roadtap: a sidepath by its street's name, as Avoid names it
      : near(query(on[0], on[1], 8).filter((g) => g.layer.type === "line" && g.sourceLayer === "roads")); // W84 roadtap
    if (!f) { peek(e, live); return false; } // W84 roadtap: no road there: as a tap off the course
    const named = peekOf(lingo, f), p = f.properties; // W84 roadtap; W219 placecard: no distance
    const k = p.kind, word = labelFor(lingo, k, {}, wordMode()), kind = plainKind(lingo, k); // W84 roadtap; W225 kindwords: bare, with its capital
    const h = named || ((word || kind) && { name: word || kind, what: word && wordMode() !== "meatspace" ? kind : "", facts: roadFacts(p), flying: flyingOf(p) }); // W84 roadtap: "Wormhole · Bike path", Plain's "Bike path"; W219 placecard: no away
    if (!h) { peek(e, live); return false; } // W84 roadtap
    const { n, lines: facts, live: tiled } = card(h, live, live && named ? acts(f, ll) : []); // W84 roadtap: an unnamed road has no star, share or Avoid; W219 placecard: so its card is words only
    return show(n, e, tiled, { lines: facts, text: hintText(h), flying: h.flying, aim: aim(f, on) }); // W84 roadtap
  } // W84 roadtap
  /** W77 hours: the place's hours under its name once the index answers ("Closed", "Closes 6 PM"), else nothing. */
  function addHours(n, go, h, live, ask) { // W77 hours
    Promise.resolve(ask()).then((t) => { // W77 hours
      if (!t || peekEl !== n) return; // W77 hours: gone, or nothing to say
      go.firstChild.append(el("small", "oh", t)); // W77 hours: under its lines (W219 placecard: no distance under it now)
      const tile = n.querySelector(".acts .go"), label = tile?.getAttribute("aria-label"), name = hintText(h); // W77 hours; W219 placecard: Go's (was the card's)
      if (label?.startsWith(name)) tile.setAttribute("aria-label", `${name}. ${t}${label.slice(name.length)}`); // W77 hours
      if (!live) say(n.innerText); // W77 hours: a peek of words only is read out, now with its hours
      state.hours = t; // W77 hours: for tests
      if (peekDue) { clearTimeout(peekTimer); peekDue += LINE_MS; peekTimer = setTimeout(hidePeek, peekDue - performance.now()); } // W77 hours: a line more to read
      relayout?.(); // W77 hours
    }).catch(() => {}); // W77 hours: no index, no line
  } // W77 hours
  /** The peek's card for `h`: live, its words (`go`, W67 places' name for them), a grey line, then its `actions` in a row of
   *  tiles (.cpeek-place); else, or with no actions, words only, which taps pass through. W219 placecard (SPEC §427), her rows
   *  12 and 25: "the name (with category), then the button row": the words aren't a button, Go is a tile of course.js's (was the
   *  card's own tap, with its ›). `live` in its answer: whether it has tiles. */
  function card(h, live, actions = []) { // W219 placecard: no onGo
    live &&= actions.length > 0; // W219 placecard: an unnamed road's card has nothing to do: words only
    const go = el("div", `cpeek${live ? "" : " fly"}`); // W67 places: card(); W219 placecard: words, never a button
    words(go, h);
    const lines = h.facts.filter(Boolean); // W219 placecard: no distance
    if (h.flying) go.firstChild.append(flyingLine(h.flying)); // W27 card: first under the name, the summary of the facts below it
    if (lines.length) go.firstChild.append(...lines.map((t) => el("small", "", t))); // W26 peek
    if (!live) return { n: go, go, lines, live }; // W67 places; W73 a11y: words only, no role="status": show() says them
    const tile = actions.find((b) => b.classList?.contains("go")); // W219 placecard: Go's spoken name is the card's tap's, its words then "Set course" (W27 card, W26 peek)
    if (tile) tile.setAttribute("aria-label", `${[hintText(h), h.flying?.said, ...lines].filter(Boolean).join(". ")}. ${tile.getAttribute("aria-label")}`); // W219 placecard
    const n = el("div", "cpeek-place"), a = el("span", "acts"); // W67 places
    a.append(...actions); n.append(go, a); // W67 places
    return { n, go, lines, live }; // W67 places
  }
  /** W67 places: a place's own peek at its point (a dropped pin, a map link's, a #pin= link's, a starred mark): its name,
   *  its quadrant and town (W219 placecard: no distance from you); `stay`, it waits for a tap elsewhere rather than its 4 s. */
  function peekPlace(place, { actions = [], stay = false, off = false } = {}) { // W67 places; W209 water3: off, a lit fountain that may be off for the winter
    hidePeek(); hideTip(); // W67 places
    const sub = [place.nick ? placeName(place) : "", place.place].filter(Boolean).join(" · "); // W206 favnames (SPEC §380): a favourite by her nickname, its own name under it
    const h = { name: place.nick || placeName(place), what: "", facts: [sub, off && offLine()].filter(Boolean) }; // W67 places; W206 favnames: nick, sub; W209 water3: off's line; W219 placecard: no away
    const { n, go, lines, live } = card(h, !flight.flying, flight.flying ? [] : actions); // W67 places: in flight, words only; W77 hours: go; W219 placecard: live, with its tiles
    const q = map.project(place.lonlat); // W67 places
    const shown = show(n, { point: q }, live, { lines, ms: stay ? 0 : undefined, stay, text: hintText(h), aim: { p: [q.x, q.y], gap: TAIL + ICON_R, stop: ICON_R } }); // W67 places; W84 roadtap: aim, the pin's tip; W219 placecard: live
    if (shown) addHours(n, go, h, live, () => hours(null, place.lonlat, place)); // W77 hours
    return shown; // W77 hours
  } // W67 places
  let relayout = null; // W29 comets: a live peek's content changed: place it again
  let tail = () => {}; // W84 roadtap: draws the open peek's tail again
  let box = null; // W152 app J5: the open peek's size, corner and place, measured when it is placed (show, relayout), and the point its tail was drawn to; a change to its content must call relayout
  map.on("move", () => tail()); // W84 roadtap: the chart moves under the peek (the camera following the ship); a pan closes it
  /** W84 roadtap: the peek's outline, with its tail toward `pt` (the page's px), as one SVG shape behind its content (hints.css). */
  function drawTail(n, pt, dot = false, stop = 0) { // W84 roadtap: stop, short of an icon
    if (box?.n !== n) box = { n, w: n.offsetWidth, h: n.offsetHeight, r: parseFloat(getComputedStyle(n).borderTopLeftRadius) || 0, left: parseFloat(n.style.left), top: parseFloat(n.style.top) }; // W84 roadtap: where it sits, not where its entrance is; W152 app J5: once a placing, not a frame
    if (box.pt?.[0] === pt[0] && box.pt[1] === pt[1]) return; // W152 app J5: the camera moved, but not the point under the peek
    box.pt = pt; // W152 app J5
    const { w, h, r, left, top } = box; // W152 app J5
    const t = tailOf(w, h, r, [pt[0] - left, pt[1] - top], TAIL, 6, stop); // W84 roadtap
    let svg = n.querySelector(":scope > .ctail"); // W84 roadtap
    if (!svg) { svg = document.createElementNS(SVG, "svg"); svg.classList.add("ctail"); svg.setAttribute("aria-hidden", "true"); svg.append(document.createElementNS(SVG, "path"), document.createElementNS(SVG, "circle")); n.append(svg); n.classList.add("tailed"); } // W84 roadtap: last, so the words stay the peek's first child (addHours, stationPeek)
    svg.setAttribute("width", w); svg.setAttribute("height", h); // W84 roadtap
    svg.firstChild.setAttribute("d", t?.d ?? tailOf(w, h, r, [w / 2, h + 1], 0).d); // W84 roadtap: no tail when the point is under the peek
    const near = t && Math.hypot(t.tip[0] - (pt[0] - left), t.tip[1] - (pt[1] - top)) < 1; // W84 roadtap: the dot only where the tip is on it
    Object.assign(svg.lastChild.style, { display: dot && t ? "" : "none" }); // W84 roadtap
    svg.lastChild.setAttribute("cx", pt[0] - left); svg.lastChild.setAttribute("cy", pt[1] - top); svg.lastChild.setAttribute("r", near ? 2.5 : 3); // W84 roadtap
    state.tail = t && { side: t.side, tip: [left + t.tip[0], top + t.tip[1]], to: pt }; // W84 roadtap: for tests
  } // W84 roadtap
  /** Place the peek `n` near the tap `e`, clear of the controls (W29 comets: from peek(), for comets too). W227 tapshows2 (SPEC §476): it
   *  measures the card and what is around it, card-place.js placeCard() says where it goes, and it puts it there; no rung is decided here. */
  function show(n, e, live, { lines, ms, close, text, flying = null, stay = false, dock = false, aim: to = { p: [e.point.x, e.point.y], gap: TAIL + ICON_R, stop: ICON_R } }) { // W67 places: stay; W84 roadtap: aim, the point its tail points at; W219 stationcard3: dock
    n.style.visibility = "hidden";
    document.body.append(n);
    const c = map.getContainer().getBoundingClientRect(), x = c.left + to.p[0], y = c.top + to.p[1], at0 = !live && ship(); // W84 roadtap: placed by the point it names
    const keepOut = at0 && (() => { const q = map.project(at0); return { left: c.left + q.x - 50, right: c.left + q.x + 50, top: c.top + q.y - 150, bottom: c.top + q.y + 30 }; })(); // in flight, off the ship and the road just ahead of it
    const cs = getComputedStyle(n), inset = (k) => parseFloat(cs[`scrollMargin${k}`]) || 0; // the safe areas (hints.css)
    const view = { left: inset("Left"), top: inset("Top"), right: innerWidth - inset("Right"), bottom: innerHeight - inset("Bottom") };
    const list = n.querySelector(".cst-list"), row = list?.querySelector(".cdep"); // rel-0.1.116: a station's or stop's list; W226 tapshows: a list with no row (its reason alone) isn't cut
    const avoid = () => [...document.querySelectorAll(AVOID)].filter((m) => m !== n && !n.contains(m) && m.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false)
      .map((m) => Object.assign(m.getBoundingClientRect(), { m })).filter((r) => r.width && r.height); // rel-0.1.116: m, what it is
    /** W227 tapshows2: what to keep clear of, in the page's order, by kind (card-place.js), measured where the sheet goes if it is gliding. */
    const boxes = () => [...settled(avoid).map((r) => Object.assign(r, { kind: !r.m.closest(".maplibregl-marker") ? "chrome" : r.m.matches("button, [role=button]") ? "button" : "pin" })), ...(keepOut ? [{ ...keepOut, kind: "ship" }] : [])]; // rel-0.1.116: a route's callout and a lit stop are buttons, the To pin isn't
    const sizes = () => { const h = n.offsetHeight, least = row ? h - list.offsetHeight : h, l = row && list.getBoundingClientRect().top, q = row?.getBoundingClientRect(); return { w: n.offsetWidth, h, least, row: row ? least + q.bottom - l : 0, strip: row ? least + q.top - l + 24 : 0 }; }; // W227 tapshows2: its heights
    const narrowed = (on) => { n.classList.toggle("narrowed", on); Object.assign(n.style, { boxSizing: on ? "border-box" : "", maxWidth: on ? `${NARROW()}px` : "" }); }; // W226 tapshows: a wide card (a ride's, a comet's) as narrow as a place's, its whole box (a ride's card is content-box); rel-0.1.118: .narrowed, comets.css lays a comet's rows out inside it
    const narrow = () => { narrowed(true); const z = n.scrollWidth <= n.clientWidth + 3 ? sizes() : null; narrowed(false); return z; }; // rel-0.1.118: failed where anything of it is wider than its box by more than its own rounding (1 px here, 2 on a screen of 2.25 or 2.63 px a pixel; a real overflow is 44 px and more)
    const docks = dock && dockable(), sheet = docks ? null : room(), B = docks ? null : boxes(); // W219 stationcard3: parked, over the chart's foot
    const ask = docks ? { dock: true } : { x, y, gap: to.gap, size: sizes(), narrow: n.offsetWidth > NARROW() ? narrow() : null, boxes: B, aside: null, view }; // W227 tapshows2
    let p = placeCard(ask); // W227 tapshows2
    if (sheet && (!p || p.narrowed || p.rung > 4)) p = placeCard(Object.assign(ask, { aside: sheet.as(boxes) })); // W226 tapshows: the sheet stepped aside, measured as it would be; W227 tapshows2 (the review's 6): only for a card rungs 1 to 4 don't place, as they don't read it
    state.place = { ask, p }; // W227 tapshows2: for tests, what it was asked and said
    if (!p) { n.remove(); close?.(); return false; } // no place: no card, rather than one over Land, and the sheet as it was
    if (p.dock) { docked(n); return shown(n, live, { lines, ms, close, text, flying, stay, dock }); } // W219 stationcard3
    if (p.narrowed) narrowed(true); // W226 tapshows
    if (p.h < n.offsetHeight) Object.assign(n.style, { boxSizing: "border-box", width: `${n.offsetWidth}px`, maxWidth: "none", maxHeight: `${p.h}px` }); // rel-0.1.116: its whole box (a ride's card is content-box), at the width it was placed by; W226 tapshows: maxWidth, so .cpeek's never narrows it under border-box
    n.classList.toggle("least", p.least); // rel-0.1.118: at its least its list and key take no room (comets.css), for as long as it is open
    const aside = p.aside ? sheet.put() : null, R = p.aside ? ask.aside : B; // W226 tapshows: the sheet steps aside (course.js room()); W227 tapshows2: R, what relayout keeps clear of
    Object.assign(n.style, { left: `${p.left}px`, top: `${p.top}px`, visibility: aside ? "hidden" : "" }); // W226 tapshows: shown once the sheet has stepped aside
    n.classList.toggle("over", p.over); // rel-0.1.118 (SPEC §476): laid over its own point, its body lets a drag or a tap through to the chart (hints.css); W227 tapshows2: not where a button of the map is under it
    n.addEventListener("click", (e) => { if (peekEl === n && !n.classList.contains("over") && inBox(n.getBoundingClientRect(), x, y) && !e.target.closest("button, a, [role=button], .cst-list")) hidePeek(); }); // W227 tapshows2 (the review's 3): over its point with a route's button under it, a tap on its words takes the press and only closes it, as one through it would
    const ins = aside ? n.getAnimations().filter((a) => a.animationName === "cpeek-in") : []; // W226 tapshows: its entrance, held, as it would end unseen before the sheet's glide
    if (aside) { asideBack = aside; for (const a of ins) a.pause(); Promise.all(sheetGlides().map((a) => a.finished)).catch(() => {}).then(() => { if (peekEl !== n) return; n.style.visibility = ""; for (const a of ins) { a.currentTime = 0; a.play(); } }); } // W226 tapshows: the sheet's glide, then the card's entrance
    keyed(n, list); // W226 tapshows
    let placed = n.offsetHeight, rowed = !!row, aimed = false; // W226 tapshows: its height where it was last placed: its spot's; its list has had a row; rel-0.1.118: aimed, its list scrolled to its reason by relayout
    for (const t of ["pointerdown", "wheel", "keydown"]) list?.addEventListener(t, () => { aimed = false; }, { passive: true }); // rel-0.1.118: she has touched or scrolled it herself
    const ll = map.unproject(to.p); // W84 roadtap: the tail follows it as the chart moves
    tail = () => { if (peekEl !== n) return; const q = map.project(ll); drawTail(n, [c.left + q.x, c.top + q.y], to.dot, to.stop); }; // W84 roadtap
    shown(n, live, { lines, ms, close, text, flying, stay }); // W219 stationcard3: the rest shared with a docked card
    relayout = () => { // W29 comets: in a clear spot for its new size, else kept in view where it is
      if (peekEl !== n) return;
      const left = n.offsetLeft, top = n.offsetTop; // W226 tapshows
      n.style.left = "0px"; // W33 peeks: measured at its own width, not squeezed against the edge where it was
      const q = placeAgain({ x, y, gap: to.gap, size: { w: n.offsetWidth, h: n.offsetHeight }, list: !!list, least: n.classList.contains("least"), boxes: R, view }, { left, top, h: placed }); // W227 tapshows2 (card-place.js)
      if (q.cap) Object.assign(n.style, { boxSizing: "border-box", width: `${n.offsetWidth}px`, maxWidth: "none", maxHeight: `${q.h}px` }); // W226 tapshows (SPEC §476): grown with no clear spot, it keeps its own, its list scrolling
      placed = n.offsetHeight; // W226 tapshows
      keyed(n, list); // W226 tapshows
      Object.assign(n.style, { left: `${q.left}px`, top: `${q.top}px` }); n.classList.toggle("over", q.over); // rel-0.1.118
      const why = rowed && n.style.maxHeight && !list.querySelector(".cdep") && list.querySelector(":scope > .cnote"); // W226 tapshows (SPEC §476): a cut card's rows gave way to its reason
      if (why) { rowed = false; if (!list.scrollTop && why.getBoundingClientRect().bottom > list.getBoundingClientRect().bottom + 1) { list.scrollTop = list.scrollHeight; aimed = true; } } // W226 tapshows: its list scrolled once to its end, the reason (unless she has scrolled it), the card as it was
      else if (aimed && list.querySelector(".cdep")) { aimed = false; rowed = true; list.scrollTop = 0; keyed(n, list); } // rel-0.1.118: rows back in it, its list from its top again, once (not after she has scrolled it), its key by the rows it shows now; to its reason again if they give way again
      box = null; // W152 app J5: its new size and place
      tail(); // W84 roadtap
    };
    return true;
  }
  /** W219 stationcard3 (SPEC §428), her row 26: a stop's or station's card, parked, over the chart's foot: as wide as the screen less 10 px a
   *  side (448 px at most, centred), its foot 8 px over the tab bar, as tall as its content up to 8 px under the Where to? bar, over the
   *  round buttons; past that its list scrolls (comets.css). No tail: its name and its lines lit say what it is. False where there is no
   *  Where to? bar or tab bar (a preview, a ride): placed by the tap, as every card. */
  const up = (m) => !!m && m.checkVisibility?.({ visibilityProperty: true }) !== false && m.getBoundingClientRect().height > 0; // W219 stationcard3
  const dockable = () => up(document.getElementById("gobar")) && up(document.getElementById("bar")); // W227 tapshows2: rung 1's, asked before its card is measured
  function docked(n) { // W219 stationcard3
    const top = document.getElementById("gobar"), bar = document.getElementById("bar"); // W219 stationcard3
    if (!up(top) || !up(bar)) return false; // W219 stationcard3
    const cs = getComputedStyle(n), l = parseFloat(cs.scrollMarginLeft) || 0, r = innerWidth - (parseFloat(cs.scrollMarginRight) || 0), w = Math.min(448, r - l - 20); // W219 stationcard3: inside the safe areas
    const t = top.getBoundingClientRect().bottom + 8, b = bar.getBoundingClientRect().top - 8; // W219 stationcard3
    n.classList.add("docked"); // W219 stationcard3
    Object.assign(n.style, { width: `${w}px`, maxHeight: `${Math.max(0, b - t)}px`, left: `${(l + r - w) / 2}px` }); // W219 stationcard3
    n.style.top = `${b - n.offsetHeight}px`; // W219 stationcard3: from its foot up
    n.style.visibility = ""; // W219 stationcard3
    return true; // W219 stationcard3
  } // W219 stationcard3
  /** The shown peek's handlers and timer (W219 stationcard3: shared by a placed card and a docked one). */
  function shown(n, live, { lines, ms, close, text, flying = null, stay = false, dock = false }) { // W219 stationcard3: was show()'s
    if (!live) { const v = n.style.visibility; n.style.visibility = ""; say(n.innerText); n.style.visibility = v; } // W73 a11y: a peek of words only is read out; W226 tapshows: its words though it is unseen till the sheet has stepped aside (innerText leaves out what isn't visible)
    peekEl = n;
    peekBack ??= backOnTouch(() => { peekBack = null; if (peekEl === n) hidePeek(); }); // W210 popups3
    swipeAway(n, { dirs: dock ? BOTTOM : ALL, close: () => { if (peekEl === n) hidePeek(); } }); // W201 gestures (SPEC §362): a swipe sends it away, as a tap elsewhere does; W219 stationcard3: a docked card down or sideways, as a bar at the foot
    if (n.matches(".fly")) n.onclick = () => { if (peekEl === n) hidePeek(); }; // W201 gestures: words only take a touch screen's taps (hints.css), and a tap closes them
    if (dock) { tail = () => {}; relayout = () => { if (peekEl === n) docked(n); }; } // W219 stationcard3: no tail; a new size, placed again from its foot
    box = null; // W152 app J5: measured again, placed anew
    tail(); // W84 roadtap: its tail, toward what it names
    state.peek = text;
    state.facts = lines; // W26 peek: for tests
    state.flying = flying; // W27 card: for tests
    liveClose = close || null; // W29 comets
    if (!stay) peekTimer = setTimeout(hidePeek, ms || PEEK_MS + LINE_MS * lines.length); // W29 comets: a live peek stays longer; W67 places: a place's own may stay
    peekDue = stay ? 0 : performance.now() + (ms || PEEK_MS + LINE_MS * lines.length); // W77 hours
    return true;
  }
  window.starchartHints = state;
  /** W112 taps: whether the chart's click at hand only closes a peek (its press closed one); a tap on a control elsewhere still acts. */
  const closing = () => closedByTap; // W112 taps
  return { peek, hidePeek, peekPlace, closing, iconAt, through: () => through, after: asideAfter }; // rel-0.1.118: through; W227 tapshows2: after, course.js's stop pop-up //  W67 places: peekPlace; W112 taps: closing; W219 placecard: iconAt
}
