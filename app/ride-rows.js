// W215 ridesheet (design/app-ui/SPEC.md §411, UX rule 55): the preview's ways as full-width rows on one clock, W214's pick B
// (design/app-ui/ride-choice/, its frame.js and ride.css ported). Every way, on foot and by T, a Bluebike or a bike route, is a
// row: its minutes from leaving (the difference of the two clocks it shows), when to leave where it has a departure to catch, its
// fare, and a bar from leaving to arriving on the clock the rows share, split by leg in the lines' colours. The lit row is the
// choice; its part (live times, then every step) sits in that row's box, under its bar (W228 trip3). app/course.js lays them out and fits them.
//
//   rowTimes(p, when, opt)   -> { kind, leave, arrive, segs }   a walker's row's or By train's two times, from its plan and now
//   rowTitle(o)              -> ["36 min", "· leave in 13 min", { by: "8:49" }]   the row's title, in pieces that wrap whole
//   rowLabel(o)              -> "36 min, leave in 13 min, by 8:49, arrive 9:25, $2.40, bus 87 then Green Line E, Least time outside"
//   rowSteps(segs)           -> [{ w, t } | { chip, ink, t, m }]   the lit row's steps: "Walk 3 min", "87 to Davis 10 min"
//   drawClock(el, ck, pad)   the clock's labels (course-logic.js clockOf()), no gridlines
//   drawRow(b, o, ck, opt)   a row's title, fare, bar and arrival, into its radio button
//   drawSteps(el, o), liveLine(el, leg)   the lit row's part: the first boarding's times, then the steps
//   tidyRows(root)           once laid out: a title piece or a step that starts a line drops its "·" or "›"
//
// An option `o`: { kind: "bike" | "comet" | "transit" | "alone" | "bluebike", leave, arrive, now, when: { kind, at }, name, fare,
// why, segs }; `segs` are walk-card.js legsAt()'s, or a bike route's one leg { kind: "cycle", t0, t1 }. Every string is [SCUL,
// Plain] (app/lingo-mode.js pick()); a lone string is both modes'.
import { pick } from "./lingo-mode.js";
import { clockAt } from "./course-logic.js";
import { dur, durNodes } from "./duration.js"; // "1h 20m" from an hour, its h and m small (W68 fixes)
import { legsAt, leaveBy, busName, midName } from "./walk-card.js"; // third pass: rowTimes(); R2 sandworm: busName, midName
import { nameInk } from "./comets-logic.js"; // W225 stationcard4 (SPEC §473): a line's name on its colour is white
import { walkerSvg } from "./walker.js"; // W228 icons6

export const WORDS = {
  min: (n) => dur(n),
  leaveNow: "leave now",
  leaveIn: (n) => `leave in ${n} min`,
  leaveAt: (t) => `leave at ${t}`,
  by: "by",
  arrive: (t) => `arrive ${t}`,
  now: "now", // the clock's first label
  walk: (m) => [`Space walk ${m} min`, `Walk ${m} min`],
  wait: (m) => `Wait ${m} min`,
  change: (m) => `Change ${m} min`,
  ride: (m) => [`Fly ${m} min`, `Ride ${m} min`], // a bike + T's own riding
  to: (stop) => `to ${stop}`,
  live: "LIVE",
  how: { walk: ["Space walk", "Walk"], bus: (l) => busName(l).map((n) => midName(n)), then: " then " }, // R2 sandworm: "sandworm 87" in SCUL, "Silver Line SL1"
};

