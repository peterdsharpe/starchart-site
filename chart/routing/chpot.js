// W85 chpot (SPEC §165): CH-potentials (Strasser & Zeitz 2021), a lower bound on the cost to the end that keeps router.js's A*
// exact and is far tighter than the straight line: the exact distance to the end under lb.js's bound metric, from a contraction
// hierarchy evaluated lazily. The hierarchy's topology is built once per graph at build time (graph/ch/build.mjs, a Rust
// contraction); its weights are computed here, from the graph and the styles' costs, a slice at a time (customizeSteps).
//   const ch = await readCH(bytes);                     // the file's header and streams, or throws
//   chFits(ch, graphBuffer)                              // its graph's hash and the metric's are this graph's and this code's
//   const topo = topology(ch, router);                  // the upward arcs: the file's shortcuts and the graph's own arcs
//   const pot = runSteps(customizeSteps(topo, router));  // all at once (Node)
//   router.chpot = pot;                                 // router.js search takes h = max(straight line, pot) from then on
//   chpotSteps(bytes, router, graphBuffer)               // all of it as one generator, for the worker to run between messages
// A stale file (another graph, other costs, another metric) is refused: chFits checks the header's hashes before anything is
// unzipped, and customizeSteps each style's weights' hash before they are used. Every step reads the router's arrays afresh
// after a yield, as the WebAssembly router (wasm.js) makes its views on them again when a search grows its memory.
import { LB_STYLES, LB_VERSION, NONE, splitSteps, weightSteps, hashBytes, hashSteps, stylesHash, stylesHashSteps } from "./lb.js"; // W88 slices: stylesHashSteps
import { runSteps } from "./router.js";
export { runSteps }; // run a *Steps build all at once (Node, the tests)

export const CH_MAGIC = 0x48434353; // "SCCH"
export const CH_VERSION = 1;
const SCALE = 1 - 1e-7; // the search's float sums against the bound's whole units

async function gunzip(u8) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()); }

/** The file's header (JSON), or throws when it isn't one. */
export function chHeader(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength < 12 || dv.getUint32(0, true) !== CH_MAGIC) throw new Error("not a Starchart CH-potentials file");
  if (dv.getUint32(4, true) !== CH_VERSION) throw new Error(`CH-potentials file version ${dv.getUint32(4, true)}, not ${CH_VERSION}`);
  const hl = dv.getUint32(8, true);
  return { header: JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + hl))), body: u8.subarray(12 + hl) };
}

/** Whether file `ch` (chHeader's or readCH's) was built for graph `graph` (the ArrayBuffer the Router is made from) and for this
 *  code's metric. */
export function chFits(ch, graph) { return ch.header.graph === hashBytes(graph) && ch.header.styles === stylesHash(); }

/** The file's header and streams: { header, level (Uint8Array N), count, ids (Uint8Array varints) }. */
export async function readCH(bytes) {
  const { header, body } = chHeader(bytes), part = async (k) => gunzip(body.subarray(header.streams[k].offset, header.streams[k].offset + header.streams[k].length));
  const [level, count, ids] = await Promise.all(["level", "count", "ids"].map(part));
  if (level.length !== header.junctions) throw new Error("CH-potentials file: the levels don't match its header");
  return { header, level, count, ids };
}

/** The hierarchy's upward arcs on router `r`: the file's shortcuts and the graph's own arcs, each at its lower junction, in
 *  fwd (low -> high) and bwd (high -> low); arcs 0 .. F - 1 are fwd's and F .. F + B - 1 bwd's. `edge[d]` is directed edge d's
 *  arc, or -1 (a loop, or a junction pair the hierarchy has no order for). */
