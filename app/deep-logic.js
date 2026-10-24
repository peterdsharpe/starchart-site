// W70 deep (design/app-ui/SPEC.md §109): the T's tunnels at their depth in 3D, the pure part. The data are
// chart/transit/deep-v1.json (chart/transit/build_deep.py): each tunnel way's points, with each point's depth below the
// street in metres, and the stations' depth table with its sources.
//
// arclight, 2026-10-20: "would it be possible to put the T underground at its actual depth, perhaps with like a think of
// like the curtain drapes, but upside down that are used for like aircraft traces."

/** The line families the data use, from the comets' route ids (the MBTA's). */
export const FAMILY = { Red: "Red", Mattapan: "Red", Orange: "Orange", Blue: "Blue", "Green-B": "Green", "Green-C": "Green", "Green-D": "Green", "Green-E": "Green" };
/** Each line's colour: the MBTA's own (its GTFS routes.txt), as the comets'. */
export const COLOUR = { Red: "#DA291C", Orange: "#ED8B00", Blue: "#003DA5", Green: "#00843D" };
/** The underground shows from FROM° of pitch and is all there by TO° (BRIEF §7.8: nothing pops). */
export const FROM = 24, TO = 34;
/** How much of the underground shows at a pitch, with terrain on or off: 0 when flat or without terrain. */
export const shown = (pitch, terrain) => (terrain ? Math.max(0, Math.min(1, (pitch - FROM) / (TO - FROM))) : 0);
/** A comet within NEAR_M of its line's tunnel rides at the tunnel's depth there. */
export const NEAR_M = 30;
const C = 40075016.686; // the Earth's circumference at the equator, in metres
export const mercX = (lon) => (lon + 180) / 360;
export const mercY = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
/** Metres in one mercator unit at a latitude. */
export const metresPerUnit = (lat) => C * Math.cos((lat * Math.PI) / 180);

/**
 * An index of the tunnels' segments by line, in a grid of mercator cells, for the comets: `depthAt(route, x, y)` is the
 * depth in metres under (x, y) (mercator) on that route's line's nearest tunnel within NEAR_M, else 0.
 */
export function tunnelIndex(tunnels) {
  const CELL = 1 / 2 ** 16, cells = new Map(), segs = [];
  const key = (i, j) => i * 70001 + j;
  for (const t of tunnels) {
    const xs = t.coords.map((c) => mercX(c[0])), ys = t.coords.map((c) => mercY(c[1]));
    for (let i = 0; i + 1 < xs.length; i++) {
      const k = segs.length;
      segs.push({ line: t.line, x0: xs[i], y0: ys[i], x1: xs[i + 1], y1: ys[i + 1], d0: t.depth[i], d1: t.depth[i + 1] });
      const i0 = Math.floor(Math.min(xs[i], xs[i + 1]) / CELL), i1 = Math.floor(Math.max(xs[i], xs[i + 1]) / CELL);
      const j0 = Math.floor(Math.min(ys[i], ys[i + 1]) / CELL), j1 = Math.floor(Math.max(ys[i], ys[i + 1]) / CELL);
      for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) { const c = key(a, b); if (!cells.has(c)) cells.set(c, []); cells.get(c).push(k); }
    }
  }
  function depthAt(route, x, y) {
    const line = FAMILY[route];
    if (!line) return 0;
    const lat = (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90, near = NEAR_M / metresPerUnit(lat);
    const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL);
    let best = near, depth = 0;
    for (let a = ci - 1; a <= ci + 1; a++) for (let b = cj - 1; b <= cj + 1; b++) {
      const list = cells.get(key(a, b));
      if (!list) continue;
      for (const k of list) {
        const s = segs[k];
        if (s.line !== line) continue;
        const dx = s.x1 - s.x0, dy = s.y1 - s.y0, L = dx * dx + dy * dy;
        const u = L ? Math.max(0, Math.min(1, ((x - s.x0) * dx + (y - s.y0) * dy) / L)) : 0;
        const d = Math.hypot(x - s.x0 - dx * u, y - s.y0 - dy * u);
        if (d < best) { best = d; depth = s.d0 + (s.d1 - s.d0) * u; }
      }
    }
    return depth;
  }
  return { depthAt, segments: segs.length };
}
