// Event banners: one compact strip above the console, never over the ship or the road ahead (brief
// §7.6). The prototype's banner is a one-line title and one short line under it (bannerElement); the
// app's is a pill, glyph and title only (bannerPill, design/app-ui/SPEC.md §9). Lodestar says the
// rest. Shared by chart/prototype/app.js and app/main.js, so both name events the same way.
import { distanceWords } from "./course.js";

/** kind -> [colour class, glyph in design/glyphs/] */
export const STYLE = {
  launch: ["system", "fort"], system_enter: ["system", "system"], // W171 icons5: a town's skyline (was shield_system)
  quadrant_enter: ["constellation", null],
  black_hole_ahead: ["black_hole", "black_hole"], pulsar_ahead: ["pulsar", "pulsar"],
  wormhole_enter: ["wormhole", "shield_wormhole"], wormhole_exit: ["wormhole", null], byway_enter: ["byway", "shield_byway"],
  negi_g_well: ["negi", "g_well_negi"], posi_g_well: ["posi", "g_well_posi"], light_year: ["ly", "lore"],
  constellation: ["constellation", "constellation"], touchdown: ["system", "landing_pad"],
  radiation: ["radiation", "radiation"], steps_ahead: ["negi", null], // W54 flight: the steps' glyph is drawn in CSS (app/main.js)
  space_junk: ["negi", "space_junk"], tracks_ahead: ["negi", null], // W67 graph3: the tracks' glyph is drawn in CSS (app/main.js)
  stop_ahead: ["negi", null], // W86 stops: the stop sign's octagon is drawn in CSS (app/main.js)
  bus_stop_ahead: ["negi", "sandworm_nest"], // W93 busstop: the chart's own bus stop mark
  crossing_ahead: ["negi", "crossing"], // W128 crashes: the crossroads' warning diamond
  daystar_set: ["pulsar", "daystar"], // W73 dark: lights on at sunset (app/dusk.js); the daystar is gold, as a star
};
/** W135 plainicons (SPEC §248): the one table of Plain's pictures, SCUL glyph → its ordinary twin (design/glyphs/build.py PLAIN_OF,
 *  the manifest's "plain"), for the map's every symbol layer (app/main.js), the peeks, search rows, the legend and these pills. */
export const PLAIN_ICON = { black_hole: "rotary", pulsar: "traffic_light", st_outpost: "police", meat_repair: "hospital", grenade_depot: "restaurant", // W135 plainicons; W157 icons3: a donut shop eats
  luna: "shop", refueling_station: "grocery", space_station: "home", sandworm_nest: "bus_stop", space_junk: "obstacle", radiation: "rain", // W135 plainicons; W157 icons3: the convenience store's cart (ice cream eats in both modes)
  launchpad: "route_start", waypoint: "pin" }; // W135 plainicons
/** W63 rider: the style's layers Plain hides (app/main.js): no starry background, no "Here be Freds" past the data, no Fort or lore
 *  highlight (SPEC §91), nor the towns' glow (W122 homerow). W166 icons4: here, so the legend draws only what Plain's map does. */
export const PLAIN_HIDES = ["starfield", "edge-stars", "edge-flavor", "fort", "system-nebula"];
/** W135 plainicons: a glyph's picture in Plain (`plain` true) or SCUL. */
export const glyphIn = (g, plain) => (plain && PLAIN_ICON[g]) || g; // W135 plainicons
/** W65 plainlook: a pill's glyph in Plain, where it differs: the road sign for the swirl, and no SCUL landmark on a mile. */
export const PLAIN_GLYPH = { ...PLAIN_ICON, lore: null }; // W124 mapbits: the traffic light, as the map; W135 plainicons: every twin
export const NO_BANNER = new Set(["course_turn", "hi_five", "cup_crush", "on_course"]); // the manoeuvre card and the buttons show these; W128 navcalls: and the course on the chart