export const topology = (ch, r) => runSteps(topologySteps(ch, r));
/** topology as a generator. */
export function* topologySteps(ch, r) {
  const { header, level, count, ids } = ch, N = header.junctions;
  if (N !== r.N || header.edges !== r.E) throw new Error("CH-potentials file: another graph");
  const n2 = 2 * r.E, CH = 1 << 14, CV = 1 << 13; // W88 slices: directed edges and junctions between yields (1 << 16 and 1 << 15 were 20-90 ms a step here)
  let hd = r.hd;
  // the shortcuts, decoded
  const sLo = new Uint32Array(header.shortcuts), sHi = new Uint32Array(header.shortcuts), sDir = new Uint8Array(header.shortcuts);
  let pc = 0, pi = 0, k = 0;
  const varint = (b, p) => { let x = 0, m = 1, c; do { c = b[p++]; x += (c & 127) * m; m *= 128; } while (c & 128); return [x, p]; };
  for (let v = 0; v < N; v++) {
    for (let dir = 0; dir < 2; dir++) {
      let c, prev = v, z; [c, pc] = varint(count, pc);
      for (let j = 0; j < c; j++, k++) { [z, pi] = varint(ids, pi); prev += z & 1 ? -(z + 1) / 2 : z / 2; sLo[k] = v; sHi[k] = prev; sDir[k] = dir; }
    }
    if (v % CV === CV - 1) yield; // W88 slices: CV; W88: the decode in slices too (in one piece it was the longest step, 47-94 ms here, so 4x that on a phone); its arrays are JS-owned, nothing to re-read
  }
  if (k !== header.shortcuts) throw new Error("CH-potentials file: the shortcuts don't match its header");
  yield;
  // each original arc t -> h at its lower end: fwd at t when t is lower, else bwd at h
  const side = (t, h) => (level[t] < level[h] ? 0 : level[t] > level[h] ? 1 : -1);
  const fc = new Uint32Array(N + 1), bc = new Uint32Array(N + 1);
  for (let i = 0; i < k; i++) { if (i % CH === CH - 1) yield; (sDir[i] ? bc : fc)[sLo[i] + 1]++; } // W88 slices: the yield
  const sc = [fc.slice(), bc.slice()]; // the shortcut counts alone, for the search below
  for (let v = 0; v < N; v++) { sc[0][v + 1] += sc[0][v]; sc[1][v + 1] += sc[1][v]; }
  yield; // W88 slices
  const shortAt = (dir, lo, hi) => { const st = sc[dir]; for (let i = st[lo]; i < st[lo + 1]; i++) if (sHiSorted[dir][i] === hi) return true; return false; };
  const sHiSorted = [new Uint32Array(sc[0][N]), new Uint32Array(sc[1][N])];
  { const f = [sc[0].slice(0, N), sc[1].slice(0, N)]; for (let i = 0; i < k; i++) { if (i % CH === CH - 1) yield; sHiSorted[sDir[i]][f[sDir[i]][sLo[i]]++] = sHi[i]; } } // W88 slices: the yield
  yield; hd = r.hd; // W88 slices
  const orig = new Int8Array(n2).fill(-1); // the side of each directed edge's arc, when it isn't one of the shortcuts
  for (let d = 0; d < n2; d++) {
    if (d % CH === CH - 1) { yield; hd = r.hd; }
    const t = hd[d ^ 1], h = hd[d]; if (t === h) continue;
    const s = side(t, h); if (s < 0) continue;
    const lo = s ? h : t, hi = s ? t : h;
    if (!shortAt(s, lo, hi)) { orig[d] = s; (s ? bc : fc)[lo + 1]++; }
  }
  yield; // W88 slices
  for (let v = 0; v < N; v++) { fc[v + 1] += fc[v]; bc[v + 1] += bc[v]; }
  const F = fc[N], fwd = { st: fc, T: new Uint32Array(F) }, bwd = { st: bc, T: new Uint32Array(bc[N]) };
  const ff = fc.slice(0, N), bf = bc.slice(0, N);
  for (let v = 0; v < N; v++) { // shortcuts first, then the original arcs, at each junction
    if (v % CV === CV - 1) yield; // W88 slices: its arrays are JS-owned
    for (let i = sc[0][v]; i < sc[0][v + 1]; i++) fwd.T[ff[v]++] = sHiSorted[0][i];
    for (let i = sc[1][v]; i < sc[1][v + 1]; i++) bwd.T[bf[v]++] = sHiSorted[1][i];
  }
  yield; hd = r.hd;
  for (let d = 0; d < n2; d++) {
    if (d % CH === CH - 1) { yield; hd = r.hd; } // W88 slices
    if (orig[d] >= 0) { const t = hd[d ^ 1], h = hd[d]; if (orig[d]) bwd.T[bf[h]++] = t; else fwd.T[ff[t]++] = h; }
  } // W88 slices
  yield; hd = r.hd; // W88 slices
  const topo = { N, F, A: F + bwd.T.length, level, fwd, bwd, header };
  topo.edge = new Int32Array(n2).fill(-1);
  for (let d = 0; d < n2; d++) {
    if (d % CH === CH - 1) { yield; hd = r.hd; }
    const t = hd[d ^ 1], h = hd[d]; if (t !== h) topo.edge[d] = arcOf(topo, t, h);
  }
  return topo;
}

