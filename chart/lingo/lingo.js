// The Lingo Layer's naming rules in JavaScript: base names from the strip rules, SCUL labels from
// the templates, and the pipeline's rules for whose name a path or bridge carries. It mirrors
// chart/pipeline/Starchart.java (which bakes `base` into the tiles) and chart/style/build_style.py
// (which turns templates into style expressions), so the app and the tests can name things the
// same way without a tile. Pure functions: no DOM, no MapLibre.

/**
 * "Massachusetts Avenue" -> "Massachusetts", with one strip rule ("street", "path", ...). `places` holds the
 * town and neighbourhood names on the chart: a rule with keep_place_names never strips a name down to one.
 */
export function stripBase(pack, name, rule, places = null) {
  if (!name || !name.trim()) return null;
  const o = pack.overrides.find((x) => x.name === name);
  if (o) return o.base;
  const s = pack.strip[rule] || pack.strip.none || { suffix: [], prefix: [] };
  let b = name.trim();
  for (const p of s.prefix || []) {
    if (b.length > p.length && b.slice(0, p.length).toLowerCase() === p.toLowerCase()) { b = b.slice(p.length).trim(); break; }
  }
  const suffixes = [...(s.suffix || [])].sort((a, c) => c.length - a.length);
  for (const suf of suffixes) {
    const tail = " " + suf;
    if (b.length > tail.length && b.slice(-tail.length).toLowerCase() === tail.toLowerCase()) { b = b.slice(0, -tail.length).trim(); break; }
  }
  if (s.keep_place_names && places && places.has(b)) return name.trim();
  return b || name;
}

/** Try each strip rule of the kind in turn; the first that changes the name wins (as the pipeline does). */
export function baseFor(pack, kind, name, places = null) {
  if (name == null) return null;
  const k = pack.kinds[kind];
  const rules = !k ? ["none"] : Array.isArray(k.strip) ? k.strip : [k.strip || "none"];
  let b = name;
  for (const r of rules) {
    b = stripBase(pack, name, r, places);
    if (b !== name) return b;
  }
  return b;
}

/**
 * A base kept whole that still ends in its kind's generic word ("Dorchester Park", kept whole because
 * Dorchester is a neighbourhood; "Town Field", an override) is labelled by its name alone: no lingo word to
 * repeat it. The tiles carry this as `whole` (Starchart.java), for the style.
 */
export function isWhole(pack, kind, name, base) {
  if (!name || base !== name.trim()) return false;
  const k = pack.kinds[kind];
  const rules = !k ? [] : Array.isArray(k.strip) ? k.strip : [k.strip || "none"];
  const n = name.trim().toLowerCase();
  return rules.some((r) => (pack.strip[r]?.suffix || []).some((s) => n === s.toLowerCase() || n.endsWith(" " + s.toLowerCase())));
}

const fill = (t, f) => t.replace("{base}", f.base || f.name || "").replace("{name}", f.name || f.base || "")
  .replace("{ref}", f.ref || "").replace("{plain}", f.plain || "").replace("{abbr}", f.abbr || f.name || "");

/** The label a feature shows in a lingo mode: "scul" (default), "cadet" (adds the plain name) or "meatspace". */
export function labelFor(pack, kind, f = {}, mode = "scul") {
  const k = pack.kinds[kind];
  if (!k) return f.name || "";
  const props = { ...f, base: f.base ?? baseFor(pack, kind, f.name) };
  if (mode === "meatspace") {
    const plain = k.plain || "{name}"; // a plain word without a name in it ("Traffic light") needs no name (events-11)
    return props.name || !/\{/.test(plain) ? fill(plain, props) : k.plain_unnamed || "";
  }
  let t = k.label;
  if (kind === "transport_lane" && !props.ref) t = k.label_noref;
  if (["shielded_starpath", "laned_starpath", "shared_starpath"].includes(kind)) t = pack.kinds.starpath.label;
  const needs = /\{(base|name|ref)\}/.test(t);
  const whole = /\{base\}/.test(t) && (f.whole ? true : isWhole(pack, kind, props.name, props.base));
  const scul = whole ? props.name.trim() : needs && !props.name && !props.base && !props.ref ? k.unnamed || t.replace(/\{[a-z]+\}\s?/g, "").trim() : fill(t, props).trim();
  if (mode !== "cadet") return scul;
  const sub = fill(k.cadet || "{name}", props).trim();
  return sub && sub !== scul ? `${scul}\n${sub}` : scul;
}

const STREETY = /\b(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Parkway|Pkwy|Highway|Hwy|Lane|Place|Court|Terrace|Way)\.?$/;

/**
 * The name a bike path carries on the chart. A sidepath named after the street beside it
 * ("Prospect Street") has no name of its own: it takes its bike route's name, or none.
 */
export function wormholeName(name, { route = null, streetNames = new Set() } = {}) {
  if (name && !streetNames.has(name) && !STREETY.test(name)) return name;
  return route || null;
}

/**
 * The name a bridge carries: its own bridge:name, else the name of the man_made=bridge area it
 * sits in, else none. Never the road's name ("Hyperspace Byway JFK").
 */
export function bridgeName({ bridgeName = null, areaName = null } = {}) {
  return bridgeName || areaName || null;
}

/** Is a closed road a rotary mapped without junction=roundabout? (One-way rings are found in the pipeline.) */
export function isNamedRotary({ name, highway, closed }) {
  if (!closed || !name || !highway) return false;
  if (/ Rotary$/.test(name)) return highway !== "service";
  return / Circle$/.test(name) && ["trunk", "primary", "secondary", "tertiary", "unclassified"].includes(highway.replace("_link", ""));
}

// W38 places: what a spot is (tiles v10's spots layer, search v5's "spot" entries), in plain words: its OSM class
// ("restaurant", "townhall"), or a named building's ("university"), as "Restaurant", "Town hall", "University building".
const SPOT_WORDS = { townhall: "Town hall", doctors: "Doctor", fitness_centre: "Gym", pitch: "Playing field", it: "IT office",
  ngo: "Nonprofit", place_of_worship: "Place of worship", social_facility: "Social services", government: "Government office",
  chemist: "Pharmacy" }; // W181 searchindex2: a shop=chemist (Walgreens, CVS) is a pharmacy here, as the map's cross says
const BUILDING_WORDS = { yes: "Building", apartments: "Apartments", dormitory: "Dormitory", house: "House", church: "Church",
  school: "School", hospital: "Hospital", hotel: "Hotel", retail: "Shop", detached: "House", residential: "Apartments" };
const plainWords = (s) => (s[0].toUpperCase() + s.slice(1)).replace(/_/g, " ").replace(/centre\b/, "center").replace(/theatre\b/, "theater");
export function spotWhat(cls, group) {
  if (!cls) return "";
  if (group === "building") return BUILDING_WORDS[cls] || `${plainWords(cls)} building`;
  return SPOT_WORDS[cls] || plainWords(cls);
}
