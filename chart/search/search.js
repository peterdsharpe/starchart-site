// Starchart's offline search: streets, systems, quadrants, constellations, black holes, places, POIs
// and house numbers, by plain or SCUL name, as you type. Pure JavaScript with no DOM, for a web
// worker and for Node tests. The index is the JSON that chart/search/build_index.py writes (format in
// chart/search/README.md); SCUL names come from the lingo pack at load time, through the same
// labelFor() the chart's labels use, so "Starpath Mass" finds Massachusetts Avenue.
//
//   const idx = load(indexJson, lingoPack);   // or await loadUrl(url, lingoPack), or loadBlob(opfsFile, lingoPack)
//   idx.search("12 elm st", [-71.12, 42.39], { limit: 8 })
//   // -> [{ name, lingo_name, kind, lonlat, address?, place, distance_m?, oh? }, ...]   (W77 hours: oh, OSM's opening_hours)
//
// Matching: every query word must match the start of a word in the name (any order), or the name of
// the entry's town or quadrant, or a word of its kind ("tardis", "black hole", "cafe"). Abbreviations
// (St, Ave, Sq, Mass, ...) are expanded on both sides. A word with no match anywhere gets one typo
// (two in long words). Ranking: squares and Comet stations whose name starts with the query, then any
// name that starts with it, then the rest; within each, match quality, kind and importance, and the
// distance from `near`.
import { labelFor, spotWhat } from "../lingo/lingo.js";
import { KINDS, STREET_KINDS as STREETS } from "../lingo/kinds.js"; // W188 kindsone: chart/kinds.json's streets; W191 dataleft: and its words, weights and leads

// Abbreviation -> the word it stands for. Applied to the index's words and the query's alike.
const ABBR = Object.assign(Object.create(null), {
  st: "street", str: "street", ave: "avenue", av: "avenue", rd: "road", sq: "square", blvd: "boulevard",
  pkwy: "parkway", pky: "parkway", hwy: "highway", ln: "lane", ct: "court", pl: "place", ter: "terrace",
  terr: "terrace", dr: "drive", cir: "circle", ext: "extension", hts: "heights", pk: "park", sta: "station",
  ctr: "center", centre: "center", mt: "mount", ft: "fort", sr: "senior", jr: "junior", n: "north",
  s: "south", e: "east", w: "west", mass: "massachusetts", comm: "commonwealth", hosp: "hospital",
  univ: "university", "1st": "first", "2nd": "second", "3rd": "third", "4th": "fourth", "5th": "fifth",
});
// Words a query may leave out, or include, as it likes.
const OPTIONAL = new Set(["the", "of", "and", "at", "a", "in", "on"]);
// W176 searchrank (SPEC §310): local short names that OSM lacks, as other names of the places of that name, in Plain and SCUL alike
const ALIASES = new Map(Object.entries({
  "Jamaica Plain": "JP", "South Boston": "Southie", "East Boston": "Eastie", "Dorchester": "Dot", "Roslindale": "Rozzie",
  "Prudential Center": "The Pru", "Boston Public Library": "BPL", "Museum of Fine Arts": "MFA", "Massachusetts General Hospital": "MGH;Mass General",
  "Boston University": "BU", "Boston College": "BC", "Back Bay Fens": "The Fens", "Charles River Esplanade": "The Esplanade",
  "Minuteman Bikeway": "The Minuteman", "Cambridgeside": "Cambridgeside Galleria", "Brigham and Women's Hospital": "Brigham",
  "Leonard P. Zakim Bunker Hill Memorial Bridge": "The Zakim;Zakim Bridge", // W181 searchrank2: SCUL knights its pilots under the Zakim
  "Logan International Airport": "Logan", // W194 search5 (SPEC §342): Boston's name for it, so "logan" is the airport, before Medford's Logan Park 3 km from Davis
}));
// W181 searchrank2 (SPEC §318): a spot's or shop's class by other words than its own ("grocery": a supermarket), as found by, never shown
const CLASS_WORDS = { "shop/supermarket": ["grocery", "grocery store"] };
/** W181 searchrank2: what a plural's singular may be ("parks", "black holes", "libraries", "churches"); none for a word that is no plural. */
const singulars = (w) => (w.length < 4 || !w.endsWith("s") || w.endsWith("ss") ? [] : w.endsWith("ies") ? [`${w.slice(0, -3)}y`, w.slice(0, -1)] : w.endsWith("es") ? [w.slice(0, -1), w.slice(0, -2)] : [w.slice(0, -1)]);
// A few plain words for kinds, beyond the lingo pack's own labels and cadet words. W183 search3: one phrase a comma ("bike shop", a kind's words being typed)
// W191 dataleft (SPEC §335): chart/kinds.json's `words` (W67 water's coolant and plasma; W181 searchrank2's "heavy nebula", SCUL's name, which the
// chart's label shortens ("The Jamaica Nebula"), and its bike rack; W188 kindsone's footbridge, "bridge", with them)
const ofKinds = (f) => Object.fromEntries(Object.entries(KINDS).filter(([, v]) => v[f] !== undefined).map(([k, v]) => [k, v[f]])); // W191 dataleft
const KIND_WORDS = ofKinds("words");
// How much each kind counts in the ranking, before its importance and distance. W191 dataleft: chart/kinds.json's `weight` (W38 places:
// a spot after a stop of the same name; W176 searchrank: 0.5, was 0, so distance decides before the kind: "rec center", one 3.8 km off
// before a park of the name 7.5 km off)
const KIND_WEIGHT = ofKinds("weight");
const STREET_KINDS = new Set(STREETS); // W188 kindsone: one list with app/course-logic.js's ROAD_KINDS (hyper_wormhole joins)
// W19: a name that starts with the query ranks above one that only contains it, and a square or a Comet
// station (or a black hole, the Fort, a lore place) above a street ("harvard": Harvard Square before Harvard Avenue). Among them, distance decides
// ("maxwell": Maxwells Green, nearby, before Maxwell Road across the chart).
const LEAD = 2, LEAD_PLACE = 4, LEAD_KINDS = new Set(Object.keys(ofKinds("lead"))); // W191 dataleft: chart/kinds.json's `lead`
const EXACT = 2; // W176 searchrank (SPEC §310): a name that is the query, all of it, before names that only start with it
// W181 searchrank2 (SPEC §318): a corner typed as "X and Y", "X & Y", "X at Y" or "X / Y"; one whose two streets both match comes before every other result
const CORNER = /^(.+?)(?:\s+(?:and|at)\s+|\s*[&/]\s*)(.+)$/i, CORNER_FIRST = 100;
// W183 search3 (SPEC §319): two streets joined by one this short meet; a road's frontage or service road's corner this near the road's is the road's
const GROW_M = 5000; // W183 search3: a half typed name's size counts in full this near, less beyond
// W191 search4 (SPEC §336): a place with its own wikidata or wikipedia tag counts as this many steps of size more, among names alike and
// again while half typed ("faneu": Faneuil Hall, the hall, before the square and the marketplace's street); in full within GROW_M, less beyond
const WIKI = 1;
const LINK_M = 60, FOLD_M = 60, TWIN = /^(.+?) (?:(?:North|South|East|West) )?(?:Frontage|Service) Road(?: (?:North|South|East|West)bound)?$/;
const HOUSE = /^\d+[a-z]?(-\d+[a-z]?)?$/;
// W21 entry (arclight, 2026-10-16: "we have our own bikes, we're not using bluebikes"): bike-share docks come after every
// other kind, and go by the first part of their name ("Innovation Lab", not "Innovation Lab - 125 Western Ave").
const DOCK = "klingon_dock";
export const dockName = (s) => (s ? s.split(" - ")[0] : s);
const MAX_WORDS = 8;

/** "Dunkin' Donuts & Co." -> ["dunkin", "donuts", "and", "co"]. Accents and apostrophes go. */
export function words(s) {
  if (!s) return [];
  if (/^[A-Za-z0-9 .\-]*$/.test(s)) return s.toLowerCase().split(/[ .\-]+/).filter(Boolean); // most names: fast path
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/['’`]/g, "").replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean);
}

/** Index words: abbreviations expanded; a leading "St" before another word is "Saint". */
function indexWords(s) {
  const w = words(s);
  return w.map((t, i) => (t === "st" && i === 0 && w.length > 2 ? "saint" : ABBR[t] || t));
}

/**
 * Bounded optimal-string-alignment distance between a and b, or (prefix) between a and the closest
 * start of b. Returns max + 1 as soon as it must exceed max.
 */
const rows = [new Int32Array(64), new Int32Array(64), new Int32Array(64)];
function editDistance(a, b, max, prefix = false) {
  const la = a.length, lb = prefix ? Math.min(b.length, la + max) : b.length;
  if (prefix ? lb < la - max : Math.abs(la - lb) > max) return max + 1;
  if (lb >= 63) return max + 1;
  let prev2 = null, prev = rows[0], cur = rows[1], spare = rows[2];
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let best = i;
    for (let j = 1; j <= lb; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    const old = prev2 || spare;
    prev2 = prev;
    prev = cur;
    cur = old;
  }
  if (!prefix) return prev[lb];
  let m = max + 1;
  for (let j = Math.max(0, la - max); j <= lb; j++) if (prev[j] < m) m = prev[j];
  return m;
}

/** First index in the sorted array `a` whose value is >= s. */
function lowerBound(a, s) {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < s) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Fetch and load an index (gzipped or not) in a worker or in Node. */
export async function loadUrl(url, pack) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`search index: HTTP ${res.status}`);
  return loadBlob(await res.blob(), pack);
}

