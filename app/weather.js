// W52 weather (design/app-ui/SPEC.md §66): the rain radar on the chart, the next two hours made on this phone, and the
// parked chip with its small sheet. arclight, 2026-10-19: "something like windy.com has radar which they basically get
// like a live radar feed and then minute by minute they assume for the next you know hour a couple hours that basically
// that radar trace is just going to advec with the given wind".
//
// - The source: IEM's N0Q tiles (app/weather-logic.js), one fixed z7 block over the chart's region, the same for every
//   pilot. The newest frame's time comes from n0q_0.json (`no-cache`: a 304 when nothing changed), every 5 min, and each
//   frame's four tiles once, by its time. No request carries a position, a referrer or a cookie.
// - When it asks, as the comets do (SPEC §41): only with the layer on, the page visible, online, the chart showing and
//   Data Saver off. On mobile data, the three frames the motion needs; the past hour when the slider is touched.
//   After a failure, again in 1, 2, 4 … 30 min, and the chip says the radar is unavailable when it has nothing fresh.
// - The nowcast runs in app/weather-worker.js. The line at the pilot's spot is worked out there too: the spot stays on
//   this droid.
// - The layer: one image source over the block (mercator pixels, so it sits true), drawn under the starpaths and the
//   labels, quiet: a faint wash in the radiation colour (--caution), with contours at the bands' edges.
// - The chip, parked and with the layer on: "Radiation in 12 min, for 20 min" at the top left (W58 clean: no "about"). A tap opens a
//   small sheet with a slider from -60 to +120 min. Nothing here moves the camera.
import { W, H, META, CORNERS, POLL_MS, PAST_MIN, // W55 weather2: STEP_MIN no longer the slider's
  AHEAD_MIN, tileUrls, validOf, mayPoll, wantedBack, backoff, nextPoll, // W68 fixes: no SURE_MIN
  whenLine, ageLine, isDay, chipIcon, NONE, onsetOf, chipLine, ageMin, spotByClock, trackRuns, marks, movingLine } from "./weather-logic.js"; // W73 polish: movingLine // W55 weather2: isDay, chipIcon; W58 clean: the minutes by the clock, the track, the marks
import { get } from "./settings.js";
import { durNodes } from "./duration.js"; // W68 fixes
import { onLingo } from "./lingo-mode.js"; // W60 c
import { STEP_MIN } from "./weather-logic.js"; import { detents } from "./delight.js"; // W73 delight: a tick at each radar frame
import { clockAt } from "./course-logic.js";
import { ALERTS, ALERTS_MS, winterOf, winterLine, winterNote, winterVoice } from "./weather-winter.js"; // W102 winter; W106 voicefix: winterVoice

export const SETTING = "starchart.layer.weather"; // "off" (the default) or "on"
const SOURCE = "weather", LAYER = "weather", LINES = "weather-lines"; // W58 clean: no credit on the chart; the sheet and About carry it
const rgbOf = ([r, g, b]) => `rgb(${r},${g},${b})`;
const STALE_MS = 30 * 60000; // older than this, the radar says nothing at the spot
const REST_MS = 250; // W55 weather2: the slider still this long is at rest: the contours come back (their GeoJSON is a long task at CPU x4)
const ASK = { credentials: "omit", referrerPolicy: "no-referrer" };

/**
 * Mount the layer, the chip and the sheet. `chart()` says whether the chart shows; `parked()` whether the pilot is
 * parked; `spot()` the pilot's [lon, lat] (the last fix) or null, for the chart's middle; `colour(theme)` the radiation
 * colour as [r, g, b]; `before` the style layer it goes under. W106 voicefix: `warm(line)` fetches a winter warning's lazy clips
 * as it comes (sfx.js warm), so the line is ready when radiation.js says it.
 */
