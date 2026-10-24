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
// course.js calls peek() from its chart click handler, and gives open(feature, lonlat) for the course preview.

import { hintLayer, hintOf, hintText, pickHint, peekOf, roadFacts, flyingOf, plainKind, nearestPx, geomLines } from "./hint-logic.js"; // W84 roadtap: roadFacts, flyingOf, plainKind, nearestPx, geomLines
export { nearestPx }; // W84 roadtap
import { labelFor } from "../chart/lingo/lingo.js"; // W84 roadtap
import { pick as pickWords, lingo as wordMode } from "./lingo-mode.js"; // W60 b; W84 roadtap: wordMode
import { metres } from "./geo.js"; // W26 peek
import { distLabel, placeName } from "./course-logic.js"; // W67 places: a place's own peek
import { say } from "./tip.js"; // W73 a11y

const SVG = "http://www.w3.org/2000/svg"; // W84 roadtap
const PEEK_MS = 4000, LINE_MS = 1500; // W26 peek: and 1.5 s more for each line of facts, to read them
// What a peek must never cover: the controls, the readout, the cards, sheets and callouts.
const AVOID = "button, .btn, [role=button], #stack, #banner > *, #scale, #nofix, #dlnote, #readout, #snack, .cturn, .csheet, .csearch, .cresults, #bar, .ccall, .cpin"; // W26 downloads: #dlnote

export const canHover = () => matchMedia("(hover: hover) and (pointer: fine)").matches;
/** W29 comets: app/comets.js's peeks, once main.js has mounted them: { at(x, y, than), cometPeek(c, relayout), stationPeek(f, t, relayout) }. */
export const cometHooks = {};

/** Where a box of w × h goes near a tap at (x, y): above it, else below, else to either side, else farther above or
 *  below (past the ship, in flight), clear of `rects`, in view. */
export function peekSpot(x, y, w, h, rects, view, gap = 26, pad = 8) {
  const clampX = (l) => Math.max(view.left + pad, Math.min(view.right - pad - w, l)), cx = clampX(x - w / 2);
  const tries = [[cx, y - gap - h], [cx, y + gap], [x + gap, y - h / 2], [x - gap - w, y - h / 2]];
  for (let d = 40; d <= 200; d += 40) tries.push([cx, y + gap + d], [cx, y - gap - h - d]);
  for (const [l, t] of tries) {
    if (t < view.top + pad || t + h > view.bottom - pad || l < view.left + pad || l + w > view.right - pad) continue;
    if (!rects.some((r) => l < r.right + pad && l + w > r.left - pad && t < r.bottom + pad && t + h > r.top - pad)) return { left: l, top: t };
  }
  return null;
}

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

