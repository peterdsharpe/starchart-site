// W67 places (design/app-ui/SPEC.md §97): starred places, kept pure so Node can test them. app/course.js draws the star
// on a peek and on the dropped pin, the quick picks and Where to?'s results; app/starred.js draws the marks on the chart.
//
// The list is localStorage "starchart.starred": places as the place sheet has them ({ lingo_name, name, place, kind,
// lonlat }), newest first, with no limit and no groups. A starred place keeps its own name; a starred pin keeps the
// name its pin had (the nearest street, or "Waypoint", which Plain says as "Pin"). W210 favs2 (SPEC §389): each keeps its last
// use (`used`, ms), which Where to? lists them by.

import { kindLabel } from "./course-logic.js"; // W225 kindwords

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

/** The list from storage's text: only places with a point; anything else is dropped. W225 kindwords (SPEC §472): a place starred from the
 *  map before W225 kept its kind's words as its place, with their article ("a library"; a place's own words never start so): a label now. */
export function readStarred(text) {
  let v;
  try { v = JSON.parse(text); } catch { return []; }
  return Array.isArray(v) ? v.filter((p) => p && typeof p.lingo_name === "string" && Array.isArray(p.lonlat) && p.lonlat.length === 2 && p.lonlat.every(Number.isFinite))
    .map((p) => (/^an? \S/u.test(p.place ?? "") ? { ...p, place: kindLabel(p.place) } : p)) : []; // W225 kindwords: not an address's "approximate" or "near 12 Elm St"
}

/** W206 favnames (SPEC §380): a nickname as kept: one line of at most NICK_MAX characters; "" for none. */
export const NICK_MAX = 40; // W206 favnames
export const cleanNick = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, NICK_MAX).trim() : ""); // W206 favnames

/** What a starred place keeps: its name, its words, its kind and its point (5 decimals, about a metre). W206 favnames: and her
 *  nickname for it, if she gave one. */
export const keep = (p) => ({ lingo_name: p.lingo_name, name: p.name || "", place: p.place || "", kind: p.kind || "waypoint",
  lonlat: p.lonlat.map((v) => Math.round(v * 1e5) / 1e5), ...(p.address ? { address: p.address } : {}), ...(p.pinned ? { pinned: true } : {}), ...(p.wide ? { wide: true } : {}), // pinned: named by its street, so a share sends no name; W73 plan: wide
  ...(cleanNick(p.nick) ? { nick: cleanNick(p.nick) } : {}), // W206 favnames
  ...(Number.isFinite(p.used) ? { used: p.used } : {}) }); // W210 favs2: its last use, so a backup carries it
/** W206 favnames: the list with `p`'s nickname `nick` (none when it is empty), where it was. */
export const nickname = (list, p, nick) => list.map((s) => (samePlace(s, p) ? keep({ ...s, nick }) : s)); // W206 favnames
/** W219 favs3 (SPEC §425): her nickname for `p` where it is a favourite she gave one, else "": what a destination is called wherever
 *  it is named (app/course.js titled(), the From/To ends in app/fromto.js). Any favourite's, never home's alone (W216's). */
export const nickOf = (list, p) => (p?.lonlat ? list.find((s) => s.nick && samePlace(s, p))?.nick ?? "" : ""); // W219 favs3

// ---- W216 homefav (SPEC §414): home was the favourite she named Home (0.1.102). W219 favs3 (SPEC §425), her row 1b of 11-11: "No need to
// have a custom icon or custom behavior for the word home. Treat it like any other favorite." A name is never a switch: nothing reads
// one; what is left is the old key's move, once.
/** W216 homefav: the key home had, before (app/keys.js: an old key); a start (app/starred.js) moves it into the list once. */
export const OLD_HOME = "starchart.home"; // W216 homefav
/** W219 favs3: the names the old home had, [SCUL, Plain]: the one it is moved in with, in the Words of the moment (was HOME_NAMES, which made a home). */
const OLD_NAMES = ["Space Station", "Home"]; // W219 favs3
/** W216 homefav: the list with the old home (`text`, OLD_HOME's) moved in, named in word mode `mode`'s words ("scul": Space Station,
 *  else Home), a name as any other (W219 favs3). A favourite at its place (within SAME_M, whatever its kind) takes the name if it has none; one with a name of hers
 *  keeps it, and so does a list with a favourite she named so already: the old home is let go. Else it is starred as a pin at its place, as it
 *  showed only as Home (its own name was SCUL's words, so Plain gets none). Nothing to move (none, or no point): the same list. */
