// W52 weather (design/app-ui/SPEC.md §66): the pure part of the rain radar and its nowcast. No DOM, so Node tests it and
// app/weather-worker.js runs it. Ported from the W50 weather research's nowcast.mjs (coarse block matching,
// semi-Lagrangian advection), on the radar's own web-mercator pixels instead of a lon/lat grid.
//
// - The source: the Iowa Environmental Mesonet's NEXRAD N0Q composite (NWS data), as z7 tiles on IEM's fixed 256-colour
//   palette, so each pixel decodes back to its dBZ (index / 2 - 32.5). Each frame is asked for by its time
//   (ridge::USCOMP-N0Q-YYYYmmddHHMM), so a frame's tiles never change and are asked for once; the newest frame's time
//   comes from n0q_0.json, asked for with `no-cache`, so the browser gets a 304 when nothing changed.
// - One fixed block of 2 x 2 tiles over the chart's region, the same for every pilot: no request carries a position.

import { lingo } from "./lingo-mode.js"; // W60 c: the chip's words in Plain
import { dur as span } from "./duration.js"; // W68 fixes: "1h 20m"
export const HOST = "https://mesonet.agron.iastate.edu";
export const META = `${HOST}/data/gis/images/4326/USCOMP/n0q_0.json`;
/** The block: z7 tiles x 38-39, y 46-47, 73.1-67.5° W and 41.0-45.1° N, about 460 km square around Greater Boston,
 *  enough upwind ground for 90 min of showers at 80 km/h. 512 x 512 radar pixels of about 0.9 km. */
export const BLOCK = { z: 7, x: 38, y: 46, n: 2 };
export const POOL = 2; // radar pixels to a cell: 256 x 256 cells of about 1.8 km, as the research's 0.02° grid
export const W = (BLOCK.n * 256) / POOL, H = W;
export const NOISE_DBZ = 10; // below it, nothing
export const RAIN_DBZ = 20; // radiation: about 0.6 mm/h, light rain (the research's threshold)
export const STEP_MIN = 5; // IEM's frames
export const PAST_MIN = 60, AHEAD_MIN = 120; // the slider; W68 fixes: one colour all the way, no dimming past 60 min
export const POLL_MS = 5 * 60000;

/** A frame's time as IEM names it: "YYYYmmddHHMM", UTC. */
export const stamp = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 12);
export const unstamp = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
/** The block's tiles for the frame at `ms`: [{ x, y, url }]. */
export const tileUrls = (ms) => {
  const out = [];
  for (let j = 0; j < BLOCK.n; j++) for (let i = 0; i < BLOCK.n; i++) {
    const x = BLOCK.x + i, y = BLOCK.y + j;
    out.push({ i, j, url: `${HOST}/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-${stamp(ms)}/${BLOCK.z}/${x}/${y}.png` });
  }
  return out;
};
/** The newest frame's time from n0q_0.json ({ meta: { valid: "2026-10-19T16:30:00Z" } }), or NaN. */
export const validOf = (json) => { const t = Date.parse(json?.meta?.valid ?? ""); return Number.isFinite(t) && t % (STEP_MIN * 60000) === 0 ? t : NaN; };

// ---- where things are on the block ----
const merc = (lon, lat) => [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2];
const lonOf = (x) => x * 360 - 180, latOf = (y) => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;
const SPAN = BLOCK.n / 2 ** BLOCK.z; // the block's width in mercator units
const X0 = BLOCK.x / 2 ** BLOCK.z, Y0 = BLOCK.y / 2 ** BLOCK.z;
/** The block's corners, for MapLibre's image source: top left, top right, bottom right, bottom left. An image source is
 *  stretched linearly in mercator between them, and the cells are mercator pixels, so the radar sits true. */
export const CORNERS = [[X0, Y0], [X0 + SPAN, Y0], [X0 + SPAN, Y0 + SPAN], [X0, Y0 + SPAN]].map(([x, y]) => [lonOf(x), latOf(y)]);
/** [lon, lat] to cell coordinates (fractional; the centre of cell 0 is 0). */
export const cellOf = ([lon, lat]) => { const [x, y] = merc(lon, lat); return [((x - X0) / SPAN) * W - 0.5, ((y - Y0) / SPAN) * H - 0.5]; };
export const inBlock = (lonlat) => { const [x, y] = cellOf(lonlat); return x >= 0 && y >= 0 && x <= W - 1 && y <= H - 1; };
/** A cell's size in km at [lon, lat] (mercator's scale there). */
export const cellKm = (lat) => (40075.016686 * Math.cos((lat * Math.PI) / 180) * SPAN) / W;