/** The index of arc u -> w in topology `topo`, or -1. */
function arcOf({ level, fwd, bwd, F }, u, w) {
  if (level[u] < level[w]) { for (let i = fwd.st[u], e = fwd.st[u + 1]; i < e; i++) if (fwd.T[i] === w) return i; }
  else if (level[u] > level[w]) for (let i = bwd.st[w], e = bwd.st[w + 1]; i < e; i++) if (bwd.T[i] === u) return F + i;
  return -1;
}

/** The customization as a generator, yielding every few thousand steps: per style, its weights (each original arc's bound
 *  weight, then every lower triangle u -> v -> w lowering arc u -> w, in level order), checked against the file's hash.
 *  Returns a ChPot, or throws when a style's weights aren't the ones the file was built with (a stale file). */
export function* customizeSteps(topo, r, STEP = 4096) {
  const { N, F, A, level, fwd, bwd, header } = topo, n2 = 2 * r.E, CH = 1 << 16; // W88 slices: CH
  const W = [], exits = [];
  for (const name of LB_STYLES) {
    const split = yield* splitSteps(r, name);
    const w0 = yield* weightSteps(r, name, split);
    if ((yield* hashSteps(w0)) !== header.weights?.[name]) throw new Error(`CH-potentials file: stale for ${name}'s costs`);
    yield; // W88 slices
    const exit = new Float32Array(n2);
    for (let d = 0; d < n2; d++) {
      if (d % CH === CH - 1) yield; // W88 slices: JS-owned arrays
      exit[d] = Math.fround(split.exit[d] * (1 - 2 ** -23)); // rounded down, never past the bound
    } // W88 slices
    exits.push(exit);
    yield;
    const w = new Float32Array(A).fill(Infinity);
    let hd = r.hd; // W88 slices: let, read afresh
    for (let d = 0; d < n2; d++) {
      if (d % CH === CH - 1) { yield; hd = r.hd; } // W88 slices
      if (w0[d] === NONE || hd[d] === hd[d ^ 1]) continue; // a loop is never on a shortest way
      const i = topo.edge[d];
      if (i < 0) throw new Error(`CH-potentials file: no arc for edge ${d}`);
      if (w0[d] < w[i]) w[i] = w0[d];
    }
    W.push(w);
    yield;
  }
  // level order (a counting sort)
  let L = 0; for (let v = 0; v < N; v++) if (level[v] > L) L = level[v];
  const cnt = new Uint32Array(L + 2); for (let v = 0; v < N; v++) cnt[level[v] + 1]++;
  for (let l = 0; l <= L; l++) cnt[l + 1] += cnt[l];
  const order = new Uint32Array(N); for (let v = 0; v < N; v++) order[cnt[level[v]]++] = v;
  yield; // W88 slices
  const S = W.length;
  let steps = 0;
  for (let o = 0; o < N; o++) {
    const v = order[o];
    for (let i = bwd.st[v], ie = bwd.st[v + 1]; i < ie; i++) {
      const u = bwd.T[i], ai = F + i;
      for (let j = fwd.st[v], je = fwd.st[v + 1]; j < je; j++) {
        const x = fwd.T[j]; if (x === u) continue;
        const t = arcOf(topo, u, x); if (t < 0) continue;
        for (let s = 0; s < S; s++) { const y = W[s][ai] + W[s][j]; if (y < W[s][t]) W[s][t] = y; }
        steps++;
      }
    }
    if (++steps > STEP) { steps = 0; yield; }
  }
  return new ChPot(topo, r, W, exits);
}

