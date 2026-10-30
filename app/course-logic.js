// Flying a set course, as pure functions and small classes with no DOM, so Node can test them (SPEC §16).
// app/course.js draws what these decide.
//
//   const cf = new CourseFlight(feature, { gate: new ReplotGate() });  // a course from chart/routing/instructions.js
//   cf.fix({ lonlat, heading, speed_mps }, t)  -> { s, d, off, replot, left, toPad, phase, prompts }
//
// Off course (SPEC §16): 40 m from the line for 5 s, or 25 m and heading away; W56 reroute (§74): a heads-up first, and the
// re-plot after a grace (GRACE_S). The pilot re-plots from the
// ship at most every 10 s (W31 navvoice: 3 s after one that failed), setting out the way the ship is going (SPEC §44). The card shows the landing pad inside 200 m; inside 30 m it is touchdown.
// W74 course (SPEC §128): touchdown inside 30 m only near the course's end (60 m), nearer the pad than the line, or far from
// the ship's place along it.

import { Course, metres } from "../chart/prototype/events.js";
import { TurnPrompter } from "../chart/prototype/course.js";
import { bearing } from "./geo.js";
import { labelFor, spotWhat, baseFor } from "../chart/lingo/lingo.js"; // W21 entry; W38 places: spotWhat; W60 b: baseFor
import { lingo, pick } from "./lingo-mode.js"; // W60 a: distLabel's unit; W60 b: pick
import { STREET_KINDS } from "../chart/lingo/kinds.js"; // W188 kindsone
import { dur } from "./duration.js"; // W68 fixes: "1h 20m"
import { isDay } from "./weather-logic.js"; // W105 night: routeMessage's night

export const LY = 1609.344, FT = 0.3048, MPH = 0.44704;
export const OFF_M = 40, OFF_S = 5, AWAY_M = 25, BACK_M = 20, REPLOT_S = 10, ARRIVE_M = 200, TOUCHDOWN_M = 30;
/** W31 navvoice (the nav audit's #1, #2): a fix heading within `ALONG_DEG` of the course, less than `NOISE_M` from it, is
 *  GPS noise for up to `NOISE_S` in a row, not off course; a fix's accuracy, up to `ACC_MAX_M`, comes off its distance. s
 *  moves on at most the ride since the last fix plus `JUMP_M` (or the accuracy, up to `ROUGH_M`); on a fix rougher than `ROUGH_M`, not back, and
 *  not past the turn ahead until three such fixes in a row put it there. */
export const ALONG_DEG = 28, NOISE_M = 60, NOISE_S = 12, ACC_MAX_M = 30, JUMP_M = 15, ROUGH_M = 20;
/** W56 reroute (SPEC §74): off course is a heads-up first. The re-plot waits `GRACE_S`, or until the ship is `GRACE_M` further
 *  off than it was at the heads-up (but no sooner than `GRACE_MIN_S`, so a GPS jump of a fix or two never fires it); coming
 *  back on within it clears it. A turn the ship passed within `MISSED_M` along is the turn it missed; one within `ABOUT_M`
 *  of the ship may be ridden or walked back to (the router's `about`). */
export const GRACE_S = 10, GRACE_M = 30, GRACE_MIN_S = 3, MISSED_M = 40, ABOUT_M = 60;
export const TAKEN_M = 5; // W73 flight
// W173 navflow (SPEC §300), her note 3: the course's ridden part, which fades: a real fix this near the line moves it on
export const RIDDEN_M = 25, RIDDEN_MPS = 15; // and by no more than twice the fix's speed (15 m/s at most) could ride since the last it took
/** W73 flight (W66 #12, Vela's rule): below `SLOW_MPS` a fix starts no off course, and holds s where the move is within its
 *  accuracy (a rider at a light); within `CALM_M` of the landing pad, as the crow flies, nothing is off course. */
export const SLOW_MPS = 1, CALM_M = 150; // W73 flight
/** W73 flight (W72 ride F3): riding the course backwards, s falling `REVERSE_M` over fixes heading more than `REVERSE_DEG` from
 *  it, is `back` ("Turn around."), until a fix heads along it again. */
export const REVERSE_M = 30, REVERSE_DEG = 120; // W73 flight
/** W76 notes (W73 flight's P2): a fix heading back at the line, more than `TOWARD_DEG` from the way from it to the ship,
 *  starts no 5 s count (a rider back from a café off the line). */
export const TOWARD_DEG = 120; // W76 notes
/** W79 walkgo (SPEC §148): on foot, a walker's 1.4 m/s is near the bike's 1 m/s floor, so below `slow_mps` a fix is a walker
 *  standing; and the turns are called nearer (`calls`: TurnPrompter's nearest prepare, now and chain distances, the bike's 120,
 *  30 and 60 m), about 60 s, 15 s and 30 s ahead at a walk. */
export const FOOT = { slow_mps: 0.5, calls: { prep: 80, now: 20, chain: 40 } }; // W79 walkgo
/** W125 tinygap: the speed a fix needs for the live course (the readout's distance) and the trail to take it: the bike's 1 m/s
 *  (below it, a rider at a light, whose fixes wander), on foot FOOT's 0.5 m/s, so a slow walk's steps count. */
export const trackMps = (foot) => (foot ? FOOT.slow_mps : SLOW_MPS); // W125 tinygap
/** W86 eta (SPEC §172): the ETA's live pace times the ride from the first moving fix, not from Start (a pilot who stood 3 min
 *  before rolling off read 41 min for a 17 min course), and leaves out a stop of over `STILL_S` (a café, a long wait). No fix
 *  for over `GAP_S` (indoors, the page hidden) is a stop too, unless the ship moved along the course that fast meanwhile. */
export const STILL_S = 120, GAP_S = 30; // W86 eta

/** A distance for the turn card: feet below 0.1 LY, rounded to 50 ft ("450 ft"), else LY to one decimal ("0.3 LY"); W60 a: "0.3 mi" in Plain. */
export function distLabel(m, mode = lingo()) {
  if (!(m >= 0)) return "";
  if (m < 0.1 * LY) return `${Math.round(m / FT / 50) * 50} ft`;
  return `${(m / LY).toFixed(1)} ${mode === "meatspace" ? "mi" : "LY"}`; // W60 a: mi
}

/** W54 flight's overview (SPEC §70): the rest of a course from `s`, as points every `step` m and its end, after `here`. */
export function restOf(course, s, here, step = 50) { // W75 chrome: from main.js's overviewFrame, for restShown too
  const pts = [here];
  for (let d = s; d < course.length; d += step) pts.push(course.pointAt(d));
  pts.push(course.pointAt(course.length));
  return pts;
}
/** W75 chrome (SPEC §131): whether every screen point [x, y] is inside `area` ({ left, top, right, bottom }). */
export const allInside = (pts, area) => pts.every(([x, y]) => x >= area.left && x <= area.right && y >= area.top && y <= area.bottom);
/** Earth minutes for m metres at v m/s (11 mph unless the flight says better), at least 1. */
export const minutesFor = (m, v = 11 * MPH) => Math.max(1, Math.round(m / Math.max(1, v) / 60));

/** The clock at the ETA, as the phone shows it, without AM/PM: "10:28". */
export const clockAt = (date) => date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");

/** The turn card's foot: "3.0 LY · 14 min · arrive 10:28" (W68 fixes: "1h 20m" from an hour). W27 card: "arrive" says what the clock is (W28 first-use 12). */
export function etaLine(left_m, v, now = new Date(), mi = false) { // W79 walkgo: mi, a walk's miles in both modes
  const { min, clock } = etaOf(left_m, v, now); // W86 ride: the readout's numbers, the same
  return `${leftLine(left_m, mi)} · ${dur(min)} · arrive ${clock}`; // W60 b: mi; W68 fixes: dur; W86 ride: leftLine
}
/** W86 ride (SPEC §168): the distance left alone, "2.2 LY", the turn card's foot while the readout shows the arrival. */
export const leftLine = (left_m, mi = false) => `${(left_m / LY).toFixed(1)} ${mi ? "mi" : pick("LY", "mi")}`; // W86 ride
/** W86 ride (SPEC §168): a line-gradient by `line-progress`: `steps`, [[from, colour]] in 0..1 from 0 (the flown part, then
 *  the course ahead), with `holes`, [[from, to]], clear: where the course walks, its footprints instead of the line. */