// ---- IEM's N0Q palette: index i is i / 2 - 32.5 dBZ; 0 is transparent ----
export const N0Q_HEX = "00000085718f85728f86738d87758b87768b887789897987897a878a7b858b7d848b7e848c7f828d81808d82808e837e8f847c8f857c"
  + "90877b918879918979928b77938d759691539894579b975b9d9a60a09d64a3a068a5a36da8a671aaa976adac7ab0af7eb2b283b7b88c"
  + "babb90bdbe94bfc199c2c49dc4c7a2c7caa6cacdaaccd0afd2d4b4cfd2b4c9ccb4c6c9b4c3c7b4c0c4b4bdc1b4b9beb4b6bbb4b3b9b4"
  + "b0b6b4adb3b4aab0b4a4abb4a0a8b49da5b49aa2b497a0b4949db4919ab4949bb59098b48c95b38892b2808cb07c89af7886ae7483ac"
  + "7080ab6c7daa6779a96376a85f73a75b70a6576da44f67a24b64a14761a0435e9f415b9e4361a24568a6486faa4a76ae4d7db24f84b6"
  + "518bbb5699c3599fc75ba6cb5eadcf60b4d462bbd865c2dc67c9e06ad0e46fd6e868d6d759d6b352d6a24bd69043d67e3cd66d35d65b"
  + "11d51811d11710cd1710c81610c4160fbc150fb7140eb3140eaf130eab130da6120da2120d9e110c99110c95100c91100b880f0b840e"
  + "0a800e0a7c0d0a770d09730c096f0c096b0b08660b08620a095e09327308467d085b88076f9207849d0698a806adb205c1bd05d6c704"
  + "ead204ffe200ffd800ffd300ffce00ffc900ffc400ffc000ffbb00ffb600ffb100ffac00ffa700ffa200ff9900ff9400ff8f00ff8a00"
  + "ff8500ff8000ff0000f80000f10000ea0000e30000d50000cd0000c60000bf0000b80000b10000aa0000a300009b00009400008d0000"
  + "7f0000780000710000fffffffff5ffffeaffffdfffffd4ffffc9ffffbeffffb3ffff9dffff92ffff75fffc6bfdf960faf656f7f34bf4"
  + "f040f1ed36efea2bece720e9e10be3b200ffac00fca400f79b00f49300ef8800ea8300e87900e27200dd6900db05ecf005ebf005eaf0"
  + "05dde005dce005dbe005cdd005ccd004bdc004bcc004bbc004aeb004adb0049ea0049da0049ca0038e90038d90038c90037e80037d80"
  + "036f70036e70036d70025f60025e60024f50024e50024d50023f40023e40023d40013030012f30012020011f20011e203a67b53a66b5"
  + "3a65b53a64b53a63b53a62b5";
let pal = null;
/** The palette as [r, g, b] by index, and a lookup from 0xRRGGBB to its index. */
export function palette(hex = N0Q_HEX) {
  if (pal && pal.hex === hex) return pal;
  const rgb = [], index = new Map();
  for (let i = 0; i < hex.length / 6; i++) {
    const v = parseInt(hex.slice(6 * i, 6 * i + 6), 16);
    rgb.push([v >> 16, (v >> 8) & 255, v & 255]);
    if (i && !index.has(v)) index.set(v, i);
  }
  pal = { hex, rgb, index, near: new Map() };
  return pal;
}
/** The index of colour (r, g, b): exact, or the nearest entry (a browser that colour-manages the PNG moves a colour by a
 *  level or two), kept so each odd colour is looked for once. */
export function indexOfColour(r, g, b, p = palette()) {
  const v = (r << 16) | (g << 8) | b;
  const k = p.index.get(v) ?? p.near.get(v);
  if (k !== undefined) return k;
  let best = 0, bd = Infinity;
  for (let i = 1; i < p.rgb.length; i++) { const [R, G, B] = p.rgb[i], d = (R - r) ** 2 + (G - g) ** 2 + (B - b) ** 2; if (d < bd) { bd = d; best = i; } }
  p.near.set(v, best);
  return best;
}
export const dbzOf = (index) => index * 0.5 - 32.5;