/** Load an index from a Blob or File, such as the one in OPFS; gzipped or not (by its first bytes). */
export async function loadBlob(blob, pack) {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  const text = gz ? await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text() : await blob.text();
  return load(JSON.parse(text), pack);
}

/** Build the in-memory index from the index JSON and the lingo pack. */
export function load(doc, pack) {
  if (doc.format !== "starchart-search" || doc.version !== 1) throw new Error("not a Starchart search index, version 1");
  const columns = new Set(doc.columns || Object.keys(doc)); // W188 datastamps (SPEC §327): the columns the index says it holds (build_index.py); an older one's, its keys
  const n = doc.name.length;
  const kinds = doc.kinds;
  const kind = Uint8Array.from(doc.kind);
  const x = new Int32Array(n), y = new Int32Array(n);
  for (let i = 0, px = 0, py = 0; i < n; i++) { px += doc.x[i]; py += doc.y[i]; x[i] = px; y[i] = py; }
  const town = Int32Array.from(doc.town), quad = Int32Array.from(doc.quad), rank = Uint8Array.from(doc.rank);
  const alt = doc.alt || {}, base = doc.base || {}, street = doc.street || {}, same = doc.same || {};
  const packOf = doc.pack || []; // W82 packui: the gazetteer's (tools/data/gazetteer.py), per entry its map pack's id
  const size = doc.size || {}; // W176 searchrank: a stop's or spot's size, where it is drawn from an area (W176 searchindex)
  const known = new Uint8Array(n); // W191 search4 (SPEC §336): a place with its own wikidata or wikipedia tag (the index's sparse `wiki`), known beyond its street
  for (const j in doc.wiki || {}) known[j] = 1; // W191 search4
  const homes = new Set((doc.classes || []).flatMap((c, i) => (/^building\/(apartments|residential|house|detached|semidetached_house|terrace|dormitory|bungalow)$/.test(c) ? [i] : []))); // W176 integration: a home's size says nothing of a destination (the Maxwell apartments 9 km away before Maxwells Green at 4.6 km)
  const oh = doc.oh || {}; // W77 data (index v8): a place's OSM opening_hours, as written, on the places that have one; W77 hours reads it
  const overrides = new Map((pack.overrides || []).map((o) => [o.name, o.base]));
  for (const nm of ALIASES.keys()) if (!overrides.has(nm)) overrides.set(nm, ""); // W176 searchrank: the aliases' places, found in the same lookup
  // W38 places (index v5): a spot's "group/class", and what it is in plain words ("Restaurant"), which it is found by too
  const cls = doc.cls || [], whats = (doc.classes || []).map((c) => spotWhat(c.split("/")[1], c.split("/")[0]));
  const whatOf = (i) => (cls[i] >= 0 ? whats[cls[i]] : "");
  const finds = [], findsOf = (c) => (finds[c] ??= [whats[c], ...(CLASS_WORDS[doc.classes[c]] || [])].map(indexWords)); // W181 searchrank2: a class's words, and its CLASS_WORDS
  const shown = (doc.classes || []).map((c) => c !== "stop/air_pump"); // W173 pumps (her note 11): a repair stand or bike shop with air is found by "air pump", but its row says what it is, never "Air pump"

  // Word -> postings (entry * 8 + the word's position in the name, capped at 7), in two passes over
  // flat arrays: every (word id, posting) pair, then a counting sort into the vocabulary's order.
  const ids = new Map(), list = [];
  const idsOf = (ws) => {
    for (let k = 0; k < ws.length; k++) {
      let id = ids.get(ws[k]);
      if (id === undefined) { id = list.length; ids.set(ws[k], id); list.push(ws[k]); }
      ws[k] = id;
    }
    return ws;
  };
  let pw = new Int32Array(1 << 17), pp = new Int32Array(1 << 17), np = 0;
  const addWords = (i, wids, from) => {
    if (np + wids.length > pw.length) {
      const grow = (a) => { const b = new Int32Array(a.length * 2); b.set(a); return b; };
      pw = grow(pw); pp = grow(pp);
    }
    for (let k = 0; k < wids.length; k++) { pw[np] = wids[k]; pp[np++] = i * 8 + Math.min(from + k, 7); }
  };
  const nwords = new Uint8Array(n), whatIds = [];
  const withOther = []; // W176 searchrank: the entries with a lingo override or an alias
  const seen = new Map(); // names repeat ("Main Street", "Dunkin'"): split each once
  const sole = new Set(); // W181 searchrank2: the names of one word
  for (let i = 0; i < n; i++) {
    const name = doc.name[i];
    let wids = seen.get(name);
    if (!wids) seen.set(name, (wids = idsOf(indexWords(name))));
    nwords[i] = Math.min(wids.length, 255);
    if (wids.length === 1) sole.add(list[wids[0]]); // W181 searchrank2
    addWords(i, wids, 0);
    if (wids.length > 1 && list[wids[0]] === "the") addWords(i, wids.slice(1), 0); // W21 entry: "pear" starts "The Pear", as W19's names that start with the query
    if (alt[i]) addWords(i, idsOf(indexWords(alt[i])), 7);
    if (cls[i] >= 0) addWords(i, (whatIds[cls[i]] ??= idsOf(findsOf(cls[i]).flat())), 7); // W38 places: "pharmacy", "brewery"; W42 bench: split once a class; W181 searchrank2: findsOf
    const ob = overrides.get(name);
    if (ob !== undefined) { if (ob) addWords(i, idsOf(indexWords(ob)), 7); withOther.push(i); } // W176 searchrank: withOther, and "" for an alias's
  }
  // W176 searchrank: each entry's other names (alt_name, the lingo override, ALIASES; several joined by ";"), as words but "the" and the like, to tell when the query is one
  const others = new Map(), have = (i, a) => (alt[i] || "").split(";").some((o) => words(o).join(" ") === words(a).join(" "));
  for (const i of [...Object.keys(alt).map(Number), ...withOther]) {
    if (others.has(i) || !(i < n)) continue;
    const al = ALIASES.get(doc.name[i])?.split(";").filter((a) => !have(i, a)).join(";"); // none an alt_name has already
    if (al) addWords(i, idsOf(indexWords(al)), 7);
    const names = [];
    for (const o of [alt[i], overrides.get(doc.name[i]), al]) for (const part of o ? o.split(";") : []) {
      const ws = indexWords(part.split(",")[0]).filter((w) => !OPTIONAL.has(w)); // the name before a comma ("Artisans Asylum, Allston": the Fort)
      if (ws.length) names.push(ws);
    }
    others.set(i, names);
  }
  const order = list.map((_, id) => id).sort((a, b) => (list[a] < list[b] ? -1 : 1));
  const vocab = order.map((id) => list[id]);
  const rankOf = new Int32Array(list.length);
  order.forEach((id, r) => { rankOf[id] = r; });
  const start = new Int32Array(vocab.length + 1);
  for (let k = 0; k < np; k++) start[rankOf[pw[k]] + 1]++;
  for (let v = 0; v < vocab.length; v++) start[v + 1] += start[v];
  const posts = new Int32Array(np), fillAt = start.slice(0, vocab.length);
  for (let k = 0; k < np; k++) posts[fillAt[rankOf[pw[k]]]++] = pp[k];
  // The same for first words only, for a query of one or two letters.
  const start0 = new Int32Array(vocab.length + 1);
  for (let k = 0; k < np; k++) if ((pp[k] & 7) === 0) start0[rankOf[pw[k]] + 1]++;
  for (let v = 0; v < vocab.length; v++) start0[v + 1] += start0[v];
  const posts0 = new Int32Array(start0[vocab.length]), fill0 = start0.slice(0, vocab.length);
  for (let k = 0; k < np; k++) if ((pp[k] & 7) === 0) posts0[fill0[rankOf[pw[k]]]++] = pp[k];

  // Kind words: the lingo pack's labels and cadet words ("black hole", "tardis", "bike shop").
  const kindWords = new Map(); // word -> [kind ids]
  const kindPhrases = kinds.map(() => []); // W183 search3: each kind's phrases of two words or more, but "the", "of" and the like ("black hole", "temple of knowledge", "bike shop")
  kinds.forEach((k, id) => {
    const lk = pack.kinds[k] || {};
    const texts = [lk.label, lk.cadet, lk.plain_unnamed, lk.unnamed, KIND_WORDS[k], k === "address" ? "" : null];
    for (const t of texts) for (const ph of (t || "").split(/\{[a-z]+\}|,/)) { const ws = words(ph).filter((w) => !OPTIONAL.has(w)); if (ws.length > 1) kindPhrases[id].push(ws); } // W183 search3
    for (const t of texts) {
      for (const w of words((t || "").replace(/\{[a-z]+\}/g, " "))) {
        if (OPTIONAL.has(w)) continue;
        const ids = kindWords.get(w) || [];
        if (!ids.includes(id)) ids.push(id);
        kindWords.set(w, ids);
      }
    }
  });
  const kindVocab = [...kindWords.keys()].sort();
  // W183 search3: every kind's words, the pack's whether this index has the kind or not (the gazetteer's towns), for no typo of a word that begins one ("tard": no Gardner)
  const anyKind = [...new Set(Object.entries(pack.kinds).flatMap(([k, lk]) => [lk.label, lk.cadet, lk.plain_unnamed, lk.unnamed, KIND_WORDS[k]]).flatMap((t) => words((t || "").replace(/\{[a-z]+\}/g, " "))))].sort();
  const kindStart = (w) => { const t = anyKind[lowerBound(anyKind, w)] || ""; return t === w || (w.length >= 3 && t.startsWith(w)); };
  const byKind = kinds.map(() => []);
  for (let i = 0; i < n; i++) byKind[kind[i]].push(i);
  // W176 searchrank: an entry's name in words but "the", "of" and the like, as many as the query's words must be to be the name, worked out
  // when first asked for: all of them; or all but a last word that is its kind's own ("Harvard Square", the square called Harvard; not a
  // street's), as `short` (that word); or none for a business or spot named by one word that a hundred names have, a kind of place more
  // than a name ("Bakery", "Pizza")
  const core = new Uint8Array(n).fill(255), short = new Int32Array(n);
  const coreOf = (e) => {
    if (core[e] !== 255) return core[e];
    const ws = seen.get(doc.name[e]) || [], last = ws[ws.length - 1];
    let c = 0;
    for (const id of ws) if (!OPTIONAL.has(list[id])) c++;
    short[e] = c > 1 && !STREET_KINDS.has(kinds[kind[e]]) && kindWords.get(list[last])?.includes(kind[e]) ? last : -1;
    if (c === 1 && (KIND_WEIGHT[kinds[kind[e]]] ?? 0) <= 0.5 && start[rankOf[last] + 1] - start[rankOf[last]] >= 100) c = 0;
    return (core[e] = Math.min(c, 254));
  };

  // W181 searchrank2 (SPEC §318): a long entry's points along it (index v8's sparse `pts`: a bike path's, a river's), as house numbers' are
  // coded, decoded when first asked for; the nearest of them and the entry's own point is where it is from a point
  const pts = doc.pts || {}, ptsDone = new Map(), hasPts = new Uint8Array(n);
  for (const e in pts) hasPts[e] = 1;
  const nearestPoint = (e, nx, ny, cos) => { // [x, y, metres] of entry e nearest (nx, ny), in 1e-5 degrees
    let bx = x[e], by = y[e], bd = Math.hypot((bx - nx) * cos, by - ny);
    if (!hasPts[e]) return [bx, by, bd * 1.1132];
    let p = ptsDone.get(e);
    if (!p) { const d = polyline(pts[e]); p = new Int32Array(d.length); for (let k = 0, qx = x[e], qy = y[e]; k < d.length; k += 2) { p[k] = qx += d[k]; p[k + 1] = qy += d[k + 1]; } ptsDone.set(e, p); }
    for (let k = 0; k < p.length; k += 2) { const dd = Math.hypot((p[k] - nx) * cos, p[k + 1] - ny); if (dd < bd) { bd = dd; bx = p[k]; by = p[k + 1]; } }
    return [bx, by, bd * 1.1132];
  };
  // W183 search3 (SPEC §319): a place's size on the size column's scale (1 to 3 from 0.5, 5 and 50 ha): a stop's or spot's own; a park's or a pond's
  // from its rank (2 and 3 from 9 and 91 ha); a path's or a river's from its length, its pts 200 m apart (1 to 3 from 1, 3 and 10 km)
  const AREAS = new Set(["terraform", "heavy_nebula"]), nPts = new Map();
  const sizeOf = (e) => {
    if (size[e]) return size[e];
    if (AREAS.has(kinds[kind[e]])) return rank[e] ? rank[e] + 1 : 0;
    if (!hasPts[e]) return 0;
    let c = nPts.get(e);
    if (c === undefined) nPts.set(e, (c = polyline(pts[e]).length / 2));
    return c >= 50 ? 3 : c >= 15 ? 2 : c >= 5 ? 1 : 0;
  };

  // House numbers per street entry, decoded when first asked for.
  const houses = new Map();
  for (const a of doc.addr || []) houses.set(a[0], a);
  const housesOf = (e) => {
    const a = houses.get(e);
    if (!a) return null;
    if (a.decoded) return a.decoded;
    const nums = a[1].split("|"), d = polyline(a[2]), out = [];
    let qx = x[e], qy = y[e];
    for (let k = 0; k < nums.length; k++) { qx += d[2 * k]; qy += d[2 * k + 1]; out.push([nums[k], qx, qy]); }
    return (a.decoded = out);
  };

  // Scratch space, reused by every query: one bit per query word, and that word's match quality.
  const mask = new Uint16Array(n), lead = new Uint16Array(n); // lead: query word b matched the name's word b
  const ends = new Uint16Array(n); let qn = 0; // W176 searchrank: query word b of qn matched the name's word that many from its end
  const qual = new Float32Array(n * MAX_WORDS);
  const first = new Uint8Array(n);
  const own = new Uint16Array(n); // W176 searchrank: query word b matched a word of the entry's own name (not another name or its class's words)
  const typed = new Uint16Array(n); // W183 search3: query word b matched a word of its names whole (or an abbreviation's), not only a word's start
  let wholeBits = 0; // W176 searchrank: the query's words that are words of the index as typed

  const kindName = (i) => kinds[kind[i]];
  const nameOf = (i) => doc.name[i] || null;
  const lingoName = (i, mode = "scul") => {
    const k = kindName(i), cut = k === DOCK ? dockName : (t) => t; // W21 entry
    const f = { name: cut(nameOf(i)) };
    if (base[i]) f.base = cut(base[i]);
    return labelFor(pack, k, f, mode) || f.name || "";
  };
  /** An unnamed POI's plain name: "Toilet", or its cadet word ("Bluebikes"). */
  const plainUnnamed = (i) => {
    const k = pack.kinds[kindName(i)] || {};
    const cadet = k.cadet && !/\{/.test(k.cadet) ? k.cadet[0].toUpperCase() + k.cadet.slice(1) : "";
    return lingoName(i, "meatspace") || cadet || lingoName(i);
  };
  const placeOf = (i) => {
    const t = town[i] >= 0 ? doc.name[town[i]] : null, q = quad[i] >= 0 ? doc.name[quad[i]] : null;
    return q && t && q !== t ? `${q}, ${t}` : q || t || null;
  };

  /** Each query word's alternatives: [word, prefix allowed, quality]. */
  function alternatives(w, last) {
    const alts = [[w, true, 1]];
    if (ABBR[w]) alts.push([ABBR[w], false, 1]);
    if (w === "st") alts.push(["saint", false, 0.9]);
    for (const one of singulars(w)) alts.push([one, false, 0.45]); // W181 searchrank2: a plural, as its singular, as good as a typo ("groceries": a supermarket's words)
    return alts;
  }

  /** Mark every entry whose words match query word `bit`; returns how many vocabulary words matched. */
  function markWord(w, bit, last, touched, kindHit, firstOnly, typoFrom = 4, whole = false) { // W181 searchrank2: typoFrom; whole, no word's start (a corner's first street)
    let hits = 0;
    const mark = (v, q, full, whole = false) => { // W183 search3: whole, the word as typed (or its abbreviation's), not a start
      const S = firstOnly && !full ? start0 : start, P = firstOnly && !full ? posts0 : posts; // W176 searchrank: full, two letters as typed, whole, anywhere ("jp", an other name)
      for (let p = S[v]; p < S[v + 1]; p++) {
        const e = P[p] >> 3, pos = P[p] & 7;
        if (mask[e] === 0) touched.push(e);
        mask[e] |= 1 << bit;
        const slot = e * MAX_WORDS + bit;
        const qq = pos === 7 ? q * 0.85 : q; // other names (alt_name, the lingo override) count a little less
        if (qq > qual[slot]) qual[slot] = qq;
        if (pos === 0 && bit === 0) first[e] = 1;
        if (pos === bit) lead[e] |= 1 << bit;
        if (whole) typed[e] |= 1 << bit; // W183 search3
        if (pos !== 7) { own[e] |= 1 << bit; if (pos === nwords[e] - qn + bit) ends[e] |= 1 << bit; } // W176 searchrank
      }
    };
    // Each vocabulary word once, at the best quality any alternative gives it ("st" and "street").
    const best = new Map(), as = new Set(); // W183 search3: as, the words typed whole
    const offer = (v, q) => { if (!(best.get(v) >= q)) best.set(v, q); };
    for (const [alt, prefix, q] of alternatives(w, last)) {
      let v = lowerBound(vocab, alt);
      if (v < vocab.length && vocab[v] === alt) { offer(v, q); as.add(v); v++; } // W183 search3: as
      if (!prefix || whole) continue; // W181 searchrank2: whole
      // Prefixes count for less the more of the word is left untyped; one letter only as the last word.
      if (alt.length < 2 && !last) continue;
      for (; v < vocab.length && vocab[v].startsWith(alt); v++) offer(v, vocab[v].length === alt.length + 1 && vocab[v].endsWith("s") && alt.length >= 3 && !alt.endsWith("s") ? q * 0.99 : q * (0.55 + 0.35 * (alt.length / vocab[v].length))); // W183 search3: the word in the plural, as good as whole ("farm": Pemberton Farms, a name with the word, as Derby Farm), but no exact name
    }
    for (const [v, q] of best) { mark(v, q, vocab[v] === w, as.has(v)); hits++; } // W176 searchrank: vocab[v] === w; W183 search3: as
    if (hits === 0 && !kindHit && w.length >= typoFrom) { // W181 searchrank2: from 3 letters beside another word ("fenway prk"), which keeps it to names with both
      // One typo (two in a long word); the last word may be a typo of a word's start.
      const max = w.length >= 8 ? 2 : 1;
      // One edit leaves one of the first two letters in place (or swaps them): a cheap filter first.
      const w0 = w[0], w1 = w[1];
      for (let v = 0; v < vocab.length; v++) {
        const t = vocab[v];
        if (t.length < w.length - max || (t[0] !== w0 && t[1] !== w1 && t[1] !== w0 && t[0] !== w1)) continue;
        const d = editDistance(w, t, max, last);
        if (d <= max) { mark(v, 0.5 - 0.1 * d); hits++; }
      }
    }
    return hits;
  }

  /** Which kinds' words the query word matches (exactly, or as a prefix of 3 letters or more). */
  function kindBits(w, bit, kmask, kqual, kexact) {
    let hit = false;
    // The word as typed only: "st" is a street in a name, not every starpath. W181 searchrank2: a plural, as its singular ("parks", "wormholes").
    const ones = (kindVocab[lowerBound(kindVocab, w)] || "").startsWith(w) || sole.has(w) ? [] : singulars(w).filter((s) => kindWords.has(s)); // not a place's whole name ("Spaces")
    for (const [alt, prefix] of [[w, true], ...ones.map((s) => [s, false])]) {
      let v = lowerBound(kindVocab, alt);
      for (; v < kindVocab.length && kindVocab[v].startsWith(alt); v++) {
        const exact = kindVocab[v] === alt;
        if (!exact && (!prefix || alt.length < 3)) break;
        for (const id of kindWords.get(kindVocab[v])) {
          kmask[id] |= 1 << bit;
          if (exact) kexact[id] |= 1 << bit;
          hit = true;
          kqual[id * MAX_WORDS + bit] = Math.max(kqual[id * MAX_WORDS + bit], exact ? 0.8 : 0.6);
        }
      }
    }
    return hit;
  }

  /** W73 plan: whether the query's words are exactly class `c`'s words ("air pump", "pharmacy"). */
  const classSets = [];
  /** W73 plan: whether entry `e`'s own name has each of the query's `nq` words, whole (not a prefix, an alt name or its class's words). */
  const wholeName = (e, nq) => { for (let b = 0; b < nq; b++) if (qual[e * MAX_WORDS + b] < 0.99) return false; return true; };
  /** W176 searchrank: whether entry `e`'s own name is the query's `required` words, all of them, as whole words (the last nearly typed,
   *  or one typo off), less a last word of its kind's ("Harvard Square" for "harvard"), or followed by words of its kind ("dunkin donuts": Dunkin');
   *  `literal`, for a query of a kind's or a class's words: the name itself only ("aquarium": the station, not Post Office Square for "post office"). */
  const isExact = (e, required, kb, qw, nq, complete, literal) => {
    const mine = own[e] & required, more = required & ~mine;
    if (!mine || (literal && more) || (more & ~kb) || (more & ((1 << (32 - Math.clz32(mine))) - 1))) return false;
    for (let b = 0, m = mine; m; b++, m >>= 1) {
      const qv = qual[e * MAX_WORDS + b];
      if (m & 1 && qv < 1 && qv >= 0.5 && (qv < 0.75 || wholeBits & (1 << b))) return false; // a prefix of most of a word ("prudential cent"), not a word of its own ("cambridge" of Cambridgeport)
    }
    const k = popcount(mine), c = coreOf(e);
    return k === c || (!literal && k === c - 1 && short[e] >= 0 && !tailIn(list[short[e]], qw, nq, complete));
  };
  /** W176 searchrank: whether the query has the word `t` ("Puddingstone Dog Park": "dog park" is not the dog park called Puddingstone). */
  const tailIn = (t, qw, nq, complete) => {
    for (let b = 0; b < nq; b++) if (t === qw[b] || t === ABBR[qw[b]] || (!complete && b === nq - 1 && t.startsWith(qw[b]))) return true;
    return false;
  };
  /** W176 searchrank: whether the query's `required` words, in order, are one of entry `e`'s other names ("southie": South Boston). */
  const otherIs = (e, qw, nq, required, complete) => {
    const nr = popcount(required);
    return others.get(e).some((ws) => {
      if (ws.length !== nr) return false;
      for (let b = 0, k = 0; b < nq; b++) {
        if (!(required & (1 << b))) continue;
        const w = qw[b], t = ws[k++];
        if (t !== w && t !== ABBR[w] && !(!complete && b === nq - 1 && !(wholeBits & (1 << b)) && t.startsWith(w) && w.length >= 0.57 * t.length)) return false; // being typed, not a word of its own ("broad": not Broadway)
      }
      return true;
    });
  };
  /** W183 search3: whether the query's `required` words, in order, start one of entry `e`'s other names, the last perhaps being typed ("artis": the Fort's
   *  "Artisans Asylum"), as its own name would */
  const otherStarts = (e, qw, nq, required, complete) => others.get(e).some((ws) => {
    for (let b = 0, k = 0; b < nq; b++) {
      if (!(required & (1 << b))) continue;
      const w = qw[b], t = ws[k++];
      if (t === undefined || (t !== w && t !== ABBR[w] && !(!complete && b === nq - 1 && t.startsWith(w) && w.length >= 0.57 * t.length))) return false; // most of it typed, as otherIs ("metro" is no Gerrior Square, once Metropolitan Square)
    }
    return true;
  });
  /** W183 search3: whether words `ws` start phrase `ph`, the last begun only ("post o": Post office; not "school s": Driving school) */
  const begins = (ws, ph) => ws.length <= ph.length && ws.every((w, j) => (j < ws.length - 1 ? ph[j] === w : ph[j].startsWith(w)));
  const classIs = (c, qw, nq, begun = false) => (classSets[c] ??= findsOf(c).map((ws) => new Set(ws))).some((set) => set.size === nq && qw.slice(0, nq).every((w) => set.has(w) || singulars(w).some((s) => set.has(s)))) || (begun && findsOf(c).some((ph) => ph.length === nq && begins(qw.slice(0, nq), ph))); // W73 plan; W181 searchrank2: any of its words (CLASS_WORDS), a plural too ("pharmacies"); W183 search3: begun, the last of several words only begun ("air p", "post o"), as a kind's

  /** Names matching the words in `qw`; returns [{e, score}] sorted best first. */
  function match(qw, nearXY, opts) {
    const touched = [];
    const nq = Math.min(qw.length, MAX_WORDS);
    let required = 0, optionalBits = 0;
    const kmask = new Uint16Array(kinds.length), kexact = new Uint16Array(kinds.length), kqual = new Float32Array(kinds.length * MAX_WORDS);
    for (let b = 0; b < nq; b++) {
      const w = qw[b], last = b === nq - 1 && !opts.complete;
      if (OPTIONAL.has(w) && nq > 1) optionalBits |= 1 << b;
      else required |= 1 << b;
      // One or two letters alone match names that start with them, not every "Street".
      qn = nq; // W176 searchrank
      markWord(w, b, last, touched, kindBits(w, b, kmask, kqual, kexact) || kindStart(w), nq === 1 && w.length <= 2, qw.slice(0, nq).some((v, c) => c !== b && !OPTIONAL.has(v)) ? 3 : 4, opts.whole); // W181 searchrank2; whole, a corner's first street
    }
    // W183 search3 (SPEC §319): a kind's words, the last only begun ("black h", "temple of kn", "bike sh"): that kind's, as when typed whole
    const restBits = required & ~(1 << (nq - 1)), begun = !opts.complete && !!restBits; // and a class's (classIs)
    if (!opts.complete && restBits && required & (1 << (nq - 1))) {
      const rw = qw.slice(0, nq).filter((_, b) => required & (1 << b)); // one of its phrases, from its first word ("park p" is no park's: Park Plaza)
      for (let id = 0; id < kinds.length; id++) {
        if (!kindPhrases[id].some((ph) => begins(rw, ph))) continue;
        kmask[id] |= 1 << (nq - 1); kexact[id] |= 1 << (nq - 1);
        kqual[id * MAX_WORDS + nq - 1] = 0.8;
      }
    }
    // Entries of a kind the query names are candidates even when no word of their name matched,
    // if the kind's words and town names cover the whole query ("tardis", "starpath somerville";
    // not "starpath mass", whose streets "mass" has found already).
    const cands = touched.slice();
    let townBits = 0;
    for (const e of touched) if (kind[e] === systemKind || kind[e] === quadrantKind) townBits |= mask[e];
    for (let k = 0; k < kinds.length; k++) {
      if (!kmask[k] || ((kmask[k] | townBits | optionalBits) & required) !== required) continue;
      if (byKind[k].length > 3000 && kexact[k] !== kmask[k]) continue; // "star" is not yet every starpath
      for (const e of byKind[k]) if (mask[e] === 0) cands.push(e);
    }
    const out = new TopK(opts.keep);
    const classQ = !optionalBits && !!required && whats.some((_, c) => classIs(c, qw, nq, begun)); // W73 plan: the query is a class's words ("pharmacy", "church")
    wholeBits = 0; // W176 searchrank
    for (let b = 0; b < nq; b++) if (vocab[lowerBound(vocab, qw[b])] === qw[b]) wholeBits |= 1 << b; // W176 searchrank
    const kindQ = classQ || kexact.some((b) => b && (b & required) === required); // W176 searchrank: the query is a kind's or a class's words ("post office", "park"): an exact name only literally
    const kindOk = opts.kinds;
    const lastBit = 1 << (nq - 1), typing = !opts.complete && qw.slice(0, nq).filter((_, b) => required & (1 << b)).join("").length >= 4; // W183 search3: from 4 letters, as a typo ("wel" is half the chart), but "the" and the like ("the h")
    const cosNear = nearXY ? Math.cos((nearXY[1] / 1e5) * Math.PI / 180) : 1;
    for (const e of cands) {
      const k = kind[e];
      if (kindOk && !kindOk.has(k)) continue;
      const tb = town[e] >= 0 ? mask[town[e]] : 0, qb = quad[e] >= 0 ? mask[quad[e]] : 0;
      const nb = mask[e], kb = kmask[k];
      if (((nb | kb | tb | qb | optionalBits) & required) !== required) continue;
      if (!(nb & required) && !(kb & required)) continue;
      let q = 0, named = 0;
      const other = !kindQ && others.has(e) && otherIs(e, qw, nq, required, opts.complete); // W176 searchrank: the query is its other name, as good as its name
      const head = !optionalBits && (ends[e] & required) === required; // W181 searchrank2
      const headWord = head && !kindQ && nq === 1 && (qual[e * MAX_WORDS] >= 0.99 || qual[e * MAX_WORDS] < 0.5); // W181 searchrank2: one word, whole or a typo of it, the name's last: what it is ("arboretum": Arnold Arboretum, before Arboretum Road, named after it; not "bea": Magazine Beach)
      const ownLead = (!optionalBits && (lead[e] & required) === required) || other || head; // W176 searchrank: other; or the name ends with the query, its head ("pizza": Dragon Pizza, as Pizza Project; "dog park")
      const otherLead = !ownLead && !kindQ && !optionalBits && others.has(e) && otherStarts(e, qw, nq, required, opts.complete); // W183 search3: an other name that starts with the query, as its own would, but a street's lead (an old name: "metro" is no Gerrior Square, once Metropolitan Square, 11 km off)
      const leads = ownLead || otherLead; // W183 search3
      const halfTyped = typing && nb & lastBit && !(typed[e] & lastBit); // W183 search3: its name half typed, the last word only a word's start (or a typo of one)
      const byName = classQ && (kexact[k] & required) !== required && !(cls[e] >= 0 && classIs(cls[e], qw, nq, begun)) && wholeName(e, nq) && (cls[e] >= 0 || KIND_WEIGHT[kinds[k]] === undefined); // W73 plan: a place (not a street, a square or a stop) with a class's words in its name: a CVS Pharmacy, a church that isn't a church building
      const station = kindQ && kinds[k] === "comet_station" && !optionalBits && (kexact[k] & required) !== required && isExact(e, required, kb, qw, nq, opts.complete, false); // W192 airportsearch: a T station by its name, a kind's word too ("airport": Airport Station, with the airports), as one of the kind, exact
      const kindAll = station || (!optionalBits && !!required && ((kexact[k] & required) === required || (classQ && cls[e] >= 0 && classIs(cls[e], qw, nq, begun)) || byName)); // W192 airportsearch: station; W73 plan: the query is the kind's own word ("cafe", "water", "park"), or a class's ("air pump", "pharmacy"): its nearest first, before names that only start with the word
      for (let b = 0; b < nq; b++) {
        const bit = 1 << b;
        let nqv = nb & bit ? qual[e * MAX_WORDS + b] : 0;
        if (leads && nqv >= 0.55) nqv = 1; // a word being typed is as good as the whole word, at the start of a name
        const kqv = kb & bit ? (kindAll ? 1 : kqual[k * MAX_WORDS + b]) : 0; // W73 plan: kindAll
        const tqv = (tb | qb) & bit ? 0.7 * Math.max(tb & bit ? qual[town[e] * MAX_WORDS + b] : 0, qb & bit ? qual[quad[e] * MAX_WORDS + b] : 0) : 0;
        const best = Math.max(nqv, kqv, tqv);
        if (nqv && nqv >= best) named++;
        q += optionalBits & bit ? best * 0.2 : best;
      }
      const nreq = nq - popcount(optionalBits);
      const quality = kindAll || other ? 1 : q / Math.max(1, nreq); // W73 plan: kindAll, the words are its kind's or its class's
      const cover = leads || kindAll || other ? 1 : nwords[e] ? Math.min(1, named / nwords[e]) : 0; // W73 plan: kindAll
      const kn = kinds[k];
      let score = 10 * quality + 2.5 * cover + ((first[e] || other || headWord) && !kindAll ? 1 : 0) + (KIND_WEIGHT[kn] ?? 1) + 0.5 * rank[e] + (kindAll || homes.has(cls[e]) ? 0 : 0.5 * (size[e] ?? 0)); // W73 plan: kindAll, by distance, not by a name that starts with the word; W176 searchrank: a stop's or spot's size (index v8's sparse size, 1 to 3 from 0.5, 5 and 50 ha), but for a kind's nearest; W181 searchrank2: headWord, as a first word
      if (kindAll) score += LEAD_PLACE + 3 - (byName ? 1 : 0); // W73 plan: above a name that leads with the word, so distance decides among the kind; one of the class first, when it is not much farther
      else if (leads) score += LEAD_KINDS.has(kn) && !otherLead ? LEAD_PLACE : LEAD; // W183 search3: otherLead
      if (other || station || (!kindAll && isExact(e, required, kb, qw, nq, opts.complete, kindQ))) score += EXACT + (!STREET_KINDS.has(kn) && kexact[k] & required ? LEAD_PLACE - LEAD : 0); // W176 searchrank: the name is the query ("Prudential Center" before "Prudential Center Plaza"); of a kind's word, literally; W181 searchrank2: and the more when the query says what it is, a word of its kind's, as a square leads ("charles river": the river, before Charles River Square, the square called Charles River; "dunkin donuts": a Dunkin'), not a street's, whose word nearly every street's name has, as `short`
      if (!doc.name[e]) score -= 0.5; // an unnamed tardis is found by its kind only
      const knownSize = known[e] && !kindAll && !homes.has(cls[e]) && !LEAD_KINDS.has(kn) ? 0.5 * WIKI : 0; // W191 search4 (SPEC §336): known beyond its street, WIKI steps of size more, but for a kind that leads already (every station has a tag)
      score += knownSize; // W191 search4
      const typedSize = halfTyped && !kindAll && !homes.has(cls[e]) ? 0.5 * sizeOf(e) + knownSize : 0; // W191 search4: knownSize, again; W183 search3: half typed, a place's size counts again, the more a rider may mean it before its name is typed (the Arnold Arboretum, the Minuteman Bikeway)
      score += typedSize; // W183 search3
      let dist = null, at = null;
      if (nearXY) {
        if (!hasPts[e]) dist = Math.hypot((x[e] - nearXY[0]) * cosNear, y[e] - nearXY[1]) * 1.1132;
        else { const [px, py, d] = nearestPoint(e, nearXY[0], nearXY[1], cosNear); dist = d; at = [px, py]; } // W181 searchrank2: a path's or a river's nearest point
        score -= 1.2 * Math.log2(1 + dist / 1000);
        if (dist > GROW_M) score -= (typedSize + knownSize) * (1 - GROW_M / dist); // W191 search4: and knownSize; W183 search3: less beyond GROW_M, so a big pond 26 km off is not first for "sprin", before the street she is spelling 3 km off
      }
      if (score > out.floor) out.add({ e, score, dist, at });
    }
    for (const e of touched) {
      mask[e] = 0;
      first[e] = 0;
      lead[e] = 0;
      ends[e] = 0; // W176 searchrank
      own[e] = 0; // W176 searchrank
      typed[e] = 0; // W183 search3
      qual.fill(0, e * MAX_WORDS, e * MAX_WORDS + MAX_WORDS);
    }
    return out.items;
  }

  function result(r) {
    const e = r.e;
    const o = { name: (kindName(e) === DOCK ? dockName(nameOf(e)) : nameOf(e)) || plainUnnamed(e), lingo_name: lingoName(e), kind: kindName(e), // W21 entry
      lonlat: [x[e] / 1e5, y[e] / 1e5], place: placeOf(e) };
    if (r.at) o.go = [r.at[0] / 1e5, r.at[1] / 1e5]; // W181 searchrank2: a path's or a river's nearest point, where a course to it goes and its distance is to; lonlat stays its own, the place a star or a recent keeps
    if (cls[e] >= 0) { // W38 places: "Restaurant · Beacon St, Somerville"
      const t = town[e] >= 0 ? doc.name[town[e]] : null, at = street[e] ? [shortStreet(street[e]), t].filter(Boolean).join(", ") : o.place;
      o.place = [shown[cls[e]] && whatOf(e), at].filter(Boolean).join(" · "); // W173 pumps: shown
    } else if (street[e]) o.address = street[e]; // a chain's place, by its street (index v3)
    if (oh[e]) o.oh = oh[e]; // W77 data
    if (r.dist != null) o.distance_m = Math.round(r.dist);
    if (oh[e]) o.oh = oh[e]; // W77 hours
    if (packOf[e]) o.pack = packOf[e]; // W82 packui: the gazetteer's map pack for the place
    return o;
  }

  /** W155 addrnear (SPEC §274): a number the street doesn't have, from its known ones on the same side: between the two that
   *  bracket it (at most 100 numbers and 400 m apart), in proportion, else at one within 40 numbers; else null. */
  function approxHouse(hs, n) { // W155 addrnear
    let lo = null, hi = null, nearest = null; // W155 addrnear
    for (const h of hs) { // W155 addrnear
      if (!/^\d+$/.test(h[0])) continue; // W155 addrnear: 12A, 206-208: not a point on the line of numbers
      const v = +h[0]; // W155 addrnear
      if (v % 2 !== n % 2) continue; // W155 addrnear
      if (v < n && (!lo || v > +lo[0])) lo = h; // W155 addrnear
      if (v > n && (!hi || v < +hi[0])) hi = h; // W155 addrnear
      if (!nearest || Math.abs(v - n) < Math.abs(+nearest[0] - n)) nearest = h; // W155 addrnear
    } // W155 addrnear
    if (lo && hi && +hi[0] - +lo[0] <= 100 && metresE5(lo[1], lo[2], hi[1], hi[2]) <= 400) { // W155 addrnear
      const t = (n - +lo[0]) / (+hi[0] - +lo[0]); // W155 addrnear
      return { x: Math.round(lo[1] + t * (hi[1] - lo[1])), y: Math.round(lo[2] + t * (hi[2] - lo[2])), near: null }; // W155 addrnear
    } // W155 addrnear
    return nearest && Math.abs(+nearest[0] - n) <= 40 ? { x: nearest[1], y: nearest[2], near: nearest[0] } : null; // W155 addrnear
  } // W155 addrnear

  function addressResults(num, rest, nearXY, opts, cap = null) { // W155 addrnear: cap, the best other match's score, when a missing number may be guessed (it came first)
    const streets = match(rest, nearXY, { ...opts, kinds: streetKindIds, keep: 8 });
    const out = [], missing = [], approx = []; // W155 addrnear: approx
    const n0 = num.toLowerCase();
    for (const s of streets) {
      const hs = housesOf(s.e);
      if (!hs) continue;
      // The number is finished once the street follows it: 12 finds 12, 12A and 12-14, never 120.
      let exact = null;
      const near = [];
      for (const h of hs) {
        const hn = h[0].toLowerCase();
        if (hn === n0) { exact = h; break; }
        if (hn.startsWith(n0) && !/\d/.test(hn[n0.length]) && near.length < 2) near.push(h);
      }
      if (!exact && !near.length) {
        const nn = parseInt(n0, 10), a = cap !== null && nn > 0 ? approxHouse(hs, nn) : null; // W155 addrnear: a leading number only (not "Route 16", "Pier 4"), never 0
        if (!a) { missing.push(s); continue; }
        const street = nameOf(s.e), town = placeOf(s.e)?.split(", ").pop(), num = n0.toUpperCase(); // W155 addrnear: 12A, as OSM writes it
        const dist = nearXY ? metresE5(nearXY[0], nearXY[1], a.x, a.y) : null; // W155 addrnear
        approx.push({ s, score: s.score + (a.near ? 0.5 : 1) + KIND_WEIGHT.address - (KIND_WEIGHT[kindName(s.e)] ?? 1), dist, e: s.e, // W155 addrnear
          res: { name: `${num} ${street}`, lingo_name: `${num} ${lingoName(s.e)}`, kind: "address", lonlat: [a.x / 1e5, a.y / 1e5], // W155 addrnear
            address: town ? `${num} ${street}, ${town}` : `${num} ${street}`, // W155 addrnear
            place: a.near ? `near ${a.near} ${street}` : "approximate", approx: true, // W155 addrnear: in words, on the row's second line; the town is in the address
            ...(dist != null ? { distance_m: Math.round(dist) } : {}) } }); // W155 addrnear
        continue; // W155 addrnear
      }
      const own = houses.get(s.e)[3]; // W176 searchindex: the places each number is the address of (index v8's addr rows)
      for (const [h, bonus] of exact ? [[exact, 3]] : near.map((h) => [h, 2])) {
        const street = nameOf(s.e);
        const hx = h[1], hy = h[2];
        const dist = nearXY ? metresE5(nearXY[0], nearXY[1], hx, hy) : null;
        const place = placeOf(s.e);
        const ps = own?.[h[0]]; // W176 searchindex: the places at this number, the biggest first
        if (ps?.length === 1) { // W176 searchindex: the address of one place is that place, its number in its row, and no bare number beside it
          const p = ps[0], pd = nearXY ? metresE5(nearXY[0], nearXY[1], x[p], y[p]) : null, o = result({ e: p, dist: pd }), t = town[p] >= 0 ? doc.name[town[p]] : null; // W176 searchindex
          if (cls[p] >= 0) o.place = [shown[cls[p]] && whatOf(p), [`${h[0]} ${shortStreet(street)}`, t].filter(Boolean).join(", ")].filter(Boolean).join(" · "); // W176 searchindex: "Restaurant · 21 Nichols Ave, Watertown"
          else o.address = `${h[0]} ${street}`; // W176 searchindex: a stop's, as a chain's
          out.push({ score: s.score + bonus + KIND_WEIGHT.address - (KIND_WEIGHT[kindName(s.e)] ?? 1), dist: pd, e: p, res: o }); // W176 searchindex
          continue; // W176 searchindex
        }
        out.push({
          score: s.score + bonus + KIND_WEIGHT.address - (KIND_WEIGHT[kindName(s.e)] ?? 1),
          dist, e: s.e,
          res: { name: `${h[0]} ${street}`, lingo_name: `${h[0]} ${lingoName(s.e)}`, kind: "address",
            lonlat: [hx / 1e5, hy / 1e5], address: place ? `${h[0]} ${street}, ${place.split(", ").pop()}` : `${h[0]} ${street}`,
            place: ps && (doc.size?.[ps[0]] ?? 0) > (doc.size?.[ps[1]] ?? 0) ? [nameOf(ps[0]), place].filter(Boolean).join(" · ") : place, ...(dist != null ? { distance_m: Math.round(dist) } : {}) }, // W176 searchindex: a building of several places, named by its biggest when it is bigger than the rest
        });
      }
    }
    // W155 addrnear: the guesses, in their order, after every number the index knows and every other place the words name; each
    // with its street just after it, a tap away when the guess is wrong
    const top = Math.min(cap ?? Infinity, ...out.map((r) => r.score)) - 0.01, shift = Math.max(0, ...approx.map((r) => r.score - top)); // W155 addrnear
    for (const { s, ...r } of approx) out.push({ ...r, score: r.score - shift }, { ...s, score: r.score - shift - 1e-6, res: null }); // W155 addrnear
    // No such number: offer the street itself, so the pilot can still set a course to it.
    if (!out.length) for (const s of missing) out.push({ ...s, score: s.score - 2, res: null });
    return out;
  }

  /** W181 searchrank2 (SPEC §318): the index's corners (`corner`: two street entries and a point each), and each street's, when first asked for. */
  let cornerIdx = null;
  const cornersOf = () => {
    if (cornerIdx) return cornerIdx;
    const c = doc.corner, m = c.a.length, ca = new Int32Array(m), cb = Int32Array.from(c.b), cx = new Int32Array(m), cy = new Int32Array(m);
    for (let i = 0, pa = 0, px = 0, py = 0; i < m; i++) { ca[i] = pa += c.a[i]; cx[i] = px += c.x[i]; cy[i] = py += c.y[i]; }
    const from = new Int32Array(n + 1);
    for (let i = 0; i < m; i++) { from[ca[i] + 1]++; from[cb[i] + 1]++; }
    for (let i = 0; i < n; i++) from[i + 1] += from[i];
    const at = new Int32Array(2 * m), fill = from.slice(0, n);
    for (let i = 0; i < m; i++) { at[fill[ca[i]]++] = i; at[fill[cb[i]]++] = i; }
    return (cornerIdx = { ca, cb, cx, cy, from, at });
  };
  /** W181 searchrank2: the corners of a query "X and Y" (& , at, /): the junctions of a street X's words match and one Y's do, nearest first among
   *  matches alike, each an address row named in the order typed ("Massachusetts Avenue & Prospect Street"), its town in its place, not its name (two lines at 320 px);
   *  none when the index has no corners. */
  function cornerResults(q, nearXY, opts, keep) {
    const m = columns.has("corner") && doc.corner?.a?.length ? CORNER.exec(q.trim()) : null; // W188 datastamps: columns
    if (!m) return [];
    const xw = words(m[1]).slice(0, MAX_WORDS), yw = words(m[2]).slice(0, MAX_WORDS);
    if (xw.join("").length < 2 || !yw.length) return []; // not "h&m"
    const plain = (r) => r.score + (r.dist != null ? 1.2 * Math.log2(1 + r.dist / 1000) : 0); // how well a street matched, less its distance
    const xs = match(xw, nearXY, { complete: true, whole: true, kinds: streetKindIds, keep: 60 }); // X is typed whole, its words not a word's start: "and" came after it ("ben & je": no Bennett Road)
    if (!xs.length) return [];
    const ys = new Map(match(yw, nearXY, { complete: opts.complete, kinds: streetKindIds, keep: 60 }).map((r) => [r.e, plain(r)]));
    const { ca, cb, cx, cy, from, at } = cornersOf(), out = [], cos = nearXY ? Math.cos((nearXY[1] / 1e5) * Math.PI / 180) : 1;
    const add = (r, b, c, qb) => {
      const dist = nearXY ? Math.hypot((cx[c] - nearXY[0]) * cos, cy[c] - nearXY[1]) * 1.1132 : null;
      const name = `${nameOf(r.e)} & ${nameOf(b)}`, place = placeOf(ca[c]);
      out.push({ e: r.e, b, dist, score: CORNER_FIRST + (plain(r) + qb) / 2 - (dist != null ? 1.2 * Math.log2(1 + dist / 1000) : 0),
        res: { name, lingo_name: `${lingoName(r.e)} & ${lingoName(b)}`, kind: "address", lonlat: [cx[c] / 1e5, cy[c] / 1e5],
          address: name, place, ...(dist != null ? { distance_m: Math.round(dist) } : {}) } });
    };
    const met = new Set(); // W183 search3: the pairs that meet
    for (const r of xs) {
      for (let p = from[r.e]; p < from[r.e + 1]; p++) {
        const c = at[p], b = ca[c] === r.e ? cb[c] : ca[c], qb = ys.get(b);
        if (qb === undefined) continue;
        met.add(r.e * n + b);
        add(r, b, c, qb);
      }
    }
    // W183 search3 (SPEC §319): two streets that never meet, joined by a street of LINK_M or less (Main Street ends at Sidney Street Extension, 53 m
    // from Mass Ave in Lafayette Square: "mass ave / main st"), meet at X's end of it
    for (const r of xs) {
      for (let p = from[r.e]; p < from[r.e + 1]; p++) {
        const c = at[p], z = ca[c] === r.e ? cb[c] : ca[c];
        if (ys.has(z)) continue;
        let short = true; // the link's every corner within LINK_M, not a cross street of blocks (Pinckney Street and Mount Vernon Street, a block apart)
        for (let p2 = from[z]; p2 < from[z + 1] && short; p2++) short = metresE5(cx[c], cy[c], cx[at[p2]], cy[at[p2]]) <= LINK_M;
        if (!short) continue;
        for (let p2 = from[z]; p2 < from[z + 1]; p2++) {
          const c2 = at[p2], b = ca[c2] === z ? cb[c2] : ca[c2];
          if (b !== r.e && ys.has(b) && !met.has(r.e * n + b)) add(r, b, c, ys.get(b));
        }
      }
    }
    out.sort((p, q) => q.score - p.score);
    // W183 search3: a road's frontage or service twin ("Commonwealth Avenue Frontage Road Westbound") at the road's corner with the same street, or at
    // its other twin's listed before it (Soldiers Field's two at Western Avenue), within FOLD_M, is that corner
    const twinOf = (s) => TWIN.exec(s)?.[1];
    const folded = (r, i) => [[r.e, r.b], [r.b, r.e]].some(([t, o]) => {
      const base = twinOf(nameOf(t)), ll = r.res.lonlat;
      return base && out.some((m, j) => j !== i && metresE5(m.res.lonlat[0] * 1e5, m.res.lonlat[1] * 1e5, ll[0] * 1e5, ll[1] * 1e5) <= FOLD_M && [[m.e, m.b], [m.b, m.e]].some(([u, v]) => {
        const s = nameOf(u), tb = twinOf(s);
        return nameOf(v) === nameOf(o) && (tb ? tb === base && j < i : s === base || s.startsWith(`${base} `));
      }));
    });
    const kept = [], byName = new Map(); // one row for a pair's corners within 300 m (a street that meets another twice nearby)
    for (const [i, r] of out.entries()) {
      const pair = [nameOf(r.e), nameOf(r.b)].sort().join("|"), ll = r.res.lonlat, near = byName.get(pair) || []; // in either order ("harvard and h": Harvard Street & Harvard Avenue, once)
      if (near.some((o) => metresE5(o[0] * 1e5, o[1] * 1e5, ll[0] * 1e5, ll[1] * 1e5) < 300) || folded(r, i)) continue; // W183 search3: folded
      byName.set(pair, [...near, ll]);
      kept.push(r);
      if (kept.length >= keep) break;
    }
    return kept;
  }

  const systemKind = kinds.indexOf("system"), quadrantKind = kinds.indexOf("quadrant");
  const streetKindIds = new Set(kinds.map((k, i) => (STREET_KINDS.has(k) ? i : -1)).filter((i) => i >= 0));

  /**
   * Search as you type. `near` is [lon, lat] or null. Options: limit (default 10); complete: true
   * when the query is finished (no prefix matching for its last word, as after Enter).
   */
  function search(q, near = null, { limit = 10, complete = false, scored: withScore = false } = {}) { // W82 packui: scored, each result's score, for mergeResults
    const qw = words(q).slice(0, MAX_WORDS);
    if (!qw.length) return [];
    const nearXY = near ? [Math.round(near[0] * 1e5), Math.round(near[1] * 1e5)] : null;
    const opts = { complete };
    const scored = match(qw, nearXY, { ...opts, keep: limit * 3 }).map((r) => ({ ...r, res: null }));
    if (qw.length > 1 && HOUSE.test(qw[0])) scored.push(...addressResults(qw[0], qw.slice(1), nearXY, opts, scored.length ? Math.max(...scored.map((r) => r.score)) : Infinity)); // W155 addrnear: guesses below the words' other places (none: no cap, so a guess keeps a finite score for mergeResults)
    else if (qw.length > 1 && HOUSE.test(qw[qw.length - 1])) {
      scored.push(...addressResults(qw[qw.length - 1], qw.slice(0, -1), nearXY, opts)); // "Elm St 12"
    }
    const corners = cornerResults(q, nearXY, opts, limit * 3); // W181 searchrank2: a corner, first, but after a place whose name is the query as typed ("Medford/Tufts", "Liberty & Main")
    if (corners.length) { const full = qw.join(" "); for (const r of scored) if (!r.res && words(doc.name[r.e]).join(" ") === full) r.score += 2 * CORNER_FIRST; scored.push(...corners); } // W181 searchrank2
    const dockId = kinds.indexOf(DOCK), dock = (r) => (!r.res && kind[r.e] === dockId ? 1 : 0); // W21 entry: docks last
    scored.sort((a, b) => dock(a) - dock(b) || b.score - a.score);
    const out = [], seen = new Set(), had = new Set(); // W176 searchindex: had, the places listed (an address row's entry is its street's)
    for (const r of scored) {
      if (!r.res && same[r.e] !== undefined) continue; // the same place again, as another kind (index v3)
      const o = r.res || result(r);
      if (o.kind !== "address") { if (had.has(r.e)) continue; had.add(r.e); } // W176 searchindex: a place found by its address and by its name, once
      const key = `${o.kind}|${o.name}|${o.place}|${Math.round(o.lonlat[0] * 500)}|${Math.round(o.lonlat[1] * 500)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (withScore) o.score = r.score; // W82 packui
      out.push(o);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** W54 course: the places of `want` kinds inside [w, s, e, n] (degrees), as search results, for the stops along a course. */
  function inBox(want, [w, s, e, nn]) {
    const out = [], x0 = Math.round(w * 1e5), x1 = Math.round(e * 1e5), y0 = Math.round(s * 1e5), y1 = Math.round(nn * 1e5); // W54 course
    for (const k of want) for (const i of byKind[kinds.indexOf(k)] || []) if (x[i] >= x0 && x[i] <= x1 && y[i] >= y0 && y[i] <= y1 && same[i] === undefined) out.push(result({ e: i })); // W54 course
    return out; // W54 course
  } // W54 course
  const withAir = []; for (let i = 0; i < n; i++) if (cls[i] >= 0 && !shown[cls[i]]) withAir.push(i); // W173 pumps: the repair stands and bike shops with a pump, which Air's choice lights too, as "air pump" finds them
  /** W112 kindsearch (SPEC §226): the `limit` places of `k` (a kind, or "spot" with a class's plain word `what`) nearest `near`. */
  function nearest(k, what, [lon, lat], limit = 8) { // W112 kindsearch
    const cos = Math.cos((lat * Math.PI) / 180), out = new TopK(limit); // W112 kindsearch
    const nx = Math.round(lon * 1e5), ny = Math.round(lat * 1e5); // W181 searchrank2
    for (const i of [...(byKind[kinds.indexOf(k)] || []), ...(k === "plasma" ? withAir : [])]) if ((!what || whatOf(i) === what) && same[i] === undefined) { const [px, py, d] = nearestPoint(i, nx, ny, cos); if (-d > out.floor) out.add({ e: i, score: -d, dist: d, at: hasPts[i] ? [px, py] : null }); } // W112 kindsearch; W173 pumps: withAir; W181 searchrank2: nearestPoint, a path's nearest point
    return out.items.map(result); // W112 kindsearch
  } // W112 kindsearch
  // W112 kindsearch: the index's kinds of place (with their KIND_WORDS) and the spots' classes (by their plain word), with how many of each, for completions
  const perWhat = new Map(), shopK = kinds.indexOf("luna"); for (let i = 0; i < n; i++) { const c = cls[i] ?? -1; if (c >= 0 && shown[c] && kind[i] !== shopK) perWhat.set(whats[c], (perWhat.get(whats[c]) || 0) + 1); } // W112 kindsearch: two classes of one word ("Post office") are one; W173 pumps: shown, as nearest() lights spots only; W181 searchindex2: no shop's class, so no kind chip lights nothing
  const choices = [...kinds.map((k, i) => ({ kind: k, n: byKind[i].length + (k === "plasma" ? withAir.length : 0), words: KIND_WORDS[k] })).filter((c) => c.n), ...[...perWhat].map(([what, n]) => ({ kind: "spot", what, n }))]; // W112 kindsearch; W173 pumps: Air's with withAir

  return {
    search, inBox, nearest, choices, // W54 course: inBox; W112 kindsearch: nearest, choices
    towns: new Set((byKind[systemKind] || []).map((e) => words(doc.name[e]).join(" "))), // W82 packui: its towns' names, as words() gives them
    size: n,
    houses: doc.stats?.houses ?? null,
    vocabulary: vocab.length,
    built: doc.built,
  };
}

/** W82 packui (SPEC §156): several indexes' results (search(..., { scored: true }) each), best score first (docks last), one entry per name
 *  within 100 m (the same street or square in the base's index and a pack's, at a cut) and one per town's name (a town past the
 *  base's edge is in its index too, at a point inside it), without their scores. */
export function mergeResults(lists, limit = 10) {
  const dock = (r) => (r.kind === DOCK ? 1 : 0); // W21 entry's rule: bike-share docks after every other kind
  const all = lists.flatMap((l, i) => l.map((r) => [i, r])).sort((a, b) => dock(a[1]) - dock(b[1]) || (b[1].score ?? 0) - (a[1].score ?? 0)), out = [], from = [];
  const same = (o, r) => o.name === r.name && ((o.kind === "system" && r.kind === "system") || metresE5(o.lonlat[0] * 1e5, o.lonlat[1] * 1e5, r.lonlat[0] * 1e5, r.lonlat[1] * 1e5) <= 100);
  for (const [i, r] of all) {
    if (out.some((o, k) => from[k] !== i && same(o, r))) continue; // another index's: an index's own are as its search() gave them
    const { score, ...o } = r;
    out.push(o);
    from.push(i);
    if (out.length >= limit) break;
  }
  return out;
}

/** W82 packui: a search of several indexes (the base's, then the stored packs') and the gazetteer's (or null), merged; a town or
 *  village named in full from the gazetteer just after the best match ("Worcester": the city, after Worcester Street and before
 *  the rest; "Harvard": Harvard Square, then the town). A town the base has (Natick, at a point inside it) is the base's; a stored
 *  pack's town named in full is the gazetteer's, in that slot (so "Worcester" still finds the city once its pack is stored). */
export function searchAll(indexes, gaz, q, near = null, opts = {}) {
  const o = { ...opts, scored: true }, limit = opts.limit ?? 10, key = (r) => words(r.name).join(" "), full = words(q).join(" ");
  const towns = indexes[0]?.towns || new Set(); // the base's: a pack's towns are past the base's edge, as the gazetteer's
  const g = gaz ? gaz.search(q, near, o).filter((r) => !(r.kind === "system" && towns.has(key(r)))) : [];
  const lists = indexes.map((x, i) => x.search(q, near, o).filter((r) => !(i && r.kind === "system" && key(r) === full && g.some((t) => key(t) === full))));
  const out = mergeResults([...lists, g.filter((r) => key(r) !== full)], limit);
  const near100 = (a, b) => metresE5(a.lonlat[0] * 1e5, a.lonlat[1] * 1e5, b.lonlat[0] * 1e5, b.lonlat[1] * 1e5) <= 100;
  const named = g.filter((r) => key(r) === full && !out.some((x) => x.name === r.name && near100(x, r))).map(({ score, ...r }) => r);
  const lead = out.length && out[0].kind !== DOCK && lists.some((l) => l.some((r) => r.lonlat === out[0].lonlat)); // an index's best (mergeResults keeps its lonlat), not the gazetteer's
  out.splice(lead ? 1 : 0, 0, ...named);
  return out.slice(0, limit);
}

const SHORT = { Street: "St", Avenue: "Ave", Road: "Rd", Boulevard: "Blvd", Parkway: "Pkwy", Square: "Sq" };
/** W38 places: a spot's street, as its second line gives it: "Beacon St". */
const shortStreet = (s) => s.replace(/\b(Street|Avenue|Road|Boulevard|Parkway|Square)$/, (w) => SHORT[w]);

/** Google's polyline encoding of signed integers (as build_index.py writes them). */
function polyline(str) {
  const out = [];
  for (let i = 0; i < str.length;) {
    let r = 0, sh = 0, b;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
    out.push(r & 1 ? ~(r >> 1) : r >> 1);
  }
  return out;
}

/** The best `k` of a stream of {score}, best first. */
class TopK {
  constructor(k) { this.k = k; this.items = []; this.floor = -Infinity; }
  add(r) {
    const a = this.items;
    let i = a.length;
    while (i > 0 && a[i - 1].score < r.score) i--;
    a.splice(i, 0, r);
    if (a.length > this.k) a.pop();
    if (a.length === this.k) this.floor = a[a.length - 1].score;
  }
}

function popcount(v) {
  let c = 0;
  for (; v; v &= v - 1) c++;
  return c;
}

function metresE5(x1, y1, x2, y2) {
  const k = Math.cos((y1 / 1e5) * Math.PI / 180);
  return Math.hypot((x2 - x1) * k, y2 - y1) * 1.1132;
}

let current = null;
/** Make `idx` (from load) the index that the module-level search() uses. */
export function use(idx) { current = idx; return idx; }
/** search(q, near, {limit}) on the index given to use(). */
/** W54 course: inBox(kinds, bbox) on the index given to use(). */
export function inBox(kinds, bbox) {
  if (!current) throw new Error("search: no index loaded (call use(load(doc, pack)))");
  return current.inBox(kinds, bbox);
}
export function search(q, near = null, opts = {}) {
  if (!current) throw new Error("search: no index loaded (call use(load(doc, pack)))");
  return current.search(q, near, opts);
}