export function mountHints({ map, lingo, flight, open, ship = () => null, you = () => null, acts = () => [], hours = () => null, roads = async () => [] }) { // W84 roadtap: roads(lonlat, m), the chart's z15 roads near a point, nearest first // W77 hours: hours(f, lonlat, place), a promise of its line or "" // W26 peek: you(), the pilot's [lon, lat] when it is known; W67 places: acts(f, lonlat), a live peek's star and share
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const state = { hover: false, queries: 0, tip: null, peek: null }; // for tests, as window.starchartHints
  let layers = null;
  const ids = () => (layers ??= map.getLayersOrder().filter((id) => hintLayer(map.getLayer(id))));
  const project = (c) => { const q = map.project(c); return [q.x, q.y]; };
  /** The feature to name at a point of the chart, or null. W33 peeks: a rotary's ring is its street, never its black hole. */
  const query = (x, y, r, layers = ids()) => { state.queries++; return map.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers }); };
  let names = null; // W108 glyphs: the squares' names, text only (no icon), so a tap counts on their box, not by the distance to their point
  const at = (x, y, r) => pick(query(x, y, r), x, y, r, map.queryRenderedFeatures([x, y], { layers: (names ??= ids().filter((id) => /^constellation/.test(id))) })); // W108 glyphs
  const pick = (fs, x, y, r, under) => pickHint(lingo, fs, [x, y], project, r, under); // W108 glyphs: under
  /** W27 card: a road's flying conditions: seven bars that rise and brighten as the chart's cyan lines do with comfort, lit
   *  up to its level, and the word; a screen reader hears "Flying conditions: fair, 4 of 7". */
  const flyingLine = (fl) => {
    const s = el("small", "cfly"), bars = el("i", "bars"), word = el("b", "", pickWords(`${fl.word} flying`, `${fl.word} riding`)); /* W60 b */
    bars.setAttribute("aria-hidden", "true"); word.setAttribute("aria-hidden", "true");
    for (let k = 1; k <= 7; k++) bars.append(el("i", k <= fl.level ? "on" : ""));
    s.dataset.level = fl.level;
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
    map.setPaintProperty("course-alt", "line-opacity", key ? ["match", ["get", "style"], styles, 0.9, BASE] : BASE);
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
      if (b && b.innerText.trim().length < 3) b.title = b.getAttribute("aria-label");
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
  function hidePeek() {
    clearTimeout(peekTimer);
    asks++; // W84 roadtap: a course peek still asking for its road gives way (another tap, a pan)
    liveClose?.(); liveClose = null; // W29 comets
    peekEl?.remove();
    peekEl = state.peek = state.facts = state.flying = state.hours = state.tail = null; // W77 hours; W84 roadtap: tail
  }
  addEventListener("pointerdown", (e) => { if (!peekEl?.contains(e.target)) hidePeek(); }, true); // any other tap; W84 roadtap: one still asking for its road too
  addEventListener("keydown", (e) => { if (e.key === "Escape" && peekEl) { e.preventDefault(); e.stopImmediatePropagation(); hidePeek(); } }, true); // W92 panels: Escape closes the peek, and only the peek
  map.on("movestart", (e) => { if (e.originalEvent) hidePeek(); }); // a pan or a pinch, not the camera following the ship
  /** A tap on the chart at a MapLibre click event: show what is there, if it has a name or a kind. W26 peek: its facts and
   *  its distance from you too; `live`, a tap on it sets a course there (open), else it is information only. W84 roadtap:
   *  `line`, the course's line under the tap ([lon, lat]s): the road the course runs on there (peekCourse). */
  function peek(e, live = !flight.flying, { line = null } = {}) { // W84 roadtap: line
    hidePeek();
    hideTip();
    if (line) return peekCourse(e, live, line); // W84 roadtap
    const f = at(e.point.x, e.point.y, 16), spot0 = f?.geometry.type === "Point" ? f.geometry.coordinates : e.lngLat.toArray(), me = f && you();
    const q = f?.geometry.type === "Point" ? project(spot0) : null, comet = cometHooks.at?.(e.point.x, e.point.y, q ? Math.hypot(q[0] - e.point.x, q[1] - e.point.y) : Infinity); // W29 comets: a comet nearer than the icon wins
    if (comet) { const c = cometHooks.cometPeek(comet, () => relayout?.()); return show(c.node, e, false, { lines: [], ...c, aim: aim(null, [e.point.x, e.point.y]) }); } // W29 comets: information only; W84 roadtap: aim
    const h = f && peekOf(lingo, f, me ? metres(me, spot0) : null);
    if (!h) return false;
    const { n, go, lines } = card(h, live, () => open(f, e.lngLat.toArray()), live ? acts(f, e.lngLat.toArray()) : []); // W67 places: card(), and a live peek's star and share
    const st = ["comet_station", "sandworm_nest"].includes(f.properties?.kind) && cometHooks.stationPeek?.(f, go.firstChild, () => relayout?.()); // W29 comets: its next trains; W33 peeks: a nest's sandworms; W67 places: go
    const shown = show(n, e, live, { lines, ms: st?.ms, close: st?.close, text: hintText(h), flying: h.flying, aim: aim(f, [e.point.x, e.point.y]) }); // W77 hours; W84 roadtap: aim
    if (shown && !st && f.geometry.type === "Point") addHours(n, go, h, live, () => hours(f, e.lngLat.toArray())); // W77 hours: a place's, not a road's or a station's
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
    const me = you(), m = me ? metres(me, ll) : null, named = peekOf(lingo, f, m), p = f.properties; // W84 roadtap
    const k = p.kind, word = labelFor(lingo, k, {}, wordMode()), kind = plainKind(lingo, k).replace(/^an? /, ""); // W84 roadtap
    const h = named || ((word || kind) && { name: word || kind[0].toUpperCase() + kind.slice(1), what: word && wordMode() !== "meatspace" ? plainKind(lingo, k) : "", facts: roadFacts(p), flying: flyingOf(p), away: m != null ? `${distLabel(m)} from you` : "" }); // W84 roadtap: "Wormhole · a bike path", Plain's "Bike path"
    if (!h) { peek(e, live); return false; } // W84 roadtap
    const { n, lines: facts } = card(h, live, () => open(f, ll), live && named ? acts(f, ll) : []); // W84 roadtap: an unnamed road has no star, share or Avoid
    return show(n, e, live, { lines: facts, text: hintText(h), flying: h.flying, aim: aim(f, on) }); // W84 roadtap
  } // W84 roadtap
  /** W77 hours: the place's hours under its name once the index answers ("Closed", "Closes 6 PM"), else nothing. */
  function addHours(n, go, h, live, ask) { // W77 hours
    Promise.resolve(ask()).then((t) => { // W77 hours
      if (!t || peekEl !== n) return; // W77 hours: gone, or nothing to say
      go.firstChild.insertBefore(el("small", "oh", t), go.firstChild.querySelector(".away")); // W77 hours: above the LY from you
      const label = go.getAttribute("aria-label"), name = hintText(h); // W77 hours
      if (label?.startsWith(name)) go.setAttribute("aria-label", `${name}. ${t}${label.slice(name.length)}`); // W77 hours
      if (!live) say(n.innerText); // W77 hours: a peek of words only is read out, now with its hours
      state.hours = t; // W77 hours: for tests
      if (peekDue) { clearTimeout(peekTimer); peekDue += LINE_MS; peekTimer = setTimeout(hidePeek, peekDue - performance.now()); } // W77 hours: a line more to read
      relayout?.(); // W77 hours
    }).catch(() => {}); // W77 hours: no index, no line
  } // W77 hours
  /** The peek's card for `h`: live, a button that sets a course (`onGo`); else words only, which taps pass through. W67
   *  places: a live one with `actions` (the star and share) sits in a pill with them beside it (.cpeek-place). */
  function card(h, live, onGo, actions = []) {
    const go = el(live ? "button" : "div", `cpeek${live ? "" : " fly"}`); // W67 places: card()
    words(go, h);
    const lines = [...h.facts, h.away].filter(Boolean);
    if (h.flying) go.firstChild.append(flyingLine(h.flying)); // W27 card: first under the name, the summary of the facts below it
    if (lines.length) go.firstChild.append(...lines.map((t, i) => el("small", i === lines.length - 1 && h.away ? "away" : "", t))); // W26 peek
    if (live) {
      go.setAttribute("aria-label", `${[hintText(h), h.flying?.said, ...lines].filter(Boolean).join(". ")}. ${pickWords("Set course", "Get directions")}`); /* W60 b */ // W27 card: the flying conditions // W26 peek: the › sets a course there
      go.title = pickWords("Set course", "Get directions"); // W60 b
      go.onclick = (ev) => { ev.stopPropagation(); hidePeek(); onGo(); };
    } // W73 a11y: words only, no role="status": show() says them
    if (!live || !actions.length) return { n: go, go, lines }; // W67 places
    const n = el("div", "cpeek-place"), a = el("span", "acts"); // W67 places
    a.append(...actions); n.append(go, a); // W67 places
    return { n, go, lines }; // W67 places
  }
  /** W67 places: a place's own peek at its point (a dropped pin, a map link's, a #pin= link's, a starred mark): its name,
   *  its quadrant and town, and the distance from you; `stay`, it waits for a tap elsewhere rather than its 4 s. */
  function peekPlace(place, { actions = [], stay = false } = {}) { // W67 places
    hidePeek(); hideTip(); // W67 places
    const me = you(), h = { name: placeName(place), what: "", facts: place.place ? [place.place] : [], away: me ? `${distLabel(metres(me, place.lonlat))} from you` : "" }; // W67 places
    const { n, go, lines } = card(h, !flight.flying, () => open(null, place.lonlat, place), flight.flying ? [] : actions); // W67 places: in flight, words only; W77 hours: go
    const q = map.project(place.lonlat); // W67 places
    const shown = show(n, { point: q }, !flight.flying, { lines, ms: stay ? 0 : undefined, stay, text: hintText(h), aim: { p: [q.x, q.y], gap: TAIL + ICON_R, stop: ICON_R } }); // W67 places; W84 roadtap: aim, the pin's tip
    if (shown) addHours(n, go, h, !flight.flying, () => hours(null, place.lonlat, place)); // W77 hours
    return shown; // W77 hours
  } // W67 places
  let relayout = null; // W29 comets: a live peek's content changed: place it again
  let tail = () => {}; // W84 roadtap: draws the open peek's tail again
  map.on("move", () => tail()); // W84 roadtap: the chart moves under the peek (the camera following the ship); a pan closes it
  /** W84 roadtap: the peek's outline, with its tail toward `pt` (the page's px), as one SVG shape behind its content (hints.css). */
  function drawTail(n, pt, dot = false, stop = 0) { // W84 roadtap: stop, short of an icon
    const w = n.offsetWidth, h = n.offsetHeight, left = parseFloat(n.style.left), top = parseFloat(n.style.top); // W84 roadtap: where it sits, not where its entrance is
    const t = tailOf(w, h, parseFloat(getComputedStyle(n).borderTopLeftRadius) || 0, [pt[0] - left, pt[1] - top], TAIL, 6, stop); // W84 roadtap
    let svg = n.querySelector(":scope > .ctail"); // W84 roadtap
    if (!svg) { svg = document.createElementNS(SVG, "svg"); svg.classList.add("ctail"); svg.setAttribute("aria-hidden", "true"); svg.append(document.createElementNS(SVG, "path"), document.createElementNS(SVG, "circle")); n.append(svg); n.classList.add("tailed"); } // W84 roadtap: last, so the words stay the peek's first child (addHours, stationPeek)
    svg.setAttribute("width", w); svg.setAttribute("height", h); // W84 roadtap
    svg.firstChild.setAttribute("d", t?.d ?? tailOf(w, h, parseFloat(getComputedStyle(n).borderTopLeftRadius) || 0, [w / 2, h + 1], 0).d); // W84 roadtap: no tail when the point is under the peek
    const near = t && Math.hypot(t.tip[0] - (pt[0] - left), t.tip[1] - (pt[1] - top)) < 1; // W84 roadtap: the dot only where the tip is on it
    Object.assign(svg.lastChild.style, { display: dot && t ? "" : "none" }); // W84 roadtap
    svg.lastChild.setAttribute("cx", pt[0] - left); svg.lastChild.setAttribute("cy", pt[1] - top); svg.lastChild.setAttribute("r", near ? 2.5 : 3); // W84 roadtap
    state.tail = t && { side: t.side, tip: [left + t.tip[0], top + t.tip[1]], to: pt }; // W84 roadtap: for tests
  } // W84 roadtap
  /** Place the peek `n` near the tap `e`, clear of the controls (W29 comets: from peek(), for comets too). */
  function show(n, e, live, { lines, ms, close, text, flying = null, stay = false, aim: to = { p: [e.point.x, e.point.y], gap: TAIL + ICON_R, stop: ICON_R } }) { // W67 places: stay; W84 roadtap: aim, the point its tail points at
    n.style.visibility = "hidden";
    document.body.append(n);
    const rects = [...document.querySelectorAll(AVOID)].filter((m) => m !== n && !n.contains(m) && m.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false)
      .map((m) => m.getBoundingClientRect()).filter((r) => r.width && r.height);
    const c = map.getContainer().getBoundingClientRect(), x = c.left + to.p[0], y = c.top + to.p[1], at0 = !live && ship(); // W84 roadtap: placed by the point it names
    if (at0) { const q = map.project(at0); rects.push({ left: c.left + q.x - 50, right: c.left + q.x + 50, top: c.top + q.y - 150, bottom: c.top + q.y + 30 }); } // in flight, off the ship and the road just ahead of it
    const cs = getComputedStyle(n), inset = (k) => parseFloat(cs[`scrollMargin${k}`]) || 0; // the safe areas (hints.css)
    const view = { left: inset("Left"), top: inset("Top"), right: innerWidth - inset("Right"), bottom: innerHeight - inset("Bottom") };
    const spot = peekSpot(x, y, n.offsetWidth, n.offsetHeight, rects, view, to.gap); // W84 roadtap: to.gap
    if (!spot) { n.remove(); close?.(); return false; } // nowhere clear of the controls: no peek, rather than one over Land
    Object.assign(n.style, { left: `${spot.left}px`, top: `${spot.top}px`, visibility: "" });
    const ll = map.unproject(to.p); // W84 roadtap: the tail follows it as the chart moves
    tail = () => { if (peekEl !== n) return; const q = map.project(ll); drawTail(n, [c.left + q.x, c.top + q.y], to.dot, to.stop); }; // W84 roadtap
    if (!live) say(n.innerText); // W73 a11y: a peek of words only is read out
    peekEl = n;
    tail(); // W84 roadtap: its tail, toward what it names
    state.peek = text;
    state.facts = lines; // W26 peek: for tests
    state.flying = flying; // W27 card: for tests
    liveClose = close || null; // W29 comets
    relayout = () => { // W29 comets: in a clear spot for its new size, else kept in view where it is
      if (peekEl !== n) return;
      const left = n.offsetLeft, top = n.offsetTop;
      n.style.left = "0px"; // W33 peeks: measured at its own width, not squeezed against the edge where it was
      const w = n.offsetWidth, s = peekSpot(x, y, w, n.offsetHeight, rects, view, to.gap) || { left: Math.max(view.left + 8, Math.min(view.right - 8 - w, left)), top }; // W84 roadtap: to.gap
      Object.assign(n.style, { left: `${s.left}px`, top: `${s.top}px` });
      tail(); // W84 roadtap
    };
    if (!stay) peekTimer = setTimeout(hidePeek, ms || PEEK_MS + LINE_MS * lines.length); // W29 comets: a live peek stays longer; W67 places: a place's own may stay
    peekDue = stay ? 0 : performance.now() + (ms || PEEK_MS + LINE_MS * lines.length); // W77 hours
    return true;
  }
  window.starchartHints = state;
  return { peek, hidePeek, peekPlace }; // W67 places: peekPlace
}