/**
 * Decode one tile's RGBA pixels (256 x 256, from a canvas's getImageData) into `cells` (Float32Array W x H, dBZ, 0 under
 * the noise floor), max-pooled POOL x POOL, at tile (i, j) of the block. A transparent pixel is no echo.
 */
export function decodeTile(rgba, i, j, cells, p = palette()) {
  const S = 256, C = S / POOL, ox = i * C, oy = j * C;
  for (let cy = 0; cy < C; cy++) for (let cx = 0; cx < C; cx++) {
    let m = 0;
    for (let dy = 0; dy < POOL; dy++) for (let dx = 0; dx < POOL; dx++) {
      const k = 4 * ((cy * POOL + dy) * S + cx * POOL + dx);
      if (rgba[k + 3] < 128) continue;
      const idx = indexOfColour(rgba[k], rgba[k + 1], rgba[k + 2], p);
      if (idx > m) m = idx;
    }
    const d = dbzOf(m);
    cells[(oy + cy) * W + ox + cx] = m && d >= NOISE_DBZ ? d : 0;
  }
  return cells;
}
/** The same from index grids (Uint8, the block's 512 x 512 pixels), for the tests' fixtures. */
export function cellsOfIndex(idx, cells = new Float32Array(W * H)) {
  const S = BLOCK.n * 256;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 0;
    for (let dy = 0; dy < POOL; dy++) for (let dx = 0; dx < POOL; dx++) { const v = idx[(y * POOL + dy) * S + x * POOL + dx]; if (v > m) m = v; }
    const d = dbzOf(m);
    cells[y * W + x] = m && d >= NOISE_DBZ ? d : 0;
  }
  return cells;
}

// ---- the nowcast: nowcast.mjs as the research left it ----
export function bilin(a, w, h, x, y) {
  if (!(x >= 0 && y >= 0 && x <= w - 1 && y <= h - 1)) return NaN;
  const x0 = Math.min(Math.floor(x), w - 2), y0 = Math.min(Math.floor(y), h - 2), fx = x - x0, fy = y - y0;
  const i = y0 * w + x0;
  return a[i] * (1 - fx) * (1 - fy) + a[i + 1] * fx * (1 - fy) + a[i + w] * (1 - fx) * fy + a[i + w + 1] * fx * fy;
}

/**
 * Motion by block matching. `frames` are dBZ grids, oldest first, `dt` minutes apart. Each block's cost sums the
 * absolute differences over consecutive pairs (temporal consistency), searched over ±R cells per pair, with a
 * parabolic sub-cell fit. Returns the blocks, how many it kept, the robust global vector and a smooth per-cell field,
 * in cells a minute (u east, v south).
 */
