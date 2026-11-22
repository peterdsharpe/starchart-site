// W128 crashes (design/app-ui/SPEC.md §240): the crossings with a strong record of bike crashes, from
// chart/crashes/crossings-v1.json (chart/crashes/build.mjs: Boston's, Cambridge's and Somerville's open crash records). A course
// carries the ones it rides through as `crossings`, and the event engine calls each once: "High-crash crossing ahead."
// (chart/prototype/events.js scanCrossings). The file (under 1 KB) is fetched only when a course is set (need()), never at the
// start; a course set before it is in gets its crossings when it comes (app/course.js).
const KX = 111320 * Math.cos((42.36 * Math.PI) / 180), KY = 110574;
export const ON_M = 25; // a crossing's centre this near the course line is on the course (the engine calls those within 20 m)
let rows = null, want = null;

export const use = (file) => { rows = file.crossings.map(([x, y]) => [x, y]); };
/** The file, fetched once, when first asked for; true once it is in. A failed fetch is tried again at the next ask. */
export function need(get = () => fetch(new URL("../chart/crashes/crossings-v1.json", import.meta.url)).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })) {
  want ??= get().then((file) => { use(file); return true; }, () => { want = null; return false; });
  return want;
}

/** The crossings within ON_M of a course's line ([lon, lat] points), as [lon, lat]. */
export function on(line, list = rows ?? []) {
  return list.filter(([x, y]) => line.some((a, i) => i > 0 && segment([x, y], line[i - 1], a) <= ON_M));
}

function segment(p, a, b) {
  const ax = (a[0] - p[0]) * KX, ay = (a[1] - p[1]) * KY, dx = (b[0] - a[0]) * KX, dy = (b[1] - a[1]) * KY;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx, ay + t * dy);
}