/** Everything from the file's bytes to the potential, as one generator: the hashes (refused with an error when another graph's or
 *  other costs'), the streams unzipped (it yields a promise for that, which the caller awaits), the topology and the customization. */
export function* chpotSteps(bytes, r, graph, cache = null) {
  const head = chHeader(bytes);
  if (head.header.styles !== (yield* stylesHashSteps())) throw new Error("CH-potentials file: built for other costs"); // W88 slices: yield*
  if ((yield* hashSteps(graph)) !== head.header.graph) throw new Error("CH-potentials file: built for another graph");
  // a cache of the result (`cache`: { load(key) -> Promise of bytes or null, save(key, bytes) }; worker.js's is OPFS), by cacheKeySteps
  const key = cache && (yield* cacheKeySteps(r, head.header));
  let kept = null;
  if (cache) yield cache.load(key).then((b) => { kept = b && unpack(b, r, head.header); }, () => {});
  if (kept) return kept;
  let ch; yield readCH(bytes).then((x) => { ch = x; });
  const topo = yield* topologySteps(ch, r), pot = yield* customizeSteps(topo, r);
  if (cache) cache.save(key, yield* packSteps(pot)).catch(() => {}); // W88 slices: packSteps (pack in one piece was 40-80 ms here)
  return pot;
}

/** The cache's key for the potential of file `header` on router r: the file's hashes, this code's versions, and a hash of every
 *  table the weights are made from (each style's cost tables, the intersections and the cos table), so a weight that would come
 *  out otherwise, from a change to router.js's costs the file's hashes don't see, never comes from the cache. */
export function* cacheKeySteps(r, header) {
  const parts = [];
  for (const name of LB_STYLES) {
    if (!r.costs[name]) yield* r.styleSteps(name);
    for (const k of ["whole", "climbAt", "turnW", "node", "cos", "waitC"]) { // each in one step, read afresh: a WebAssembly router's are views
      const x = r.style(name)[k];
      if (x) parts.push(hashBytes(x));
      yield;
    }
  }
  parts.push(hashBytes(r.zone));
  return hashBytes(new TextEncoder().encode([CH_VERSION, LB_VERSION, header.graph, header.styles, ...LB_STYLES.map((s) => header.weights?.[s]), ...parts].join(",")));
}

const PACK_MAGIC = 0x50484353; // "SCHP"
/** A potential's arrays as one buffer, for the cache: u32 magic, version, N, F, A, 2E; then fwd.st, fwd.T, bwd.st, bwd.T (u32),
 *  the levels (padded to 4 bytes), each style's weights (f32 A) and exits (f32 2E). */