export function motionField(frames, w, h, dt, { B = 24, step = 12, R = 10, minRain = 0.12 } = {}) {
  const blocks = [], n = frames.length, last = frames[n - 1];
  const S = 2 * R + 1, cost = new Float64Array(S * S);
  for (let by = 0; by + B <= h; by += step) for (let bx = 0; bx + B <= w; bx += step) {
    let wet = 0;
    for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) if (last[y * w + x] > 15) wet++;
    if (wet < minRain * B * B) continue;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      let c = 0, cnt = 0;
      for (let p = 1; p < n; p++) {
        const a = frames[p - 1], b = frames[p];
        for (let y = by; y < by + B; y++) {
          const ya = y - dy; if (ya < 0 || ya >= h) continue;
          for (let x = bx; x < bx + B; x++) {
            const xa = x - dx; if (xa < 0 || xa >= w) continue;
            c += Math.abs(b[y * w + x] - a[ya * w + xa]); cnt++;
          }
        }
      }
      cost[(dy + R) * S + dx + R] = cnt ? c / cnt : 1e9;
    }
    let best = 0;
    for (let k = 1; k < S * S; k++) if (cost[k] < cost[best]) best = k;
    const iy = Math.floor(best / S), ix = best % S;
    const sub = (cm, c0, cp) => { const den = cm - 2 * c0 + cp; return den > 0 ? (0.5 * (cm - cp)) / den : 0; };
    let fx = ix - R, fy = iy - R;
    if (ix > 0 && ix < S - 1) fx += sub(cost[iy * S + ix - 1], cost[best], cost[iy * S + ix + 1]);
    if (iy > 0 && iy < S - 1) fy += sub(cost[(iy - 1) * S + ix], cost[best], cost[(iy + 1) * S + ix]);
    blocks.push({ cx: bx + B / 2, cy: by + B / 2, u: fx / dt, v: fy / dt, wet, edge: ix === 0 || iy === 0 || ix === S - 1 || iy === S - 1 });
  }
  const good = blocks.filter((b) => !b.edge);
  const wmean = (arr) => {
    let su = 0, sv = 0, sw = 0;
    for (const b of arr) { su += b.u * b.wet; sv += b.v * b.wet; sw += b.wet; }
    return sw ? { u: su / sw, v: sv / sw } : { u: 0, v: 0 };
  };
  let g = wmean(good);
  const spread = (b) => Math.hypot(b.u - g.u, b.v - g.v);
  if (good.length > 4) {
    const ds = good.map(spread).sort((a, b) => a - b), cut = Math.max(ds[Math.floor(ds.length * 0.75)] * 1.5, 0.05);
    g = wmean(good.filter((b) => spread(b) <= cut));
  }
  const keep = good.filter((b) => spread(b) <= Math.max(0.6, 3 * Math.hypot(g.u, g.v)));
  return { blocks: blocks.length, keep: keep.length, global: g, ...smooth(keep, g, w, h, 2 * step, B) };
}
/** The field: Gaussian-weighted blocks, blended toward the global vector where blocks are sparse, on a coarse lattice. */
function smooth(keep, g, w, h, sig, B) {
  const U = new Float32Array(w * h), V = new Float32Array(w * h), G = 4, k0 = 1.0;
  const gw = Math.ceil(w / G) + 1, gh = Math.ceil(h / G) + 1, gu = new Float32Array(gw * gh), gv = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    let su = g.u * k0, sv = g.v * k0, sw = k0;
    for (const b of keep) {
      const r2 = ((i * G - b.cx) ** 2 + (j * G - b.cy) ** 2) / (sig * sig);
      if (r2 > 9) continue;
      const wt = Math.exp(-0.5 * r2) * Math.min(1, b.wet / (0.3 * B * B)) * 3;
      su += b.u * wt; sv += b.v * wt; sw += wt;
    }
    gu[j * gw + i] = su / sw; gv[j * gw + i] = sv / sw;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    U[y * w + x] = bilin(gu, gw, gh, x / G, y / G); V[y * w + x] = bilin(gv, gw, gh, x / G, y / G);
  }
  return { U, V };
}

/** The cheap path: block-match on a 2x max-pooled grid, then bring the field back to (w, h). */
export function motionFieldCoarse(frames, w, h, dt, opts = { B: 12, step: 12, R: 6 }) {
  const cw = Math.floor(w / 2), ch = Math.floor(h / 2);
  const pooled = frames.map((d) => {
    const o = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = 2 * y * w + 2 * x;
      o[y * cw + x] = Math.max(d[i], d[i + 1], d[i + w], d[i + w + 1]);
    }
    return o;
  });
  const m = motionField(pooled, cw, ch, dt, opts);
  const U = new Float32Array(w * h), V = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = Math.min(x / 2, cw - 1), cy = Math.min(y / 2, ch - 1);
    U[y * w + x] = 2 * bilin(m.U, cw, ch, cx, cy); V[y * w + x] = 2 * bilin(m.V, cw, ch, cx, cy);
  }
  return { blocks: m.blocks, keep: m.keep, global: { u: 2 * m.global.u, v: 2 * m.global.v }, U, V };
}
/** A field of one vector everywhere: the motion held from the last update, or none. */
export const constField = (w, h, u, v) => ({ U: new Float32Array(w * h).fill(u), V: new Float32Array(w * h).fill(v) });
/** Too few wet blocks to trust a motion: hold the last one (the 700 hPa wind would need a new host, Open-Meteo). */
export const FEW_BLOCKS = 3;

