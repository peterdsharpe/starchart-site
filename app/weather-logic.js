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

/** W217 weather3 (SPEC §420): the backward trajectory from cell (x, y), `lead` minutes, in about `sub`-minute steps: the
 *  index of the nearest cell at its foot, or -1 where it leaves the block. advect() and pictures().cell() both go through it. */
export function footCell(w, h, U, V, x, y, lead, sub = 5) {
  const nst = Math.max(1, Math.round(lead / sub)), st = lead / nst;
  let px = x, py = y;
  for (let s = 0; s < nst; s++) {
    const u = bilin(U, w, h, px, py), v = bilin(V, w, h, px, py);
    if (Number.isNaN(u)) return -1;
    px -= u * st; py -= v * st;
  }
  const ix = Math.round(px), iy = Math.round(py);
  return ix >= 0 && iy >= 0 && ix < w && iy < h ? iy * w + ix : -1;
}
/** Backward semi-Lagrangian advection of `d` by (U, V), `lead` minutes ahead, in about 5-min steps. A cell whose source
 *  lies outside the block comes back NaN (unknown). W217 weather3: each cell takes the nearest cell at its foot (it took
 *  the four round it, weighted), so a small shower of light rain moves on whole instead of thinning under 20 dBZ. */
export function advect(d, w, h, U, V, lead, sub = 5, out = new Float32Array(w * h)) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = footCell(w, h, U, V, x, y, lead, sub); out[y * w + x] = k < 0 ? NaN : d[k]; } // W217 weather3
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
  /** W217 weather3 (SPEC §420): at(m)'s cell (i, j), the same value, worked out alone where the picture isn't kept (NaN
   *  unknown), so a spot's minutes read the pictures the map draws without making them. */
  function cell(m, i, j) {
    const b = Math.floor(m / STEP_MIN) * STEP_MIN, kept = m === b ? five.get(m) : one.get(m);
    if (m === b && m <= 0) { const d = frameAt(m); return d ? d[j * W + i] : NaN; }
    if (kept) return kept[j * W + i];
    if (m === b) { const d = frameAt(0), k = d ? footCell(W, H, U, V, i, j, m) : -1; return k < 0 ? NaN : d[k]; }
    const k = footCell(W, H, U, V, i, j, m - b);
    return k < 0 ? NaN : cell(b, k % W, Math.floor(k / W));
  }
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
  return { at, cell, stats, get kept() { return five.size + one.size; } }; // W217 weather3: cell
}
/** W217 weather3 (SPEC §420), her row 32: the minutes at a point (x, y in cells) from minute `from` to `to` of `pics`
 *  (pictures()), each the step the map marks there then (bandAt() of the picture's cells), as its level's dBZ (20 light, 35
 *  steady, 45 heavy) or 0, dry; NaN, unknown, where the map marks nothing and the cell under it isn't known. The words, the
 *  slider's track and a route's rain all read this, and the map draws the same pictures (markAreas()), so what they say
 *  is what the map shows. It took one trajectory from the point itself to the frame's nearest cell (seriesAt), where the
 *  map drew from the pictures blurred 3 x 3, so a small shower of light rain was said and never drawn. */
export function spotSeries(pics, [x, y], from, to) {
  const out = new Float32Array(to - from + 1), ix = Math.round(x), iy = Math.round(y), on = ix >= 0 && iy >= 0 && ix < W && iy < H;
  for (let m = from; m <= to; m++) {
    const k = bandAt((i, j) => (i < 0 || j < 0 || i >= W || j >= H ? 0 : bandOf(pics.cell(m, i, j))), x, y);
    out[m - from] = k ? LEVELS[k - 1] : on && !Number.isNaN(pics.cell(m, ix, iy)) ? 0 : NaN;
  }
  return out;
}

/** For part 2 (the route card's row and the flight's line): along a route, `pts` [{ x, y, m }] (cells, and the minute
 *  the pilot gets there), the first point where it rains (>= thr) at that minute: its index, or -1. W217 weather3: from
 *  `pics`, as spotSeries() reads them (was one trajectory a point, from the frame). */