/** The clock's minute a time is in, to the second as walkCard()'s clocks: 8:49:40 is 8:49. */
export const minOf = (t) => Math.floor(Math.round(t / 1000) / 60);
/** A row's minutes: the difference of the two clocks it shows (leave 8:49, arrive 9:25: 36 min), never under 1. */
export const rowMin = (o) => Math.max(1, minOf(o.arrive) - minOf(o.leave));
/** Third pass (scratch/lanes/W215d-ridesheet-times.md): a walker's plan `p`'s row, or By train's, at `when` ({ kind, at, now }): its
 *  { kind, leave, arrive, segs }, everything the row says and draws. Asked for now, a row with a train or bus leaves at its Leave by while
 *  that is ahead (the plan's own, asked at its start: no five-minute window), else now; one with no timetable (a walk all the way, a
 *  Bluebike) leaves now and arrives walkCard()'s whole minutes later, its last leg ending there. Leave at and Arrive by ask nothing of
 *  now: a train's row keeps its plan's times; one with no timetable leaves at the plan's start, or (Arrive by) its minutes before the
 *  plan arrives. `paceK`: her pace on a bike + T's rides. A bike route's rows are course.js's (from now, its minutes later). */
export function rowTimes(p, when, { paceK = 1 } = {}) { // W215 ridesheet
  const sec = (t) => Math.round(t / 1000) * 1000, start = p.arrive - p.total_s * 1000, now = when.kind === "now"; // the plan's times to the second, as minOf() takes them: clockAt() drops a time's milliseconds, so 5:29:59.6 would show 5:29
  const kind = p.bike ? "bluebike" : p.legs.some((l) => l.type === "ride") ? "comet" : p.legs.some((l) => l.type === "train") ? "transit" : "alone";
  if (kind === "transit" || kind === "comet") {
    const lb = now ? leaveBy(p, start, { paceK }) : null, leave = !now ? sec(start) : lb != null && lb > when.now ? sec(lb) : when.now, segs = legsAt(p, leave, { paceK });
    return { kind, leave, arrive: sec(kind === "comet" ? segs.at(-1)?.t1 ?? p.arrive : p.arrive), segs }; // By train's arrival at her pace (cometCard()'s)
  }
  const m = Math.max(1, Math.round(p.total_s / 60)) * 60e3, leave = now ? when.now : when.kind === "arrive" ? sec(p.arrive) - m : sec(start), arrive = leave + m; // walkCard()'s minutes
  const segs = legsAt(p).map((g) => ({ ...g, t0: g.t0 + leave - start, t1: g.t1 + leave - start })); // its legs from leaving
  if (segs.length) segs.at(-1).t1 = Math.max(segs.at(-1).t0, arrive); // its last leg ends at its arrival (by 30 s at most)
  return { kind, leave, arrive, segs };
} // W215 ridesheet
const legMin = (g) => Math.max(1, Math.round((g.t1 - g.t0) / 60000));

/** The title's pieces. A walker's row with a train or bus says when to leave: now, in n min "by" the clock, or at a clock past an
 *  hour; a walk all the way and a Bluebike say their minutes alone, as a bike's rows say their minutes and names: she leaves
 *  whenever she likes (the integrator's ruling 4, UX rule 43). Leave at: a row leaving at the time asked for, its minutes alone
 *  (the clock's first label says the time); Arrive by: when to leave. By train says when, as a walker's row with a train does. */
export function rowTitle(o) {
  const parts = [WORDS.min(rowMin(o))], k = o.when?.kind || "now", at = clockAt(new Date(o.leave)), n = minOf(o.leave) - minOf(o.now);
  if (o.kind === "bike" || o.kind === "comet") parts.push(`· ${o.name}`);
  if (o.kind === "bike") return k === "now" ? parts : [...parts, `· ${WORDS.leaveAt(at)}`]; // W219 preview3 (SPEC §424): no clock over a bike's rows, so Leave at's say its time too, as Arrive by's
  if ((o.kind === "alone" || o.kind === "bluebike") && k !== "arrive") return parts; // third pass: with Arrive by, when to leave
  if (k === "leave" && minOf(o.leave) === minOf(o.when.at)) return parts;
  if (k !== "now" || n > 60) return [...parts, `· ${WORDS.leaveAt(at)}`];
  if (n <= 0) return [...parts, `· ${WORDS.leaveNow}`];
  return [...parts, `· ${WORDS.leaveIn(n)}`, { by: at }];
}
/** The row's spoken name: its title, its arrival, its fare, how (its rides), and its reason. */
export function rowLabel(o) {
  const t = rowTitle(o).map((p) => (typeof p === "string" ? p.replace("· ", "") : `${WORDS.by} ${p.by}`));
  const rides = (o.segs || []).filter((g) => g.kind === "train").map((g) => (g.leg.mode === "bus" ? pick(WORDS.how.bus(g.leg)) : g.leg.line)); // R2 sandworm: the leg
  const how = o.kind === "bluebike" ? o.name : o.kind === "alone" ? pick(WORDS.how.walk) : o.kind === "transit" ? rides.join(WORDS.how.then) : "";
  return [...t, WORDS.arrive(clockAt(new Date(o.arrive))), o.fare, how, o.why].filter(Boolean).join(", ");
}
/** The lit row's steps from its legs: a walk, a wait, a change (its walk and its wait, one step), a ride in its line's chip with
 *  where she gets off, a Bluebike's chip, a bike + T's own riding (from 30 s). */
