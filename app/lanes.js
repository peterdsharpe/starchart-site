// W53 lanes: the lane row in the turn card's Then slot (SPEC §68). A turn across 2 or more motor lanes (the router's
// `lanes`, chart/routing/router.js lanesAt) shows its lanes left to right as the road is, one 30 px cell each with its
// turn:lanes arrows drawn here in code (the lanes that turn this way in --course, the others dim, a dotted line for none or
// no data), the ship's chevron in a --phosphor bike-lane cell at the bike's edge, "2 TO CROSS", and a "BIKE BOX" chip. The
// count only: it never says which lane to take, or how.

import { lingo } from "./lingo-mode.js"; // W73 flight: the mode, for the row's name

const NS = "http://www.w3.org/2000/svg";
/** Each turn:lanes value's heading, in degrees from straight on (+ is right); merges and the like go straight on. */
const HEADING = { through: 0, slight_left: -45, left: -90, sharp_left: -135, reverse: -160, slight_right: 45, right: 90, sharp_right: 135 };
export const COUNT = ["None", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];

/** One lane's arrows as SVG path data on a 22 x 28 box: a stem from the bottom, then a branch with a head for each value
 *  ("left;through" is two), or null for a lane with no arrow ("none", or the count alone), which draws a dotted line. */
export function arrowPaths(values) {
  const hs = [...new Set((values || []).map((v) => HEADING[v] ?? (v === "none" ? null : 0)).filter((h) => h !== null))];
  if (!hs.length) return null;
  const jx = 11, jy = hs.includes(0) ? 15 : 12, r = (n) => +n.toFixed(2); // a lane that only turns bends higher, so it fills its cell
  let stroke = `M${jx} 27V${jy}`, fill = "";
  for (const h of hs) {
    const a = (h * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a), len = Math.abs(h) >= 90 ? 9.5 : 12;
    const bx = jx + dx * (len - 5), by = jy + dy * (len - 5), tx = jx + dx * len, ty = jy + dy * len;
    stroke += ` M${jx} ${jy}L${r(bx)} ${r(by)}`;
    fill += `M${r(tx)} ${r(ty)}L${r(bx - dy * 4.5)} ${r(by + dx * 4.5)}L${r(bx + dy * 4.5)} ${r(by - dx * 4.5)}Z`;
  }
  return { stroke, fill };
}

/** W73 flight: the lanes turning, in the row's name, [SCUL, Plain]. */
export const WORDS = { port: ["at port turning to port", "on the left turning left"], starboard: ["at starboard turning to starboard", "on the right turning right"] }; // W73 flight
/** The row's accessible name: "Lanes: 3, the 2 at port turning to port. Two lanes to cross. Bike box."; W73 flight: in Plain,
 *  "the two on the left turning left". */
export function laneLabel(l, mode = lingo()) { // W73 flight: mode
  const turning = l.use ? l.use.filter(Boolean).length : 0, side = WORDS[l.side === "starboard" ? "port" : "starboard"][mode === "meatspace" ? 1 : 0]; // W73 flight: WORDS
  const which = turning ? `, ${turning === 1 ? "the one" : `the ${COUNT[turning]?.toLowerCase() ?? turning}`} ${side}` : ""; // W73 flight: side, WORDS' words
  return `Lanes: ${l.n}${which}. ${COUNT[l.cross] ?? l.cross} lane${l.cross === 1 ? "" : "s"} to cross.${l.box ? " Bike box." : ""}`;
}

const svg = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

/** Fill `box` (the row's lanes part) with the cells of lanes object `l`. */
export function drawLanes(box, l) {
  const cells = [];
  for (let i = 0; i < l.n; i++) {
    const cell = document.createElement("span"), p = arrowPaths(l.turn?.[i]);
    cell.className = `lane${l.use?.[i] ? " use" : ""}`;
    const s = svg("svg", { viewBox: "0 0 22 28", "aria-hidden": "true" });
    if (p) s.append(svg("path", { d: p.stroke, fill: "none", stroke: "currentColor", "stroke-width": "3", "stroke-linecap": "round", "stroke-linejoin": "round" }),
      svg("path", { d: p.fill, fill: "currentColor" }));
    else s.append(svg("path", { d: "M11 25V5", fill: "none", stroke: "currentColor", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-dasharray": "2 5" }));
    cell.append(s);
    cells.push(cell);
  }
  const bike = document.createElement("span");
  bike.className = "bike";
  const s = svg("svg", { viewBox: "0 0 12 16", "aria-hidden": "true" });
  s.append(svg("path", { d: "M6 1L11 15L6 11.5L1 15Z", fill: "currentColor" })); // the ship's chevron
  bike.append(s);
  if (l.side === "port") cells.unshift(bike); else cells.push(bike);
  box.replaceChildren(...cells);
}