export function lineInk(steps, holes = [], clear = "transparent") { // W86 ride: "transparent", so a gap reads apart from a draw-on's clear (course-flow.js)
  const cuts = [...new Set([0, 1, ...steps.map(([t]) => t), ...holes.flat()].map((t) => Math.min(1, Math.max(0, t))))].sort((a, b) => a - b); // W86 ride
  const at = (t) => (holes.some(([a, b]) => t > a && t < b) ? clear : steps.findLast(([s]) => s <= t)?.[1] ?? steps[0][1]); // W86 ride
  const out = ["interpolate", ["linear"], ["line-progress"]]; // W86 ride
  for (let i = 0; i + 1 < cuts.length; i++) { // W86 ride: each piece its colour, a hair after the last one's end
    const a = cuts[i], b = cuts[i + 1]; if (b - a < 2e-4) continue; // W86 ride
    const c = at((a + b) / 2); out.push(out.length === 3 ? 0 : a + 1e-4, c, b, c); // W86 ride
  } // W86 ride
  return out; // W86 ride
} // W86 ride
/** W111 walkchevrons (SPEC §216): the stretches ridden, between the walked `holes` ([[from, to]] in line-progress, in order): where the chevrons go. */
export const rideRuns = (holes) => [...holes, [1, 1]].reduce((o, [a, b]) => { if (a > o.at) o.runs.push([o.at, a]); o.at = Math.max(o.at, b); return o; }, { at: 0, runs: [] }).runs; // W111 walkchevrons
/** W86 ride: stretches [[from_m, to_m]] cut at `at` metres: those ahead of it, and those behind (flown). */
export const runsAt = (runs, at) => ({ ahead: runs.filter(([, b]) => b > at).map(([a, b]) => [Math.max(a, at), b]), flown: runs.filter(([a]) => a < at).map(([a, b]) => [a, Math.min(b, at)]) }); // W86 ride
// W124 mapbits (SPEC §231), her note: "even when the map is zoomed in, if the walking path is so short that you're displaying only two
// footstep icons or less, then it should still be showing dots". MapLibre lays a line's icons out at the tile's whole zoom, one about
// every spacing: a walked stretch shorter than FEW_FEET + 1 spacings there shows FEW_FEET footprints or fewer, so it shows dots.
export const FEW_FEET = 2;
/** A zoom expression's value at `z`: ["interpolate", ["linear"], ["zoom"], z0, v0, z1, v1, ...], or a number. */
export const zoomValue = (e, z) => { if (!Array.isArray(e)) return e; const s = e.slice(3); if (z <= s[0]) return s[1];
  for (let i = 2; i < s.length; i += 2) if (z <= s[i]) return s[i - 1] + ((s[i + 1] - s[i - 1]) * (z - s[i - 2])) / (s[i] - s[i - 2]); return s.at(-1); };
/** The metres under which a walked stretch shows dots at the map's zoom `zoom` (its whole zoom's layout), at latitude `lat`, its
 *  footprints `spacing` apart (a zoom expression, px); 0 below `feetZ`, where every walk is dots. */
export const fewFeetM = (spacing, zoom, lat, feetZ = 16) => { const z = Math.floor(zoom);
  return z < feetZ ? 0 : ((FEW_FEET + 1) * zoomValue(spacing, z) * 40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** z); };
/** W86 ride (SPEC §168): the readout on a course: the arrival clock, "6:07", and the time left under it, "12 min left"
 *  ("1h 20m left"), from the metres left at `v` m/s, as the turn card's foot has them. The same words in both modes. */
export function etaOf(left_m, v, now = new Date()) { // W86 ride
  const min = minutesFor(left_m, v); // W86 ride
  return { min, clock: clockAt(new Date(now.getTime() + min * 60000)), left: ETA_WORDS.left(dur(min)) }; // W86 ride
} // W86 ride
export const ETA_WORDS = { left: (d) => pick(`${d} left`, `${d} left`) }; // W86 ride: [SCUL, Plain], the same

/** W25 course: a bearing as a word of the compass's eight: "north", "northeast" … */
export const compassWord = (deg) => ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
/** The smaller angle between two headings, in degrees. */
export const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Off course or on it, from each fix's distance to the line: off after `OFF_S` s beyond `OFF_M`, or at once
 * beyond `AWAY_M` while heading away from the line's direction; back on within `BACK_M`.
 */
export class OffCourse {
  constructor() { this.off = false; this.since = null; }
  update(d, away, t, slow = false, toward = false) { // W73 flight: slow; W76 notes: toward
    if (this.off) { if (d <= BACK_M) { this.off = false; this.since = null; } return this.off; }
    if (d > OFF_M && !slow && !toward) this.since ??= t; else this.since = null; // W73 flight: the 5 s count only while moving; W76 notes: and not heading back
    if (!slow && ((this.since !== null && t - this.since >= OFF_S * 1000) || (d > AWAY_M && away))) this.off = true; // W73 flight: !slow
    return this.off;
  }
}

/** At most one re-plot every `REPLOT_S` seconds, across the courses one after another. W31 navvoice: one that failed is
 *  tried again `RETRY_S` after it failed. */
export const RETRY_S = 3;
export class ReplotGate {
  constructor(every = REPLOT_S * 1000) { this.every = every; this.last = -Infinity; }
  due(t) { return t - this.last >= this.every; }
  take(t) { if (!this.due(t)) return false; this.last = t; return true; }
  retry(t) { this.last = Math.min(this.last, t + RETRY_S * 1000 - this.every); }
}

/**
 * W21 flight: one spell off the course, across its re-plots. "Off course." is said once a spell, and "New course." once
 * (`pill`); the spell ends once the pilot has ridden `ON_M` along a course, the new one or the old, without being off it.
 * Before, each re-plot from the ship began a new spell: "Off course." and a "Hard about" every 10 s while the pilot rode on
 * (the W21 audit counted 45 in 7 minutes). W31 navvoice: the turns are quiet only while off. A re-plot now sets out the
 * way the ship is going, so the new course's first turn is said at once, after "New course.".
 */
export const ON_M = 30;
export class OffSpell {
  constructor() { this.on = false; this.pilled = false; this.cf = null; this.from = 0; }
  /** At each fix on course `cf`, with its answer `r`: { say: say "Off course." now, quiet: keep its turns quiet }. */
  update(cf, r) {
    if (r.off) { const say = !this.on; this.on = true; this.cf = null; return { say, quiet: true }; }
    if (!this.on) return { say: false, quiet: false };
    if (this.cf !== cf) { this.cf = cf; this.from = r.s; }
    if (r.s - this.from < ON_M) return { say: false, quiet: false };
    this.on = this.pilled = false;
    return { say: false, quiet: false };
  }
  /** Whether this spell's re-plot says "New course.": the first one only. */
  pill() { const first = !this.pilled; this.pilled = true; return first; }
}

/** The streets and paths (W188 kindsone: chart/kinds.json's, as search.js's STREET_KINDS; space_walk joins, so a footpath's results
 *  light none, as a street's). */
export const ROAD_KINDS = STREET_KINDS;
/** W104 oss2 (OSS review #28): a search's results to light on the chart: two or more, all places of one kind ("cafe",
 *  "coolant", a chain's name), none a street, an address or a town; else null. */
export function kindResults(res) { // W104 oss2
  const k = res?.[0]?.kind; // W104 oss2
  if (!res || res.length < 2 || ROAD_KINDS.includes(k) || ["address", "system", "quadrant", "waypoint"].includes(k)) return null; // W104 oss2
  return res.every((r) => r.kind === k && Array.isArray(r.lonlat)) ? res : null; // W104 oss2
} // W104 oss2
// W112 kindsearch (her note 5, SPEC §226): a kind of place completes as she types ("post": Post office, "wat": Water)
const NOT_KINDS = new Set([...ROAD_KINDS, "address", "system", "quadrant", "waypoint", "spot", "fort", "lore", "space_station"]); // W112 kindsearch: no kind of place to light, or only one
const kindWords = (s) => (s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter(Boolean); // W112 kindsearch: as the index's words()
/** W112 kindsearch: a kind's (or a spot class's, `what`) name in the Words mode, and what it is where the name doesn't say:
 *  SCUL's "Coolant" and Plain's "Water" (drinking water), Plain's "Café" for a Fuel Depot; a class's plain word ("Post office") in both. */
export function kindName(pack, c, mode = lingo()) { // W112 kindsearch
  if (c.what) return { name: c.what, gloss: "" }; // W112 kindsearch
  const k = pack.kinds[c.kind], bare = (t) => (t || "").replace(/\{[a-z_]+\}/g, "").replace(/\s+/g, " ").trim(); // W112 kindsearch: "Luna {name}" is Luna
  if (!k) return null; // W112 kindsearch
  const what = (k.cadet && !k.cadet.includes("{") ? k.cadet : plainWhat(pack, c.kind).replace(/^an? /, "")), cap = what && what[0].toUpperCase() + what.slice(1); // W112 kindsearch: "drinking water", else the Codex's "library"
  const name = (mode === "meatspace" ? bare(k.plain) || k.plain_unnamed : bare(k.label)) || cap; // W112 kindsearch: Plain's "{name}" kinds by what they are ("Bike shop", "Library")
  return name ? { name, gloss: what && !` ${kindWords(name).join(" ")} `.includes(` ${kindWords(what).join(" ")} `) ? what : "" } : null; // W112 kindsearch; fix pass: nor when the name holds it ("Bluebikes station")
} // W112 kindsearch
/** W173 uismall (SPEC §302, her note 13: "it should display … what word it's auto completing to"): what "Show … on the map" lights,
 *  for the lit places `rs` (kindResults) the words `q` found: the one name they all share ("Starbucks"); else the one word of every
 *  name that the one word typed completes ("piz": "Pizza"); else their kind's name in the mode, made plural ("Cafés"). */
export function foundName(pack, rs, q, mode = lingo()) { // W173 uismall
  const names = rs.map((r) => (r.name || "").trim()), key = (t) => kindWords(t).join(" "); // W173 uismall
  if (names[0] && names.every((n) => key(n) === key(names[0]))) return names[0]; // W173 uismall: a chain
  const typed = kindWords(q), last = typed.length === 1 ? typed[0] : "", done = (n) => n.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, "")).find((w) => w && key(w).startsWith(last)); // W173 uismall; fix pass: one word typed ("boston public" is the kind, never "Public"), and "Dunkin'" keeps its apostrophe
  const words = names.map(done); // W173 uismall
  if (last && words.every((w) => w && key(w) === key(words[0]))) return words[0]; // W173 uismall
  const k = kindName(pack, { kind: rs[0]?.kind }, mode)?.name; // W173 uismall
  if (!k || /,| or /.test(k)) return ""; // W173 uismall; review2 P2: a kind named as a list ("pond, lake or the seas") says plain "Show on the map"
  const [, head, of = ""] = k.match(/^(.*?)( of .*)?$/); // W173 uismall fix pass: the plural on the head noun, "Temples of Knowledge"
  const many = MASS.test(k) ? k : head.replace(/(?<=[^aeiou])y$/i, "ie").replace(/(s|x|ch|sh)$/i, "$1e") + "s" + of; // W173 uismall: Library, Libraries; Fuel Depot, Fuel Depots; Water stays
  return mode === "meatspace" && /^[A-Z][a-z]/.test(many) && !/^Bluebikes\b/.test(many) ? many[0].toLowerCase() + many.slice(1) : many; // W173 uismall: Plain's "cafés"; SCUL's names keep their capitals
} // W173 uismall
const MASS = /^(water|air|coolant|plasma|police|st outpost|first aid|hamburger helper|(bike )?parking|construction|gravel|space dust|deep space|woods|ice cream|shore leave)$/i; // W173 uismall: no plural
/** W112 kindsearch: the index's kinds (`choices`, its { kind, what?, n, words? }) that the words `q` start: a word of the mode's
 *  name, of what it is, of the other mode's name or of the index's words for it starts with the last word typed, the words before it whole. Best first: from a
 *  first word, then a later one; then the kind with more places ("wat": Coolant's 125 before 3 watch shops). Two places or more; at most `max`. */