export function mountWeather({ map, $ = (id) => document.getElementById(id), chart = () => true, parked = () => true, spot = () => null,
  colour = () => [175, 206, 0], theme = "dark", before = "comet-trail", now = () => Date.now(), warm = () => {} }) {
  const chip = $("wxchip"), sheet = $("wxsheet"), slider = $("wx-slider");
  const stats = { requests: 0, bytes: 0, frames: 0, unchanged: 0, failed: 0, urls: [], worker: { motion: [], spot: [], draw: [] }, paint: [], winter: 0 }; // W102 winter: the NWS's requests // W54 flight: paint, the main thread's ms a picture
  let on = get(SETTING) === "on", valid = NaN, fails = 0, timer = 0, busy = false, touched = false, once = false, lastAsk = 0;
  let motion = null, line = null, minute = 0, retryAt = 0;
  let onsetMin = null, flat = false, forced = null; // W54 flight: the minutes to rain at the spot; a picture drawn in flight, without its contours; the bench's contours on or off
  let scrubbing = 0, icon = ""; // W55 weather2: the slider moving (its rest timer): the wash only, the contours when it rests; the chip's icon
  const detent = detents(); // W73 delight: the frames sit STEP_MIN apart, from the newest at the slider's -age
  let spotAt = null, track = null, lastAge = -1; // W58 clean: the worker's minutes at the spot, the same by the clock, and the frame's age they were read at
  const age = () => ageMin(valid, now()); // W58 clean: the slider's 0 is the clock's now; its minute m is the frame's m + age
  const have = new Set(); // the frames' times the worker holds
  let winter = null, winterAt = -Infinity, winterBusy = false; // W102 winter: the NWS's winter alert in effect, when it was last asked

  // ---- the worker ----
  let worker = null, seq = 0;
  const waiting = new Map();
  const ask = (msg, transfer = []) => {
    if (!worker) {
      worker = new Worker(new URL("./weather-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => { const w = waiting.get(data.id); waiting.delete(data.id); w?.(data); };
    }
    return new Promise((ok) => { const id = ++seq; waiting.set(id, ok); worker.postMessage({ ...msg, id }, transfer); });
  };

  // ---- the layer: added the first time it is switched on, so a chart without it is as before ----
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H }), ctx = canvas.getContext("2d");
  let added = false;
  function addLayers() {
    if (added) return;
    added = true;
    const under = map.getLayer(before) ? before : undefined;
    // a canvas source, not an image one: MapLibre fetches an image's URL, which the CSP's connect-src would have to allow
    map.addSource(SOURCE, { type: "canvas", canvas, coordinates: CORNERS, animate: false });
    map.addLayer({ id: LAYER, type: "raster", source: SOURCE, paint: { "raster-opacity": 1, "raster-resampling": "linear", "raster-fade-duration": 0 } }, under);
    // the contours: thin lines at 20, 35 and 45 dBZ, the same width at every zoom
    map.addSource(LINES, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: LINES, type: "line", source: LINES, layout: { "line-join": "round" },
      paint: { "line-color": rgbOf(colour(theme)), "line-width": ["match", ["get", "level"], 20, 1, 35, 1.3, 1.7], "line-opacity": ["match", ["get", "level"], 20, 0.6, 35, 0.75, 0.9] } }, under);
  }

  // ---- asking IEM ----
  const conn = () => navigator.connection;
  const state = () => ({ on, visible: document.visibilityState === "visible", online: navigator.onLine, chart: chart(), saveData: conn()?.saveData === true && !once });
  async function fetchOk(url, init) {
    stats.requests++; stats.urls.push(url); if (stats.urls.length > 200) stats.urls.shift();
    const r = await fetch(url, { ...ASK, ...init });
    if (!r.ok) throw new Error(`${r.status}`);
    return r;
  }
  async function frame(t) {
    const tiles = await Promise.all(tileUrls(t).map(async ({ i, j, url }) => {
      const blob = await (await fetchOk(url)).blob();
      stats.bytes += blob.size;
      return { i, j, blob };
    }));
    const r = await ask({ type: "frame", t, tiles });
    if (r.error) throw new Error(r.error);
    have.add(t); stats.frames++;
  }
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(poll, ms); };
  /** W102 winter: the NWS's winter alerts for the fixed zones, at most once in 15 minutes, by the radar's rules (a tap with
   *  Data Saver asks once); `no-cache`, so the browser revalidates by its ETag. */
  async function askWinter() {
    if (winterBusy || !mayPoll(state()) || now() - winterAt < ALERTS_MS) return;
    winterBusy = true; winterAt = now(); stats.winter++;
    try {
      const r = await fetch(ALERTS, { ...ASK, cache: "no-cache" });
      if (r.ok) winter = winterOf(await r.json(), now());
      if (r.ok && winter?.level === "warning") warm(winterVoice(winter)); // W106 voicefix: its clip, as it comes
    } catch { /* again in 15 minutes */ } finally { winterBusy = false; }
    show();
  }
  const winterNow = () => (winter && !(winter.ends <= now() || winter.expires <= now()) ? winter : null); // W102 winter: an alert past its end, or its message's, is gone
  async function poll() {
    askWinter(); // W102 winter
    if (busy) return;
    if (!mayPoll(state())) { schedule(5000); show(); return; }
    busy = true; lastAsk = now();
    let next = POLL_MS;
    try {
      const r = await fetchOk(META, { cache: "no-cache" }); // the browser asks with If-None-Match: a 304 when nothing changed
      const text = await r.text();
      stats.bytes += text.length;
      const t = validOf(JSON.parse(text));
      if (!Number.isFinite(t)) throw new Error("no time");
      if (t === valid) stats.unchanged++;
      const back = wantedBack({ cellular: conn()?.type === "cellular", slider: touched });
      const need = back.map((m) => t - m * 60000).filter((k) => !have.has(k));
      if (need.includes(t)) await frame(t); // the newest first: the motion and the line need it
      valid = t; fails = 0; retryAt = 0;
      for (const k of need) if (k !== t) await frame(k).catch(() => { stats.failed++; }); // an old frame missing costs only its slider step
      for (const k of have) if (k < t - PAST_MIN * 60000) have.delete(k);
      ask({ type: "drop", before: t - PAST_MIN * 60000 });
      if (need.length) await update();
      next = nextPoll(t, now());
    } catch {
      stats.failed++; fails++;
      next = backoff(fails); retryAt = now() + next;
    } finally { busy = false; once = false; }
    show();
    schedule(next);
  }
  const kick = () => { if (on && !busy && mayPoll(state()) && now() - lastAsk > (Number.isFinite(valid) ? 60000 : 5000)) schedule(0); else show(); };
  document.addEventListener("visibilitychange", kick);
  addEventListener("online", kick);
  addEventListener("offline", () => show());
  conn()?.addEventListener?.("change", kick);

  // ---- the forecast and the line ----
  const here = () => { const s = spot(); if (s) return s; const c = map.getCenter(); return [c.lng, c.lat]; };
  async function update() {
    const r = await ask({ type: "nowcast", now: valid });
    if (r.ok) { motion = r; stats.worker.motion.push(r.ms); }
    await spotLine();
    await draw(minute);
  }
  async function spotLine() {
    if (!Number.isFinite(valid)) return;
    const r = await ask({ type: "spot", lonlat: here() });
    stats.worker.spot.push(r.ms);
    spotAt = r; relabel(); // W58 clean
    show();
  }
  /** W58 clean: the chip's words, the minutes to rain (W54 flight) and the slider's track, counted from the clock. */
  function relabel() {
    const r = spotAt; lastAge = age();
    if (!r?.series) { line = r && !r.inside ? "Outside the radar's reach" : null; onsetMin = null; track = null; return; }
    track = spotByClock(r.series, r.past, lastAge);
    const o = onsetOf(track.subarray(PAST_MIN, PAST_MIN + 91)); // the hour and a half ahead, as before W58, from now
    line = chipLine(o); onsetMin = o ? o.start : null;
  }
  let drawing = null, again = false, drawnLines = 0, drawnAge = NaN; // W55 weather2: drawnLines, the contours on the chart; W102 leftovers: the frame's age the picture was drawn at
  // W102 leftovers (W58's repaint): the picture steps a minute by the clock only with its sheet open, or in flight, where the
  // chart draws anyway; parked with the sheet shut, every STEP_MIN (a frame's time), so a resting chart sleeps between, and an
  // old picture still moves on with no new frame (Data Saver, offline, the radar failing), up to the forecast's end (AHEAD_MIN,
  // ageMin's cap), where it stays: nothing clears it (W109 notes)
  const stepping = () => !sheet.hidden || !parked();
  const contoured = () => parked() && !scrubbing; // W55 weather2: a picture's contours: parked (W54 flight), and the slider at rest
  async function draw(m) {
    minute = m;
    if (drawing) { again = true; return drawing; }
    drawing = (async () => {
      do {
        again = false;
        flat = forced === null ? !contoured() : !forced; // W54 flight: in flight, no contours, to keep a new frame's work on the main thread small (SPEC §70); W55 weather2: nor while scrubbing
        drawnAge = age(); // W102 leftovers
        const r = await ask({ type: "draw", m: minute + drawnAge, rgb: colour(theme), gain: theme === "light" ? 1.5 : 1, lines: !flat }); // W54 flight: lines; W58 clean: the frame's minute, + its age
        stats.worker.draw.push(r.ms); stats.made = r.made; stats.kept = r.kept; // W55 weather2: the pictures made and kept
        const t0 = performance.now(); // W54 flight: the main thread's part, below
        if (r.rgba) ctx.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), W, H), 0, 0);
        else ctx.clearRect(0, 0, W, H); // a frame not here (yet): nothing, not another minute's
        if (r.lines.length || drawnLines) { // W55 weather2: no contours shown and none to show (scrubbing, in flight): the source left alone
          map.getSource(LINES)?.setData({ type: "FeatureCollection", features: r.lines.map(({ level, ll }) => ({ type: "Feature", properties: { level }, geometry: { type: "LineString", coordinates: ll } })) });
          drawnLines = r.lines.length; // W55 weather2
        }
        const src = map.getSource(SOURCE); // the texture is uploaded only while it "plays": for one frame
        src.play(); map.once("render", () => src.pause()); map.triggerRepaint();
        stats.paint.push(+(performance.now() - t0).toFixed(1)); if (stats.paint.length > 50) stats.paint.shift(); // W54 flight
      } while (again || (forced === null && flat === contoured())); // W55 weather2: the slider came to rest (or moved) meanwhile
      drawing = null;
    })();
    return drawing;
  }

  // ---- the chip and the sheet ----
  const fresh = () => Number.isFinite(valid) && now() - valid < STALE_MS;
  /** The chip's words now. */
  function words() {
    const s = state(), w = winterNow();
    if (w && !(fresh() && line && line !== NONE && line !== "No rain")) return winterLine(w); // W102 winter: in place of "No rain"
    if (fresh() && line) return line;
    if (!s.online) return "The radar needs a connection";
    if (conn()?.saveData === true && !Number.isFinite(valid)) return "Radar paused for Data Saver";
    if (fails) return "Radar unavailable";
    return "Looking at the radar…";
  }
  function note() {
    if (fails && retryAt) return `The radar isn't answering. Trying again in ${Math.max(1, Math.round((retryAt - now()) / 60000))} min.`;
    if (!Number.isFinite(valid)) return "";
    const parts = [ageLine(valid, now())];
    if (movingLine(motion)) parts.push(movingLine(motion)); // W73 polish: mph, as Warp
    return parts.join(" · ") + ".";
  }
  function show() {
    const vis = on && parked() && chart();
    if (flat === contoured() && added && on && Number.isFinite(valid) && !drawing) draw(minute); // W54 flight: landed, the contours again; launched, none; W55 weather2: the slider at rest
    if (chip.hidden === vis) chip.hidden = !vis;
    if (!vis && !sheet.hidden) close();
    const w = words();
    const t = chip.querySelector(".t");
    if (t.textContent !== w) t.textContent = w;
    const a = winterNow(), k = a && w === winterLine(a) ? a.kind : chipIcon(w, isDay(now(), here())); // W55 weather2: the icon says what the words say, by day or by night; W102 winter: snow or ice
    if (k !== icon) { icon = k; for (const el of [chip, $("wx-title")]) el.querySelector(".i").className = `i i-wx-${k}`; } // W55 weather2
    for (const el of [chip, sheet]) el.classList.toggle("wet", k === "rain" || k === "soon" || k === "snow" || k === "ice"); // W55 weather2: the sheet's icon too, from the same state; W102 winter: snow and ice in the caution colour too
    if (!sheet.hidden) {
      const h = $("wx-title").querySelector(".t"); if (h.textContent !== w) h.textContent = w; // W55 weather2: beside its icon
      $("wx-note").textContent = note();
      const al = $("wx-alert"), an = a ? winterNote(a, now()) : ""; // W102 winter: the NWS's name for it, and its end
      if (al.textContent !== an) al.textContent = an;
      al.hidden = !an;
      const hi = String(AHEAD_MIN - age()); if (slider.max !== hi) { slider.max = hi; if (+slider.value !== minute) draw(+slider.value); } // W58 clean: the end moves in as the frame ages
      const m = +slider.value, at = clockAt(new Date(Math.floor(now() / 60000) * 60000 + m * 60000)); // W58 clean: by the clock
      if ($("wx-when").textContent !== `${whenLine(m)} · ${at}`) $("wx-when").replaceChildren(...(m === 0 ? [whenLine(0)] : m < 0 ? [...durNodes(-m), " ago"] : ["In ", ...durNodes(m)]), ` · ${at}`); // W58 clean; W68 fixes: whenLine's words, the units small
      slider.setAttribute("aria-valuetext", `${whenLine(m)}, ${at}`); // W58 clean: the minute and its time
      paintTrack(); // W58 clean
    }
  }
  /** W58 clean: the slider's track, wet in the radiation colour and dry plain, minute by minute at the spot, and its marks:
   *  every 10 min of the clock, "4:30" and "5:00" at the majors, and Now. Made again only when the minute, the frame's age
   *  or the spot's minutes change. */
  let painted = "";
  function paintTrack() {
    const lo = -PAST_MIN, hi = AHEAD_MIN - age(), key = `${Math.floor(now() / 60000)}|${hi}|${stats.worker.spot.length}|${$("wx-track").clientWidth}`;
    if (key === painted) return;
    painted = key;
    const pc = (m) => `${((Math.max(lo, Math.min(hi, m)) - lo) / (hi - lo) * 100).toFixed(2)}%`;
    const col = { wet: "var(--caution)", dry: "var(--wx-dry)", unknown: "transparent" };
    const runs = track ? trackRuns(track) : [{ from: lo, to: hi, k: "unknown" }];
    $("wx-track").style.backgroundImage = `linear-gradient(to right, ${runs.map((r) => `${col[r.k]} ${pc(r.from)} ${pc(r.to)}`).join(", ")})`;
    $("wx-track").dataset.wet = runs.filter((r) => r.k === "wet").map((r) => `${r.from}..${r.to}`).join(" "); // for tests: the wet minutes
    const out = [], at = (tag, className, x, text = "") => { const el = Object.assign(document.createElement(tag), { className, textContent: text }); el.style.left = x; out.push(el); };
    const clear = Math.ceil(36 / Math.max(0.5, $("wx-track").clientWidth / (hi - lo))); // a label's room beside Now: 36 px, in minutes at this width
    for (const k of marks(lo, hi, now(), (t) => clockAt(new Date(t)), clear)) {
      const f = (k.m - lo) / (hi - lo), x = pc(k.m);
      at("i", `tick${k.major ? " major" : ""}${k.now ? " now" : ""}`, x);
      if (k.label && (k.now || (f > 0.05 && f < 0.95))) at("span", `lab${k.now ? " now" : ""}`, x, k.label); // none at the very ends, where it would spill
    }
    $("wx-marks").replaceChildren(...out);
  }
  let watch = null;
  function open() {
    sheet.hidden = false;
    chip.setAttribute("aria-expanded", "true");
    if (conn()?.saveData === true && !Number.isFinite(valid)) { once = true; askWinter(); schedule(0); } // Data Saver: a tap asks once; W102 winter: the alerts too
    if (added && Number.isFinite(valid) && drawnAge !== age()) draw(minute); // W102 leftovers: the picture of now, as the sheet opens
    show();
    if (window.CloseWatcher && !watch) { try { watch = new CloseWatcher(); watch.onclose = () => { watch = null; close(); }; } catch { /* one per user gesture */ } }
  }
  function close() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    chip.setAttribute("aria-expanded", "false");
    watch?.destroy(); watch = null;
    clearTimeout(scrubbing); scrubbing = 0; // W55 weather2: at rest
    if (+slider.value !== 0) { slider.value = "0"; draw(0); } // the chart shows now again
    detent.reset(); // W73 delight
  }
  chip.onclick = () => (sheet.hidden ? open() : close()); // the camera stays where it is
  sheet.querySelector(".x").onclick = () => { close(); chip.focus({ preventScroll: true }); };
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) { close(); chip.focus({ preventScroll: true }); } });
  addEventListener("resize", () => { if (!sheet.hidden) show(); }); // W58 clean: the marks again for the new width
  slider.min = String(-PAST_MIN); slider.max = String(AHEAD_MIN); slider.step = "1"; // W55 weather2: a minute a step
  slider.oninput = () => {
    const m = +slider.value;
    detent(Math.floor((m + age()) / STEP_MIN)); // W73 delight
    if (!touched) { touched = true; if (conn()?.type === "cellular" && Number.isFinite(valid)) schedule(0); } // mobile data: the past hour now
    clearTimeout(scrubbing); scrubbing = setTimeout(() => { scrubbing = 0; show(); }, REST_MS); // W55 weather2: the contours when it rests
    draw(m); show();
  };

  // ---- on or off ----
  function set(v) {
    on = !!v;
    if (on) addLayers();
    if (added) for (const id of [LAYER, LINES]) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); // W58 clean: no credit layer
    if (on) kick(); else { clearTimeout(timer); close(); }
    show();
    map.triggerRepaint();
  }
  addEventListener("starchart:settings", (e) => { if (e.detail?.key === SETTING) set(e.detail.value === "on"); });
  onLingo(() => { if (spotAt) relabel(); show(); }); // W60 c: the chip and the sheet in the new words, at once
  map.on("moveend", () => { if (on && !spot() && Number.isFinite(valid)) spotLine(); }); // no fix: the line is for the chart's middle
  let clock = 0;
  const tick = () => { // W58 clean: at each minute of the clock: the chip's minutes, the picture at the slider's minute, its end and marks; "Updated 4 min ago"
    clock = setTimeout(tick, 60000 - (now() % 60000) + 20);
    if (!on) return;
    if (Number.isFinite(valid) && age() !== lastAge) { relabel(); if (added && (stepping() || age() - drawnAge >= STEP_MIN)) draw(minute); }
    show();
  };
  tick();
  if (on) { addLayers(); schedule(0); }
  show();

  return {
    set, stats, open, close,
    get on() { return on; }, get valid() { return valid; }, get line() { return line; }, get words() { return words(); }, get motion() { return motion; },
    get minute() { return minute; }, get frames() { return [...have].sort(); },
    /** For part 2: the first of `pts` ([{ lonlat, m }], a route's points and the minutes to them) where it rains as the
     *  pilot gets there: its index, or -1 (also with no radar). */
    along: async (pts) => (on && fresh() ? (await ask({ type: "along", pts: pts.map((p) => ({ ...p, m: p.m + age() })) })).index ?? -1 : -1), // W58 clean: minutes from the clock, so from the frame + its age
    /** The pilot's spot moved, or the flight state changed: the line again, the chip shown or hidden. */
    refresh() { if (on && Number.isFinite(valid)) spotLine(); else show(); },
    /** W54 flight: the minutes to rain at the pilot's spot now (0: raining), or null: none within the hour, or no fresh radar. */
    onset: async () => { if (!(on && fresh())) return null; await spotLine(); return fresh() ? onsetMin : null; },
    /** W54 flight: the picture at minute `m` drawn again, as a new frame draws it (for tests and the bench). */
    redraw: async (m = minute, { lines = null } = {}) => { if (!Number.isFinite(valid)) return; forced = lines; try { await draw(m); } finally { forced = null; } }, // lines: the bench's, as before W54 (true) or not
    get contoured() { return !flat; }, // W54 flight
    get busy() { return !!drawing; }, get icon() { return icon; }, // W55 weather2: a picture on its way; the chip's icon
    theme(t) { theme = t; if (!added) return; map.setPaintProperty(LINES, "line-color", rgbOf(colour(theme))); if (Number.isFinite(valid)) draw(minute); },
    stop() { clearTimeout(timer); clearTimeout(clock); worker?.terminate(); }, // W58 clean: the minute's timer
    get winter() { return winterNow(); }, // W102 winter: the alert in effect, or null
    get age() { return age(); }, get track() { return track; }, // W58 clean: the frame's age in minutes; the spot's dBZ by the clock
    host: META,
  };
}
