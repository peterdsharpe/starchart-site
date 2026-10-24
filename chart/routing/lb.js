// W85 chpot (SPEC §165): the lower-bound metric for CH-potentials (chpot.js), on the junction graph, directed. Arc d (tail ->
// head) weighs, in whole cost units rounded down,
//   whole[d] + reset climb[d] + beta(d) + exit(d),   exit(d) = nc(d) + alpha(d),
// where nc(d) is the search's own cost at d's head (router.js search: the node, the `once` pulsar on entering an intersection,
// the wait), a function of d alone, and the reset climb is the climb past the buffer with the buffer empty at the edge's start,
// never more than the search pays from any buffer state. The turn d -> d2 is split per junction so that alpha(d) + beta(d2) <=
// turn(d, d2) for every pair but the U-turn on one edge, which the search never makes: beta(d2) is the least turn into d2,
// alpha(d) the least of (turn - beta) out of d. BACK_COST and an avoid only raise the search's costs, so they are left out.
// The potential of directed edge d is then exit(d) + D(head d), D the exact distance to the end under this metric, and it is
// consistent with the search's costs from every buffer state, so routes are the same as plain A*'s.
import { STYLES, PACE, NOT_FREE, BARE_WORM, BARE_QUICK, BUFFER_M } from "./router.js";

export const LB_STYLES = ["wormhole", "flat", "quickest"]; // the hierarchy's metrics, in this order
export const LB_VERSION = 1; // a change to this metric must change it: it is in stylesHash, so older files are refused
export const NONE = 0xffffffff; // an arc a style never rides (a blocked junction)

/** The reset climb's cost of directed edge d: climbing past the buffer, from an empty buffer. */
const climbLB = (st, climbAt, d) => { const b = st.buffer ?? BUFFER_M, c = climbAt[d]; return c > b ? (c - b) * st.uphill : 0; };

const CHUNK = 1 << 14; // directed edges between yields (W88 slices: 1 << 16 was 20-30 ms a slice here)
const run = (it) => { for (;;) { const { value, done } = it.next(); if (done) return value; } };
/** f(d0, d1) over 0 .. n in CHUNKs, yielding between them. f reads the router's arrays afresh each time: the WebAssembly router
 *  (wasm.js) makes its views again when a search grows its memory. */
function* chunks(n, f) { for (let d0 = 0; d0 < n; d0 += CHUNK) { if (d0) yield; f(d0, Math.min(n, d0 + CHUNK)); } }

/** Style `name`'s split, per directed edge: { beta, alpha, exit } (Float64Array 2E each), exit = nc + alpha. */
export const turnSplit = (r, name) => run(splitSteps(r, name));
/** turnSplit as a generator, yielding every CHUNK edges. */
export function* splitSteps(r, name) {
  const n = 2 * r.E, beta = new Float64Array(n), alpha = new Float64Array(n), exit = new Float64Array(n);
  if (!r.costs[name]) yield* r.styleSteps(name); // the style's cost tables in steps too (router.js styleSteps)
  r.style(name); // and through style(), which the WebAssembly router's tables go through
  yield* chunks(n, (d0, d1) => { // beta: the least turn into d2, from any edge into its tail but its own reverse
    const { hd, sb, eb, outStart, out } = r, { turnW, cos } = r.style(name);
    for (let d2 = d0; d2 < d1; d2++) {
      const u = hd[d2 ^ 1];
      let b = Infinity;
      for (let k = outStart[u]; k < outStart[u + 1]; k++) {
        const d = out[k] ^ 1; // into u
        if (d >> 1 === d2 >> 1) continue;
        const t = turnW[d2] * cos[(sb[d2] - eb[d]) & 255];
        if (t < b) b = t;
      }
      beta[d2] = b === Infinity ? 0 : b;
    }
  });
  yield* chunks(n, (d0, d1) => { // alpha, the least of turn - beta out of d, and nc
    const { hd, sb, eb, zone, outStart, out } = r, { node, waitC, turnW, cos, st } = r.style(name), once = !!st.once;
    for (let d = d0; d < d1; d++) {
      const v = hd[d];
      const nc = (once && zone[v] >= 0 && zone[v] !== zone[hd[d ^ 1]] ? node[v] + st.signal : node[v]) + (waitC ? waitC[d] : 0); // router.js search's
      let a = Infinity;
      for (let k = outStart[v]; k < outStart[v + 1]; k++) {
        const d2 = out[k];
        if (d2 >> 1 === d >> 1) continue;
        const t = turnW[d2] * cos[(sb[d2] - eb[d]) & 255] - beta[d2];
        if (t < a) a = t;
      }
      alpha[d] = a === Infinity ? 0 : Math.max(0, a);
      exit[d] = nc + alpha[d];
    }
  });
  return { beta, alpha, exit };
}

