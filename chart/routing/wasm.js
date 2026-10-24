// W83 rustroute (SPEC §162): router.js's search in WebAssembly, compiled from Rust (chart/routing/rust/, rebuilt by its
// build.sh), behind the routing worker's ?router=wasm. Only Router.search moves: snapping, the cost tables and the course's
// description stay router.js's, so the two routers give the same courses and a timing compares the languages alone.
//
//   const mod = await wasmModule();        // compiles chart/routing/rust/router.wasm (fetched; or wasmModule(bytes))
//   useWasm(router, mod);                  // that Router's search() runs in its own instance from now on
//
// The search's arrays (router.js's x, y, hd, sb, eb, hasR, outStart, out, zone, state, g, ehb, par, and each style's cost
// tables) move into the instance's memory, and the Router's fields become views on it, so the graph isn't held twice.
// Every byte the instance needs later is allocated here, up front, but for the search's heap, which may grow the memory and
// so detach the views: they are made again after each search, before anything else reads them.
// W85 chpot (SPEC §165): a router's CH-potentials (chpot.js, router.chpot) move in the same way at its first search with them (the
// hierarchy's arrays, each style's weights and exits), and the search takes the larger of the straight line and the potential
// in WebAssembly too; chpot.js still works out where the leg's ends enter the hierarchy (ChPot.ends).
import { STYLES, STYLE_ALIASES, DEFAULT_STYLE, M_PER_DEG, BUFFER_M, WALK_COST } from "./router.js";

export const WASM_URL = new URL("./rust/router.wasm", import.meta.url);

/** The compiled module, from `bytes` or fetched from WASM_URL (read from disk in Node, whose fetch has no file: URLs). */
export async function wasmModule(bytes = null) {
  if (!bytes && WASM_URL.protocol === "file:") bytes = globalThis.process.getBuiltinModule("node:fs").readFileSync(WASM_URL);
  if (bytes) return WebAssembly.compile(bytes);
  const res = await fetch(WASM_URL);
  if (!res.ok) throw new Error(`${WASM_URL}: HTTP ${res.status}`); // not a "malformed module" from a 404 page
  return WebAssembly.compile(await res.arrayBuffer());
}

const MOVED = [["x", Float64Array], ["y", Float64Array], ["hd", Uint32Array], ["sb", Uint8Array], ["eb", Uint8Array], ["hasR", Uint8Array],
  ["outStart", Uint32Array], ["out", Uint32Array], ["zone", Int32Array]];
const STATE = [["state", Uint32Array], ["g", Float64Array], ["ehb", Float32Array], ["par", Int32Array]]; // the search's, made afresh (zero)
const TABLES = ["perM", "whole", "climbAt", "turnW", "node", "cos", "waitC"]; // router.js style()'s, all Float32Array