export function kindMatches(pack, choices, q, mode = lingo(), max = 3) { // W112 kindsearch
  const qw = kindWords(q); // W112 kindsearch
  if (qw.join("").length < 3) return []; // W112 kindsearch: three letters, as the index's kind words
  const at = (t) => { const w = kindWords(t); for (let i = 0; i + qw.length <= w.length; i++) if (qw.every((x, j) => (j < qw.length - 1 ? w[i + j] === x : w[i + j].startsWith(x)))) return i; return -1; }; // W112 kindsearch
  const out = [], seen = new Set(); // W112 kindsearch
  for (const c of choices || []) { // W112 kindsearch
    const nm = c.n >= 2 && (c.what || !NOT_KINDS.has(c.kind)) ? kindName(pack, c, mode) : null; // W112 kindsearch
    if (!nm) continue; // W112 kindsearch
    const is = [nm.name, nm.gloss, c.what ? "" : kindName(pack, c, mode === "meatspace" ? "scul" : "meatspace")?.name, c.words].map(at).filter((i) => i >= 0); // W112 kindsearch: its name, what it is, the other mode's name, the index's own words for it ("coffee")
    const rank = !is.length ? -1 : is.includes(0) ? 0 : 1; // W112 kindsearch: from a first word, then a later one
    if (rank >= 0) out.push({ ...c, ...nm, rank }); // W112 kindsearch
  } // W112 kindsearch
  const key = (name, gloss = "") => `${name}|${gloss}`.toLowerCase(); // W112 kindsearch fix pass: two rows that read the same are one ("Luna (shop)" and "Luna (ice cream)" are two)
  const one = out.sort((a, b) => !!a.what - !!b.what || a.rank - b.rank || b.n - a.n).filter((c) => !seen.has(key(c.name, c.gloss)) && seen.add(key(c.name, c.gloss)) && (!c.gloss || seen.add(key(c.gloss)))); // W112 kindsearch fix pass: a kind before a spot class of its name or of what it is (Hospital: the hospitals, not 53 hospital buildings)
  return one.sort((a, b) => a.rank - b.rank || b.n - a.n).slice(0, max); // W112 kindsearch
} // W112 kindsearch
/** W112 kindsearch: what "Show on the map" frames: nothing when `few` of the lit places `rs` are in view (`inView(r)`), or all
 *  of them; else the `few` nearest `from` (the rider, or the chart's centre), for the camera to glide out to, with `from`. */
export const FRAME_FEW = 3;
export function frameFew(rs, from, inView, few = FRAME_FEW) { // W112 kindsearch
  if (rs.filter(inView).length >= Math.min(few, rs.length)) return null; // W112 kindsearch
  return rs.map((r) => ({ r, d: metres(from, r.lonlat) })).sort((a, b) => a.d - b.d).slice(0, few).map((x) => x.r); // W112 kindsearch
} // W112 kindsearch
/**
 * A SCUL name in its parts, so the lingo's generic word can be small and dim beside the name that tells
 * places apart (arclight, 2026-10-15): "Starpath Maxwells Green" -> [{ text: "Starpath", generic: true },
 * { text: "Maxwells Green" }]. The parts come from the kind's label in the lingo pack; a kind the pack doesn't
 * know (a pinned waypoint, an address) is tried as each road kind. A name that is only the generic word
 * ("Tardis", "Wormhole") is all name.
 */
export function nameParts(pack, kind, name, mode = lingo()) { // W60 b: mode
  const whole = [{ text: name || "" }];
  if (!name) return whole;
  if (mode === "meatspace") { // W60 b: a plain name leads with its base, its generic word small after it, as the chart's Plain labels (W60 e)
    const b = baseFor(pack, pack.kinds[kind] ? kind : "starpath", name); // W60 b: a pin, by its road
    return b && b !== name && name.startsWith(`${b} `) ? [{ text: b }, { text: name.slice(b.length + 1), generic: true }] : whole; // W60 b: "Kendall" "square"
  }
  const num = kind === "address" ? /^\d+\S*\s+/.exec(name)?.[0] ?? "" : "";
  const rest = name.slice(num.length);
  let best = null;
  for (const k of pack.kinds[kind] ? [kind] : ROAD_KINDS) {
    for (const t of [pack.kinds[k]?.label, pack.kinds[k]?.label_noref]) {
      const m = t && /^(.*?)\{(?:base|name|ref|abbr)\}(.*)$/.exec(t);
      if (!m || !(m[1] + m[2]).trim() || rest.length <= m[1].length + m[2].length) continue;
      if (rest.startsWith(m[1]) && rest.endsWith(m[2]) && (!best || m[1].length + m[2].length > best[0].length + best[1].length)) best = [m[1], m[2]];
    }
  }
  const mid = best && rest.slice(best[0].length, rest.length - best[1].length).trim();
  if (!mid) return whole;
  return [num.trim(), best[0].trim() && { text: best[0].trim(), generic: true }, mid, best[1].trim() && { text: best[1].trim(), generic: true }]
    .filter(Boolean).map((p) => (typeof p === "string" ? { text: p } : p));
}

/** The distinguishing part of a SCUL name: "Maxwells Green" for "Starpath Maxwells Green". */
export const mainName = (pack, kind, name, mode = lingo()) => nameParts(pack, kind, name, mode).filter((p) => !p.generic).map((p) => p.text).join(" "); // W60 b: mode

