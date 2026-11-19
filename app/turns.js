// W53 turns (SPEC §67): the turn list and the course strip. app/course.js makes the sheet and the turn card and calls these:
//   strip(route, { from, to, ship, course })  the course strip: the route's heights, coloured by way, the steep parts marked;
//                                               a finger along it moves a dot along the route on the chart (the camera stays)
//   list(rows, { dist })                      the rows of a turn list: glyph, the card's words, a distance (W219 preview3: plain rows; the
//                                               preview's list, whose rows lit their turns by a tap or a mouse over them, went)
//   light(row, course) / unlight()             a turn lit on the chart: the white arrow (course.js's), a --course ring, and
//                                               a pointer at the chart's edge when it is out of view; never a camera move
// The rows and the strip's shape are app/turns-logic.js's.

import { stripModel, rangeLabel, splitAt, flownWords, profileShape } from "./turns-logic.js"; // W219 preview3: profileShape
import { distLabel, FT } from "./course-logic.js"; // W173 previewsheet: the cursor's readout
import { pick, plain } from "./lingo-mode.js"; // W60 b; W135 plainicons: plain
import { glyphIn, dayIn } from "../chart/prototype/banners.js"; // W135 plainicons: Plain's twins; W228 transit2: dayIn
import { el } from "./dom.js"; // W152 app-rest J2
import { swipeAway, tapAway } from "./swipe.js"; // W201 gestures; W210 popups3: tapAway
import { own as ownScreen, sync as syncScreen } from "./screen.js"; // W190 screenstate (SPEC §330)

const NS = "http://www.w3.org/2000/svg";
const H = 28, DOT_MS = 2000;

