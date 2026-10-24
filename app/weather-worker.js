// W52 weather (design/app-ui/SPEC.md §66): the radar's decoding and the nowcast, off the page. app/weather.js sends it
// each frame's tiles as they come, then asks for the motion, the line at a spot, and the picture at a minute.
//
//   { type: "frame", t, tiles: [{ i, j, blob }] }  decode a frame (IEM's N0Q palette back to dBZ), keep it by its time
//   { type: "nowcast", now }                       the motion from now - 20, now - 10 and now (coarse block matching);
//                                                  with too few wet blocks, the last motion is held
//   { type: "spot", lonlat }                       the minutes ahead at one place: one backward trajectory a minute, to
//                                                  +120 (W58 clean: and the observed frames there, the past hour)
//   { type: "draw", m, rgb, gain }                       the picture at minute m (-60..120), the wash's RGBA pixels and the contours: a frame, or the
//                                                  latest frame advected m minutes (semi-Lagrangian); W55 weather2: a minute
//                                                  between, the 5-minute picture before it advected the minutes since, made
//                                                  when asked for and kept (weather-logic.js pictures())
//   { type: "along", pts: [{ lonlat, m }] }         the first point of a route where it rains as the pilot gets there
//                                                  (minute m): its index, or -1; for part 2, the route card and flight
//   { type: "drop", before }                       forget frames older than that
// Each reply carries the message's id and the time it took. The spot never leaves this worker and the page.
import { W, H, FEW_BLOCKS, cellOf, inBlock, cellKm, decodeTile, motionFieldCoarse, constField, seriesAt, // W55 weather2: advect moved to pictures()
  firstWet, paint, blur, contour, lonLatOf, LEVELS, CORNERS, pictures, AHEAD_MIN, PAST_MIN, STEP_MIN } from "./weather-logic.js"; // W55 weather2: pictures; W58 clean: the spot's minutes to +120, the past frames, no words

const frames = new Map(); // time (ms) → dBZ cells
let now = NaN, motion = null, held = false, ahead = null; // W55 weather2: the pictures by minute, for `now`
let canvas = null, ctx = null;

async function decode(tiles) {
  const cells = new Float32Array(W * H);
  if (!canvas) { canvas = new OffscreenCanvas(256, 256); ctx = canvas.getContext("2d", { willReadFrequently: true }); }
  for (const { i, j, blob } of tiles) {
    // no colour management and no premultiplying, so each pixel keeps the palette's colour
    const bm = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    ctx.clearRect(0, 0, 256, 256);
    ctx.drawImage(bm, 0, 0, 256, 256);
    bm.close();
    decodeTile(ctx.getImageData(0, 0, 256, 256).data, i, j, cells);
  }
  return cells;
}

function nowcast(t) {
  const back = [t - 20 * 60000, t - 10 * 60000, t].map((k) => frames.get(k)).filter(Boolean);
  if (!frames.get(t)) return { ok: false };
  now = t;
  const m = back.length >= 2 ? motionFieldCoarse(back, W, H, back.length === 3 ? 10 : 20) : null;
  if (m && m.keep >= FEW_BLOCKS) { motion = m; held = false; }
  else { held = true; if (!motion) motion = { ...constField(W, H, 0, 0), global: { u: 0, v: 0 }, keep: 0, blocks: m?.blocks ?? 0 }; }
  ahead = pictures((k) => frames.get(t + k * 60000) ?? null, motion.U, motion.V); // W55 weather2
  // the motion in km/h and where it comes from, at the block's middle
  const km = cellKm(CORNERS[0][1] / 2 + CORNERS[2][1] / 2), u = motion.global.u * km * 60, v = -motion.global.v * km * 60;
  return { ok: true, held, keep: motion.keep, blocks: motion.blocks, kmh: Math.hypot(u, v), from: Math.round(((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360) };
}


/** The picture at minute m: the wash's pixels, and the contours as [lon, lat] lines by level. */
function draw(m, rgb, gain, withLines = true) { // W54 flight: withLines, none in flight
  const d = Number.isFinite(now) ? ahead.at(m) : null; // W55 weather2
  if (!d) return { rgba: null, lines: [] };
  const soft = blur(d), lines = [];
  for (const level of withLines ? LEVELS : []) for (const l of contour(soft, level)) { // W54 flight
    const ll = new Array(l.length / 2);
    for (let i = 0; i < l.length; i += 2) ll[i / 2] = lonLatOf(l[i], l[i + 1]);
    lines.push({ level, ll });
  }
  return { rgba: paint(soft, new Uint8ClampedArray(W * H * 4), rgb, gain).buffer, lines, made: ahead.stats.made, kept: ahead.kept }; // W55 weather2: made, kept
}

self.onmessage = async ({ data }) => {
  const t0 = performance.now(), { id, type } = data;
  let out = {};
  try {
    if (type === "frame") { frames.set(data.t, await decode(data.tiles)); out = { ok: true }; }
    else if (type === "nowcast") out = nowcast(data.now);
    else if (type === "spot") {
      if (!Number.isFinite(now) || !inBlock(data.lonlat)) out = { inside: inBlock(data.lonlat), line: null };
      else {
        const c = cellOf(data.lonlat), s = seriesAt(frames.get(now), W, H, motion.U, motion.V, c, AHEAD_MIN); // W58 clean: to the slider's end; the chip's words are worked out by the clock (weather.js)
        const k = Math.round(c[1]) * W + Math.round(c[0]), past = Float32Array.from({ length: PAST_MIN / STEP_MIN + 1 }, (_, i) => frames.get(now - i * STEP_MIN * 60000)?.[k] ?? NaN); // W58 clean
        out = { inside: true, series: s, past, now: s[0] }; // W58 clean
      }
    } else if (type === "along") { // part 2's hook: [{ lonlat, m }] → the first point where it rains when the pilot gets there
      out = { index: Number.isFinite(now) ? firstWet(frames.get(now), W, H, motion.U, motion.V, data.pts.map(({ lonlat, m }) => { const [x, y] = cellOf(lonlat); return { x, y, m }; })) : -1 };
    } else if (type === "draw") out = draw(data.m, data.rgb, data.gain, data.lines !== false); // W54 flight: lines
    else if (type === "drop") { for (const k of frames.keys()) if (k < data.before) frames.delete(k); out = { ok: true }; }
  } catch (e) { out = { error: String(e?.message || e) }; }
  self.postMessage({ id, ms: performance.now() - t0, ...out }, out.rgba ? [out.rgba] : []);
};