export const pack = (pot) => runSteps(packSteps(pot)); // W88 slices
/** pack as a generator, yielding every 1 MB copied (W88 slices); the potential's arrays read afresh after each yield. */
export function* packSteps(pot) { // W88 slices
  const { topo } = pot, { N, F, A } = topo, n2 = pot.exits[0].length, L4 = Math.ceil(N / 4) * 4, M = 1 << 20; // W88 slices: M
  const parts = () => [Uint32Array.of(PACK_MAGIC, CH_VERSION, N, F, A, n2), topo.fwd.st, topo.fwd.T, topo.bwd.st, topo.bwd.T, topo.level, new Uint8Array(L4 - N), ...pot.W, ...pot.exits]; // W88 slices: afresh
  const out = new Uint8Array(parts().reduce((n, a) => n + a.byteLength, 0)), P = parts().length; // W88 slices
  let o = 0;
  for (let j = 0; j < P; j++) { // W88 slices
    const n = parts()[j].byteLength; // W88 slices
    for (let i = 0; i < n; i += M) { if (o + i) yield; const a = parts()[j]; out.set(new Uint8Array(a.buffer, a.byteOffset + i, Math.min(M, n - i)), o + i); } // W88 slices
    o += n; // W88 slices
  }
  return out;
}
/** pack's buffer as a ChPot on router r, or null when it isn't one for this graph. */
export function unpack(bytes, r, header) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength < 24) return null; // cut short: no header
  const buf = u8.byteOffset % 4 ? u8.slice().buffer : u8.buffer, base = u8.byteOffset % 4 ? 0 : u8.byteOffset;
  const h = new Uint32Array(buf, base, 6), [magic, ver, N, F, A, n2] = h, S = LB_STYLES.length, L4 = Math.ceil(N / 4) * 4;
  if (magic !== PACK_MAGIC || ver !== CH_VERSION || N !== r.N || n2 !== 2 * r.E || N !== header.junctions) return null;
  if (u8.byteLength !== 24 + 4 * (2 * (N + 1) + A) + L4 + 4 * S * (A + n2)) return null;
  let o = base + 24;
  const take = (T, n) => { const a = new T(buf, o, n); o += n * T.BYTES_PER_ELEMENT; return a; };
  const fwd = { st: take(Uint32Array, N + 1) }; fwd.T = take(Uint32Array, F);
  const bwd = { st: take(Uint32Array, N + 1) }; bwd.T = take(Uint32Array, A - F);
  const level = take(Uint8Array, N); o += L4 - N;
  const W = LB_STYLES.map(() => take(Float32Array, A)), exits = LB_STYLES.map(() => take(Float32Array, n2));
  return new ChPot({ N, F, A, level, fwd, bwd, header }, r, W, exits);
}

/** The potential of each style on router `r`, from customized weights W (per LB_STYLES) and exits (lb.js's, rounded down). */
export class ChPot {
  constructor(topo, r, W, exits) {
    this.topo = topo; this.r = r; this.W = W; this.exits = exits;
    this.gen = 0; this.stack = []; this.seen = [];
    // its arrays, and the labels a search's prepare needs (24 B a junction: here at the first, or in WebAssembly, wasm.js)
    this.bytes = [topo.fwd.st, topo.fwd.T, topo.bwd.st, topo.bwd.T, topo.level, ...W, ...exits].reduce((n, a) => n + a.byteLength, 0) + 24 * topo.N;
    delete topo.edge; // the customization's
  }

  /** The style index of cost tables `cost` (router.js style()'s), or -1. */
  styleOf(cost) { return LB_STYLES.findIndex((s) => this.r.costs[s] === cost); }

