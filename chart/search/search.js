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
// A few plain words for kinds, beyond the lingo pack's own labels and cadet words.
const KIND_WORDS = {
  tardis: "restroom bathroom toilets", fuel_depot: "coffee", meat_repair: "hospital er emergency",
  comet_station: "station subway train t", space_dock: "bike shop bicycle", klingon_dock: "bluebikes bike share",
  black_hole: "rotary roundabout", steering_dampener: "bar pub", grenade_depot: "donut donuts doughnut",
  ice_cream: "ice cream", temple_of_knowledge: "library", st_outpost: "police", aed: "defibrillator",
  terraform: "park", heavy_nebula: "pond lake", asteroid_belt: "river", constellation: "square",
  coolant: "water fountain bubbler", plasma: "air pump compressed", // W67 water
  starpath: "street road", wormhole: "bike path", hyperspace_byway: "bridge", fort: "fort",
};
// How much each kind counts in the ranking, before its importance and distance.
const KIND_WEIGHT = {
  system: 3, quadrant: 2.5, constellation: 2.5, black_hole: 2, fort: 3.5, lore: 3, comet_station: 1.5,
  starpath: 1.5, wormhole: 1.8, transport_lane: 0.8, space_walk: 1, hyperspace_byway: 1.5,
  heavy_nebula: 1.5, asteroid_belt: 1.5, terraform: 1.2, address: 2.5, spot: 0, // W38 places: a spot after a stop of the same name, even one twice as far
};
const STREET_KINDS = new Set(["starpath", "wormhole", "transport_lane", "space_walk", "hyperspace_byway"]);
// W19: a name that starts with the query ranks above one that only contains it, and a square or a Comet
// station (or a black hole, the Fort, a lore place) above a street ("harvard": Harvard Square before Harvard Avenue). Among them, distance decides
// ("maxwell": Maxwells Green, nearby, before Maxwell Road across the chart).
const LEAD = 2, LEAD_PLACE = 4, LEAD_KINDS = new Set(["constellation", "comet_station", "black_hole", "fort", "lore"]);
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
  const n = doc.name.length;
  const kinds = doc.kinds;
  const kind = Uint8Array.from(doc.kind);
  const x = new Int32Array(n), y = new Int32Array(n);
  for (let i = 0, px = 0, py = 0; i < n; i++) { px += doc.x[i]; py += doc.y[i]; x[i] = px; y[i] = py; }
  const town = Int32Array.from(doc.town), quad = Int32Array.from(doc.quad), rank = Uint8Array.from(doc.rank);
  const alt = doc.alt || {}, base = doc.base || {}, street = doc.street || {}, same = doc.same || {};
  const packOf = doc.pack || []; // W82 packui: the gazetteer's (tools/data/gazetteer.py), per entry its map pack's id
  const oh = doc.oh || {}; // W77 data (index v8): a place's OSM opening_hours, as written, on the places that have one; W77 hours reads it
  const overrides = new Map((pack.overrides || []).map((o) => [o.name, o.base]));
  // W38 places (index v5): a spot's "group/class", and what it is in plain words ("Restaurant"), which it is found by too
  const cls = doc.cls || [], whats = (doc.classes || []).map((c) => spotWhat(c.split("/")[1], c.split("/")[0]));
  const whatOf = (i) => (cls[i] >= 0 ? whats[cls[i]] : "");

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
  const seen = new Map(); // names repeat ("Main Street", "Dunkin'"): split each once
  for (let i = 0; i < n; i++) {
    const name = doc.name[i];
    let wids = seen.get(name);
    if (!wids) seen.set(name, (wids = idsOf(indexWords(name))));
    nwords[i] = Math.min(wids.length, 255);
    addWords(i, wids, 0);
    if (wids.length > 1 && list[wids[0]] === "the") addWords(i, wids.slice(1), 0); // W21 entry: "pear" starts "The Pear", as W19's names that start with the query
    if (alt[i]) addWords(i, idsOf(indexWords(alt[i])), 7);
    if (cls[i] >= 0) addWords(i, (whatIds[cls[i]] ??= idsOf(indexWords(whats[cls[i]]))), 7); // W38 places: "pharmacy", "brewery"; W42 bench: split once a class
    const ob = overrides.get(name);
    if (ob) addWords(i, idsOf(indexWords(ob)), 7);
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
  kinds.forEach((k, id) => {
    const lk = pack.kinds[k] || {};
    const texts = [lk.label, lk.cadet, lk.plain_unnamed, lk.unnamed, KIND_WORDS[k], k === "address" ? "" : null];
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
  const byKind = kinds.map(() => []);
  for (let i = 0; i < n; i++) byKind[kind[i]].push(i);

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
  const qual = new Float32Array(n * MAX_WORDS);
  const first = new Uint8Array(n);

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
    return alts;
  }

  /** Mark every entry whose words match query word `bit`; returns how many vocabulary words matched. */
  function markWord(w, bit, last, touched, kindHit, firstOnly) {
    let hits = 0;
    const S = firstOnly ? start0 : start, P = firstOnly ? posts0 : posts;
    const mark = (v, q) => {
      for (let p = S[v]; p < S[v + 1]; p++) {
        const e = P[p] >> 3, pos = P[p] & 7;
        if (mask[e] === 0) touched.push(e);
        mask[e] |= 1 << bit;
        const slot = e * MAX_WORDS + bit;
        const qq = pos === 7 ? q * 0.85 : q; // other names (alt_name, the lingo override) count a little less
        if (qq > qual[slot]) qual[slot] = qq;
        if (pos === 0 && bit === 0) first[e] = 1;
        if (pos === bit) lead[e] |= 1 << bit;
      }
    };
    // Each vocabulary word once, at the best quality any alternative gives it ("st" and "street").
    const best = new Map();
    const offer = (v, q) => { if (!(best.get(v) >= q)) best.set(v, q); };
    for (const [alt, prefix, q] of alternatives(w, last)) {
      let v = lowerBound(vocab, alt);
      if (v < vocab.length && vocab[v] === alt) { offer(v, q); v++; }
      if (!prefix) continue;
      // Prefixes count for less the more of the word is left untyped; one letter only as the last word.
      if (alt.length < 2 && !last) continue;
      for (; v < vocab.length && vocab[v].startsWith(alt); v++) offer(v, q * (0.55 + 0.35 * (alt.length / vocab[v].length)));
    }
    for (const [v, q] of best) { mark(v, q); hits++; }
    if (hits === 0 && !kindHit && w.length >= 4) {
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
    // The word as typed only: "st" is a street in a name, not every starpath.
    for (const [alt, prefix] of [[w, true]]) {
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
  const classIs = (c, qw, nq) => { const set = (classSets[c] ??= new Set(indexWords(whats[c]))); return set.size === nq && qw.slice(0, nq).every((w) => set.has(w)); }; // W73 plan

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
      markWord(w, b, last, touched, kindBits(w, b, kmask, kqual, kexact), nq === 1 && w.length <= 2);
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
    const classQ = !optionalBits && !!required && whats.some((_, c) => classIs(c, qw, nq)); // W73 plan: the query is a class's words ("pharmacy", "church")
    const kindOk = opts.kinds;
    const cosNear = nearXY ? Math.cos((nearXY[1] / 1e5) * Math.PI / 180) : 1;
    for (const e of cands) {
      const k = kind[e];
      if (kindOk && !kindOk.has(k)) continue;
      const tb = town[e] >= 0 ? mask[town[e]] : 0, qb = quad[e] >= 0 ? mask[quad[e]] : 0;
      const nb = mask[e], kb = kmask[k];
      if (((nb | kb | tb | qb | optionalBits) & required) !== required) continue;
      if (!(nb & required) && !(kb & required)) continue;
      let q = 0, named = 0;
      const leads = !optionalBits && (lead[e] & required) === required;
      const byName = classQ && (kexact[k] & required) !== required && !(cls[e] >= 0 && classIs(cls[e], qw, nq)) && wholeName(e, nq) && (cls[e] >= 0 || KIND_WEIGHT[kinds[k]] === undefined); // W73 plan: a place (not a street, a square or a stop) with a class's words in its name: a CVS Pharmacy, a church that isn't a church building
      const kindAll = !optionalBits && !!required && ((kexact[k] & required) === required || (classQ && cls[e] >= 0 && classIs(cls[e], qw, nq)) || byName); // W73 plan: the query is the kind's own word ("cafe", "water", "park"), or a class's ("air pump", "pharmacy"): its nearest first, before names that only start with the word
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
      const quality = kindAll ? 1 : q / Math.max(1, nreq); // W73 plan: kindAll, the words are its kind's or its class's
      const cover = leads || kindAll ? 1 : nwords[e] ? Math.min(1, named / nwords[e]) : 0; // W73 plan: kindAll
      const kn = kinds[k];
      let score = 10 * quality + 2.5 * cover + (first[e] && !kindAll ? 1 : 0) + (KIND_WEIGHT[kn] ?? 1) + 0.5 * rank[e]; // W73 plan: kindAll, by distance, not by a name that starts with the word
      if (kindAll) score += LEAD_PLACE + 3 - (byName ? 1 : 0); // W73 plan: above a name that leads with the word, so distance decides among the kind; one of the class first, when it is not much farther
      else if (leads) score += LEAD_KINDS.has(kn) ? LEAD_PLACE : LEAD;
      if (!doc.name[e]) score -= 0.5; // an unnamed tardis is found by its kind only
      let dist = null;
      if (nearXY) {
        dist = Math.hypot((x[e] - nearXY[0]) * cosNear, y[e] - nearXY[1]) * 1.1132;
        score -= 1.2 * Math.log2(1 + dist / 1000);
      }
      if (score > out.floor) out.add({ e, score, dist });
    }
    for (const e of touched) {
      mask[e] = 0;
      first[e] = 0;
      lead[e] = 0;
      qual.fill(0, e * MAX_WORDS, e * MAX_WORDS + MAX_WORDS);
    }
    return out.items;
  }

  function result(r) {
    const e = r.e;
    const o = { name: (kindName(e) === DOCK ? dockName(nameOf(e)) : nameOf(e)) || plainUnnamed(e), lingo_name: lingoName(e), kind: kindName(e), // W21 entry
      lonlat: [x[e] / 1e5, y[e] / 1e5], place: placeOf(e) };
    if (cls[e] >= 0) { // W38 places: "Restaurant · Beacon St, Somerville"
      const t = town[e] >= 0 ? doc.name[town[e]] : null, at = street[e] ? [shortStreet(street[e]), t].filter(Boolean).join(", ") : o.place;
      o.place = [whatOf(e), at].filter(Boolean).join(" · ");
    } else if (street[e]) o.address = street[e]; // a chain's place, by its street (index v3)
    if (oh[e]) o.oh = oh[e]; // W77 data
    if (r.dist != null) o.distance_m = Math.round(r.dist);
    if (oh[e]) o.oh = oh[e]; // W77 hours
    if (packOf[e]) o.pack = packOf[e]; // W82 packui: the gazetteer's map pack for the place
    return o;
  }

  function addressResults(num, rest, nearXY, opts) {
    const streets = match(rest, nearXY, { ...opts, kinds: streetKindIds, keep: 8 });
    const out = [], missing = [];
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
      if (!exact && !near.length) { missing.push(s); continue; }
      for (const [h, bonus] of exact ? [[exact, 3]] : near.map((h) => [h, 2])) {
        const street = nameOf(s.e);
        const hx = h[1], hy = h[2];
        const dist = nearXY ? metresE5(nearXY[0], nearXY[1], hx, hy) : null;
        const place = placeOf(s.e);
        out.push({
          score: s.score + bonus + KIND_WEIGHT.address - (KIND_WEIGHT[kindName(s.e)] ?? 1),
          dist, e: s.e,
          res: { name: `${h[0]} ${street}`, lingo_name: `${h[0]} ${lingoName(s.e)}`, kind: "address",
            lonlat: [hx / 1e5, hy / 1e5], address: place ? `${h[0]} ${street}, ${place.split(", ").pop()}` : `${h[0]} ${street}`,
            place, ...(dist != null ? { distance_m: Math.round(dist) } : {}) },
        });
      }
    }
    // No such number: offer the street itself, so the pilot can still set a course to it.
    if (!out.length) for (const s of missing) out.push({ ...s, score: s.score - 2, res: null });
    return out;
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
    if (qw.length > 1 && HOUSE.test(qw[0])) scored.push(...addressResults(qw[0], qw.slice(1), nearXY, opts));
    else if (qw.length > 1 && HOUSE.test(qw[qw.length - 1])) {
      scored.push(...addressResults(qw[qw.length - 1], qw.slice(0, -1), nearXY, opts)); // "Elm St 12"
    }
    const dockId = kinds.indexOf(DOCK), dock = (r) => (!r.res && kind[r.e] === dockId ? 1 : 0); // W21 entry: docks last
    scored.sort((a, b) => dock(a) - dock(b) || b.score - a.score);
    const out = [], seen = new Set();
    for (const r of scored) {
      if (!r.res && same[r.e] !== undefined) continue; // the same place again, as another kind (index v3)
      const o = r.res || result(r);
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

  return {
    search, inBox, // W54 course: inBox
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