export function mountTurns({ map, maplibregl, at, arrow, sheetTop = () => Infinity }) {
  const svg = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

  // ---- the course strip -------------------------------------------------------------------------
  let dot = null, dotTimer = 0, dotGone = null; // W173 previewsheet: dotGone, the strip's cursor back at rest with the dot
  const dotPtr = el("div", "cstrip-ptr"); dotPtr.hidden = true; dotPtr.setAttribute("aria-hidden", "true"); document.body.append(dotPtr); // W173 previewsheet: toward the dot when it is out of view
  const dotAt = (ll, gone = null) => {
    clearTimeout(dotTimer);
    if (!ll) { dotTimer = setTimeout(() => { dot?.remove(); dot = null; aimAt(null, dotPtr); dotGone?.(); dotGone = null; }, DOT_MS); return; } // it stays 2 s after the finger lifts; W173 previewsheet: its pointer too
    if (gone) dotGone = gone; // W173 previewsheet
    if (!dot) dot = new maplibregl.Marker({ element: el("div", "cstrip-dot") }).setLngLat(ll).addTo(map);
    else dot.setLngLat(ll);
    aimAt(ll, dotPtr); // W173 previewsheet: her note 19: the camera stays still, so a point out of view gets the lit turn's pointer at the chart's edge
  };
  /** The strip of `route` from `from` to `to` metres along; `ship`, the ship's place on it (in flight); `course`, a Course
   *  (chart/prototype/events.js) on the route, for the dot. `h`: its height in px. `dist(m)`: its readout's distance (R2 cardfoot). */
  function strip(route, { from = 0, to = route.distance_m, ship = null, course = null, h = H, dist = distLabel } = {}) { // R2 cardfoot: dist, the ride's unit (a walk's miles)
    const m = stripModel(route, from, to), w = Math.max(1, m.to - m.from);
    const y = (z) => h - 3 - ((z - m.lo) / m.scale) * (h - 9); // 6 px of headroom for the ▲; W111 flatride: to m.scale, so a flat ride lies flat
    const x = (s) => (((s - m.from) / w) * 1000).toFixed(1);
    const box = el("div", "cstrip"), pic = svg("svg", { viewBox: `0 0 1000 ${h}`, preserveAspectRatio: "none", "aria-hidden": "true" });
    box.style.setProperty("--strip-h", `${h}px`);
    const zAt = (s) => { const i = m.pts.findIndex(([q]) => q >= s); if (i <= 0) return m.pts[Math.max(0, i)]?.[1] ?? m.lo; const [a, b] = [m.pts[i - 1], m.pts[i]]; return a[1] + ((b[1] - a[1]) * (s - a[0])) / (b[0] - a[0] || 1); };
    const shape = (s0, s1) => { // the silhouette between s0 and s1, down to the strip's foot
      const line = [[s0, zAt(s0)], ...m.pts.filter(([s]) => s > s0 && s < s1), [s1, zAt(s1)]];
      return `M${x(s0)},${h} ` + line.map(([s, z]) => `L${x(s)},${y(z).toFixed(1)}`).join(" ") + ` L${x(s1)},${h} Z`;
    };
    for (const r of m.runs) pic.append(svg("path", { d: shape(r.s0, r.s1), class: `way ${r.hue}` }));
    for (const [a, b] of m.steep) pic.append(svg("path", { d: shape(a, b), class: "steep" }));
    pic.append(svg("path", { d: m.pts.map(([s, z], i) => `${i ? "L" : "M"}${x(s)},${y(z).toFixed(1)}`).join(" "), class: "top" }));
    const plot = el("div", "plot");
    plot.append(pic);
    for (const [a, b] of m.steep) { // ▲ over each steep part: colour is never alone (BRIEF §7.2)
      const t = el("i", "up", "▲");
      t.style.left = `${(((a + b) / 2 - m.from) / w) * 100}%`;
      plot.append(t);
    }
    for (const [a, b] of m.dust) { // W104 oss2 (OSS review #13): unpaved ground hatched along the foot, so a texture says it, not a colour
      const t = el("i", "dust"); t.style.left = `${((a - m.from) / w) * 100}%`; t.style.width = `${((b - a) / w) * 100}%`; plot.append(t); // W104 oss2
    } // W104 oss2
    if (ship != null) { const s = el("i", "ship"); s.style.left = `${((ship - m.from) / w) * 100}%`; s.style.top = `${y(zAt(ship))}px`; plot.append(s); }
    box.append(plot, el("span", "range", rangeLabel(m)));
    box.dataset.lo = m.lo.toFixed(1); box.dataset.hi = m.hi.toFixed(1); box.dataset.steep = m.steep.length; box.dataset.dust = m.dust.length; // for tests; W104 oss2: dust
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", `Heights along the ${pick("course", "route")}: ${rangeLabel(m)}${m.steep.length ? `, ${m.steep.length} steep ${m.steep.length > 1 ? "climbs" : "climb"}` : ""}${m.dust.length ? pick(", space dust", ", unpaved ground") : ""}`); // W60 b; W104 oss2: dust
    if (course) { // a finger along the strip: a dot along the route on the chart; the camera stays still
      plot.style.touchAction = "none";
      // W173 previewsheet (SPEC §305), her note 19: "a draggable cursor of the elevation chart, showing that I can drag my finger":
      // a line with a knob on the profile, at the start at rest; held, it says the distance and the height there
      const cur = el("i", "cur"), read = el("span", "read"), rest = ship ?? m.from; cur.setAttribute("aria-hidden", "true"); plot.append(cur, read); // W173 previewsheet: read, over the strip at the cursor, so the plot keeps its width under the finger
      const put = (s) => { cur.style.left = `${((s - m.from) / w) * 100}%`; cur.style.setProperty("--knob", `${y(zAt(s)).toFixed(1)}px`); }; // W173 previewsheet
      const say = (s) => { read.textContent = `${dist(Math.abs(s - (ship ?? 0)))} · ${Math.round(zAt(s) / FT)} ft`; /* R2 cardfoot: dist */ const pw = plot.clientWidth, half = read.offsetWidth / 2; read.style.left = `${Math.max(half, Math.min(pw - half, ((s - m.from) / w) * pw)).toFixed(1)}px`; }; // W173 previewsheet: within the plot; in flight, behind the ship too, how far back
      put(rest); // W173 previewsheet
      const along = (e) => { const r = plot.getBoundingClientRect(); return m.from + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * w; };
      const move = (e) => { const s = along(e); box.dataset.s = Math.round(s); put(s); box.classList.add("held"); say(s); dotAt(course.pointAt(s), () => { if (!box.isConnected) return; put(rest); box.classList.remove("held"); }); }; // W173 previewsheet: the cursor, its readout
      plot.onpointerdown = (e) => { e.stopPropagation(); plot.setPointerCapture?.(e.pointerId); move(e); plot.onpointermove = move; };
      plot.onpointerup = plot.onpointercancel = () => { plot.onpointermove = null; dotAt(null); };
    }
    return box;
  }

  /** W219 preview3 (SPEC §424), her row 10: a bike row's graph, `w` px wide on the rows' one height scale `{ lo, scale }`
   *  (turns-logic.js profileShape): its outline and edge, its fill a node for the ride quality (course.js comfortCardBar, `.pfill`), and
   *  the strip's knob on it, resting at the start; held, it says the distance and the height there, and the dot moves along the route
   *  on the chart (the camera stays). */
  function profile(route, { w, lo, scale, course = null }) { // W219 preview3
    const p = profileShape(route, w, { lo, scale }), box = el("div", "cstrip prof"), plot = el("div", "plot"), fill = el("i", "pfill");
    plot.style.width = `${w}px`; plot.style.height = `${p.h}px`; fill.style.clipPath = `path("${p.d}")`;
    const pic = svg("svg", { width: w, height: p.h, viewBox: `0 0 ${w} ${p.h}`, "aria-hidden": "true" }); pic.append(svg("path", { d: p.d, class: "edge" }));
    plot.append(fill, pic); box.append(plot);
    for (const [a, b] of p.dust) { const t = el("i", "dust"); t.style.left = `${p.xAt(a).toFixed(1)}px`; t.style.width = `${Math.max(3, p.xAt(b) - p.xAt(a)).toFixed(1)}px`; plot.append(t); } // W104 oss2's unpaved ground, hatched along the base (a texture says it, not a colour)
    box.setAttribute("role", "img"); box.setAttribute("aria-label", `Heights along the ${pick("course", "route")}${p.dust.length ? pick(", space dust", ", unpaved ground") : ""}`); box.dataset.dust = p.dust.length;
    box.dataset.lo = p.yt.toFixed(1); box.dataset.top = Math.min(...Array.from({ length: 41 }, (_, i) => p.yAt(p.from + ((p.to - p.from) * i) / 40))).toFixed(1); // for tests: the base's top edge, and the outline's highest point, px
    if (!course) return box;
    plot.style.touchAction = "none"; plot.dataset.noswipe = ""; // the knob's drag, never the sheet's
    const cur = el("i", "cur"), read = el("span", "read"); cur.setAttribute("aria-hidden", "true"); plot.append(cur, read);
    const put = (s) => { cur.style.left = `${p.xAt(s).toFixed(1)}px`; cur.style.setProperty("--knob", `${p.yAt(s).toFixed(1)}px`); };
    const say = (s) => { read.textContent = `${distLabel(s)} · ${Math.round(p.zAt(s) / FT)} ft`; const half = read.offsetWidth / 2; read.style.left = `${Math.max(half, Math.min(w - half, p.xAt(s))).toFixed(1)}px`; };
    put(p.from);
    const move = (e) => { const s = p.sAt(e.clientX - plot.getBoundingClientRect().left); box.dataset.s = Math.round(s); put(s); box.classList.add("held"); say(s); dotAt(course.pointAt(s), () => { put(p.from); box.classList.remove("held"); }); }; // 0.1.105 (preview3's re-review): off the page too, as the open row's graph is kept (course.js pg) and comes back as it was left
    plot.onpointerdown = (e) => { e.stopPropagation(); plot.setPointerCapture?.(e.pointerId); move(e); plot.onpointermove = move; };
    plot.onpointerup = plot.onpointercancel = () => { plot.onpointermove = null; dotAt(null); };
    return box;
  } // W219 preview3

  // ---- the rows ---------------------------------------------------------------------------------
  /** The rows. `dist(row)`: its distance's words. */
  function list(rows, { dist }) { // W219 preview3: no onTap or course (the preview's list went)
    const ol = el("ol", "trows");
    for (const r of rows) {
      const li = el("li"), b = el("div", `trow${r.pad ? " pad" : ""}${r.warn ? ` warn ${r.warn}` : ""}`); // W54 flight: warn
      // W54 flight: a warning's own glyph; W135 plainicons: Plain's twin; W217 turnicons: a rotary's own picture (turnPicture), its words; W219 sculgreen: SCUL's twin
      const own = r.src && `design/glyphs/${dayIn(glyphIn(r.src, plain()), document.documentElement.dataset.theme === "light")}.svg`; // W228 transit2: her bus stop sign by day, outlined (a stop on the way's row)
      const g = r.icon ? el("i", `i wi i-${r.icon}`) : Object.assign(el("img"), { alt: r.alt || "", width: 32, height: 32, src: r.glyph?.startsWith("data:") ? r.glyph : at(own || `design/glyphs/${glyphIn(`maneuver/${r.glyph}`, plain())}.svg`) }); // rel-0.1.121: the line under 400 characters
      const words = el("span", "w", r.text);
      if (r.mark) words.append(el("em", "", ` · ${r.mark}`));
      b.append(g, words, el("span", "d", dist(r)));
      b.dataset.at = r.at_m;
      li.append(b);
      ol.append(li);
    }
    return ol;
  }

  // ---- a lit turn -------------------------------------------------------------------------------
  let lit = null;
  const ptr = el("div", "cturn-ptr");
  ptr.hidden = true;
  ptr.setAttribute("aria-hidden", "true");
  document.body.append(ptr);
  /** The pointer at the chart's edge, toward a lit turn out of view (above the sheet, or beside it in landscape). */
  function aim() { aimAt(lit?.ll, ptr); } // W173 previewsheet: aimAt, the strip's dot's too
  function aimAt(ll, ptr) { // W173 previewsheet: was aim's own
    if (!ll) { ptr.hidden = true; return; }
    const c = map.getContainer(), p = map.project(ll), r = c.getBoundingClientRect();
    const top = sheetTop(), side = top < 60, sr = document.querySelector(".csheet")?.getBoundingClientRect();
    const box = { x0: side && sr ? sr.right : 0, y0: 0, x1: r.width, y1: side ? r.height : Math.min(r.height, top - r.top) };
    const inside = p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
    ptr.hidden = inside;
    if (inside) return;
    const m = 22, cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2, dx = p.x - cx, dy = p.y - cy;
    const t = Math.min(Math.abs(dx) > 1e-6 ? ((box.x1 - box.x0) / 2 - m) / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? ((box.y1 - box.y0) / 2 - m) / Math.abs(dy) : Infinity, 1);
    ptr.style.transform = `translate(${(r.left + cx + dx * t).toFixed(1)}px, ${(r.top + cy + dy * t).toFixed(1)}px) rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
  }
  map.on("move", () => { if (lit) aim(); if (dot) aimAt(dot.getLngLat().toArray(), dotPtr); }); // W173 previewsheet: the dot's pointer
  /** Light a row's turn: the arrow (not for the landing pad), the ring, and the pointer when it is out of view. Silent. */
  function light(row, course) {
    unlight();
    const ll = row.ins.at ?? course.pointAt(row.at_m);
    lit = { ll, ring: new maplibregl.Marker({ element: el("div", "cturn-ring") }).setLngLat(ll).addTo(map) };
    arrow(row.pad || row.warn || row.ins.turn === "straight" ? null : row.at_m, course); // W54 flight: row.warn, no arrow // straight on and the pad get no arrow, as in flight (SPEC §43)
    aim();
  }
  function unlight() {
    if (!lit) return;
    lit.ring.remove();
    lit = null;
    arrow(undefined);
    aim();
  }
  return { strip, profile /* W219 preview3 */, list, light, unlight, get lit() { return lit; }, aim, unfold: (o) => unfold({ ...o, strip, list, el }) };
}

export const CLOSE_MS = 15_000; // the unfolded list closes by itself after 15 s with no touch
const LY_M = 1609.344;

/** In flight: the turn card's foot is its own target, with a ⌄; a tap unfolds the card downward into the turns still ahead,
 *  the next light year of the strip at its head with the ship's place on it, and the turns flown folded into one line. It
 *  closes by its ⌃, Back (`watch(close)`), or by itself after 15 s with no touch. `state()`: { rows, s, route, course }, or
 *  null with no course; `room()`: the px it may take, down to the ship; `changed()`: its height changed (the card's room). */
function unfold({ card, foot, state, room, changed, watch, dist, strip, list, el, chips = null, closed = () => {} }) { // W54 course: chips(st), the stops' chips under the head; closed()
  const chev = el("i", "fold"), panel = el("div", "cturns-fly");
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Turns ahead");
  foot.append(chev);
  foot.setAttribute("role", "button");
  foot.tabIndex = 0;
  foot.setAttribute("aria-expanded", "false");
  foot.setAttribute("aria-label", "Turns ahead");
  document.body.append(panel);
  let open = false, timer = 0, shown = "", stripS = -Infinity;
  ownScreen("turns", () => open); // W190 screenstate: was body.cturns-open
  const poke = () => { clearTimeout(timer); if (open) timer = setTimeout(() => close(), CLOSE_MS); };
  function show(on) {
    open = on;
    panel.hidden = !on;
    foot.setAttribute("aria-expanded", String(on));
    syncScreen(); // W190 screenstate
    shown = ""; stripS = -Infinity;
    if (on) { tick(); watch(close); } else { watch(null); closed(); } // W54 course: closed()
    poke();
    changed();
  }
  const close = () => { if (open) show(false); };
  swipeAway(panel, { dirs: ["up"], close }); // W201 gestures (SPEC §362): it folds up into the card it came from (the strip keeps its finger)
  tapAway(panel, { close, open: () => open, keep: (t) => card.contains(t) }); // W210 popups3 (SPEC §391): a panel over the chart, as Layers and the weather: a tap on the chart closes it, a drag or a pinch never; its card's taps are the card's
  const toggle = (e) => { e.stopPropagation(); show(!open); }; // not the card's tap, which says the turn again
  foot.addEventListener("click", toggle);
  foot.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); } });
  for (const t of ["pointerdown", "wheel", "scroll"]) panel.addEventListener(t, poke, { passive: true });
  /** Four times a second with the card: the rows ahead, their distances from the ship, and the strip as the ship moves on. */
  function tick() {
    if (!open) return;
    const st = state();
    if (!st || card.hidden) return close();
    panel.style.maxHeight = `${Math.max(120, Math.round(room()))}px`;
    const { flown, ahead } = splitAt(st.rows, st.s);
    const key = `${flown}:${ahead.length}`;
    if (key !== shown) {
      shown = key;
      const rows = list(ahead, { dist: (r) => dist(r.at_m - st.s) });
      const head = el("div", "thead"), past = el("p", "flown", flownWords(flown));
      past.hidden = !flown;
      const stops = chips?.(st); // W54 course: the stops ahead, again at each turn flown
      panel.replaceChildren(head, ...(stops ? [stops] : []), past, rows); // W54 course: stops
      stripS = -Infinity;
    }
    for (const b of panel.querySelectorAll(".trow:not(.stop)")) { const t = dist(+b.dataset.at - st.s); const d = b.querySelector(".d"); if (d.textContent !== t) d.textContent = t; } // W54 course: not a stop's row, which says its own
    if (st.route?.elev && Math.abs(st.s - stripS) >= 10) { // the next light year, the ship near its start
      stripS = st.s;
      const from = Math.max(0, st.s - 0.1 * LY_M), to = Math.min(st.route.distance_m, from + LY_M);
      panel.querySelector(".thead").replaceChildren(strip(st.route, { from, to, ship: st.s, course: st.course, dist })); // R2 cardfoot (SPEC §452): held, the ride's unit, as its rows
    }
    changed();
  }
  return { tick, close, get open() { return open; }, get h() { return panel.hidden ? 0 : panel.offsetHeight; }, panel };
}