/** Run `router`'s search in a new instance of `module`. Returns the instance's exports (for tests and the bench). */
export function useWasm(router, module) {
  const w = new WebAssembly.Instance(module, {}).exports, mem = w.memory;
  const views = []; // [object, key, address, type, length]: made again when the memory grows
  let buf = null;
  const bind = () => {
    if (mem.buffer === buf) return;
    buf = mem.buffer;
    for (const [o, k, at, T, n] of views) o[k] = new T(buf, at, n);
  };
  const alloc = (bytes) => { const at = w.alloc(bytes); if (!at) throw new RangeError(`router.wasm: out of memory (${bytes} bytes)`); return at; }; // 0: memory.grow failed
  const place = (o, k, T, n) => { const at = alloc(n * T.BYTES_PER_ELEMENT); views.push([o, k, at, T, n]); buf = null; return at; };
  const put = (o, k, T, src) => { const at = place(o, k, T, src.length); bind(); o[k].set(src); return at; };
  const { N, E } = router, own = {};
  const at = {};
  for (const [k, T] of MOVED) at[k] = put(router, k, T, router[k]);
  for (const [k, T] of STATE) at[k] = place(router, k, T, router[k].length); // made afresh, not copied: a state of 0 is no generation's
  at.len = put(own, "len", Float32Array, router.s.len);
  // the turn restrictions by incoming directed edge, sorted, as router.js's `restr` Map
  const keys = [...router.restr.keys()].sort((p, q) => p - q), rs = [0], rt = [], ro = [];
  for (const k of keys) { for (const r of router.restr.get(k)) { rt.push(r.to); ro.push(r.only ? 1 : 0); } rs.push(rt.length); }
  for (const [k, T, src] of [["rKey", Uint32Array, keys], ["rStart", Uint32Array, rs], ["rTo", Uint32Array, rt], ["rOnly", Uint8Array, ro]]) at[k] = put(own, k, T, src);
  at.backs = place(own, "backs", Uint8Array, 2 * E);
  // each style's tables, filled when router.js first makes them (style())
  const slots = new Map(Object.entries(STYLES).map(([name, st]) => [name, Object.fromEntries(TABLES.filter((k) => k !== "waitC" || st.waits) // waits: router.js's waitC
    .map((k) => [k, alloc(4 * (k === "node" ? N : k === "cos" ? 256 : 2 * E))]))]));
  let potOn = null, potAt = null, potFailed = null; // W85 chpot: the potential whose arrays are in this instance, their addresses; one that didn't fit
  const attach = (pot) => { // W85 chpot
    const t = pot.topo, a = { W: [], exit: [] };
    a.fst = put(t.fwd, "st", Uint32Array, t.fwd.st); a.fT = put(t.fwd, "T", Uint32Array, t.fwd.T);
    a.bst = put(t.bwd, "st", Uint32Array, t.bwd.st); a.bT = put(t.bwd, "T", Uint32Array, t.bwd.T);
    a.level = put(t, "level", Uint8Array, t.level);
    for (let i = 0; i < pot.W.length; i++) { a.W.push(put(pot.W, i, Float32Array, pot.W[i])); a.exit.push(put(pot.exits, i, Float32Array, pot.exits[i])); }
    w.pot_init(t.N, t.F, a.fst, a.fT, a.bst, a.bT, a.level);
    buf = null; bind(); // its labels' memory
    potOn = pot; potAt = a;
  };
  let io = 4096, ioAt = place(own, "io", Float64Array, io);
  bind();
  router.state.fill(0); own.backs.fill(0); // alloc doesn't zero
  w.init(N, 2 * E, at.x, at.y, at.hd, at.sb, at.eb, at.hasR, at.outStart, at.out, at.zone, at.len, at.rKey, at.rStart, at.rTo, at.rOnly, keys.length,
    at.state, at.g, at.ehb, at.par, at.backs);

  const style = router.style, ptrs = new WeakMap(); // a style's tables -> their addresses
  router.style = function (name = DEFAULT_STYLE) {
    const key = STYLE_ALIASES[name] || name, c = style.call(this, key);
    if (!ptrs.has(c)) {
      const slot = slots.get(key), p = {};
      for (const k of TABLES) {
        if (!c[k]) { p[k] = 0; continue; }
        const src = c[k];
        views.push([c, k, (p[k] = slot[k]), Float32Array, src.length]);
        buf = null; bind();
        c[k].set(src);
      }
      ptrs.set(c, p);
    }
    return c;
  };

  router.search = function (a, b, cost, seeds = a.flatMap((p) => [[2 * p.e, 1 - p.t, p], [2 * p.e + 1, p.t, p]])) {
    bind(); // W85 chpot: the views again, should the memory have grown since the last search (a test's alloc does)
    const { s } = this, st = cost.st, gen = ++this.gen;
    if (gen * 2 + 1 >= 0xffffffff) { this.state.fill(0); this.gen = 0; return this.search(a, b, cost, seeds); }
    const walkC = st.walk ?? WALK_COST, aim = b[0].walk > 0 ? b[0].place : b[0].at;
    const pot = this.chpot ?? null; // W85 chpot
    if (pot && pot !== potOn && pot !== potFailed) try { attach(pot); } catch (err) { potFailed = pot; console.warn("CH-potentials don't fit in router.wasm's memory: plain A*", err); } // W85 chpot: once, not at every route
    const si = pot && pot === potOn ? pot.styleOf(cost) : -1; // W85 chpot
    const pe = si >= 0 ? pot.ends(si, b, walkC) : []; // W85 chpot
    const need = 3 * seeds.length + 3 * b.length + 10 * b.length + 4 + pe.length; // W85 chpot: pe
    if (need > io) { io = 2 * need; ioAt = place(own, "io", Float64Array, io); views.splice(views.findIndex((v) => v[0] === own && v[1] === "io"), 1); buf = null; bind(); }
    const f = own.io, f0 = new Map(), from = new Map();
    let k = 0;
    for (const [d, frac, p] of seeds) { f[k++] = d; f[k++] = frac; f[k++] = p ? p.walk * walkC : 0; f0.set(d, 1 - frac); from.set(d, p); }
    const bqAt = k;
    for (const p of b) { f[k++] = p.e; f[k++] = p.t; f[k++] = p.walk * walkC; }
    const endsAt = k;
    for (const [i, p] of b.entries()) for (const [v, dd, frac] of [[s.from[p.e], 2 * p.e, p.t], [s.to[p.e], 2 * p.e + 1, 1 - p.t]]) {
      f[k++] = v; f[k++] = dd; f[k++] = frac; f[k++] = i; f[k++] = p.walk * walkC;
    }
    const resAt = k, backs = this.backs;
    const peAt = k + 4; f.set(pe, peAt); // W85 chpot
    if (backs) for (const d of backs) own.backs[d] = 1;
    const p = ptrs.get(cost);
    if (!p) throw new Error("a cost table not made by this router's style()");
    try {
      w.search(gen, p.perM, p.whole, p.climbAt, p.turnW, p.node, p.cos, p.waitC, st.uphill, st.buffer ?? BUFFER_M, st.once ? 1 : 0, st.signal ?? 0,
        aim[0] * this.kx, aim[1] * M_PER_DEG, backs ? 1 : 0, ioAt, seeds.length, ioAt + 8 * bqAt, b.length, ioAt + 8 * endsAt, 2 * b.length, ioAt + 8 * resAt,
        si >= 0 ? potAt.W[si] : 0, si >= 0 ? potAt.exit[si] : 0, ioAt + 8 * peAt, pe.length / 2); // W85 chpot
    } finally {
      bind();
      if (backs) for (const d of backs) own.backs[d] = 0;
    }
    const best = own.io[resAt], bestD = own.io[resAt + 1], bestVia = own.io[resAt + 2], bestB = b[own.io[resAt + 3]] ?? null;
    if (best === Infinity) return null;
    const ds = [], par = this.par;
    for (let d = bestD; d >= 0; d = par[d]) ds.push(d);
    ds.reverse();
    const d0 = bestD === -1 ? bestVia : ds[0];
    return { ds, last: bestVia, cost: best, direct: bestD === -1, f0: f0.get(d0), a: from.get(d0) || null, b: bestB };
  };
  return w;
}
