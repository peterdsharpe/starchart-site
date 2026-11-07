// W67 places (design/app-ui/SPEC.md §97): starred places, kept pure so Node can test them. app/course.js draws the star
// on a peek and on the dropped pin, the quick picks and Where to?'s results; app/starred.js draws the marks on the chart.
//
// The list is localStorage "starchart.starred": places as the place sheet has them ({ lingo_name, name, place, kind,
// lonlat }), newest first, with no limit and no groups. A starred place keeps its own name; a starred pin keeps the
// name its pin had (the nearest street, or "Waypoint", which Plain says as "Pin").

export const KEY = "starchart.starred";
/** W133 fivestar (SPEC §247): the favourites star, five-pointed, in a 24 box: Settings' (log.css .i-star, .i-star-on) and
 *  the chart's marks (app/starred.js). */
export const STAR_D = "M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z";
const R = 6371008.8, rad = Math.PI / 180;
const metres = (a, b) => { const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad), y = (b[1] - a[1]) * rad; return Math.hypot(x, y) * R; };
export const SAME_M = 8; // a tile's point moves a little from zoom to zoom: the same place within this

export const WIDE_M = 300; // W73 plan: a path, park or water is starred at the tap: the same one, named alike, within this
/** The same starred place: the same kind within SAME_M metres. W73 plan: or a wide one (a path, park or water, starred
 *  where it was tapped) of the same kind and name within WIDE_M. */
export const samePlace = (a, b) => !!a?.lonlat && !!b?.lonlat && a.kind === b.kind && (metres(a.lonlat, b.lonlat) <= SAME_M
  || (!!(a.wide || b.wide) && a.lingo_name === b.lingo_name && a.name === b.name && metres(a.lonlat, b.lonlat) <= WIDE_M)); // W73 plan

/** The list from storage's text: only places with a point; anything else is dropped. */
export function readStarred(text) {
  let v;
  try { v = JSON.parse(text); } catch { return []; }
  return Array.isArray(v) ? v.filter((p) => p && typeof p.lingo_name === "string" && Array.isArray(p.lonlat) && p.lonlat.length === 2 && p.lonlat.every(Number.isFinite)) : [];
}

/** What a starred place keeps: its name, its words, its kind and its point (5 decimals, about a metre). */
export const keep = (p) => ({ lingo_name: p.lingo_name, name: p.name || "", place: p.place || "", kind: p.kind || "waypoint",
  lonlat: p.lonlat.map((v) => Math.round(v * 1e5) / 1e5), ...(p.address ? { address: p.address } : {}), ...(p.pinned ? { pinned: true } : {}), ...(p.wide ? { wide: true } : {}) }); // pinned: named by its street, so a share sends no name; W73 plan: wide

export const isStarred = (list, p) => list.some((s) => samePlace(s, p));
/** The list with `p` first (starring it again moves nothing). */
export const star = (list, p) => (isStarred(list, p) ? list : [keep(p), ...list]);
/** The list without `p`, and what Undo needs: { list, undo } where undo(list) puts it back where it was. */
export function unstar(list, p) {
  const at = list.findIndex((s) => samePlace(s, p));
  if (at < 0) return { list, undo: (l) => l };
  const gone = list[at];
  return { list: list.filter((_, i) => i !== at), undo: (l) => (isStarred(l, gone) ? l : [...l.slice(0, at), gone, ...l.slice(at)]) };
}

/** "Dunkin' Donuts & Co." -> ["dunkin", "donuts", "and", "co"], as chart/search/search.js reads words. */
const words = (s) => (s ? String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’`]/g, "").replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean) : []);

/** Whether the words typed find a starred place: each the start of a word of its names or its town. */
export function matches(q, p) {
  const want = words(q);
  if (!want.length) return false;
  const have = [p.lingo_name, p.name, p.place, p.address].flatMap(words);
  return want.every((w) => have.some((h) => h.startsWith(w)));
}

/** One place twice: the same starred place, or the same name within 60 m (a search's row for a place starred from its icon). */
const dup = (a, b) => samePlace(a, b) || (!!a?.lonlat && !!b?.lonlat && a.lingo_name === b.lingo_name && metres(a.lonlat, b.lonlat) < 60);

/** Where to?'s rows: the starred places the words find first, then the search's, without the same place twice. */
export function starFirst(results, list, q) {
  const mine = list.filter((p) => matches(q, p));
  return [...mine.map((p) => ({ ...p, starred: true })), ...results.filter((r) => !mine.some((p) => dup(p, r)))];
}

/** The quick picks: the Fort and home (`first`, either may be null), then the starred places, then the recent ones
 *  that aren't starred. */
export function withStarred(first, list, recent) {
  const g = pickGroups(first, list, recent); // W88 favorites
  return [...g.top, ...g.mine, ...g.recent]; // W88 favorites
}
/** W88 favorites: the quick picks in their groups, { top, mine, recent }, for Where to?'s headings: the Fort and home,
 *  the starred places (each `starred: true`), and the recent ones that are neither. */
export function pickGroups(first, list, recent) { // W88 favorites
  const top = first.filter(Boolean), mine = list.filter((p) => !top.some((f) => dup(f, p))).map((p) => ({ ...p, starred: true })); // W88 favorites
  return { top, mine, recent: recent.filter((r) => !top.some((f) => dup(f, r)) && !mine.some((p) => dup(p, r))) }; // W88 favorites
} // W88 favorites

/** W88 favorites (SPEC §176): the words, [SCUL, Plain]. SCUL has no word of its own for a starred place, so it says
 *  Starred; Plain says Favorites. */
export const WORDS = { // W88 favorites
  mine: ["Starred", "Favorites"], // W88 favorites: Where to?'s heading over them
  recent: ["Recent", "Recent"], // W88 favorites: and over the recent places
  clear: "Clear", // W88 favorites: the recent places forgotten
  cleared: ["Recent places cleared", "Recent places cleared"], // W88 favorites: the snack, with Undo
  list: ["Starred places", "Favorites"], // W88 favorites: Settings' row
  more: ["First when you tap Where to?, and marked on the chart.", "First when you tap Where to?, and marked on the map."], // W88 favorites: its long press
  none: ["None yet", "None yet"], // W88 favorites: the row's line with none
  how: [["Tap ", " by a place in the search or on the chart."], ["Tap ", " by a place in the search or on the map."]], // W88 favorites: the list's how-to, the star drawn between
  starIcon: ["Star", "Star"], // W88 favorites: the star's name in that line, for a screen reader
  remove: (name) => `Remove ${name}`, // W88 favorites
}; // W88 favorites

/** The chart's marks: a point each, named in the mode's words (`name(p)`). */
export const marks = (list, name) => ({ type: "FeatureCollection", features: list.map((p, i) => ({ type: "Feature", id: i,
  properties: { name: name(p), i }, geometry: { type: "Point", coordinates: p.lonlat } })) });