const same = (a, b) => (a || "").toLowerCase().replace(/[^a-z0-9]/g, "") === (b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** W82: a pin dropped where no street was found to name it (placeName's bare "Pin"): the pack offer says "This spot". */
export const barePin = (p) => !!p && p.kind === "waypoint" && (p.lingo_name === "Waypoint" || !p.name);
/** W60 b: a place's name in the Words mode: its SCUL name, or in Plain its plain one (the address, the OSM name), "Home"
 *  for the Space Station, and the SCUL name where there is no other ("Your position"). */
export const placeName = (p, mode = lingo()) => (mode !== "meatspace" ? p.lingo_name : p.kind === "space_station" ? "Home" : (p.kind === "address" && p.address) || p.name || (p.kind === "waypoint" && p.lingo_name === "Waypoint" ? "Pin" : p.lingo_name)); // W60 b; W67 places: a bare pin is "Pin" in Plain
/** W73 plan: the name a shared place sends: its own (OSM's, an address's), never a word mode's nor a kind's word for an unnamed
 *  one ("Toilet"), and none for a dropped pin, so the receiver names it in their own words. */
export const ownName = (pack, p) => { const n = p.pinned ? "" : (p.kind === "address" && p.address) || p.name || ""; return n && n !== labelFor(pack, p.kind, {}, "meatspace") ? n : ""; }; // W73 plan
/** W60 b: what a kind is, in the Codex's plain words: "a bus stop or station". */
export const plainWhat = (pack, kind) => (pack.kinds[kind]?.codex || "").split(/[.(;]/)[0].trim(); // W60 b
/** W60 b: a name says what it is when its last word is one of `what`'s: "Bus stop" of "a bus stop or station". */
export const says = (name, what) => { const w = (t) => (t || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean), last = w(name).at(-1); return !!last && w(what).includes(last); }; // W60 b
/**
 * What tells a place apart from others of the same name, after its main name: its plain name when that says
 * more ("Maxwell Road", "Artisans Asylum") and its quadrant or system. "Maxwell Road · Winchester".
 */
export function sideLine(pack, r, mode = lingo()) { // W60 b: mode
  const plain = r.address || r.name;
  const town = (t) => { const p = r.place || "", last = p.split(" · ").pop(); return last && (t || "").endsWith(`, ${last}`) ? p.slice(0, -last.length).replace(/ · $/, "") : p; }; // W176 searchux (SPEC §311): a town said once ("6 Clearway Street, Boston" said Boston twice)
  const where = (street, t = street) => [street, town(t)].filter(Boolean).join(r.address && street === r.address && r.kind !== "address" ? ", " : " · "); // W176 searchux: a street and its town, "Boylston Street, Boston", as a spot's row says them
  if (mode === "meatspace") { // W60 b: the title is the plain name (placeName): what it is, unless it says so, and where
    const title = placeName(r, mode), what = says(title, plainWhat(pack, r.kind)) || (ROAD_KINDS.includes(r.kind) && r.kind !== "space_walk") || r.kind === "fort" || (r.kind === "luna" && (r.place || "").includes(" · ")) ? "" : plainWhat(pack, r.kind); // W60 b: not "your Fort"; W181 searchindex2: nor "Shop" before a shop's class ("Supermarket · White St, Cambridge"); W188 kindsone: a footpath says so, as before ("Footpath · Stoneham")
    const noun = what.split(":")[0].replace(/^(an?|your) /, "").replace(/^./, (c) => c.toUpperCase()); // W176 searchux: "Café", "Train or subway station", as a spot's class reads ("Restaurant"), was "a café"
    return [noun, where(same(r.address, title) ? "" : r.address, title)].filter(Boolean).join(" · "); // W60 b; W176 searchux: where
  }
  if (r.approx) return [r.place, plain].filter(Boolean).join(" · "); // W155 addrnear (SPEC §274): "approximate" first, whole on a small phone
  const said = (t) => same(t, mainName(pack, r.kind, r.lingo_name)) || same(t, r.lingo_name); // the SCUL title says it
  const own = r.address && r.kind !== "address" && r.name && !said(r.name) && !same(r.name, plain) ? r.name : ""; // W191 search4 (SPEC §336): a place's own name before its own address, where its SCUL name doesn't say it ("Cambridge Public Library · 449 Broadway, Cambridge" under "Temple of Knowledge")
  return [own, where(said(plain) ? "" : plain)].filter(Boolean).join(" · "); // W176 searchux: where; W191 search4: own
}

/** The three route styles, in the preview's order. W21 routes: Scenic (car-free first) was what Wormholes already does, so
 *  it was merged into it. W32 routing: each card shows the route best on its style's own measure (`foldStyles`). W102
 *  leftovers: no hover note; "Least climb" under Fewest hills only said the name again (his doubled-text rule, W55). */
export const STYLE_CARDS = [ // W33 routing2: `best`, what a folded card says its route is, for a pilot who hasn't seen the styles
  { id: "wormhole", get name() { return pick("Wormholes", "Bike paths"); }, get best() { return pick("most transport-free", "most protected"); } }, // W60 b: pick, read each time, so a switch shows at the next preview; W173 previewsheet: Plain's "protected", as the share (her note 20)
  { id: "flat", get name() { return pick("Fewest negi g-wells", "Fewest hills"); }, best: "flattest" }, // W60 b
  { id: "quickest", name: "Quickest", best: "quickest" },
];
/** A style the preview offers: an old or unknown one ("scenic") is Wormholes. */
export const styleOf = (id) => (STYLE_CARDS.some((st) => st.id === id) ? id : "wormhole");
/** W105 night (SPEC §211): the routing worker's route message for course.js route()'s request `q`: `night` as `q` gives it
 *  (false for a route file, whatever the clock), else after sunset or before sunrise at `now` where it starts. */
export const routeMessage = (q, now = Date.now()) => ({ type: "route", ...q, night: q.night ?? !isDay(now, q.from) }); // W105 night

/** W21 entry: a tapped chart icon as a place for the place sheet: its SCUL name, its plain name, and what it is in plain
 *  words from the lingo's codex ("a shop", "a Bluebikes station"), unless the plain name says it already. */
export function iconPlace(pack, p, lonlat) {
  if (p.group) return { lingo_name: p.name, name: p.name, place: spotWhat(p.class, p.group), kind: "spot", lonlat }; // W38 places: a spot
  if (p.kind === "klingon_dock") p = { ...p, name: p.name?.split(" - ")[0], base: p.base?.split(" - ")[0] }; // as the search names a dock (chart/search/search.js)
  const bare = (t) => (t || "").toLowerCase().replace(/^(a|an|the)\s+/, "");
  const plain = labelFor(pack, p.kind, p, "meatspace"), what = plainWhat(pack, p.kind); // W152 app J3: cut at a semicolon too, as plainWhat and the peek cut it
  return { lingo_name: labelFor(pack, p.kind, p), name: plain, place: bare(what) && !says(plain, what) ? what : "", kind: p.kind, lonlat }; // W60 b: says, not only the same words ("Bus stop · a bus stop or station")
}

/** Two plans of one route: the same length and the same points. */
export const sameRoute = (a, b) => a.distance_m === b.distance_m && a.geometry.length === b.geometry.length && a.geometry.every((c, j) => c[0] === b.geometry[j][0] && c[1] === b.geometry[j][1]);
/**
 * W27 card: two routes that are the same choice (arclight, 2026-10-17: "if going left around a 50 foot wide obstacle and going
 * right around it are basically equal, but one has a 1 ft hill and the other is 2 seconds slower, don't present that to me as a
 * decision"): where they part (more than `wide_m` apart) is `apart_m` or less of each, in all; the time differs by at most
 * `time_s` or `time_share` of it, whichever is more; the climb by `climb_m`; and the share of wormhole by `worm_pts` points.
 */
export const NEAR = { apart_m: 100, wide_m: 10, time_s: 10, time_share: 0.02, climb_m: 2, worm_pts: 2, bare_pts: 5 }; // W59 routes: bare_pts
/** W59 routes: a route's stretches with no bike support, [from_m, to_m]: the router's `bare` (with the transports, on a
 *  through road or a wide one, with no lane or track; chart/routing/router.js `bare`), joined across gaps under `gap_m`
 *  (a crossing, a short bit of paint) and kept from `min_m` (a jog across a junction is not a stretch). */
export const BARE = { gap_m: 40, min_m: 50 }; // W59 routes
const bareMemo = new WeakMap(); // W59 routes
export function bareRuns(r) { // W59 routes
  if (!r?.bare) return [];
  if (bareMemo.has(r)) return bareMemo.get(r);
  const out = [];
  for (const [a, b] of r.bare) { const t = out.at(-1); if (t && a - t[1] < BARE.gap_m) t[1] = Math.max(t[1], b); else out.push([a, b]); }
  const keep = out.filter(([a, b]) => b - a >= BARE.min_m);
  bareMemo.set(r, keep);
  return keep;
}
/** W59 routes: the metres and the share (percent) of a route with no bike support. */
export const bareM = (r) => bareRuns(r).reduce((t, [a, b]) => t + b - a, 0); // W59 routes
export const bareShare = (r) => (r.distance_m > 0 ? (100 * bareM(r)) / r.distance_m : 0); // W59 routes
/** W59 routes: a card's bar, the route from start to end, its bare stretches in `--caution` where they are (each 2 % at
 *  least, so a short one still shows): a CSS image for its `--bare`, or "none". */
export function bareBar(r) { // W59 routes
  const runs = bareRuns(r), L = r?.distance_m || 0;
  if (!runs.length || !(L > 0)) return "none";
  const stops = runs.map(([a, b]) => { const x = (100 * a) / L, y = Math.min(100, Math.max((100 * b) / L, x + 2)); return `transparent ${x.toFixed(1)}%, var(--caution) ${x.toFixed(1)}% ${y.toFixed(1)}%, transparent ${y.toFixed(1)}%`; });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
/** W59 routes: route a has clearly less riding without bike support than b: `bare_pts` points of its length and `bare_m`. */
const lessBare = (a, b) => bareShare(a) <= bareShare(b) - EARN.bare_pts && bareM(b) - bareM(a) >= EARN.bare_m; // W59 routes
/** W32 routing: a route's share car-free, in percent: on wormholes and protected lanes (the router's `bike_m`), what
 *  Wormholes rides for. The cards show it for every route. */
export const carFree = (r) => (r.distance_m > 0 ? (100 * ((r.bike_m?.wormhole || 0) + (r.bike_m?.shielded || 0))) / r.distance_m : 0);
export function nearEqual(a, b, t = NEAR) {
  if (sameRoute(a, b)) return true;
  if (!(Math.abs(a.time_s - b.time_s) <= Math.max(t.time_s, t.time_share * Math.min(a.time_s, b.time_s)))) return false;
  if (!(Math.abs((a.climb_m || 0) - (b.climb_m || 0)) <= t.climb_m) || !(Math.abs(carFree(a) - carFree(b)) <= t.worm_pts)) return false;
  if (!(Math.abs(bareShare(a) - bareShare(b)) <= t.bare_pts)) return false; // W59 routes
  return apart(a.geometry, b.geometry, t.wide_m).off <= t.apart_m && apart(b.geometry, a.geometry, t.wide_m).off <= t.apart_m;
}
/**
 * W32 routing (arclight, 2026-10-17: "Why do you even list the 'Quickest', if it's the exact same time as the Wormholes
 * option, but the Wormholes option is a) less mileage and b) significantly more bike-friendly?"). Each style's measure, as
 * the cards show it, lower is better (`MEASURE`), with what counts as a tie (`TIE`); the margin a route must beat every
 * card shown by to have a card of its own (`EARN`); and a sensible detour: at most `detour_share` more time than the
 * quickest route, or `detour_s` more, whichever is more.
 */
export const MEASURE = { wormhole: (r) => -carFree(r), flat: (r) => r.climb_m || 0, quickest: (r) => r.time_s };
const TIE = { wormhole: 1, flat: 0.5, quickest: 0.5 };
export const EARN = { worm_pts: 10, climb_m: 3, climb_share: 0.15, time_s: 60, time_share: 0.05, detour_share: 0.3, detour_s: 180, bare_pts: 10, bare_m: 150 }; // W59 routes: bare_pts, bare_m
/** Route a is better than b on style s's measure; a tie goes to the quicker. W59 routes: or first to the one with clearly less
 *  riding without bike support. */
const better = (s, a, b) => { const d = MEASURE[s](a) - MEASURE[s](b); return d < -TIE[s] || (Math.abs(d) <= TIE[s] && (lessBare(a, b) || (!lessBare(b, a) && a.time_s < b.time_s))); }; // W59 routes: lessBare
/** Route a beats b on style s's measure by a clear margin. W59 routes: or has clearly less riding without bike support. */
const clearly = (s, a, b) => lessBare(a, b) || (s === "quickest" ? a.time_s <= b.time_s - Math.max(EARN.time_s, EARN.time_share * b.time_s)
  : s === "flat" ? (a.climb_m || 0) <= (b.climb_m || 0) - Math.max(EARN.climb_m, EARN.climb_share * (b.climb_m || 0))
  : carFree(a) >= carFree(b) + EARN.worm_pts);
/**
 * The cards: [{ ids, name, note, keep }], in the cards' order, `ids` the styles a card stands for, `name` the style's own,
 * "Quickest & flattest" or "Best route" (with `note` "Quickest, flattest and most transport-free" under it), and `keep`
 * the style whose route it shows. W33 routing2 (arclight, 2026-10-17): "All three" and "Flat & Quickest" named the styles,
 * which a pilot seeing the preview for the first time hasn't met; a fold now says what its route is. W21 entry: styles that give the
 * same route share a card; W27 card: so do those whose routes are `nearEqual`. W32 routing: each style takes, of all the
 * routes within a sensible detour, the best on its own measure, so Wormholes is never less car-free than another card,
 * Fewest negi g-wells never climbs more, Quickest is never slower. Wormholes has a card; another style has one only if its
 * route beats every card before it clearly (`EARN`), else it joins the card best on its measure.
 */
export function foldStyles(routes) {
  const ids = STYLE_CARDS.map((st) => st.id).filter((id) => routes[id]);
  if (!ids.length) return [];
  const tMin = Math.min(...ids.map((id) => routes[id].time_s));
  const ok = ids.filter((id) => routes[id].time_s <= Math.max(tMin * (1 + EARN.detour_share), tMin + EARN.detour_s));
  const pick = (s) => ok.reduce((k, o) => (k === null || better(s, routes[o], routes[k]) ? o : k), ok.includes(s) ? s : null);
  const groups = [], later = [];
  for (const s of ids) {
    const keep = pick(s), r = routes[keep];
    const g = groups.find((x) => routes[x.keep] === r || nearEqual(routes[x.keep], r));
    if (g) g.ids.push(s);
    else if (groups.length && !groups.every((x) => clearly(s, r, routes[x.keep]))) later.push(s);
    else groups.push({ ids: [s], keep });
  }
  for (const s of later) groups.reduce((k, x) => (better(s, routes[x.keep], routes[k.keep]) ? x : k)).ids.push(s);
  const card = (id) => STYLE_CARDS.find((st) => st.id === id), order = (id) => STYLE_CARDS.indexOf(card(id));
  const best = (ids) => ids.map((id) => card(id).best).reverse(), cap = (t) => t[0].toUpperCase() + t.slice(1); // quickest first
  return groups.map(({ ids, keep }) => (ids.sort((a, b) => order(a) - order(b)), ids.length === STYLE_CARDS.length
    ? { ids, name: "Best route", note: cap(`${best(ids).slice(0, -1).join(", ")} and ${best(ids).at(-1)}`), keep }
    : { ids, name: ids.length > 1 ? cap(best(ids).join(" & ")) : card(ids[0]).name, note: null, keep }));
}

/**
 * W59 routes ("Prefer bikeable"): the style whose card a preview chooses first. The pilot's own style (the one picked last,
 * arclight 2026-10-16), but for Wormholes, the bike-first style and the default: there, a card with clearly less riding
 * without bike support (`lessBare`) is chosen first when it takes at most `time_share` or `time_s` more than the Wormholes
 * card, whichever is more. `routes` by style (the router's), `folds` as foldStyles gives them.
 */
export const FIRST = { time_share: 0.1, time_s: 180 }; // W59 routes
export function firstPick(routes, folds, style) { // W59 routes
  const own = folds.find((f) => f.ids.includes(style));
  if (!own || style !== "wormhole") return style;
  const r0 = routes[own.keep], budget = Math.max(r0.time_s * (1 + FIRST.time_share), r0.time_s + FIRST.time_s);
  let best = own;
  for (const f of folds) if (routes[f.keep].time_s <= budget && lessBare(routes[f.keep], routes[best.keep])) best = f;
  return best === own ? style : best.ids[0];
}

/** A route's minutes, by the router's time model (chart/routing/README.md, "Route time"), at least 1. W59 pace: at the
 *  pilot's pace `k` (1.1 at 110 %, app/settings.js pace()); the route chosen never depends on it. */
export const routeMinutes = (r, k = 1) => Math.max(1, Math.round(r.time_s / k / 60));
/** W102 leaveby (SPEC §198): the arrive-by a preview's picker offers first: the next quarter-hour (on the phone's clock) a ride
 *  of `min` minutes can make, leaving at `now` (ms). */
export const firstArrive = (now, min) => Math.ceil((now + min * 60e3) / 900e3) * 900e3; // W102 leaveby
/** W102 leaveby: when to leave to arrive at `arrive` (ms) after a ride of `min` minutes, as a Date. */
export const leaveAt = (arrive, min) => new Date(arrive - min * 60e3); // W102 leaveby

const plane = (line) => { const kx = 111320 * Math.cos((line[0][1] * Math.PI) / 180); return (p) => [p[0] * kx, -p[1] * 111320]; };
/** Squared distance from point p to segment ab, all [x, y]. */
const seg2 = (p, a, b) => {
  const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
  const u = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0;
  const x = a[0] + u * vx - p[0], y = a[1] + u * vy - p[1];
  return x * x + y * y;
};

/**
 * Two routes that ride the same way but for a stretch shorter than `apart` (as a share of each one's length) more than
 * `m` metres from the other (W21 routes: Brookline Village's routes part for a block or two): one callout says both.
 */
export function nearlySame(a, b, { m = 30, apart: share = 0.1 } = {}) {
  const { off, total } = apart(a, b, m);
  return off <= share * total;
}
/** How much of line `a` is more than `m` metres from line `b` (`off`), of its length (`total`), in metres, every 10 m. */
function apart(a, b, m) {
  const px = plane(a), A = a.map(px), Bp = b.map(px), cell = m;
  const grid = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (let i = 1; i < Bp.length; i++) { // each segment of b in the cells along it
    const [p, q] = [Bp[i - 1], Bp[i]], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / cell));
    for (let k = 0; k <= n; k++) {
      const x = p[0] + ((q[0] - p[0]) * k) / n, y = p[1] + ((q[1] - p[1]) * k) / n, cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const g = `${cx + dx},${cy + dy}`;
        if (!grid.has(g)) grid.set(g, new Set());
        grid.get(g).add(i);
      }
    }
  }
  const far = (P) => { const near = grid.get(key(...P)); if (!near) return true; for (const i of near) if (seg2(P, Bp[i - 1], Bp[i]) <= m * m) return false; return true; };
  let off = 0, total = 0;
  for (let i = 1; i < A.length; i++) { // every 10 m along a
    const [p, q] = [A[i - 1], A[i]], L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(L / 10));
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; if (far([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])) off += L / n; }
    total += L;
  }
  return { off, total };
}