/** Style `name`'s arc weights (Uint32Array 2E, NONE where the arc is never ridden), rounded down, and its split. */
export const lbWeights = (r, name, split = turnSplit(r, name)) => run(weightSteps(r, name, split));
/** lbWeights as a generator. */
export function* weightSteps(r, name, split) {
  const n = 2 * r.E, w = new Uint32Array(n), { exit, beta } = split;
  yield* chunks(n, (d0, d1) => {
    const c = r.style(name);
    for (let d = d0; d < d1; d++) {
      const x = c.whole[d] + climbLB(c.st, c.climbAt, d) + beta[d] + exit[d];
      w[d] = x < NONE ? Math.floor(x) : NONE;
    }
  });
  return w;
}
/** A 64-bit hash (16 hex digits) of typed arrays' bytes, two 32-bit lanes of a multiply-xorshift mix. */
export const hashBytes = (...arrays) => run(hashSteps(...arrays));
/** hashBytes as a generator, yielding every 1 MB (W88 slices: 4 MB was 9-20 ms here). */
export function* hashSteps(...arrays) {
  const Q = 1 << 18; // W88 slices
  let a = 0x9e3779b9, b = 0x85ebca6b, len = 0;
  for (const x of arrays) {
    const u8 = new Uint8Array(x.buffer ?? x, x.byteOffset ?? 0, x.byteLength), q = u8.byteLength >> 2;
    const u32 = (u8.byteOffset & 3) === 0 ? new Uint32Array(u8.buffer, u8.byteOffset, q) : new Uint32Array(u8.slice(0, 4 * q).buffer);
    for (let i0 = 0; i0 < q; i0 += Q) { // W88 slices: Q
      if (i0) yield;
      for (let i = i0, i1 = Math.min(q, i0 + Q); i < i1; i++) { // W88 slices: Q
        const k = u32[i];
        a = Math.imul(a ^ k, 0x01000193); a ^= a >>> 15;
        b = Math.imul(b + k, 0x2c1b3c6d) ^ (b >>> 13);
      }
    }
    for (let i = 4 * q; i < u8.byteLength; i++) { a = Math.imul(a ^ u8[i], 0x01000193); b = Math.imul(b + u8[i], 0x2c1b3c6d); }
    len += u8.byteLength;
  }
  a = Math.imul(a ^ len, 0x85ebca6b); a ^= a >>> 13; b = Math.imul(b ^ (a >>> 7), 0xc2b2ae35); b ^= b >>> 16;
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** A hash of what the metric is made of: this file's version, the styles' constants and their factors' prices over a grid of
 *  every class, bike kind, flag and direction (plain arithmetic, the same in every engine). */
export const stylesHash = () => run(stylesHashSteps()); // W88 slices
/** stylesHash as a generator, yielding after each style's grid (W88 slices: all at once it was 12-30 ms here). */
export function* stylesHashSteps() { // W88 slices
  const parts = [LB_VERSION, BUFFER_M, NOT_FREE, BARE_WORM, BARE_QUICK, JSON.stringify(PACE)];
  for (const name of LB_STYLES) {
    const st = STYLES[name], { factor, label, ...k } = st; void label;
    parts.push(name, JSON.stringify(k));
    for (const f of [1, 1.3, 2, 4.2, 25]) for (let cls = 0; cls < 17; cls++) for (let bike = 0; bike < 7; bike++)
      for (const flags of [0, 16, 9]) for (const wrong of [false, true]) for (const bare of [false, true]) parts.push(factor(f, cls, bike, flags, wrong, bare));
    yield; // W88 slices
  }
  return hashBytes(new TextEncoder().encode(parts.join(",")));
}