  /** Where ends `b` (router.js search's, with the walk at `walkC` a metre) enter the hierarchy in style `si`: [junction, the
   *  bound on the cost from it onto the end and the walk, ...], flat. */
  ends(si, b, walkC) {
    const r = this.r, { s, hd, outStart, out, sb, eb } = r, { perM, turnW, cos } = r.style(LB_STYLES[si]), at = [];
    const beta = (d2) => { // lb.js's, for an end's edge: the least turn into it
      const u = hd[d2 ^ 1]; let m = Infinity;
      for (let k = outStart[u]; k < outStart[u + 1]; k++) { const d = out[k] ^ 1; if (d >> 1 === d2 >> 1) continue; const t = turnW[d2] * cos[(sb[d2] - eb[d]) & 255]; if (t < m) m = t; }
      return m === Infinity ? 0 : m;
    };
    const alphaIn = (v) => { // the largest alpha of the edges into v: an end right at v pays no turn
      let m = 0;
      for (let k = outStart[v]; k < outStart[v + 1]; k++) {
        const d = out[k] ^ 1; let a = Infinity;
        for (let k2 = outStart[v]; k2 < outStart[v + 1]; k2++) { const d2 = out[k2]; if (d2 >> 1 === d >> 1) continue; const t = turnW[d2] * cos[(sb[d2] - eb[d]) & 255] - beta(d2); if (t < a) a = t; }
        if (a !== Infinity && a > m) m = a;
      }
      return m;
    };
    for (const q of b) for (const [v, dd, frac] of [[s.from[q.e], 2 * q.e, q.t], [s.to[q.e], 2 * q.e + 1, 1 - q.t]]) {
      at.push(v, s.len[q.e] * frac * perM[dd] + q.walk * walkC + (frac > 0 ? beta(dd) : -alphaIn(v))); // its climb left out
    }
    return at;
  }

  /** Aim style `si`'s potential at ends `b` (as ends'): the upward search back from them. Returns h(d), the bound on the cost
   *  on from directed edge d's head, ready for search's push. */
  prepare(si, b, walkC) {
    const r = this.r, hd = r.hd, { level, fwd, bwd, N } = this.topo, at = this.ends(si, b, walkC);
    if (!this.B) { this.B = new Float64Array(N); this.bs = new Uint32Array(N); this.H = new Float64Array(N); this.hs = new Uint32Array(N); }
    const W = this.W[si], exit = this.exits[si], F = this.topo.F, B = this.B, bs = this.bs, H = this.H, hs = this.hs;
    if (++this.gen >= 0xffffffff) { bs.fill(0); hs.fill(0); this.gen = 1; }
    const gen = this.gen, seen = this.seen, stack = this.stack;
    seen.length = 0; stack.length = 0;
    for (let k = 0; k < at.length; k += 2) {
      const v = at[k], T = at[k + 1];
      if (bs[v] !== gen) { bs[v] = gen; B[v] = T; seen.push(v); stack.push(v); } else if (T < B[v]) B[v] = T;
    }
    while (stack.length) { const v = stack.pop(); for (let i = bwd.st[v]; i < bwd.st[v + 1]; i++) { const u = bwd.T[i]; if (bs[u] !== gen) { bs[u] = gen; B[u] = Infinity; seen.push(u); stack.push(u); } } }
    seen.sort((p, q) => level[p] - level[q]);
    for (const v of seen) { const bv = B[v]; if (bv === Infinity) continue; for (let i = bwd.st[v], e = bwd.st[v + 1]; i < e; i++) { const u = bwd.T[i], x = bv + W[F + i]; if (x < B[u]) B[u] = x; } }
    const st2 = stack, fs = fwd.st, fT = fwd.T;
    const D = (v0) => { // the bound distance from junction v0 to the ends: down from the meeting junctions, up from v0, memoized
      if (hs[v0] === gen) return H[v0];
      st2.length = 0; st2.push(v0);
      while (st2.length) {
        const v = st2[st2.length - 1];
        if (hs[v] === gen) { st2.pop(); continue; }
        let ready = true;
        for (let i = fs[v], e = fs[v + 1]; i < e; i++) if (hs[fT[i]] !== gen) { ready = false; st2.push(fT[i]); }
        if (!ready) continue;
        let x = bs[v] === gen ? B[v] : Infinity;
        for (let i = fs[v], e = fs[v + 1]; i < e; i++) { const y = W[i] + H[fT[i]]; if (y < x) x = y; }
        H[v] = x; hs[v] = gen; st2.pop();
      }
      return H[v0];
    };
    return (d) => { const h = (exit[d] + D(hd[d])) * SCALE; return h > 0 ? h : 0; };
  }
}