/**
 * Where the preview puts a route's minutes (W21 routes, arclight: "it's hard to tell them apart since your times overlap
 * the routes themselves"): a callout beside the line, not on it, with a short pointer to it. Its point on the line is
 * where the route is farthest from the others (in the line's middle 80 %, from the middle out, so a tie keeps the middle),
 * and the callout, a `box` [w, h] wide and high, sits off to one side of it, as near as it can be without covering any
 * route's line (`lines`, every route, this one too), another callout already `taken` ({ x, y, w, h }), or leaving `view`
 * ([left, top, right, bottom]). Lines are arrays of [lon, lat]; `project` turns one into screen pixels (by default
 * metres east and south of nowhere, for tests). Returns { ll, dx, dy }: the point on the line, and the callout's centre
 * from it in pixels. The callout is pushed onto `taken`.
 */
export function calloutAt(line, others = [], { project = null, taken = [], box = [64, 24], view = null, lines = [line, ...others], clear = 7 } = {}) {
  const px = project || plane(line);
  const pts = line.map(px), cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const segs = []; // every route's segments, with their boxes for a quick miss
  for (const l of lines) {
    const q = l === line ? pts : l.map(px);
    for (let i = 1; i < q.length; i++) {
      const [a, b] = [q[i - 1], q[i]];
      segs.push([a, b, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
    }
  }
  const otherPts = others.map((o) => o.map(px));
  const away = (p) => { // to the nearest other line
    let d2 = Infinity;
    for (const o of otherPts) for (let i = 1; i < o.length; i++) d2 = Math.min(d2, seg2(p, o[i - 1], o[i]));
    return Math.sqrt(d2);
  };
  const [hw, hh] = [box[0] / 2, box[1] / 2];
  /** How badly a callout centred at c is placed: 0 when it covers nothing and stays in view. */
  const fault = (c) => {
    const x0 = c[0] - hw - clear, y0 = c[1] - hh - clear, x1 = c[0] + hw + clear, y1 = c[1] + hh + clear;
    let f = 0;
    if (view) f += (c[0] - hw < view[0]) + (c[1] - hh < view[1]) + (c[0] + hw > view[2]) + (c[1] + hh > view[3]);
    for (const t of taken) if (Math.abs(c[0] - t.x) < hw + t.w / 2 + 4 && Math.abs(c[1] - t.y) < hh + t.h / 2 + 4) f += 2;
    for (const [a, b, sx0, sy0, sx1, sy1] of segs) {
      if (sx1 < x0 || sx0 > x1 || sy1 < y0 || sy0 > y1) continue;
      if (segBox(a, b, x0, y0, x1, y1)) { f += 1; if (f > 8) break; }
    }
    return f;
  };
  let best = null;
  const at = (s) => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    return [i, cum[i] > cum[i - 1] ? (s - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0];
  };
  for (let k = 0; k <= 40; k++) {
    const [i, u] = at(cum.at(-1) * (0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.02));
    const [a, b] = [pts[i - 1], pts[i]], p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
    const d = away(p);
    if (best && best.f === 0 && d < best.d - 1) continue;
    place: for (const r of [6, 14, 24, 36]) for (const turn of [0, 0.5, -0.5, 1]) for (const side of [1, -1]) {
      // off to one side of the line, from square to it to along it; the pointer is `r` px from the line to the callout
      const ux = side * (n[0] * Math.cos(turn) + n[1] * Math.sin(turn)), uy = side * (n[1] * Math.cos(turn) - n[0] * Math.sin(turn));
      const edge = Math.min(Math.abs(ux) > 1e-9 ? hw / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? hh / Math.abs(uy) : Infinity);
      const c = [p[0] + ux * (edge + clear + 4 + r), p[1] + uy * (edge + clear + 4 + r)];
      const f = fault(c), len = clear + 4 + r;
      // in view and covering nothing first, then farther from the other routes, then the shorter pointer
      if (!best || f < best.f || (f === best.f && (d > best.d + 1 || (Math.abs(d - best.d) <= 1 && len < best.len))))
        best = { f, d, len, c, p, ll: [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * u, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * u] };
      if (f === 0) break place;
    }
  }
  taken.push({ x: best.c[0], y: best.c[1], w: box[0], h: box[1] });
  return { ll: best.ll, dx: best.c[0] - best.p[0], dy: best.c[1] - best.p[1], fault: best.f };
}
/** Whether segment ab crosses or lies in the box [x0, y0, x1, y1] (Liang-Barsky). */
function segBox(a, b, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

/** The point of a line nearest screen point p ([x, y], with `project` turning [lon, lat] into it): its distance `d` in
 *  pixels, and `s`, how far along the line it is in metres. */
export function nearestOn(line, p, project) {
  const kx = 111320 * Math.cos((line[0][1] * Math.PI) / 180);
  let best = { d: Infinity, s: 0 }, s = 0, a = project(line[0]);
  for (let i = 1; i < line.length; i++) {
    const b = project(line[i]), m = Math.hypot((line[i][0] - line[i - 1][0]) * kx, (line[i][1] - line[i - 1][1]) * 111320);
    const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
    const u = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0;
    const d = Math.hypot(a[0] + u * vx - p[0], a[1] + u * vy - p[1]);
    if (d < best.d) best = { d, s: s + u * m };
    s += m;
    a = b;
  }
  return best;
}

/** Where a via dragged out of a route at `s` metres along it goes among the route's vias (`via_m`, their places on it). */
export const viaIndex = (via_m = [], s) => via_m.filter((m) => m < s).length;
/** W31 navvoice (the nav audit's #9): which side of the course's end the landing pad's pin is on, "port" or "starboard", by
 *  the last 15 m's bearing; null when the pin is at the end (within 8 m, or 5 m to the side) or ahead or behind it. */
export function padSide(line, pin) {
  const end = line.at(-1);
  let i = line.length - 2;
  while (i > 0 && metres(line[i], end) < 15) i--;
  if (i < 0 || !pin || metres(end, pin) < 8) return null;
  const turn = ((bearing(end, pin) - bearing(line[i], end) + 540) % 360) - 180, side = metres(end, pin) * Math.sin((turn * Math.PI) / 180);
  return Math.abs(side) < 5 || Math.abs(turn) < 25 || Math.abs(turn) > 155 ? null : side > 0 ? "starboard" : "port";
}

/** The vias a re-plot from the ship keeps: those it hasn't reached (within `REACHED_M` of, or past, at `s` along). */
export const REACHED_M = 30;
export const viasAhead = (via = [], via_m = [], s) => via.filter((_, i) => !(via_m[i] - REACHED_M <= s));

/**
 * One course in flight: where the ship is along it, whether it is off it, the turns to say, and the landing pad.
 * `feature` is a course as instructions.js toCourse() makes it. `gate` is shared by the courses of one flight.
 */
export class CourseFlight {
  /** W25 course: `after_m`, a course that leads to From first lands only past From, `after_m` along it (a course back
   *  to where you are passes its own landing pad as it sets out). */
  constructor(feature, { gate = new ReplotGate(), after_m = 0, pace = 1, foot = false } = {}) { // W59 pace; W79 walkgo: foot
    this.feature = feature;
    this.slow = foot ? FOOT.slow_mps : SLOW_MPS; // W79 walkgo
    this.pace = pace; // W59 pace: the pilot's, for the ETA until the live pace takes over
    this.after_m = after_m;
    this.course = new Course(feature);
    this.prompter = new TurnPrompter(feature.properties.instructions, this.course.length, foot ? FOOT.calls : undefined); // W79 walkgo: FOOT.calls
    this.end = feature.geometry.coordinates.at(-1);
    this.offCourse = new OffCourse();
    this.gate = gate;
    this.s = 0;
    this.t = null; // the last fix's time, on the fixes' clock (the demo's runs fast)
    this.clock = { on: false, s: 0, still: 0 }; // W86 eta: the ride's seconds since the first moving fix, and the stop going on
    this.lonlat = null; this.noiseT = null; this.past = 0; // W31 navvoice
    this.offT = this.offD = null; // W56 reroute: when the heads-up came, and how far off the ship was then
    this.headS = -Infinity; // W73 flight: the furthest along the ship has been, on the course and heading along it
    this.backS = null; this.back = false; // W73 flight: where a ride back along the course began, and whether it is one
    this.nearer = 0; // W74 course: the good fixes in a row nearer the landing pad than the line
    this.kept = false; // W74 course: Keep course, this spell off the course
    this.ridden = 0; this.riddenT = null; // W173 navflow: how far along the ride has surely come, and the fix that said so
    this.last = null;
  }

  get length() { return this.course.length; }

  /** The ship's place along the course: the nearest point from a little behind the last one to well ahead,
   *  or, when that is far, to the end (a short cut back onto the course). W73 flight: where the course doubles back on itself
   *  (a spur out and back), the stretch that runs the ship's way. */
  locate(lonlat, heading = null, speed_mps = 0) { // W73 flight: heading, speed_mps
    const c = this.course, s0 = Math.max(0, this.s - 60), s1 = Math.min(c.length, this.s + 400), near = c.distanceTo(lonlat, s0, s1);
    const against = (i) => angleBetween(heading, bearing(c.coords[i], c.coords[i + 1])) > 90; // W73 flight: a segment's own way
    if (heading !== null && speed_mps >= this.slow && near.d <= OFF_M && against(Math.min(c.index(near.s), c.coords.length - 2))) { // W73 flight; W79 walkgo: this.slow
      let best = null; // W73 flight: the nearest stretch in the window that runs within 90° of the heading
      for (let i = c.index(s0); i < c.coords.length - 1 && c.cum[i] < s1; i++) { // W73 flight
        if (against(i)) continue; // W73 flight
        const m = c.distanceTo(lonlat, Math.max(s0, c.cum[i]), Math.min(s1, c.cum[i + 1])); // W73 flight
        if (m.d <= OFF_M && !(best?.d <= m.d)) best = m; // W73 flight
      }
      if (best) return best; // W73 flight
    }
    if (near.d <= OFF_M || this.s + 400 >= c.length) return near;
    const far = c.distanceTo(lonlat, this.s + 400, c.length);
    return far.d < near.d ? far : near;
  }

  fix({ lonlat, heading = null, speed_mps = 0, accuracy_m = null, estimated = false }, t) { // W173 navflow: estimated, W31 navview's guess in a GPS gap
    const dt = this.t === null ? null : (t - this.t) / 1000, prev = this.lonlat, s0 = this.s; // W73 flight: s0
    this.t = t;
    this.lonlat = lonlat;
    const near = this.locate(lonlat, heading, speed_mps), d = near.d, // W73 flight: heading, speed_mps
      acc = Number.isFinite(accuracy_m) ? accuracy_m : 0;
    // W31 navvoice (#2): a rough fix at a corner neither jumps s onto the next leg nor pulls it back. The ride since the last
    // fix is the speed's, or, on a good fix, the way the fixes moved if that is more
    let s = near.s;
    const moved = prev && acc <= ROUGH_M ? metres(prev, lonlat) / dt : 0;
    if (dt > 0) s = Math.min(s, this.s + Math.max(speed_mps, moved) * dt + Math.max(JUMP_M, Math.min(acc, ROUGH_M)));
    if (acc > ROUGH_M) { // nor, on a rough fix, past the turn ahead, until three rough fixes in a row put it past: the card
      // moves on once the ship has turned
      const turn = this.feature.properties.instructions?.find((i) => i.turn !== "arrive" && i.along_m > this.s);
      this.past = turn && s > turn.along_m ? (this.pastTurn === turn ? this.past : 0) + 1 : 0;
      this.pastTurn = turn;
      if (turn && this.past < 3) s = Math.min(s, turn.along_m - 6);
      s = Math.max(s, this.s);
    } else this.past = 0;
    if (speed_mps < this.slow && dt !== null && Math.abs(s - this.s) <= acc) s = this.s; // W73 flight: stopped, the card holds; W79 walkgo: this.slow
    if (d <= OFF_M) this.s = s;
    // W173 navflow (SPEC §300): the ridden part only grows, on a real fix on the line, within what the ride could cover since
    // the last fix it took; a GPS gap, a jump to a street beside the line (downtown's tall buildings) or a ride back hold it
    if (!estimated && d <= RIDDEN_M && this.s > this.ridden && (this.riddenT === null || this.s - this.ridden <= Math.min(RIDDEN_MPS, 2 * Math.max(speed_mps, this.slow)) * ((t - this.riddenT) / 1000) + JUMP_M)) { this.ridden = this.s; this.riddenT = t; }
    else if (!estimated && d <= RIDDEN_M && this.s <= this.ridden) this.riddenT = t; // on the line where it was (stopped, or riding back): the clock runs from here
    const c = this.clock, moving = (speed_mps >= this.slow && !(dt > GAP_S)) || (dt > 0 && (this.s - s0) / dt >= this.slow); // W86 eta: a fix with no speed, or after a gap, moves by s
    c.on ||= moving; // W86 eta
    if (c.on && dt > 0) { if (moving) { c.s += dt + (c.still <= STILL_S ? c.still : 0); c.still = 0; } else c.still += dt; } // W86 eta
    // W31 navvoice (#1): heading along the course near it is a GPS jump, for a while; the accuracy comes off the distance
    const dEff = Math.max(0, d - Math.min(acc, ACC_MAX_M));
    const segB = heading !== null && speed_mps >= this.slow ? bearing(this.course.pointAt(near.s), this.course.pointAt(Math.min(this.course.length, near.s + 15))) : null; // W152 app O17: the course's way at near.s, once a fix; W79 walkgo: this.slow, was 1
    const along = segB !== null && d < NOISE_M && angleBetween(heading, segB) <= ALONG_DEG;
    this.noiseT = along ? this.noiseT ?? t : null;
    const noise = along && t - this.noiseT < NOISE_S * 1000;
    if (along && d <= OFF_M) this.headS = Math.max(this.headS, this.s); // W73 flight: a turn the ship rode on past, heading along its new leg, was taken
    const rev = segB !== null && d <= OFF_M ? angleBetween(heading, segB) : null; // W73 flight; W79 walkgo: this.slow (segB)
    if (rev > REVERSE_DEG) { this.backS ??= s0; if (this.backS - this.s >= REVERSE_M) this.back = true; } // W73 flight: riding back along it
    else if (rev !== null && rev < 180 - REVERSE_DEG) { this.backS = null; this.back = false; } // W73 flight: along it again
    // heading away: the ship's heading points away from the line, within 90° of the way from the line to the ship
    const out = heading !== null && speed_mps >= this.slow && d > 1 ? angleBetween(heading, bearing(this.course.pointAt(near.s), lonlat)) : null; // W76 notes: out; W79 walkgo: this.slow
    const away = !noise && out !== null && out < 90, toward = out > TOWARD_DEG; // W76 notes: toward
    const toPad = metres(lonlat, this.end);
    const past = this.s >= this.after_m - REACHED_M; // W25 course
    const calm = past && toPad <= CALM_M; // W73 flight: none near the pad
    if (calm) this.offCourse = new OffCourse(); // W73 flight
    const off = !calm && this.offCourse.update(noise ? Math.min(dEff, OFF_M) : dEff, dEff > AWAY_M && away, t, speed_mps < this.slow, toward); // W73 flight: not near the pad, nor starting while stopped; W76 notes: nor heading back; W79 walkgo: this.slow
    const left = Math.max(0, this.course.length - this.s);
    const turnAhead = this.feature.properties.instructions?.some((i) => i.turn !== "arrive" && i.along_m > this.s + 5); // W73 flight: a course that loops back near its pad keeps its last turns on the card
    const lost = metres(lonlat, this.course.pointAt(this.s)) > 2 * TOUCHDOWN_M; // W74 course: far from its place along the course (it rode its own way), s can't say how much is left
    this.nearer = (toPad < d || lost) && acc <= ROUGH_M ? this.nearer + 1 : 0; // W74 course: on two good fixes in a row, never one wild one
    const land = toPad <= TOUCHDOWN_M && (left <= 2 * TOUCHDOWN_M || this.nearer >= 2); // W74 course (W72 dd-3): near the course's end, or nearer the pad than the line (one who cut across) or far from its place along it (one who rode his own way); never on an earlier pass beside the pad
    const phase = past && land ? "touchdown" : past && Math.min(left, toPad) <= ARRIVE_M && !off && (!turnAhead || (calm && d > OFF_M)) ? "arrive" : off ? "off" : "on"; // W74 course: land; W73 flight: !turnAhead, or near the pad away from the line (s holds there, so its turn ahead is stale)
    if (off) { this.offT ??= t; this.offD ??= dEff; } else this.offT = this.offD = null; // W56 reroute: the grace
    if (!off) this.kept = false; // W74 course: Keep course holds for one spell off the course
    const since = off ? t - this.offT : 0, due = off && (since >= GRACE_S * 1000 || (since >= GRACE_MIN_S * 1000 && dEff - this.offD >= GRACE_M)); // W56 reroute
    const replot = due && !this.kept && phase !== "touchdown" && this.gate.take(t); // W56 reroute: due, not at once; W74 course: not kept
    const mph = speed_mps / MPH;
    const prompts = off || phase === "touchdown" ? [] : this.prompter.update(this.s, mph, t, this.back); // W128 navcalls: no reminder or steady riding it backwards
    const wait_s = off && !due && !this.kept ? Math.ceil(GRACE_S - since / 1000) : 0; // W56 reroute: the heads-up's seconds left; W74 course: none kept
    return (this.last = { s: this.s, d, off, replot, left, toPad, phase, prompts, grace: off && !due && !this.kept, wait_s, back: this.back && !off, kept: off && this.kept }); // W56 reroute: grace, wait_s; W73 flight: back; W74 course: kept
  }

  /** W74 course (SPEC §128, D7): Keep course, in the heads-up's grace: this spell off the course re-plots nothing, and the
   *  card still shows the way back; back on the line, the next spell's heads-up is as before. Whether it took. */
  keep() { // W74 course
    if (!this.last?.grace) return false; // W74 course
    this.kept = true; // W74 course
    this.last = { ...this.last, grace: false, wait_s: 0, kept: true }; // W74 course: the card follows at once
    return true; // W74 course
  } // W74 course

  /** W56 reroute: the turn the ship missed, off course: the one it passed (within `MISSED_M` of where it is along), with how far
   *  back it is (`back_m`, as the crow flies); null if none. W73 flight: never one it took, riding on `TAKEN_M` past it heading along the new leg. */
  missed(lonlat = this.lonlat) {
    const ins = this.feature.properties.instructions?.filter((i) => i.turn !== "arrive" && i.at && Math.abs(i.along_m - this.s) <= MISSED_M && i.along_m + TAKEN_M > this.headS) // W73 flight: not one taken
      .sort((a, b) => Math.abs(a.along_m - this.s) - Math.abs(b.along_m - this.s))[0];
    return ins && lonlat ? { ins, back_m: metres(lonlat, ins.at) } : null;
  }

  /** The average speed along the course since it was set, once there is some: for the ETA. Until then the
   *  router's time for the course (W19 course) at the pilot's pace (W59 pace), else 11 mph. W86 eta: over the ride's clock. */
  speed() {
    const c = this.clock, secs = c.s + (c.still <= STILL_S ? c.still : 0), planned = this.feature.properties.time_s; // W86 eta
    return secs >= 60 && this.s > 50 ? this.s / secs : planned > 0 ? (this.length / planned) * this.pace : 11 * MPH; // W59 pace
  }
}

/** W124 autoland (SPEC §233): after a course's touchdown, the ride ends by itself on a real fix (never W31 navview's
 *  estimate in a GPS gap) within `LAND_M` of the pad with an accuracy within `ACC_MAX_M`: at once where the course's end is
 *  passed (`LAND_END_M` or less left), else after `LAND_S` stopped (below the course's slow speed) on such fixes no more than
 *  `LAND_GAP_S` apart. A GPS loss, a rough fix, a move or a step away from the pad starts the count again; two good fixes in a
 *  row beyond `ARRIVE_M` of both the pad and the course (she rode on elsewhere) end the wait for good, never one wild one nor
 *  a course running on past its pad after an early touchdown. app/sim.js's rider (40 seeds, with and without multipath, on
 *  a straight course, a hook back beside its pad, a corner and red lights near the end) lands on every run, 1-29 m from the
 *  end, 0-19 s after stopping, never at a red light 40 m out; at 30 m out, once in 40 (TOUCHDOWN_M's 30 m let 24 in 40, and
 *  a multipath fix 51 m out). */
export const LAND_S = 4, LAND_END_M = 8, LAND_GAP_S = 3, LAND_M = 20; // W124 autoland
export class Landing { // W124 autoland
  constructor(cf) { this.cf = cf; this.t = null; this.still = null; this.gone = false; this.far = 0; } // W124 autoland: the course that touched down; gone, ridden away; far, good fixes away in a row
  /** A fix after touchdown, as CourseFlight.fix's (`estimated`: main.js's); whether the ride ends now. */
  fix({ lonlat, heading = null, speed_mps = 0, accuracy_m = null, estimated = false }, t) { // W124 autoland
    if (estimated || this.gone) { this.still = null; return false; } // W124 autoland: no fix, no landing
    const gap = this.t === null || t - this.t > LAND_GAP_S * 1000, r = this.cf.fix({ lonlat, heading, speed_mps, accuracy_m }, t); // W124 autoland
    this.t = t; // W124 autoland
    this.far = !(accuracy_m > ACC_MAX_M) && r.toPad > ARRIVE_M && r.d > ARRIVE_M ? this.far + 1 : 0; // W124 autoland fix pass: away from the pad and the course, on two good fixes in a row, never one wild one
    if (this.far >= 2) { this.gone = true; return false; } // W124 autoland fix pass: ridden away, a later pass never lands
    if (accuracy_m > ACC_MAX_M || !(r.toPad <= LAND_M)) { this.still = null; return false; } // W124 autoland
    if (r.left <= LAND_END_M) return true; // W124 autoland: the end passed
    if (speed_mps >= this.cf.slow) { this.still = null; return false; } // W124 autoland
    if (gap || this.still === null) this.still = t; // W124 autoland
    return t - this.still >= LAND_S * 1000; // W124 autoland: stopped at the pad
  } // W124 autoland
} // W124 autoland

// ---- W67 routefile (SPEC §94): a route file (or a flight's trail) matched to the chart with a few vias -------------------
// Vela Maps' method (SavedRoutes.kt viasAgainst, GPL-3.0; the method, written again here): plot between the line's ends;
// sample the line every `step_m`, and where it runs more than `off_m` from the plotted course for `run_m` or more (not in
// the `ends_m` at each end, where a file starts at a door), put a via in the stretch's middle, and one more for each
// `every_m` of a long stretch, at most `max` (evenly kept); plot again through them, and repeat once. A handful of legs, and
// no detour where the file and the router already agree. Then the stretches of the course still more than `stray_m` from
// the line for `stray_run_m` or more are its strays, marked on the preview.
export const MATCH = { step_m: 25, off_m: 60, run_m: 150, every_m: 2500, max: 8, ends_m: 150, passes: 2, stray_m: 50, stray_run_m: 50, gap_m: 40 }; // W67 routefile
const KY = 111320; // W67 routefile: metres a degree of latitude, as events.js metres()
/** W67 routefile: a line's points every `step` metres, each with its metres along: [{ p, at }]. */
export function densify(line, step = MATCH.step_m) { // W67 routefile
  const out = [{ p: line[0], at: 0 }]; let along = 0; // W67 routefile
  for (let i = 1; i < line.length; i++) { // W67 routefile
    const a = line[i - 1], b = line[i], d = metres(a, b); // W67 routefile
    for (let t = step - (along % step); t < d; t += step) out.push({ p: [a[0] + ((b[0] - a[0]) * t) / d, a[1] + ((b[1] - a[1]) * t) / d], at: along + t }); // W67 routefile
    along += d; // W67 routefile
  } // W67 routefile
  if (line.length > 1) out.push({ p: line.at(-1), at: along }); // W67 routefile
  return out; // W67 routefile
} // W67 routefile
/** W67 routefile: a line's segments in a grid of `cell` metres, for "how far is p from the line, up to r": near(p, r) gives the
 *  metres, or Infinity past r. A 5,000-point file against a 40 km course is a few ms, not a scan of every segment. */
export function lineNear(line, cell = 100) { // W67 routefile
  const kx = KY * Math.cos(((line[0]?.[1] ?? 42) * Math.PI) / 180), xy = line.map((p) => [p[0] * kx, p[1] * KY]), cells = new Map(); // W67 routefile
  const key = (i, j) => i * 1e6 + j; // W67 routefile
  for (let s = 1; s < xy.length; s++) { // W67 routefile: the cells along each segment, every half cell
    const [ax, ay] = xy[s - 1], [bx, by] = xy[s], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (cell / 2))); // W67 routefile
    for (let k = 0; k <= n; k++) { const c = key(Math.floor((ax + ((bx - ax) * k) / n) / cell), Math.floor((ay + ((by - ay) * k) / n) / cell)); const l = cells.get(c); if (!l) cells.set(c, [s]); else if (l.at(-1) !== s) l.push(s); } // W67 routefile
  } // W67 routefile
  const seen = new Int32Array(xy.length); let q = 0; // W67 routefile: the query that last looked at each segment
  return (p, r) => { // W67 routefile
    const px = p[0] * kx, py = p[1] * KY, ci = Math.floor(px / cell), cj = Math.floor(py / cell), R = Math.ceil((r + cell / 4) / cell); q++; // W67 routefile: a segment within r passes a sampled point within r + cell/4
    let best = Infinity; // W67 routefile
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) for (const s of cells.get(key(i, j)) || []) { // W67 routefile
      if (seen[s] === q) continue; seen[s] = q; // W67 routefile
      const [ax, ay] = xy[s - 1], [bx, by] = xy[s], dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1))); // W67 routefile
      best = Math.min(best, Math.hypot(ax + t * dx - px, ay + t * dy - py)); // W67 routefile
    } // W67 routefile
    return best <= r ? best : Infinity; // W67 routefile
  }; // W67 routefile
} // W67 routefile
/** W67 routefile: the runs of samples farther than `far` from `near` (lineNear's), as [first, last] indices into `samples`. */
function farRuns(samples, near, far, skip = 0) { // W67 routefile
  const total = samples.at(-1)?.at ?? 0, runs = []; let a = -1; // W67 routefile
  for (const [i, s] of samples.entries()) { // W67 routefile
    const off = s.at > skip && s.at < total - skip && near(s.p, far) === Infinity; // W67 routefile
    if (off && a < 0) a = i; // W67 routefile
    if (!off && a >= 0) { runs.push([a, i - 1]); a = -1; } // W67 routefile
  } // W67 routefile
  if (a >= 0) runs.push([a, samples.length - 1]); // W67 routefile
  return runs; // W67 routefile
} // W67 routefile
/** W67 routefile: the vias on `line` where it leaves `course` (a plotted geometry; none, or a point, and all of it is off):
 *  [{ lonlat, at }], `at` its metres along the line. Empty: they are the same way. */