export function rowSteps(segs) {
  const st = [], first = segs.findIndex((g) => g.kind === "train" || g.kind === "bike");
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i], m = legMin(g), next = segs[i + 1]?.kind;
    if (g.kind === "walk" && (g.change || (first >= 0 && i > first)) && (next === "wait" || next === "train")) { const end = next === "wait" ? segs[++i].t1 : g.t1; st.push({ w: true, t: WORDS.change(Math.max(1, Math.round((end - g.t0) / 60000))) }); continue; }
    if (g.kind === "walk") { st.push({ w: true, t: pick(WORDS.walk(m)) }); continue; }
    if (g.kind === "wait") { st.push({ w: true, t: first >= 0 && i > first ? WORDS.change(m) : WORDS.wait(m) }); continue; }
    if (g.kind === "ride") { if (g.t1 - g.t0 >= 30000) st.push({ w: true, t: pick(WORDS.ride(m)) }); continue; }
    if (g.kind === "bike") { st.push({ chip: g.name, bb: true, t: "", m }); continue; }
    if (g.kind === "train") st.push({ chip: g.short, ink: g.ink, pale: pale(g.ink), t: WORDS.to(g.leg.to_name), m });
  }
  return st;
}

/** A line's colour that takes black words: her bus yellow alone (W225 stationcard4, UX rule 86: comets-logic.js nameInk, the station card's
 *  rule; was a luminance over 0.55: the Green Line's by night and the Silver Line's grey too). */
export const pale = (hex) => nameInk(hex) === "black"; // W225 stationcard4
const WALKER = walkerSvg(14); // W228 icons6 (SPEC §478): her walker (app/walker.js), 14 px as in her mock-up (was a 9 × 12 drawing of its own)
/** A Bluebike's bike: her drawing, the dock sign's own (design/glyphs/bluebikes_dock.svg, W215 icons5), in the row's ink. One thing, one
 *  picture (UX rule 41); app/tests/walk.test.mjs holds the two drawings together. */
export const BIKE = `<svg width="18" height="12" viewBox="-152 -289 600 409" aria-hidden="true"><circle cx="-32.13" cy="0" r="97.0" fill="none" stroke="currentColor" stroke-width="44.0"/><circle cx="328.13" cy="0" r="97.0" fill="none" stroke="currentColor" stroke-width="44.0"/><path d="M 66.02 -152.00 L 229.98 -152.00 L 148.00 -10.00 L 66.02 -152.00" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor" stroke-width="40.0"/><path d="M -32.13 0.00 L 66.02 -152.00" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor" stroke-width="40.0"/><path d="M 148.00 -10.00 L 66.02 -152.00 L 5.39 -257.00" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor" stroke-width="40.0"/><path d="M -43.41 -268.00 L 83.62 -257.00 L -43.41 -246.00 Z" fill="currentColor" stroke="currentColor" stroke-width="40.0" stroke-linejoin="round"/><path d="M 328.13 0 L 229.98 -152.00 L 189.68 -257.00 L 273.68 -257.00 A 26.00 26.00 0 0 1 299.68 -231.00 L 299.68 -205.00" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor" stroke-width="40.0"/></svg>`; // W217 glyphs6 (SPEC §415): design/glyphs/ui/bike.svg's drawing, shape for shape
const el = (tag, cls = "", text = "") => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== "") n.textContent = text; return n; };
const fs = () => parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;