export function moveHome(list, text, mode) { // W216 homefav
  let h = null; try { h = JSON.parse(text); } catch { /* not JSON: nothing to move */ } // W216 homefav
  const named = list.some((s) => OLD_NAMES.some((n) => cleanNick(s.nick).toLowerCase() === n.toLowerCase())); // W219 favs3: was homeOf(list)
  if (!Array.isArray(h?.lonlat) || h.lonlat.length !== 2 || !h.lonlat.every(Number.isFinite) || named) return list; // W216 homefav; W219 favs3: named
  const nick = OLD_NAMES[mode === "scul" ? 0 : 1], at = list.findIndex((s) => metres(s.lonlat, h.lonlat) <= SAME_M); // W216 homefav; W219 favs3: OLD_NAMES
  if (at >= 0) return cleanNick(list[at].nick) ? list : list.map((s, i) => (i === at ? keep({ ...s, nick }) : s)); // W216 homefav
  return [keep({ lingo_name: "Waypoint", name: "", place: typeof h.place === "string" ? h.place : "", kind: "waypoint", lonlat: h.lonlat, nick }), ...list]; // W216 homefav
} // W216 homefav

export const isStarred = (list, p) => list.some((s) => samePlace(s, p));
/** The list with `p` first (starring it again moves nothing). W210 favs2: starring it is its first use, at `at` (ms). */
export const star = (list, p, at = Date.now()) => (isStarred(list, p) ? list : [keep({ ...p, used: at }), ...list]); // W210 favs2: at

// ---- W210 favs2 (SPEC §389), her row 38: "order the favorites by most recently searched in the search bar. In the settings, they
// can be ordered alphabetically." A favourite's last use is when it was starred, picked in Where to?, or a route planned to it.
/** W210 favs2: the list with `p` used at `at` (ms), if it is starred; else the same list. */
export const use = (list, p, at = Date.now()) => (isStarred(list, p) ? list.map((s) => (samePlace(s, p) ? { ...s, used: at } : s)) : list); // W210 favs2
/** W210 favs2: Where to?'s order: the last used first; those with no `used` (starred before W210, and not used since) after them,
 *  in the list's order (newest starred first), as they were. */
export const byUse = (list) => [...list].sort((a, b) => (Number.isFinite(b.used) ? b.used : 0) - (Number.isFinite(a.used) ? a.used : 0)); // W210 favs2: sort is stable
let names = null; // W210 favs2: "café" by "Cafe", "Pier 9" before "Pier 10"; made at its first use, never as the module loads (W76 start, SPEC §137: the start never waits for ICU)
const NAMES = () => (names ??= new Intl.Collator("en", { sensitivity: "base", numeric: true }));
/** W210 favs2: Settings' order: by `name(p)`, her nickname where she gave one, from A to Z. */
export const byName = (list, name) => [...list].sort((a, b) => NAMES().compare(name(a), name(b))); // W210 favs2
/** The list without `p`, and what Undo needs: { list, undo } where undo(list) puts it back where it was. */
export function unstar(list, p) {
  const at = list.findIndex((s) => samePlace(s, p));
  if (at < 0) return { list, undo: (l) => l };
  const gone = list[at];
  return { list: list.filter((_, i) => i !== at), undo: (l) => (isStarred(l, gone) ? l : [...l.slice(0, at), gone, ...l.slice(at)]) };
}