export function firstWet(pics, pts, thr = RAIN_DBZ) { // W217 weather3: pics
  for (let i = 0; i < pts.length; i++) { const { x, y, m } = pts[i], at = Math.max(0, Math.round(m)); if (spotSeries(pics, [x, y], at, at)[0] >= thr) return i; }
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
 *  Plain (W60 c, `mode` "meatspace", else the setting's) "Rain in 12 min, for 20 min", "Rain now", "No rain".
 *  W201 weather2 (SPEC §360): from rainOf() (its `step`) and lastsOf() (`lasts`, past the radar's end the forecast's), the
 *  whole story: "Rain in 12 min, light, for about 20 min", "Rain now, heavy, likely until about 9:00" (`clock(ms)` writes a time). */
export function chipLine(on, mode = lingo(), { lasts = on && lastsOf(on), clock = String } = {}) { // W60 c: mode; W201 weather2: lasts, clock
  const k = mode === "meatspace" ? 1 : 0; // W60 c
  if (!on) return [NONE, "No rain"][k]; // W58 clean; W60 c
  const tail = [on.step == null ? null : STRENGTHS[on.step], lastsLine(lasts, clock)].filter(Boolean).join(", "); // W201 weather2: how hard, how long
  if (on.start === 0) return `${["Radiation now", "Rain now"][k]}, ${tail}`; // W60 c; W201 weather2: and the story
  return [`Radiation in ${span(on.start)}, ${tail}`, `Rain in ${span(on.start)}, ${tail}`][k]; // W60 c; W68 fixes: span
}
// ---- W201 weather2 (SPEC §360): the rain ahead told whole: when it comes (onsetOf()), how hard and how long ----
/** The steps' words, the map's three (LEVELS: light from 20 dBZ, steady from 35, heavy from 45), as its key names them. */
export const STRENGTHS = ["light", "steady", "heavy"];
/** A step counts once the band holds it this many minutes running, so a minute's spike doesn't make a shower heavy. */
export const HOLD_MIN = 3;
/** onsetOf()'s band { start, dur, open } and `step`, its strength: the heaviest step it holds HOLD_MIN minutes running (for a
 *  shorter band, all of it): 0 light, 1 steady, 2 heavy; or null. NaN is unknown, read as dry. */
export function rainOf(series, thr = RAIN_DBZ, within = 60, gap = 5) {
  const on = onsetOf(series, thr, within, gap);
  if (!on) return null;
  const n = Math.min(HOLD_MIN, on.dur);
  let held = -Infinity;
  for (let i = on.start; i + n <= on.start + on.dur; i++) {
    let lo = Infinity;
    for (let j = i; j < i + n; j++) lo = Math.min(lo, Number.isNaN(series[j]) ? -Infinity : series[j]);
    held = Math.max(held, lo);
  }
  return { ...on, step: held >= LEVELS[2] ? 2 : held >= LEVELS[1] ? 1 : 0 };
}
/** How long it lasts, as the call says it: { min } to 5 min under an hour ("for about 20 min"); { hour: true } for an hour or
 *  more; past the radar's end (`open`) the forecast's `beyond` (app/weather-forecast.js rainUntil(): { until: ms }, "likely until
 *  about 9:00", or { day: true }, "likely the rest of the day"), else what the radar saw, { hour: true } or { more: min }
 *  ("for 40 min or more"), never a guess. */
export function lastsOf(on, beyond = null) {
  if (on.open && beyond) return beyond;
  if (round5(on.dur) >= 60) return { hour: true }; // 58 min and up: an hour, so no "about 60 min"
  if (!on.open) return { min: round5(on.dur) };
  return on.dur >= 5 ? { more: Math.floor(on.dur / 5) * 5 } : null; // the radar's last minutes: how long, not known
}
/** lastsOf()'s words in the chip's line and the banner. */
export function lastsLine(l, clock = String) {
  if (!l) return "";
  if (l.until) return `likely until about ${clock(l.until)}`;
  if (l.day) return "likely the rest of the day";
  if (l.hour) return "for an hour or more";
  return l.more ? `for ${l.more} min or more` : `for about ${l.min} min`;
} // W201 weather2
/** The slider's words for minute `m` (-60 to 120): "Now", "40 min ago", "In 25 min", "In 1h 30m", "1h ago" (W58 clean: no ", less sure"; W68 fixes: span). */
export const whenLine = (m) => (m === 0 ? "Now" : m < 0 ? `${span(-m)} ago` : `In ${span(m)}`); // W58 clean; W68 fixes: span
// ---- W58 clean: the slider by the clock ----
/** The newest frame's age in whole minutes at `now`, 0 to AHEAD_MIN: the slider's 0 is the clock's now, and its minute
 *  m shows the frame's minute m + age (a nowcast, even at 0). */
export const ageMin = (valid, now) => (Number.isFinite(valid) ? Math.max(0, Math.min(AHEAD_MIN, Math.floor((now - valid) / 60000))) : 0);
/** The dBZ at a spot by the clock: index i is clock minute i - PAST_MIN, from -PAST_MIN to AHEAD_MIN - age. Ahead of the
 *  frame, from `series` (spotSeries(), every minute from the frame, 0 to AHEAD_MIN); before it, from `past` (W217 weather3:
 *  the same, past[i] the frame's minute -i, 0 to PAST_MIN, as the pictures the slider shows there; was the observed frames
 *  every 5 min, the one at or before each minute). NaN is unknown. */
export function spotByClock(series, past, age) {
  const out = new Float32Array(PAST_MIN + AHEAD_MIN + 1 - age);
  for (let i = 0; i < out.length; i++) { const f = i - PAST_MIN + age; out[i] = (f >= 0 ? series[f] : past[-f]) ?? NaN; } // W217 weather3: by the minute
  return out;
}
/** The slider's track from spotByClock(): runs [{ from, to, k }] of clock minutes (to exclusive), k "wet" (>= thr),
 *  "dry" or "unknown". W217 weather3 (SPEC §420): each minute as the map marks it, so a wet minute on the track has marks
 *  at the spot and a dry one none (a dry spell of 5 min or less between two wet ones was drawn wet, as onsetOf() reads it). */
export function trackRuns(d, thr = RAIN_DBZ) {
  const out = [];
  for (let i = 0; i < d.length; i++) {
    const v = d[i], m = i - PAST_MIN;
    const k = v >= thr ? "wet" : v === v ? "dry" : "unknown";
    const prev = out[out.length - 1];
    if (prev?.k === k) prev.to = m + 1; else out.push({ from: m, to: m + 1, k });
  }
  return out;
}
/** The slider's marks between clock minutes `min` and `max`, with `now` (ms) at minute 0: [{ m, major, label }], a mark
 *  at every round 10 min of the clock, the :00 and :30 ones major and labelled with their time ("4:30"), and "Now" at 0. A
 *  major's label within `clear` minutes of Now is left off, so the two don't run together. `clock(ms)` writes a time. R2 bigtext
 *  (SPEC §450): `every` 60 labels the :00 majors alone, where 30 min of track is too narrow for a label. */
export function marks(min, max, now, clock, clear = 15, every = 30) {
  const base = Math.floor(now / 60000) * 60000, out = [{ m: 0, major: true, now: true, label: "Now" }];
  const first = Math.ceil((base + min * 60000) / 600000) * 600000;
  for (let t = first; t <= base + max * 60000; t += 600000) {
    const m = Math.round((t - base) / 60000);
    if (m === 0) continue;
    const major = new Date(t).getMinutes() % 30 === 0;
    out.push({ m, major, label: major && new Date(t).getMinutes() % every === 0 && Math.abs(m) >= clear ? clock(t) : "" }); // R2 bigtext: every
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
/** The chip's icon for its words: "rain" (radiation now), "soon" (radiation in N min), "dry" (none for the hour: dry,
 *  never a promise of sun, which the radar can't see; W160 smallui: one by day and night, her note 15), "out" (outside the radar's reach), "offline",
 *  "looking" (no radar yet) or "paused" (Data Saver, or the radar unavailable). */
export function chipIcon(words) {
  if (/^(Radiation|Rain) now\b/.test(words)) return "rain"; // W60 c: SCUL's words or Plain's; W201 weather2: and the story after them
  if (/^(Radiation|Rain) in /.test(words)) return "soon"; // W60 c
  if (words === NONE || words === "No rain") return "dry"; // W60 c; W160 smallui
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
export const movingLine = (m) => (m && m.kmh >= 3 ? `Moving ${Math.round(m.kmh * KMH_MPH)} mph from ${COMPASS[Math.round(m.from / 45) % 8]}` : ""); // W73 polish; W140 words: a held motion says nothing more (the age leads the line)
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
/** W112 weatherlook (SPEC §223): the intensity's steps, at the contours' levels: 0 dry (under 15 dBZ), 1 a trace (15-20),
 *  2 light (20-35), 3 steady (35-45), 4 heavy (45 and up). */
export const stepOf = (d) => (d < 15 ? 0 : d < LEVELS[0] ? 1 : d < LEVELS[1] ? 2 : d < LEVELS[2] ? 3 : 4);
// W211 maplook2 (SPEC §394), her row 29 of 2026-11-09: "very mild rain causes the map to be shaded in light gray, which is barely noticeable,
// without displaying rain drops ... get rid of the shading and just display the rain drop pattern": no wash (W112's WASH, a stepped alpha
// in the ink under every step, and the trace's alone): every step is its marks alone, and the trace below LEVELS[0] (RAIN_DBZ, where the
// chip says "No rain") draws nothing.
/** W211 maplook2: whether the picture at the slider's minute steps on by the clock, with no new frame: with the sheet open, each minute;
 *  shut and parked, a frame's time (STEP_MIN) after it was drawn (W102 leftovers); in flight, where the marks are drawn now, only once a new
 *  frame is overdue (its frame's time past due), so a ride's marks change once a radar frame, the frame's own update the one. */
export const clockStep = ({ open, flying, age, drawnAge }) => (open ? age !== drawnAge : age - drawnAge >= STEP_MIN && (!flying || age >= 2 * STEP_MIN));
/** W112 weatherlook: the rain streaks, one fill pattern a level: `size` the tile in CSS px, each streak [x, y] its top (it
 *  falls `len` px: left and down), `alpha` 0-1 and `width` in CSS px. W177 weatherlook (SPEC §315, her note: "a textured
 *  cloud with dashes … I am only seeing a very faint Green Cloud"): marks she can see, slanted as the chip's rain icon's
 *  drops; a mark crossing the tile's edge goes on in the next tile. W200 rainlook (SPEC §355, her row 3: "I cannot tell
 *  which intensity level is currently being displayed … Shorter, rounder drops for light rain, and more elongated ones for
 *  heavy rain"): the shape tells the step, and each step draws its own alone (areas()' `top`, no longer stacked): light
 *  rain round drops (6 a tile, 3 px), steady dashes (8, 6.5 px long, as W177's steady), heavy long streaks (6, 12 px),
 *  the ink about doubling at each step as before. W206 rain2 (SPEC §381, her row 21: "too dense and they prevent me from
 *  seeing the map clearly … less dense?"): fewer, finer marks, the same shapes: 4 drops 2.4 px wide and rounder (were 6 at 3), 5 dashes
 *  1.5 px (8 at 1.8), 4 streaks 1.8 px (6 at 2.4), spread as far apart as the tile allows; about half the ink at each step. */
export const HATCH = { size: 32, levels: [
  { level: LEVELS[0], streaks: [[7.5, 5.5], [23.5, 8.5], [12.5, 21.5], [28.5, 24.5]], len: [-0.3, 0.7], alpha: 0.9, width: 2.4 }, // W200 rainlook: drops; W206 rain2: fewer, finer, each about a pixel's middle, so it draws round at 1x too
  { level: LEVELS[1], streaks: [[11, 5], [23, 5], [30, 15], [17, 21], [4, 27]], len: [-2.5, 6], alpha: 0.9, width: 1.5 }, // W200 rainlook: dashes; W206 rain2: fewer, finer
  { level: LEVELS[2], streaks: [[7, 3], [15, 11], [23, 19], [31, 27]], len: [-4.6, 11], alpha: 1, width: 1.8 }, // W200 rainlook: streaks; W206 rain2: fewer, finer
] };
/** W112 weatherlook: the hatch's image name at a contour level. */
export const hatchId = (level) => `wx-rain-${LEVELS.indexOf(level) + 1}`;
/** W228 looks7 (SPEC §480), her row 8 of 11-13: "draw each one as a complete little sample, with only whole marks, evenly spaced and
 *  centred, with a bit of space before the label, so Light, Steady and Heavy clearly step up". A step's sample in the legends (the Layers
 *  tile's ⓘ, app/layers.js; the Weather panel's key, app/weather.js) is the map's own marks, HATCH's shape for that step (its slant and
 *  length, width and alpha), so the samples follow the marks when they change: `n` of them a step, one more at each, evenly spaced,
 *  the group centred in one w × h box for all three, every mark whole and `pad` clear of its edges. */
export const RAIN_KEY = { w: 40, h: 20, pad: 4, n: [3, 4, 5] };
/** W228 looks7: step k's sample (k 0 light, 1 steady, 2 heavy): { at: each mark's top [x, y], len, width, alpha }, as HATCH's levels. */
export function keyMarks(k, { w, h, pad, n } = RAIN_KEY) {
  const { len, width, alpha } = HATCH.levels[k], m = n[k], step = m > 1 ? (w - 2 * pad - Math.abs(len[0]) - width) / (m - 1) : 0;
  return { at: Array.from({ length: m }, (_, i) => [w / 2 + (i - (m - 1) / 2) * step - len[0] / 2, h / 2 - len[1] / 2]), len, width, alpha };
}
/** W228 looks7: step k's sample as an SVG of RAIN_KEY's size, for a mask (only its alpha counts: app.css paints it in the theme's ink). */
export const keySvg = (k) => { const { at, len, width, alpha } = keyMarks(k), f = (v) => +v.toFixed(3); return `<svg xmlns='http://www.w3.org/2000/svg' width='${RAIN_KEY.w}' height='${RAIN_KEY.h}'><path d='${at.map(([x, y]) => `M${f(x)} ${f(y)}l${len[0]} ${len[1]}`).join("")}' stroke='currentColor' stroke-width='${width}' stroke-opacity='${alpha}' stroke-linecap='round'/></svg>`; };
// W217 weather3 (SPEC §420), her row 32: no 3 x 3 blur under the marks (W52's, for the wash's speckle): it took two thirds of a
// light shower's cells under 20 dBZ, so the sheet said rain the map never drew. The marks are drawn from each cell's step instead.
/** W217 weather3: a cell's step as the map marks it: 0 none (under 20 dBZ, or unknown), 1 light, 2 steady, 3 heavy. */
export const bandOf = (v) => (v >= LEVELS[2] ? 3 : v >= LEVELS[1] ? 2 : v >= LEVELS[0] ? 1 : 0);
/** W217 weather3: the marks of a picture `d` (W x H, dBZ): each step's band, light, steady and heavy, as areas() of the cells'
 *  steps (bandOf()) at k + 0.5, so the edge runs half way between a cell and its neighbour of another step, and a lone cell
 *  of light rain is marked as surely as a wide one. [{ level (its dBZ, LEVELS[k]), polys }]; bandAt() reads the same. */
export function markAreas(d) {
  const s = new Uint8Array(W * H);
  for (let k = 0; k < s.length; k++) s[k] = bandOf(d[k]);
  return LEVELS.map((level, k) => ({ level, polys: areas(s, k + 0.5, k + 1 < LEVELS.length ? k + 1.5 : null) }));
}
/** W217 weather3: the step markAreas() marks at (x, y) (cells), from the four cells round it, `get(i, j)` each one's step (0 off
 *  the block, as areas()' edge): for each step, its square as contour() cuts it (the corners at the step or more, and the
 *  edges' crossings, in order round the square), the point in it or not. */
export function bandAt(get, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const a = get(x0, y0), b = get(x0 + 1, y0), c = get(x0 + 1, y0 + 1), e = get(x0, y0 + 1); // top left, top right, bottom right, bottom left
  for (let k = LEVELS.length; k >= 1; k--) {
    const l = k - 0.5, lerp = (p, q) => (l - p) / (q - p), pts = [];
    if (a >= l) pts.push(0, 0);
    if ((a >= l) !== (b >= l)) pts.push(lerp(a, b), 0);
    if (b >= l) pts.push(1, 0);
    if ((b >= l) !== (c >= l)) pts.push(1, lerp(b, c));
    if (c >= l) pts.push(1, 1);
    if ((c >= l) !== (e >= l)) pts.push(lerp(e, c), 1);
    if (e >= l) pts.push(0, 1);
    if ((e >= l) !== (a >= l)) pts.push(0, lerp(a, e));
    let inside = false;
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) if ((pts[i + 1] > fy) !== (pts[j + 1] > fy) && fx < ((pts[j] - pts[i]) * (fy - pts[i + 1])) / (pts[j + 1] - pts[i + 1]) + pts[i]) inside = !inside;
    if (inside) return k;
  }
  return 0;
}
/** A cell coordinate back to [lon, lat]. */
export const lonLatOf = (x, y) => [lonOf(X0 + ((x + 0.5) / W) * SPAN), latOf(Y0 + ((y + 0.5) / H) * SPAN)];
/**
 * The contours of `d` at `level` by marching squares, joined into lines: [[x0, y0, x1, y1, …], …] in cell coordinates.
 * Lines run so that the higher side is on their left, and close on themselves where they can.
 */
export function contour(d, level, w = W, h = H) { // W112 weatherlook: w, h for areas()' edged grid
  const segs = [];
  const v = (x, y) => { const a = d[y * w + x]; return a === a ? a : 0; };
  const lerp = (a, b) => (level - a) / (b - a);
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
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
/**
 * W112 weatherlook: the areas of `d` at `level` or above, as polygons [[outer, ...holes], …] (each ring a closed flat
 * [x0, y0, …] in cell coordinates), for the hatch's fill. The grid is edged with a dry cell all round, so every ring
 * closes; a ring inside an odd number of others is a hole, in the smallest of them (contour()'s segments don't keep one
 * winding, so it is told by nesting). W200 rainlook (SPEC §355): with `top`, the band from `level` up to `top` only, so each
 * step draws its own marks alone: the rings at both levels, nested as before (a heavier area is a hole in it, and a lighter
 * hole in that an island).
 */
export function areas(d, level, top = null) {
  const P = W + 2, pad = new Float32Array(P * (H + 2));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pad[(y + 1) * P + x + 1] = d[y * W + x];
  const rings = (top === null ? [level] : [level, top]).flatMap((l) => contour(pad, l, P, H + 2)).map((l) => { const r = l.map((v) => v - 1); r[r.length - 2] = r[0]; r[r.length - 1] = r[1]; return r; }); // W200 rainlook: and top's
  const box = rings.map((r) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); } return [x0, y0, x1, y1]; });
  const size = box.map(([x0, y0, x1, y1]) => (x1 - x0) * (y1 - y0));
  const inside = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c; return c; };
  const parents = rings.map((r, i) => { // the rings round ring i, by a point of it (rings never cross)
    const [x, y] = [r[0], r[1]], out = [];
    for (let j = 0; j < rings.length; j++) { const b = box[j]; if (j !== i && size[j] > size[i] && x > b[0] && x < b[2] && y > b[1] && y < b[3] && inside(rings[j], x, y)) out.push(j); }
    return out;
  });
  const polys = new Map();
  rings.forEach((r, i) => { if (parents[i].length % 2 === 0) polys.set(i, [r]); });
  rings.forEach((r, i) => { const p = parents[i]; if (p.length % 2) polys.get(p.reduce((a, b) => (size[b] < size[a] ? b : a)))?.push(r); });
  return [...polys.values()];
}