/** The clock's labels over the rows: its first ("NOW", or its start's clock) and its ticks, each centred on its time. `pad`: the
 *  rows' inner left edge, px, so a label sits over its time on every bar. */
export function drawClock(n, ck, pad = 0) {
  const f = el("span", "tick first", ck.first === "now" ? WORDS.now : ck.first); f.style.left = `${pad}px`;
  n.replaceChildren(f, ...ck.ticks.map((k) => { const s = el("span", "tick", k.label); s.style.left = `${(pad + k.x).toFixed(1)}px`; return s; }));
  n.setAttribute("aria-hidden", "true"); // each row says its own times
}

/** A row: its title and fare, then its bar on the clock `ck` (or, `solo`, the one row's own length across the track) with the
 *  arrival at its end. `opt`: { width, arrW, track }: the bar's room and the arrival's label's, px; `track(seg, node)` paints a
 *  bike route's leg in the ride-quality scale (course.js comfortCardBar). W219 preview3 (SPEC §424): `span`, ms, a bike's rows with no
 *  clock: each bar from the left, as long as its minutes against the longest's (`span`); `open`, its title alone (its graph is its part). */
export function drawRow(b, o, ck, { width, arrW, solo = false, track = null, span = 0, open = false } = {}) {
  const t1 = el("span", "t1"), title = el("span", "title");
  for (const [i, p] of rowTitle(o).entries()) { if (typeof p === "string" && i) { const s = el("span", "ws"), w = p.split(" "); if (w[0] === "·") w.splice(0, 2, `· ${w[1]}`); w.forEach((t, j) => s.append(...(j ? [" "] : []), el("span", "", t))); title.append(s); } // a piece wider than the row wraps between its words, the · with the first, never at a hyphen ("transport-free")
    else if (typeof p === "string") { const s = el("span", "", rowMin(o) < 60 ? p : ""); if (!s.textContent) s.append(...durNodes(p)); title.append(s); } else { const s = el("span", "by", `${WORDS.by} `); s.append(el("b", "", p.by)); title.append(s); } }
  t1.append(title); if (o.fare) t1.append(el("span", "fare", o.fare));
  if (open) { b.replaceChildren(t1); return void b.setAttribute("aria-label", rowLabel(o)); } // W219 preview3
  const tr = el("span", `track${solo ? " solo" : ""}`), x = solo ? (t) => ((t - o.leave) / Math.max(1, o.arrive - o.leave)) * (width - arrW) : span ? (t) => ((t - o.leave) / span) * (width - arrW) /* W219 preview3 */ : ck.x, F = fs();
  if (!solo && !span && o.leave - ck.t0 > 30000) { const h = el("i", "lg home"), x0 = x(ck.t0), x1 = x(o.leave); h.style.left = `${x0}px`; h.style.width = `${Math.max(0, x1 - x0 - 2)}px`; tr.append(h); } // time before leaving: not travel, an empty dashed box (B)
  o.segs.forEach((g, i) => {
    const s = el("i", `lg ${g.kind === "ride" ? "pedal" : g.kind === "train" ? "veh" : g.kind}`); let a = x(g.t0), z = x(g.t1); // a vehicle "veh" (app/around.css has .train), a bike + T's own riding "pedal" (never .ride, the rows')
    if ((g.kind === "train" || g.kind === "bike") && z - a < 4) { const c = (a + z) / 2; a = c - 2; z = c + 2; } // a ride never under 4 px, centred on its true place
    if (i === 0) s.classList.add("first"); if (i === o.segs.length - 1) s.classList.add("last");
    s.style.left = `${a.toFixed(1)}px`; s.style.width = `${Math.max(1, z - a).toFixed(1)}px`;
    if (g.kind === "walk" && z - a >= 14) s.innerHTML = WALKER;
    else if (g.kind === "train") { s.style.background = g.ink; if (pale(g.ink)) s.classList.add("pale"); const name = [g.name, g.short].map((t) => String(t || "").toUpperCase()).find((t) => t && z - a >= t.length * 7.2 * F + 8); if (name) s.textContent = name; } // the short name where the long one doesn't fit ("E" for GREEN E), else none
    else if (g.kind === "bike") s.innerHTML = z - a >= (8 * 7.2 + 30) * F ? `${BIKE}<span>${g.name.toUpperCase()}</span>` : z - a >= 24 ? BIKE : ""; // the integrator's ruling 3: one block in her Bluebikes cyan, the bike and its name in ink where they fit
    else if (g.kind === "cycle") { s.classList.add("bare"); track?.(g, s); } // a bike route: the ride quality along it
    tr.append(s);
  });
  const end = el("span", "arr", clockAt(new Date(o.arrive))); if (!solo) end.style.left = `${x(o.arrive).toFixed(1)}px`; tr.append(end);
  b.replaceChildren(t1, tr);
  b.setAttribute("aria-label", rowLabel(o));
}

