// W152 chart (tech debt): what Starchart's binary files and their readers share, with no imports, so the modules the page
// loads (transit.js, merge.js) can read them without loading router.js. router.js re-exports all but TYPES.
//   readSections(buf, "SCRG", "routing graph")  -> { version, h (the JSON header), s (each section, a typed-array view) }

/** The section types of the files (the graph's, build_graph.py; the timetable's, build_timetable.py). */
export const TYPES = { i4: Int32Array, u4: Uint32Array, f4: Float32Array, u2: Uint16Array, i2: Int16Array, u1: Uint8Array };
export const M_PER_DEG = 111320;
export const MPH = 0.44704;
export const N_JUNK = 8; // W67 graph3: a junction's Space Junk flag, which a bike may pass (graph version 3)

/**
 * The time model: a cruising speed in mph by way, a climb penalty, and a wait at each pulsar (traffic signal) and
 * each gate walked through. Bike paths and bike lanes 12, other streets 11, slower ways by class (`slow`), unpaved
 * ground at 75 %; walking the bike (a sidewalk, the wrong way up a one-way) 3, steps 1. Each metre climbed (the
 * reported climb) adds `climb_s`; a right-angle turn `turn_s`, scaled by 1 - cos angle as the search's turn cost.
 * W33 routing2: a pulsar's wait is once per intersection: signals within `pulsar_m` of each other are one, a junction
 * within `inside_m` of one of its signals is in it, and a course waits `signal_s` each time it enters one (Router.zone).
 * W67 graph3: a stop sign the course meets costs `stop_s` (a bike's rolling stop), a give-way `give_s`, and riding a crossing
 * over an unsignalled tertiary or bigger road `cross_s`, each only from the approach it faces (Router.waits).
 */
export const PACE = {
  path: 12, street: 11, slow: { service: 9, living_street: 8, pedestrian: 7, path: 9, footway: 9, track: 9, bridleway: 8 },
  unpaved: 0.75, walk: 3, steps: 1, climb_s: 5, signal_s: 15, pulsar_m: 40, inside_m: 20, gate_s: 10, turn_s: 5,
  stop_s: 6, give_s: 3, cross_s: 3, // W67 graph3
};
export const V_TOP = PACE.path * MPH; // Quickest's cost is seconds at this speed, so a metre never costs less than 1

/** A file's header and sections, as views on `buf` (an ArrayBuffer): 4 bytes of `magic`, a u4 version, a u4 header length,
 *  the JSON header, then the sections at their offsets. Throws "not a Starchart <what>" for another file. */
export function readSections(buf, magic, what) {
  if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== magic) throw new Error(`not a Starchart ${what}`);
  const dv = new DataView(buf), hlen = dv.getUint32(8, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hlen)));
  const s = {};
  for (const [k, { offset, type, length }] of Object.entries(h.sections)) s[k] = new TYPES[type](buf, 12 + hlen + offset, length);
  return { version: dv.getUint32(4, true), h, s };
}
