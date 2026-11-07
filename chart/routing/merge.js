// W81 packroute: routing across the base and the map packs (SPEC §153). Each pack ships its own graph; a trip loads the
// base's and the packs its box touches (packsFor), merged into one graph in the router's own format (mergeGraphs), so
// `new Router(buffer)` is unchanged.
//
//   mergeGraphs([base, central])          -> ArrayBuffer, a graph file (worker.js: { type: "graphs", buffers })
//   packsFor({ from, to, vias }, packs)   -> ["central", ...], the ids of the packs whose bounds the trip's box plus PAD_M touches
//
// A way that crosses a cut is in both graphs whole (build_graph.py), so a junction of one graph is joined to another's
// at the same stored coordinates (1e-6 degrees), and an edge an earlier graph already has (the same ends, length to
// 0.1 m and name) is kept once, the earlier graph's. Junctions within one graph are never joined to each other (twins
// at one point join an earlier graph's twins in order). The
// earlier graph's facts win at a joined junction (its height and flags). Only the few joined junctions and dropped edges
// are kept in lists (`numbering`); the rest is copied in runs straight into the file it returns, so its ArrayBuffers are
// the merged graph's own size and a hash table of the earlier graphs' junctions (base and central: 42.1 MB and 2.1 MB).
// The name index widens from u2 to u4 when the names pass 65,536 (the base and the six packs: 63,744); Router reads either.

import { TYPES, M_PER_DEG, N_JUNK, readSections } from "./graphfile.js"; // W152 chart: router.js's, without loading it on the page

const JUNCTION = ["elev_dm", "node_flags"]; // copied with each new junction (lon and lat are its key)
const EDGE = ["len", "cost_fwd", "cost_rev", "curve", "cls", "bike", "flags", "bearing_start", "bearing_end", "lanes", "bike_side"]; // copied with each kept edge
const MAPPED = ["lon", "lat", "from", "to", "name", "shape0", "shape", "names", "turn_lanes", "r_from", "r_via", "r_to", "r_only",
  "tl_dir", "tl_str", "asl", "wait_dir", "wait_kind", "tr_node", "tr_bear"];
const OPTIONAL = ["lit", "comfort_dir"]; // W105 night: edge sections a graph may lack (a pack built before them): zero in the merged graph's edges from it; W140 dircomfort: comfort_dir (0, unknown)
const FAMILY = (v) => (v === 4 ? 3 : v); // W140 dircomfort: version 4 only adds comfort_dir, an OPTIONAL one, so a version 3 pack merges with a version 4 base (and no later version)
EDGE.push(...OPTIONAL); // W105 night
const KNOWN = new Set([...JUNCTION, ...EDGE, ...MAPPED]);
export const PAD_M = 5000; // packsFor: the trip's box grows this much each way

/** A graph file's header and sections, as views on its buffer (router.js's reading). */
function open(buf) {
  const { version, h, s } = readSections(buf, "SCRG", "routing graph");
  const strs = (u8) => (u8?.length ? new TextDecoder().decode(u8).split("\n") : []);
  return { version, h, s, names: strs(s.names), tl: strs(s.turn_lanes) };
}

/** A hash of a junction's stored coordinates, for an open-addressed table of `mask + 1` slots. */
const hash = (lon, lat, mask) => {
  let x = Math.imul(lon, 0x9e3779b1) ^ Math.imul(lat ^ (lat >>> 15), 0x85ebca77);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) & mask;
};

/**
 * A graph's junctions or edges numbered in the merged graph: each new one from `start` on, in order, unless it is one of
 * the few in `at` (sorted: joined to, or the same as, an earlier graph's), which maps to `to`.
 */
function numbering(start, at, to) {
  return (i) => {
    let lo = 0, hi = at.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (at[m] < i) lo = m + 1; else hi = m; }
    return at[lo] === i ? to[lo] : start + i - lo;
  };
}

/** The runs [from, to) of 0..n - 1 between the items in `at` (sorted): the new ones, copied whole. */
function runs(n, at) {
  const out = [];
  let i0 = 0;
  for (const i of [...at, n]) { if (i > i0) out.push([i0, i]); i0 = i + 1; }
  return out;
}