/** Backward semi-Lagrangian advection of `d` by (U, V), `lead` minutes ahead, in about 5-min steps. A cell whose source
 *  lies outside the block comes back NaN (unknown). */
export function advect(d, w, h, U, V, lead, sub = 5, out = new Float32Array(w * h)) {
  const nst = Math.max(1, Math.round(lead / sub)), st = lead / nst;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let px = x, py = y;
    for (let s = 0; s < nst; s++) {
      const u = bilin(U, w, h, px, py), v = bilin(V, w, h, px, py);
      if (Number.isNaN(u)) { px = -1; break; }
      px -= u * st; py -= v * st;
    }
    out[y * w + x] = bilin(d, w, h, px, py);
  }
  return out;
}
/** The forecast at one point (cell coordinates), every minute from 0 to `ahead`: one backward trajectory a minute,
 *  the nearest cell at its foot. NaN where it leaves the block. */
export function seriesAt(d, w, h, U, V, [x, y], ahead = 90, sub = 5) {
  const out = new Float32Array(ahead + 1);
  for (let m = 0; m <= ahead; m++) {
    const nst = Math.max(1, Math.round(m / sub)), st = m / nst;
    let px = x, py = y;
    for (let s = 0; s < nst && m; s++) {
      const u = bilin(U, w, h, px, py), v = bilin(V, w, h, px, py);
      if (Number.isNaN(u)) { px = NaN; break; }
      px -= u * st; py -= v * st;
    }
    const ix = Math.round(px), iy = Math.round(py);
    out[m] = ix >= 0 && iy >= 0 && ix < w && iy < h ? d[iy * w + ix] : NaN;
  }
  return out;
}

/** W55 weather2: the pictures the slider shows, minute by minute, made as it reaches them and kept. `frameAt(m)` is the
 *  observed frame m minutes from now (m <= 0, a multiple of 5) or null; (U, V) the motion. A 5-minute picture ahead is
 *  the newest frame advected m minutes, as before; any other minute is the 5-minute picture before it (a frame in the
 *  past, a picture ahead) advected the 1 to 4 minutes since. The 5-minute pictures are all kept (24 at most); the other
 *  minutes, the last `keep`. `made` counts the advections. */
export function pictures(frameAt, U, V, keep = 12) { // W55 weather2
  const five = new Map(), one = new Map(), stats = { made: 0 };
  const make = (d, lead) => { stats.made++; return advect(d, W, H, U, V, lead); };
  function at(m) {
    const b = Math.floor(m / STEP_MIN) * STEP_MIN;
    if (m === b && m <= 0) return frameAt(m);
    if (m === b) { if (!five.has(m)) { const d = frameAt(0); if (!d) return null; five.set(m, make(d, m)); } return five.get(m); }
    let d = one.get(m);
    if (d) { one.delete(m); one.set(m, d); return d; } // the most recent last
    const base = at(b);
    if (!base) return null;
    one.set(m, (d = make(base, m - b)));
    if (one.size > keep) one.delete(one.keys().next().value);
    return d;
  }
  return { at, stats, get kept() { return five.size + one.size; } };
}

/** For part 2 (the route card's row and the flight's line): along a route, `pts` [{ x, y, m }] (cells, and the minute
 *  the pilot gets there), the first point where it rains (>= thr) at that minute: its index, or -1. One trajectory a
 *  point. */
export function firstWet(d, w, h, U, V, pts, thr = RAIN_DBZ) {
  for (let i = 0; i < pts.length; i++) { const { x, y, m } = pts[i], s = seriesAt(d, w, h, U, V, [x, y], Math.max(0, Math.round(m))); if (s[s.length - 1] >= thr) return i; }
  return -1;
}

/** Along a point's minutes (series[m], dBZ, m = 0 the frame now): the first minute it rains (>= thr) within `within`
 *  minutes and for how long after it, to the series' end at most, a dry spell of `gap` minutes or less counting as
 *  rain (showers come in bands); or null. NaN is unknown, read as dry. */
export function onsetOf(series, thr = RAIN_DBZ, within = 60, gap = 5) {
  let start = -1, end = -1;
  for (let m = 0; m < series.length; m++) {
    if (series[m] >= thr) { if (start < 0) { if (m > within) break; start = m; } end = m; } else if (start >= 0 && m - end > gap) break;
  }
  return start < 0 ? null : { start, dur: end - start + 1, open: end === series.length - 1 };
}

