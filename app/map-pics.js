// W211 mapicons4 (SPEC §393), her row 42 of 2026-11-09: "In the search, T icons of different stations should have the correctly colored icon. In
// general, try to keep the right icon for searchable items." A T station's row wears the map's picture for it: its lines' roundels, overlapping
// (design/glyphs/comet_station_<lines>.svg, which chart/style/build_style.py station_image picks by the tiles' `line`), so one station has one
// picture everywhere. The search index has no lines, so they come from the tiles' own, as a table shipped with the app (chart/transit/tile-lines.js,
// made by chart/pipeline/station_lines.py --app); a station not in it (no line the tiles know) is the neutral roundel, as on the map.
// And every kind's row its map icon: where the map draws a kind with another picture than chart/kinds.json's glyph, MAP_MARK says the map's.
import { TILE_LINES } from "../chart/transit/tile-lines.js";
import { KINDS } from "../chart/lingo/kinds.js";
import { spotWhat } from "../chart/lingo/lingo.js"; // W222 legendavatar: BIZ_WHAT, here from app/course.js

/** Where the map draws a kind with another picture than chart/kinds.json's glyph (a stamp source: a change there is a data release), the map's: a
 *  bike rack is the rack mark (chart/style/build_style.py's anchorage layers, app/anchorages.js), not the Anchorage badge. */
export const MAP_MARK = { anchorage: "rack" };
/** A kind's picture in a search row: the map's (MAP_MARK), else chart/kinds.json's glyph, else the route's pin (app/course.js glyphFor). */
export const kindGlyph = (kind) => MAP_MARK[kind] || KINDS[kind]?.glyph || "waypoint";
/** W176 searchux (SPEC §311): a business place's glyph, as the map draws it (chart/style/build_style.py BIZ_GLYPH, SPOT_BIZ), by what its
 *  row says it is ("Restaurant · Nichols Ave, Watertown"), so a search's, a recent and a favourite one, never the pin the map doesn't draw.
 *  W222 legendavatar (SPEC §438): here from app/course.js, so the Icon legend reads the same tables (rowGlyphs). */
const BIZ = { restaurant: ["restaurant", "food_court", "fast_food", "ice_cream"], bank: ["bank", "bureau_de_change"], pharmacy: ["pharmacy", "chemist"],
  fuel_depot: ["cafe"], steering_dampener: ["bar", "pub", "biergarten", "nightclub", "brewery", "winery", "distillery"] }; // W176 searchux
const SHOP = { grocery: ["supermarket", "greengrocer", "grocery", "deli", "butcher", "seafood", "health_food", "farm", "frozen_food", "convenience"],
  restaurant: ["bakery", "pastry"] }; // W181 searchindex2: a shop's glyph by its class's word, as the map's BIZ_GLYPH draws a shop (bakeries with the fork and knife)
const byWhat = (t) => Object.entries(t).flatMap(([g, cs]) => cs.map((c) => [spotWhat(c), g]));
const BIZ_WHAT = new Map(byWhat(BIZ)), SHOP_WHAT = new Map([...BIZ_WHAT, ...byWhat(SHOP)]);
/** A search row's picture for a place `r` ({ kind, name, place, lonlat }): a T station its lines' roundels (W211 mapicons4, SPEC §393), a business
 *  or shop its class's (W176 searchux, W181 searchindex2), else its kind's (kindGlyph). W222 legendavatar: was app/course.js glyphOf. */
export const rowGlyph = (r) => (r.kind === "comet_station" ? stationGlyph(stationLine(r)) : null) || ((r.kind === "spot" ? BIZ_WHAT : r.kind === "luna" ? SHOP_WHAT : null)?.get(String(r.place || "").split(" · ")[0])) || kindGlyph(r.kind);
/** W222 legendavatar (SPEC §438): the kinds no search row wears: the old home (app/course.js and fromto-logic.js leave it out of every list,
 *  W219 favs3) and the hazard picture no place has (chart/kinds.json's "the app's" asteroids). */
export const NO_ROW = ["space_station", "asteroids"];
/** W222 legendavatar (SPEC §438), her row 1 of 2026-11-12: "icons … that appear in the search list but not in the icon legend": every picture
 *  rowGlyph can give, in SCUL's names (Plain's twins by glyphIn), from its own tables: each kind's, each business's and shop's, each station's. */