/** The lit row's live line: its first boarding, where, and its times (the first bold), LIVE where they are the MBTA's own. */
export function liveLine(n, l, name) {
  if (l.live) { const p = el("span", "live"); p.append(el("i"), WORDS.live); n.append(p, " "); }
  n.append(el("span", "", `${name} at ${l.from_name}`), " "); // spaces as words, so a screen reader reads them apart too
  const ts = el("span", "times"); [l.dep, ...(l.next || [])].forEach((t, i) => ts.append(...(i ? [" ", el("span", "", clockAt(new Date(t)))] : [el("b", "", clockAt(new Date(t)))]))); n.append(ts);
}
/** The lit row's steps, "Walk 3 min › 87 to Davis 10 min › Change 3 min", each with its minutes; a ride's chip in its line's colour. */
export function drawSteps(n, o) {
  n.replaceChildren();
  rowSteps(o.segs).forEach((s, i) => {
    const st = el("span", `st${s.w ? " w" : ""}`), k = el("span", "k"); // k: the › with what it leads to, never parted
    if (i) k.append(el("span", "sep", "›"), "\u00a0"); // the › with what it leads to, never parted; the minutes never from their step
    if (s.w) { const [a, m] = s.t.split(/ (?=\d+ min$)/); k.append(el("span", "", a)); st.append(k, "\u00a0", el("b", "", m)); }
    else { const c = el("span", `ln${s.pale ? " pale" : ""}${s.bb ? " bb" : ""}`, s.chip.toUpperCase()); if (s.ink) c.style.background = s.ink; k.append(c); st.append(k, "\u00a0"); if (s.t) st.append(`${s.t}\u00a0`); st.append(el("b", "", WORDS.min(s.m))); }
    if (i) n.append(" "); n.append(st);
  });
}
/** Once laid out: a title piece that starts a line drops its "·", and a step that starts one its "›" (her round 5), with a break
 *  that keeps it there. */
export function tidyRows(root) {
  for (const t of root.querySelectorAll(".title")) { let top = null; for (const s of [...t.children]) { const y = s.getBoundingClientRect().top; if (top != null && y > top + 4 && s.textContent.startsWith("· ")) { const f = s.classList.contains("ws") ? s.firstElementChild : s; f.textContent = f.textContent.slice(2); s.before(el("i", "brk")); } top = y; } }
  const mid = (r) => (r ? (r.top + r.bottom) / 2 : null);
  for (const d of root.querySelectorAll(".d3")) { let prev = null; for (const st of d.querySelectorAll(".st")) { const sep = st.querySelector(".sep"), last = prev && mid([...prev.getClientRects()].at(-1)); if (sep && last != null && mid(st.getClientRects()[0]) > last + 8) { sep.remove(); st.before(document.createElement("br")); } prev = st; } }
}