// ---- the words ----
const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);
/** The chip's line at the pilot's spot, from onsetOf(): "Radiation in 12 min, for 20 min", "Radiation now", or
 *  "No radiation" (W58 clean: within the hour goes without saying). SCUL's word for rain is radiation (BRIEF §6.3); in
 *  Plain (W60 c, `mode` "meatspace", else the setting's) "Rain in 12 min, for 20 min", "Rain now", "No rain". */
export function chipLine(on, mode = lingo()) { // W60 c: mode
  const k = mode === "meatspace" ? 1 : 0; // W60 c
  if (!on) return [NONE, "No rain"][k]; // W58 clean; W60 c
  if (on.start === 0) return ["Radiation now", "Rain now"][k]; // W60 c
  const dur = on.open || on.dur >= 60 ? "for an hour or more" : `for ${round5(on.dur)} min`; // W58 clean: no "about": a forecast to 5 min says so
  return [`Radiation in ${span(on.start)}, ${dur}`, `Rain in ${span(on.start)}, ${dur}`][k]; // W60 c; W68 fixes: span
}
/** The slider's words for minute `m` (-60 to 120): "Now", "40 min ago", "In 25 min", "In 1h 30m", "1h ago" (W58 clean: no ", less sure"; W68 fixes: span). */
export const whenLine = (m) => (m === 0 ? "Now" : m < 0 ? `${span(-m)} ago` : `In ${span(m)}`); // W58 clean; W68 fixes: span
// ---- W58 clean: the slider by the clock ----
/** The newest frame's age in whole minutes at `now`, 0 to AHEAD_MIN: the slider's 0 is the clock's now, and its minute
 *  m shows the frame's minute m + age (a nowcast, even at 0). */
export const ageMin = (valid, now) => (Number.isFinite(valid) ? Math.max(0, Math.min(AHEAD_MIN, Math.floor((now - valid) / 60000))) : 0);
/** The dBZ at a spot by the clock: index i is clock minute i - PAST_MIN, from -PAST_MIN to AHEAD_MIN - age. Ahead of the
 *  frame, from `series` (seriesAt(), every minute from the frame, 0 to AHEAD_MIN); before it, from `past` (the observed
 *  frames at the spot, 0, 5 … PAST_MIN min before the newest), the frame at or before each minute. NaN is unknown. */
export function spotByClock(series, past, age) {
  const out = new Float32Array(PAST_MIN + AHEAD_MIN + 1 - age);
  for (let i = 0; i < out.length; i++) { const f = i - PAST_MIN + age; out[i] = (f >= 0 ? series[f] : past[Math.ceil(-f / STEP_MIN)]) ?? NaN; }
  return out;
}
/** The slider's track from spotByClock(): runs [{ from, to, k }] of clock minutes (to exclusive), k "wet" (>= thr),
 *  "dry" or "unknown". A dry spell of `gap` minutes or less between two wet ones is wet, as onsetOf() reads it. */
export function trackRuns(d, thr = RAIN_DBZ, gap = 5) {
  const out = [];
  for (let i = 0; i < d.length; i++) {
    const v = d[i], m = i - PAST_MIN, last = out[out.length - 1];
    const k = v >= thr ? "wet" : v === v ? "dry" : "unknown";
    if (k === "wet" && last?.k === "dry" && last.to - last.from <= gap && out[out.length - 2]?.k === "wet") { out.pop(); out[out.length - 1].to = m; } // the band goes on
    const prev = out[out.length - 1];
    if (prev?.k === k) prev.to = m + 1; else out.push({ from: m, to: m + 1, k });
  }
  return out;
}
/** The slider's marks between clock minutes `min` and `max`, with `now` (ms) at minute 0: [{ m, major, label }], a mark
 *  at every round 10 min of the clock, the :00 and :30 ones major and labelled with their time ("4:30"), and "Now" at 0. A
 *  major's label within `clear` minutes of Now is left off, so the two don't run together. `clock(ms)` writes a time. */