export function rowGlyphs(table = TILE_LINES) {
  const kinds = Object.keys(KINDS).filter((k) => !NO_ROW.includes(k));
  return new Set([...kinds.map(kindGlyph), kindGlyph(""), ...BIZ_WHAT.values(), ...SHOP_WHAT.values(), stationGlyph(""), ...table.map(([, , , line]) => stationGlyph(line))]);
}

export const NAMED_M = 400, NEAR_M = 150; // chart/pipeline/station_lines.py's: a station of its name within NAMED_M, else the nearest within NEAR_M
export const STATION_STEP = 34; // design/glyphs/build.py STATION_STEP: the next roundel's centre, of 64 along (app/tests/map-pics.test.mjs holds it to the manifest's)
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); // station_lines.py key()
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(((a[1] + b[1]) * Math.PI) / 360), (a[1] - b[1]) * 111320);

/** The tiles' `line` of the station a place `r` ({ kind, name, lonlat }) is ("Green;Red"), or "" (not a station, or none the table knows). */
export function stationLine(r, table = TILE_LINES) {
  if (r?.kind !== "comet_station" || !Array.isArray(r.lonlat)) return "";
  const k = key(r.name);
  let named = null, near = null;
  for (const [name, lon, lat, line] of table) {
    const m = metres(r.lonlat, [lon, lat]);
    if (k && key(name) === k && m < NAMED_M && !(named?.m <= m)) named = { m, line };
    else if (m < NEAR_M && !(near?.m <= m)) near = { m, line };
  }
  return (named || near)?.line || "";
}

/** W218 stations2 (SPEC §423): the tiles' comet_station_pair, a T station and a commuter rail station of one name drawn as one icon while their
 *  pictures can't stand apart on screen, is read as the station of its name with all its lines, as before the tiles held them apart: its
 *  tooltip, peek and card are the whole station's (no `sep`, so no one network's). Any other feature as it is. */
export const asStation = (f) => {
  if (f?.properties?.kind !== "comet_station_pair") return f;
  const { sep, whole, ...p } = f.properties;
  return { type: "Feature", id: f.id, geometry: f.geometry, properties: { ...p, kind: "comet_station" }, layer: f.layer, source: f.source, sourceLayer: f.sourceLayer };
};
/** W218 stations2 (SPEC §423): a station's lines in words, as a search row tells a network's own station from its namesake's: "Commuter Rail",
 *  "Red Line", "Orange and Green Lines" (the MBTA's order, the pictures'; app/legend.js's words for them). */
export function lineWords(line) {
  const ls = String(line || "").split(";"), t = ["Red", "Mattapan", "Orange", "Blue", "Green"].filter((l) => ls.includes(l));
  const ts = t.length < 2 ? t.map((l) => `${l} Line`) : [`${t.slice(0, -1).join(", ")} and ${t.at(-1)} Lines`];
  return [...ts, ...(ls.includes("Commuter Rail") ? ["Commuter Rail"] : [])].join(" and ");
}
/** W218 stations2: of a station place `r` ({ kind, name, lonlat }) the tiles draw as one network's of two of its name (two of the table's stations
 *  of its name within NAMED_M: South Station's Red Line and its Commuter Rail), its own lines in words ("Commuter Rail"); else "". */
export function netWords(r, table = TILE_LINES) {
  if (r?.kind !== "comet_station" || !Array.isArray(r.lonlat) || !r.name) return "";
  const k = key(r.name);
  return table.filter(([name, lon, lat]) => key(name) === k && metres(r.lonlat, [lon, lat]) < NAMED_M).length > 1 ? lineWords(stationLine(r, table)) : "";
}
/** The picture of a station of the tiles' `line`: its lines' roundels, as the style's station_image names them; none, the neutral roundel. */
export const stationGlyph = (line) => (line ? "comet_station_" + line.toLowerCase().replace(/ /g, "_").replace(/;/g, "_") : "comet_station");
/** How many roundels wide a station's picture is, in its height (1 for one line, 98 / 64 for two, 132 / 64 for three). */
export const stationWide = (line) => (64 + STATION_STEP * Math.max(0, String(line || "").split(";").filter(Boolean).length - 1)) / 64;
const WIDE = new Map(TILE_LINES.map(([, , , line]) => [stationGlyph(line), stationWide(line)]));
/** A glyph's width in its height: a station's picture of several lines is wider; every other glyph is square. */
export const glyphWide = (g) => WIDE.get(g) || 1;