export function viasAgainst(line, course, t = MATCH) { // W67 routefile
  if (!(line?.length >= 2)) return []; // W67 routefile
  const samples = densify(line, t.step_m), near = course?.length >= 2 ? lineNear(course) : () => Infinity, vias = []; // W67 routefile
  for (const [a, b] of farRuns(samples, near, t.off_m, t.ends_m)) { // W67 routefile
    const len = samples[b].at - samples[a].at; // W67 routefile
    if (len < t.run_m) continue; // W67 routefile: two lines disagreeing about one junction
    const n = 1 + Math.floor(len / t.every_m); // W67 routefile
    for (let k = 1; k <= n; k++) { const at = samples[a].at + (len * k) / (n + 1); let j = a; while (j < b && samples[j + 1].at <= at) j++; vias.push({ lonlat: samples[j].p, at: samples[j].at }); } // W67 routefile
  } // W67 routefile
  return vias.length <= t.max ? vias : Array.from({ length: t.max }, (_, k) => vias[Math.round((k * (vias.length - 1)) / (t.max - 1))]); // W67 routefile: too many: evenly kept, the first and last too
} // W67 routefile
/** W67 routefile: a course's stretches more than `stray_m` from the line, [from_m, to_m] along the course, joined across a gap
 *  under `gap_m` and kept from `stray_run_m`: where the matched course still leaves the file. */