export function marks(min, max, now, clock, clear = 15) {
  const base = Math.floor(now / 60000) * 60000, out = [{ m: 0, major: true, now: true, label: "Now" }];
  const first = Math.ceil((base + min * 60000) / 600000) * 600000;
  for (let t = first; t <= base + max * 60000; t += 600000) {
    const m = Math.round((t - base) / 60000);
    if (m === 0) continue;
    const major = new Date(t).getMinutes() % 30 === 0;
    out.push({ m, major, label: major && Math.abs(m) >= clear ? clock(t) : "" });
  }
  return out.sort((a, b) => a.m - b.m);
}

// ---- W55 weather2: the chip's icon, from its words and the time of day ----
const RAD = Math.PI / 180;
/** The sun's altitude in degrees at [lon, lat] and time `ms`: the low-precision almanac formula (about 0.01° in the
 *  declination), worked out on the phone. */
export function sunAltitude(ms, [lon, lat]) {
  const d = ms / 86400000 - 10957.5; // days from J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD, e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ha = ((280.46061837 + 360.98564736629 * d + lon) * RAD) - ra; // the local sidereal time less the right ascension
  return Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha)) / RAD;
}
/** Day while the sun's upper edge is above the horizon, refraction included, as sunrise and sunset are reckoned. */
export const isDay = (ms, lonlat) => sunAltitude(ms, lonlat) > -0.833;
export const NONE = "No radiation"; // W58 clean: was "No radiation for the next hour"
/** The chip's icon for its words: "rain" (radiation now), "soon" (radiation in N min), "dry-day" or "dry-night" (none
 *  for the hour: dry, never a promise of sun, which the radar can't see), "out" (outside the radar's reach), "offline",
 *  "looking" (no radar yet) or "paused" (Data Saver, or the radar unavailable). */
export function chipIcon(words, day) {
  if (words === "Radiation now" || words === "Rain now") return "rain"; // W60 c: SCUL's words or Plain's
  if (/^(Radiation|Rain) in /.test(words)) return "soon"; // W60 c
  if (words === NONE || words === "No rain") return day ? "dry-day" : "dry-night"; // W60 c
  if (words === "Outside the radar's reach") return "out";
  if (words === "The radar needs a connection") return "offline";
  if (words === "Looking at the radar…") return "looking";
  return "paused";
}
/** "Updated 4 min ago", from the newest frame's time. */
export const ageLine = (valid, now) => { const a = Math.max(0, Math.round((now - valid) / 60000)); return a < 1 ? "Updated just now" : `Updated ${span(a)} ago`; }; // W68 fixes: span

// ---- the politeness rules, as the comets' (SPEC §41) ----
/** It asks only with the layer on, the page visible, online, the chart showing and Data Saver off. */
/** W73 polish: the showers' motion in the sheet's note, in mph (Warp's unit) in both modes; none under 3 km/h. */
export const KMH_MPH = 1 / 1.609344; // W73 polish
const COMPASS = ["the north", "the north-east", "the east", "the south-east", "the south", "the south-west", "the west", "the north-west"]; // W73 polish: from weather.js
export const movingLine = (m) => (m && m.kmh >= 3 ? `Moving ${Math.round(m.kmh * KMH_MPH)} mph from ${COMPASS[Math.round(m.from / 45) % 8]}${m.held ? ", held from before" : ""}` : ""); // W73 polish
export const mayPoll = (s) => !!(s.on && s.visible && s.online && s.chart && !s.saveData);
/** The minutes back it fetches: on mobile data the three frames the motion needs, until the slider is touched; else the
 *  past hour. */
export const wantedBack = ({ cellular = false, slider = false } = {}) => {
  const out = [];
  for (let m = 0; m <= PAST_MIN; m += STEP_MIN) if (!cellular || slider || m % 10 === 0 && m <= 20) out.push(m);
  return out;
};
/** After `fails` failures in a row, the wait before the next try: 1, 2, 4, 8, 16 then 30 min. */
export const backoff = (fails) => Math.min(30, 2 ** Math.max(0, fails - 1)) * 60000;
/** When to look for the next frame: about 4.5 min after the newest one's time (IEM writes it a little before that
 *  time), and at least a minute from now. */
export const nextPoll = (valid, now) => Math.max(60000, Math.min(POLL_MS, valid + 4.5 * 60000 - now));