const LINGO_KIND = { system_enter: "system", quadrant_enter: "quadrant", black_hole_ahead: "black_hole", pulsar_ahead: "pulsar",
  wormhole_enter: "wormhole", wormhole_exit: "wormhole", constellation: "constellation", negi_g_well: "g_well", posi_g_well: "g_well" };
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * The banner's title and short line for an event, in a lingo mode.
 * ctx: {lingo, inSystem: the system's label (for quadrants), launch: the line under the launch title}.
 */
export function bannerWords({ kind, text, data = {} }, mode, { lingo, inSystem = "", launch } = {}) {
  const title = mode === "meatspace" ? meatLine(kind, text, data) : text;
  const sub = (mode === "cadet" && cadetLine(lingo, kind, data)) || subLine(kind, data, mode, inSystem, launch);
  return { title, sub };
}

/** Cadet mode: the plain name under the term ("Harvard Square", "Traffic light"). */
function cadetLine(lingo, kind, data) {
  const k = lingo && lingo.kinds[LINGO_KIND[kind] || data.kind];
  if (!k || !k.cadet) return "";
  const sub = k.cadet.replace("{name}", data.name || "").replace("{base}", data.base || "").trim();
  return sub && sub !== data.base ? cap(sub) : "";
}

function subLine(kind, data, mode, inSystem, launch) {
  const ahead = data.ahead_m ? distanceWords(data.ahead_m, mode) : "";
  if (mode === "meatspace") {
    return { black_hole_ahead: [data.name, ahead].filter(Boolean).join(" · "), pulsar_ahead: ahead, negi_g_well: "▲ Uphill" }[kind] || "";
  }
  return { launch: launch ?? data.title ?? "", system_enter: "Now entering", quadrant_enter: inSystem,
    constellation: "Approaching", black_hole_ahead: ahead, pulsar_ahead: ahead,
    wormhole_enter: "Entering", wormhole_exit: "Leaving", byway_enter: "Engaging", negi_g_well: data.climb_m ? `▲ ${data.climb_m} m up` : "▲ Uphill",
    posi_g_well: data.climb_m ? `▼ ${Math.abs(data.climb_m)} m down` : "▼ Downhill", touchdown: "Landing pad" }[kind] || "";
}

function meatLine(kind, text, data) {
  const plain = { pulsar_ahead: "Traffic light ahead", black_hole_ahead: "Rotary ahead",
    wormhole_enter: `Bike path${data.name ? ": " + data.name : ""}`, wormhole_exit: "End of bike path",
    system_enter: data.name ? `Entering ${data.name}` : text, quadrant_enter: data.name || text,
    byway_enter: `Bridge${data.name ? ": " + data.name : ""}`, negi_g_well: "Hill ahead", posi_g_well: "Downhill",
    light_year: `${data.light_years} mi`, constellation: data.name || text, launch: "Start", touchdown: "Arrived",
    radiation: data.stage === "winter" ? text : data.min > 0 ? `Rain in ${data.min} min` : "Rain now", bus_stop_ahead: "Bus stop ahead" }; // W60 d: the rain ahead (app/radiation.js); W93 busstop; W102 winter: a winter alert, its words already Plain's
  return plain[kind] || text;
}

/** The banner element for an event, built with the DOM (no markup from event text). */
export function bannerElement(detail, mode, { glyphs, ...ctx }) {
  const [cls, glyph] = STYLE[detail.kind] || ["system", null];
  const { title, sub } = bannerWords(detail, mode, ctx);
  const el = (tag, className) => Object.assign(document.createElement(tag), { className });
  const b = el("div", `banner ${cls}`), body = el("div", "body"), t = el("div", "title"), span = el("span", "");
  if (glyph) t.append(Object.assign(el("img", "glyph"), { alt: "", src: `${glyphs}${glyph}.svg` }));
  span.textContent = title;
  t.append(span);
  body.append(t);
  if (sub) body.append(Object.assign(el("div", "sub"), { textContent: sub }));
  b.append(el("div", "cap"), body);
  return b;
}

/** Do two rects stay `gap` px apart? (A full-width strip overlaps the ship whenever it reaches its height.) */
export const apart = (a, b, gap = 8) =>
  a.top >= b.bottom + gap || a.bottom + gap <= b.top || a.left >= b.right + gap || a.right + gap <= b.left;

/**
 * Put a banner at the top of the strip, then make the strip fit: one banner below 400 px of width,
 * else two; older ones go first while the strip reaches the ship. A lone banner that still reaches it
 * keeps only its title, and if even that reaches the ship it is dropped (prototype-5): the voice
 * still says it. Returns the banner, or null if it was dropped.
 */
export function placeBanner(strip, b, shipEl, { width = innerWidth, gap = 8 } = {}) {
  strip.prepend(b);
  const span = b.querySelector(".title span"); // shrink a long name to fit one line, then ellipsis
  for (let px = 26; span && px > 20 && span.scrollWidth > span.clientWidth; px -= 2) span.style.fontSize = px - 2 + "px";
  const ship = shipEl.getBoundingClientRect();
  const clear = () => apart(strip.getBoundingClientRect(), ship, gap);
  const max = width < 400 ? 1 : 2;
  while (strip.children.length > max || (strip.children.length > 1 && !clear())) strip.lastChild.remove();
  if (!clear()) b.classList.add("short");
  if (!clear()) { b.remove(); return null; }
  return b;
}

/**
 * The app's banner: a pill with the event's glyph and its title, and nothing under it (the voice and
 * the chart say the rest). A pulsar or a black hole ahead adds its distance.
 */
export function bannerPill(detail, mode, { glyphs }) {
  const [cls, scul] = STYLE[detail.kind] || ["system", null];
  const glyph = mode === "meatspace" && scul in PLAIN_GLYPH ? PLAIN_GLYPH[scul] : scul; // W65 plainlook
  const el = (tag, className) => Object.assign(document.createElement(tag), { className });
  const b = el("div", `bpill ${cls}`), title = el("span", "t");
  if (glyph) b.append(Object.assign(el("img", "glyph"), { alt: "", src: `${glyphs}${glyph}.svg` }));
  title.textContent = mode === "meatspace" ? meatLine(detail.kind, detail.text, detail.data || {}) : detail.text;
  b.append(title);
  const d = pillDistance(detail, mode);
  if (d) b.append(Object.assign(el("span", "d"), { textContent: d }));
  return b;
}

/** A pill's distance: "0.1 LY" (or "0.1 mi" in Meatspace) for a pulsar or black hole ahead; nothing when it is here. */
export function pillDistance({ kind, data = {} }, mode) {
  const m = data.ahead_m;
  if (!(m >= 60) || (kind !== "pulsar_ahead" && kind !== "black_hole_ahead" && kind !== "stop_ahead" && kind !== "bus_stop_ahead" && kind !== "crossing_ahead")) return ""; // W86 stops; W93 busstop; W128 crashes
  return `${Math.max(0.1, m / 1609.344).toFixed(1)} ${mode === "meatspace" ? "mi" : "LY"}`;
}

/**
 * The pills on screen, one at a time below 400 px of width, else two, the newest at the bottom; the
 * rest wait their turn. A pill that would reach the ship is dropped (the voice still says it), and so
 * is one that waited too long to still be news. hold: how long each stays, in ms.
 */
export class PillQueue {
  constructor(strip, shipEl, { hold = 3800, stale = 6000, gap = 8, now = () => performance.now() } = {}) {
    Object.assign(this, { strip, shipEl, hold, stale, gap, now, waiting: [], timers: new Set() });
  }

  push(pill) { this.waiting.push({ pill, at: this.now() }); this.pump(); }

  pump() {
    const max = innerWidth < 400 ? 1 : 2;
    while (this.strip.children.length < max && this.waiting.length) {
      const { pill, at } = this.waiting.shift();
      if (this.now() - at > this.stale) continue;
      this.strip.prepend(pill);
      if (!apart(this.strip.getBoundingClientRect(), this.shipEl.getBoundingClientRect(), this.gap)) { pill.remove(); continue; }
      const t = setTimeout(() => { this.timers.delete(t); pill.remove(); this.pump(); }, this.hold);
      this.timers.add(t);
    }
  }

  /** Land: no more pills. */
  clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.waiting = [];
    this.strip.replaceChildren();
  }
}