export function strays(course, line, t = MATCH) { // W67 routefile
  if (!(course?.length >= 2) || !(line?.length >= 2)) return []; // W67 routefile
  const samples = densify(course, 10), out = []; // W67 routefile
  for (const [a, b] of farRuns(samples, lineNear(line), t.stray_m)) { const r = [samples[Math.max(0, a - 1)].at, samples[Math.min(samples.length - 1, b + 1)].at], last = out.at(-1); if (last && r[0] - last[1] < t.gap_m) last[1] = r[1]; else out.push(r); } // W67 routefile
  return out.filter(([a, b]) => b - a >= t.stray_run_m); // W67 routefile
} // W67 routefile
/** W67 routefile: a route file's line matched to the chart. `plot(from, to, via)` is the router's (a route or null). Gives
 *  { from, to, via: [[lon, lat]], route, strays } (route null: no route at all), the vias in their order along the line. */
export async function matchLine(line, plot, t = MATCH) { // W67 routefile
  const from = line[0], to = line.at(-1); // W67 routefile
  let via = [], route = await plot(from, to, []); // W67 routefile
  for (let k = 0; k < t.passes; k++) { // W67 routefile
    const add = viasAgainst(line, route?.geometry, t).filter((v) => via.every((u) => Math.abs(u.at - v.at) >= t.run_m)); // W67 routefile: none on top of one already set
    if (!add.length) break; // W67 routefile
    const next = [...via, ...add].sort((a, b) => a.at - b.at), r = await plot(from, to, next.map((v) => v.lonlat)); // W67 routefile
    if (!r) break; // W67 routefile: the vias the router can't reach are left out, and the last course stays
    via = next; route = r; // W67 routefile
  } // W67 routefile
  return { from, to, via: via.map((v) => v.lonlat), route, strays: route ? strays(route.geometry, line, t) : [] }; // W67 routefile
} // W67 routefile