/** "Dunkin' Donuts & Co." -> ["dunkin", "donuts", "and", "co"], as chart/search/search.js reads words. */
const words = (s) => (s ? String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’`]/g, "").replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean) : []);

/** Whether the words typed find a starred place: each the start of a word of its names or its town. W206 favnames: her
 *  nickname for it is one of its names. */
export const matches = (q, p) => finds(q, [p.nick, p.lingo_name, p.name, p.place, p.address]); // W206 favnames: was its body, with `nick`
/** W206 favnames: whether the words find it by its nickname alone. */
export const byNick = (q, p) => !!p.nick && finds(q, [p.nick]); // W206 favnames
function finds(q, names) { // W206 favnames: matches' body
  const want = words(q);
  if (!want.length) return false;
  const have = names.flatMap(words); // W206 favnames
  return want.every((w) => have.some((h) => h.startsWith(w)));
}

/** One place twice: the same starred place, or the same name within 60 m (a search's row for a place starred from its icon). */
const dup = (a, b) => samePlace(a, b) || (!!a?.lonlat && !!b?.lonlat && a.lingo_name === b.lingo_name && metres(a.lonlat, b.lonlat) < 60);

/** Where to?'s rows: the starred places the words find first, then the search's, without the same place twice. W206 favnames:
 *  those found by a nickname before those found by their own names. */
export function starFirst(results, list, q) {
  const mine = byUse(list).filter((p) => matches(q, p)).sort((a, b) => byNick(q, b) - byNick(q, a)); // W206 favnames: sort; W210 favs2: byUse, the last used first
  return [...mine.map((p) => ({ ...p, starred: true })), ...results.filter((r) => !mine.some((p) => dup(p, r)))];
}

/** The quick picks: the Fort (`first`, each may be null; W219 favs3: no home, a favourite as the rest), then the starred places, then the recent ones
 *  that aren't starred. */
export function withStarred(first, list, recent) {
  const g = pickGroups(first, list, recent); // W88 favorites
  return [...g.top, ...g.mine, ...g.recent]; // W88 favorites
}
/** W88 favorites: the quick picks in their groups, { top, mine, recent }, for Where to?'s headings: the Fort (W219 favs3: no home),
 *  the starred places (each `starred: true`), and the recent ones that are neither. */
export function pickGroups(first, list, recent) { // W88 favorites
  const top = first.filter(Boolean), mine = byUse(list).filter((p) => !top.some((f) => dup(f, p))).map((p) => ({ ...p, starred: true })); // W88 favorites; W210 favs2: byUse, the last used first
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
  saved: [(n) => `${n} saved`, (n) => `${n} saved`], // W210 favs2 (SPEC §389), her row 19: the row's line, how many (was their names); 0.1.97's words review: SCUL's "on the chart" read as a place, not a count
  how: [["To star a place, search for it in Where to? or tap it on the chart, then tap its ", "."], ["To add a favorite, search for the place in Where to? or tap it on the map, then tap its ", "."]], // W88 favorites: the list's how-to, the star drawn between; W210 favs2 (her row 18): what to do and where (was "Tap ☆ by a place in the search or on the map.")
  starIcon: ["Star", "Star"], // W88 favorites: the star's name in that line, for a screen reader
  remove: (name) => `Remove ${name}`, // W88 favorites
  added: ["Starred", "Added to favorites"], // W206 favnames: the snack after a star, with its nickname's button
  nick: ["Call sign", "Nickname"], // W206 favnames: that button, and the field's name; SCUL's pilots have call signs (CULTURE.md §5)
  nickFor: [(name) => `Call sign for ${name}`, (name) => `Nickname for ${name}`], // W206 favnames: the question's title, and Settings' button
  nickHint: ["Like Home or Work", "Like Home or Work"], // W206 favnames: the field's placeholder; 0.1.95's words review: whole at 150 % text (was "Home, work, a friend's name", cut there); W219 favs3: no names offered under it (W216's Home and Work went)
  save: "Save", cancel: "Cancel", // W206 favnames: the question's buttons
}; // W88 favorites

/** The chart's marks: a point each, named in the mode's words (`name(p)`). */
export const marks = (list, name) => ({ type: "FeatureCollection", features: list.map((p, i) => ({ type: "Feature", id: i,
  properties: { name: name(p), i }, geometry: { type: "Point", coordinates: p.lonlat } })) });