// ---- the look: quiet, at the light end ----
/** The contours' levels, dBZ: radiation (light rain), heavier, heavy radiation. */
export const LEVELS = [20, 35, 45];
/** The wash's alpha (0-255) at `d` dBZ: from 8 % at 15 to under a third at 45 and up, so heavy radiation over the whole
 *  chart still leaves it readable. */
export const washAlpha = (d) => (d < 15 ? 0 : Math.round(20 + 60 * Math.min(1, (d - 15) / 30)));
/** A 3 x 3 box blur of `d` (W x H), for the picture: the 1.8 km cells' speckle smoothed, the contours rounder. */
export function blur(d, out = new Float32Array(W * H)) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, y - 1); j <= Math.min(H - 1, y + 1); j++) for (let i = Math.max(0, x - 1); i <= Math.min(W - 1, x + 1); i++) { const v = d[j * W + i]; if (v === v) { s += v; n++; } }
    out[y * W + x] = n ? s / n : 0;
  }
  return out;
}
/** Paint the wash of `d` (W x H dBZ) into `rgba` (W x H x 4) in colour `rgb`, its alpha times `gain` (Daystar's 1.5:
 *  its olive on the pale page shows less than the lime on the void). */
export function paint(d, rgba, rgb, gain = 1) {
  for (let k = 0; k < W * H; k++) {
    const o = 4 * k, a = Math.min(255, washAlpha(d[k] || 0) * gain);
    rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; rgba[o + 3] = a;
  }
  return rgba;
}
/** A cell coordinate back to [lon, lat]. */
export const lonLatOf = (x, y) => [lonOf(X0 + ((x + 0.5) / W) * SPAN), latOf(Y0 + ((y + 0.5) / H) * SPAN)];
/**
 * The contours of `d` at `level` by marching squares, joined into lines: [[x0, y0, x1, y1, …], …] in cell coordinates.
 * Lines run so that the higher side is on their left, and close on themselves where they can.
 */
export function contour(d, level) {
  const segs = [];
  const v = (x, y) => { const a = d[y * W + x]; return a === a ? a : 0; };
  const lerp = (a, b) => (level - a) / (b - a);
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const a = v(x, y), b = v(x + 1, y), c = v(x + 1, y + 1), e = v(x, y + 1); // corners: top left, top right, bottom right, bottom left
    const k = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (e >= level ? 1 : 0);
    if (k === 0 || k === 15) continue;
    const T = [x + lerp(a, b), y], R = [x + 1, y + lerp(b, c)], B = [x + lerp(e, c), y + 1], L = [x, y + lerp(a, e)];
    const add = (p, q) => segs.push(p[0], p[1], q[0], q[1]);
    switch (k) {
      case 1: case 14: add(L, B); break;
      case 2: case 13: add(B, R); break;
      case 3: case 12: add(L, R); break;
      case 4: case 11: add(T, R); break;
      case 6: case 9: add(T, B); break;
      case 7: case 8: add(L, T); break;
      case 5: add(L, T); add(B, R); break;
      case 10: add(T, R); add(L, B); break;
    }
  }
  // join the segments end to end
  const key = (x, y) => `${Math.round(x * 64)},${Math.round(y * 64)}`;
  const ends = new Map(), used = new Uint8Array(segs.length / 4);
  for (let i = 0; i < used.length; i++) for (const e of [0, 2]) {
    const kk = key(segs[4 * i + e], segs[4 * i + e + 1]);
    (ends.get(kk) ?? ends.set(kk, []).get(kk)).push(i);
  }
  const lines = [];
  for (let i = 0; i < used.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [segs[4 * i], segs[4 * i + 1], segs[4 * i + 2], segs[4 * i + 3]];
    for (const dir of [1, -1]) {
      for (;;) {
        const n = line.length, px = dir > 0 ? line[n - 2] : line[0], py = dir > 0 ? line[n - 1] : line[1];
        const next = (ends.get(key(px, py)) ?? []).find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = 1;
        const s0 = [segs[4 * next], segs[4 * next + 1]], s1 = [segs[4 * next + 2], segs[4 * next + 3]];
        const far = key(s0[0], s0[1]) === key(px, py) ? s1 : s0;
        if (dir > 0) line.push(far[0], far[1]); else line.unshift(far[0], far[1]);
      }
    }
    if (line.length >= 6) lines.push(line); // a line of one segment is a speck
  }
  return lines;
}