/**
 * One graph from several: the junctions joined by their stored coordinates, an edge present in two graphs kept once.
 * @param {ArrayBuffer[]} buffers graph files of one version and one set of sections, the base's first
 * @returns {ArrayBuffer} a graph file
 */
export function mergeGraphs(buffers) {
  if (buffers.length === 1) return buffers[0];
  if (!buffers.length || buffers.length > 127) throw new Error(`can't merge ${buffers.length} graphs`);
  const gs = buffers.map(open), g0 = gs[0], order = Object.keys(g0.h.sections);
  for (const k of order) if (!KNOWN.has(k)) throw new Error(`no merge rule for section ${k}`);
  for (const g of gs) {
    const ks = Object.keys(g.h.sections).filter((k) => !OPTIONAL.includes(k)), k0 = order.filter((k) => !OPTIONAL.includes(k)); // W105 night: OPTIONAL
    if (FAMILY(g.version) !== FAMILY(g0.version) || ks.length !== k0.length || ks.some((k) => !g0.h.sections[k])) throw new Error("graphs of different versions"); // W105 night: k0
    if (g.s.lon.length >= 1 << 24) throw new Error("a graph over 16 M junctions");
  }

  // junctions: each graph's looked up among the earlier graphs' (a table of (graph << 24 | index), -1 empty), then added
  let slots = 1;
  while (slots < 1.5 * gs.slice(0, -1).reduce((n, g) => n + g.s.lon.length, 0)) slots *= 2;
  let table = new Int32Array(slots).fill(-1);
  const mask = slots - 1, jnum = [], jat = [], jto = [], jstart = [];
  let N = 0, junk = 0;
  for (const [gi, g] of gs.entries()) {
    const { lon, lat, node_flags: nf } = g.s, n = lon.length, at = [], to = [], claimed = new Set();
    if (gi) for (let i = 0; i < n; i++) {
      let k = hash(lon[i], lat[i], mask), t;
      while ((t = table[k]) >= 0) {
        const o = gs[t >>> 24].s, j = t & 0xffffff;
        if (o.lon[j] === lon[i] && o.lat[j] === lat[i]) { // one this graph hasn't joined yet, so twins pair in order
          const m = jnum[t >>> 24](j);
          if (!claimed.has(m)) { claimed.add(m); at.push(i); to.push(m); break; }
        }
        k = (k + 1) & mask;
      }
    }
    jstart.push(N); jat.push(at); jto.push(to); jnum.push(numbering(N, at, to));
    N += n - at.length;
    for (let i = 0, p = 0; i < n; i++) {
      if (at[p] === i) { p++; continue; } // joined: the earlier graph's is in the table
      if (nf[i] & N_JUNK) junk++;
      if (gi === gs.length - 1) continue;
      let k = hash(lon[i], lat[i], mask);
      while (table[k] >= 0) k = (k + 1) & mask;
      table[k] = (gi << 24) | i;
    }
  }
  table = null;

  // names and turn lanes, each string once
  const intern = (m, list, v) => { let i = m.get(v); if (i === undefined) { m.set(v, (i = list.length)); list.push(v); } return i; };
  const nameIx = new Map(), names = [], tlIx = new Map(), tls = [];
  const nmap = gs.map((g) => Uint32Array.from(g.names, (v) => intern(nameIx, names, v)));
  const tmap = gs.map((g) => Uint32Array.from(g.tl, (v) => intern(tlIx, tls, v)));

  // edges: one whose ends are both joined is dropped when an earlier graph has it (in `eat`, mapped to that graph's in `eto`)
  const edgeNum = [], eat = [], estart = [];
  let E = 0, P = 0;
  const key = (a, b, len, name) => `${a},${b},${Math.round(len * 10)},${name}`;
  for (const [gi, g] of gs.entries()) {
    const { from, to, len, name, shape0 } = g.s, jm = jnum[gi], js = jstart[gi], ne = from.length, at = [], eto = [];
    let seen = null;
    for (let e = 0; e < ne; e++) {
      if (gi && jat[gi].length) {
        const a = jm(from[e]), b = jm(to[e]);
        if (a < js && b < js) {
          if (!seen) { // the earlier graphs' edges between joined junctions, found once per graph
            const joined = new Set(jto[gi]);
            seen = new Map();
            for (let o = 0; o < gi; o++) {
              const os = gs[o].s, om = jnum[o], em = edgeNum[o], drop = new Set(eat[o]);
              for (let f = 0; f < os.from.length; f++) {
                if (drop.has(f)) continue;
                const fa = om(os.from[f]), fb = om(os.to[f]);
                if (joined.has(fa) && joined.has(fb)) seen.set(key(fa, fb, os.len[f], names[nmap[o][os.name[f]]]), em(f));
              }
            }
          }
          const k = seen.get(key(a, b, len[e], names[nmap[gi][name[e]]]));
          if (k !== undefined) { at.push(e); eto.push(k); continue; }
        }
      }
      P += shape0[e + 1] - shape0[e];
    }
    estart.push(E); eat.push(at); edgeNum.push(numbering(E, at, eto));
    E += ne - at.length;
  }
  const dir = (gi, d) => 2 * edgeNum[gi](d >> 1) + (d & 1);

  // restrictions, turn lanes, bike boxes, waits and track crossings, each once (the first graph's); all but the
  // restrictions (router.js reads those into a Map) sorted by their key
  const R = new Map(), TL = new Map(), ASL = new Set(), WAIT = new Map(), TR = new Map();
  for (const [gi, { s }] of gs.entries()) {
    for (let i = 0; i < (s.r_from?.length || 0); i++) {
      const r = [dir(gi, s.r_from[i]), jnum[gi](s.r_via[i]), dir(gi, s.r_to[i]), s.r_only[i]], k = r.join();
      if (!R.has(k)) R.set(k, r);
    }
    for (let i = 0; i < (s.tl_dir?.length || 0); i++) { const d = dir(gi, s.tl_dir[i]); if (!TL.has(d)) TL.set(d, tmap[gi][s.tl_str[i]]); }
    for (const d of s.asl || []) ASL.add(dir(gi, d));
    for (let i = 0; i < (s.wait_dir?.length || 0); i++) { const d = dir(gi, s.wait_dir[i]); if (!WAIT.has(d)) WAIT.set(d, s.wait_kind[i]); }
    for (let i = 0; i < (s.tr_node?.length || 0); i++) { const j = jnum[gi](s.tr_node[i]); if (!TR.has(j)) TR.set(j, s.tr_bear[i]); }
  }
  const rs = [...R.values()], byKey = (m) => [...m.entries()].sort((x, y) => x[0] - y[0]);
  const tl = byKey(TL), wt = byKey(WAIT), tr = byKey(TR), asl = [...ASL].sort((x, y) => x - y);
  const enc = (list) => new TextEncoder().encode(list.join("\n"));
  const strings = { names: enc(names), turn_lanes: enc(tls) };

  // the file: the first graph's header and section order; an index section widens to u4 past 65,536 strings
  const lengths = { lon: N, lat: N, from: E, to: E, name: E, shape0: E + 1, shape: 2 * P, names: strings.names.length,
    turn_lanes: strings.turn_lanes.length, r_from: rs.length, r_via: rs.length, r_to: rs.length, r_only: rs.length, tl_dir: tl.length,
    tl_str: tl.length, asl: asl.length, wait_dir: wt.length, wait_kind: wt.length, tr_node: tr.length, tr_bear: tr.length };
  for (const k of JUNCTION) lengths[k] = N;
  for (const k of EDGE) lengths[k] = E;
  const type = (k) => ((k === "name" && names.length > 65536) || (k === "tl_str" && tls.length > 65536) ? "u4" : g0.h.sections[k].type);
  const sections = {};
  let off = 0;
  for (const k of order) {
    const t = type(k), bytes = lengths[k] * TYPES[t].BYTES_PER_ELEMENT;
    sections[k] = { offset: off, type: t, length: lengths[k] };
    off += Math.ceil(bytes / 8) * 8;
  }
  const bs = gs.map((g) => g.h.bounds || [-180, -90, 180, 90]);
  const { sections: _, ...meta } = g0.h;
  Object.assign(meta, { junctions: N, edges: E, shape_points: P, restrictions: rs.length, names: names.length, turn_lanes: tl.length,
    bike_boxes: asl.length, waits: wt.length, junk, tracks: tr.length,
    bounds: [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))] });
  let head = new TextEncoder().encode(JSON.stringify({ ...meta, sections }));
  const hlen = head.length + ((8 - ((head.length + 12) % 8)) % 8); // padded with spaces, so the sections start 8-aligned
  const out = new ArrayBuffer(12 + hlen + off), u8 = new Uint8Array(out), dv = new DataView(out);
  u8.set([83, 67, 82, 71]); // "SCRG"
  dv.setUint32(4, g0.version, true);
  dv.setUint32(8, hlen, true);
  u8.fill(0x20, 12, 12 + hlen);
  u8.set(head, 12);
  head = null;
  const o = {};
  for (const k of order) o[k] = new TYPES[sections[k].type](out, 12 + hlen + sections[k].offset, sections[k].length);

  // fill it, graph by graph: new junctions and kept edges are numbered in order, so each graph's come in runs, copied whole
  let p = 0;
  for (const [gi, { s }] of gs.entries()) {
    const jm = jnum[gi], nm = nmap[gi];
    for (const [i0, i1] of runs(s.lon.length, jat[gi])) for (const k of ["lon", "lat", ...JUNCTION]) o[k].set(s[k].subarray(i0, i1), jm(i0));
    for (const [e0, e1] of runs(s.from.length, eat[gi])) {
      const x0 = edgeNum[gi](e0), q0 = s.shape0[e0];
      for (const k of EDGE) if (o[k] && s[k]) o[k].set(s[k].subarray(e0, e1), x0); // W105 night: an OPTIONAL one either lacks stays 0 (or isn't kept)
      for (let e = e0, x = x0; e < e1; e++, x++) { o.from[x] = jm(s.from[e]); o.to[x] = jm(s.to[e]); o.name[x] = nm[s.name[e]]; o.shape0[x] = p + s.shape0[e] - q0; }
      o.shape.set(s.shape.subarray(2 * q0, 2 * s.shape0[e1]), 2 * p); // an edge's points are deltas from its `from` junction, which keeps its coordinates
      p += s.shape0[e1] - q0;
    }
  }
  o.shape0[E] = P;
  rs.forEach(([f, v, t, only], i) => { o.r_from[i] = f; o.r_via[i] = v; o.r_to[i] = t; o.r_only[i] = only; });
  if (o.names) o.names.set(strings.names);
  if (o.turn_lanes) o.turn_lanes.set(strings.turn_lanes);
  tl.forEach(([d, v], i) => { o.tl_dir[i] = d; o.tl_str[i] = v; });
  if (o.asl) o.asl.set(asl);
  wt.forEach(([d, v], i) => { o.wait_dir[i] = d; o.wait_kind[i] = v; });
  tr.forEach(([j, v], i) => { o.tr_node[i] = j; o.tr_bear[i] = v; });
  return out;
}

/**
 * The packs a trip needs: those whose bounds [W, S, E, N] the box of its from, vias and to, plus PAD_M each way, touches.
 * @param {{ from?: number[], to?: number[], vias?: number[][] }} trip [lon, lat] points
 * @param {{ id: string, bounds: number[] }[]} packs
 * @returns {string[]} the packs' ids, in the order given
 */
export function packsFor({ from, to, vias = [] }, packs) {
  const pts = [from, ...(vias || []), to].filter(Boolean);
  if (!pts.length) return [];
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  const S = Math.min(...lats), N = Math.max(...lats), far = Math.max(Math.abs(S), Math.abs(N));
  const dLat = PAD_M / M_PER_DEG, dLon = PAD_M / (M_PER_DEG * Math.cos(far * Math.PI / 180)); // at least PAD_M all along the box
  const W = Math.min(...lons) - dLon, E = Math.max(...lons) + dLon;
  return packs.filter(({ bounds: [w, s, e, n] }) => w <= E && e >= W && s <= N + dLat && n >= S - dLat).map((p) => p.id);
}
