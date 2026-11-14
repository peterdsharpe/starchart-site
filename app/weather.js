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
// - The layer: rain's marks over the bands from light up, more and stronger at each step (SPEC §223), over the streets and under
//   the labels (W177 weatherlook, SPEC §315), in the theme's ink (W112 weatherlook: --starlight, never the parks' green). W211
//   maplook2 (SPEC §394): no wash under them (it was one image source over the block), and nothing below light rain.
// - The chip, parked and with the layer on: "Radiation in 12 min, light, for about 20 min" at the top left (W201 weather2: the story whole, SPEC §360). A tap opens a
//   small sheet with a slider from -60 to +120 min. Nothing here moves the camera.
import { META, POLL_MS, PAST_MIN, // W55 weather2: STEP_MIN no longer the slider's; W211 maplook2: no W, H, CORNERS (the wash's canvas)
  AHEAD_MIN, tileUrls, validOf, mayPoll, wantedBack, backoff, nextPoll, // W68 fixes: no SURE_MIN
  whenLine, ageLine, chipIcon, NONE, chipLine, ageMin, spotByClock, trackRuns, marks, movingLine, HATCH, hatchId, LEVELS, clockStep } from "./weather-logic.js"; // W112 weatherlook: HATCH, hatchId, LEVELS; W211 maplook2: no WASH; clockStep // W73 polish: movingLine // W55 weather2: isDay, chipIcon; W58 clean: the minutes by the clock, the track, the marks; W201 weather2: no onsetOf (rainOf)
import { get } from "./settings.js"; // W196 ui4: no setSetting (W89 home: the row's tap with the layer off turned it on)
import { durNodes } from "./duration.js"; // W68 fixes
import { onLingo } from "./lingo-mode.js"; // W60 c
import { STEP_MIN } from "./weather-logic.js"; import { detents } from "./delight.js"; // W73 delight: a tick at each radar frame
import { clockAt } from "./course-logic.js";
import { closeOnBack } from "./dom.js"; // W152 app-rest J6
import { swipeAway, tapAway } from "./swipe.js"; // W201 gestures; W210 popups3: tapAway
import { ALERTS, ALERTS_MS, winterOf, winterLine, winterNote, winterVoice, harshOf } from "./weather-winter.js"; // W102 winter; W106 voicefix: winterVoice; W198 walkcards: harshOf
import { rainOf, lastsOf, RAIN_DBZ } from "./weather-logic.js"; // W201 weather2: the rain ahead told whole
import { RAIN_KEY, keyMarks } from "./weather-logic.js"; // W228 looks7 (SPEC §480): the key's samples, whole, the Layers tile's ⓘ's too
import { regionOf, forecastUrl, hoursOf, rainUntil, FORECAST_MS, STALE_MS as FORECAST_STALE_MS } from "./weather-forecast.js"; // W201 weather2: past the radar's end

export const SETTING = "starchart.layer.weather"; // "off" (the default) or "on"
const FORECAST_KEY = "starchart:forecast"; // W201 weather2: the last forecast asked, { id, at, hours } (app/keys.js: a cache)
const LINES = "weather-lines"; // W58 clean: no credit on the chart; the sheet and About carry it; W211 maplook2: no wash's SOURCE and LAYER
const rgbOf = ([r, g, b]) => `rgb(${r},${g},${b})`;
const STALE_MS = 30 * 60000; // older than this, the radar says nothing at the spot
const REST_MS = 250; // W55 weather2: the slider still this long is at rest: the contours come back (their GeoJSON is a long task at CPU x4)
const ASK = { credentials: "omit", referrerPolicy: "no-referrer" };

/**
 * Mount the layer, the chip and the sheet. `chart()` says whether the chart shows; `parked()` whether the pilot is
 * parked; `spot()` the pilot's [lon, lat] (the last fix) or null, for the chart's middle; `colour(theme)` the weather's
 * ink as [r, g, b] (W112 weatherlook: --starlight); `markInk(theme)` the rain's marks' ink, `colour`'s unless given (W206 rain2: her grey by day); `before` the style layer the marks go under when the style has no `rainBefore` (W177 weatherlook: the streaks under `rainBefore`, over the streets; W211 maplook2: no wash, which went under `before`). W106 voicefix: `warm(line)` fetches a winter warning's lazy clips
 * as it comes (sfx.js warm), so the line is ready when radiation.js says it.
 */
export function mountWeather({ map, $ = (id) => document.getElementById(id), chart = () => true, parked = () => true, spot = () => null,
  colour = () => [243, 239, 255], markInk = colour, theme = "dark", before = "comet-trail", now = () => Date.now(), warm = () => {}, rainBefore = "laned-starpath", regions = () => [] }) { // W218 layers3: the first bike lane (was shared-starpath, the sharrows, which went); W177 weatherlook: rainBefore, the streaks' layer over the streets; W201 weather2: regions(), the map packs' { id, bounds }, for the forecast's region; W206 rain2: markInk(), the marks' ink, `colour` unless given
  const chip = $("wxchip"), sheet = $("wxsheet"), slider = $("wx-slider");
  const stats = { requests: 0, bytes: 0, frames: 0, unchanged: 0, failed: 0, urls: [], worker: { motion: [], spot: [], draw: [] }, paint: [], winter: 0 }; // W102 winter: the NWS's requests // W54 flight: paint, the main thread's ms a picture
  let on = get(SETTING) === "on", valid = NaN, fails = 0, timer = 0, busy = false, touched = false, once = false, lastAsk = 0;
  let motion = null, line = null, minute = 0, retryAt = 0;
  let onsetMin = null, flat = false, forced = null; // W54 flight: the minutes to rain at the spot; a picture drawn in flight, without its contours; the bench's contours on or off
  let scrubbing = 0, icon = null; // W55 weather2: the slider moving (its rest timer): the last marks kept (W211 maplook2: was the wash only), the contours when it rests; the chip's icon; W173 uismall: null, so the first show() sets it from the first frame's i-wx-boot (was "", the off cloud's, as index.html had it)
  const detent = detents(); // W73 delight: the frames sit STEP_MIN apart, from the newest at the slider's -age
  let spotAt = null, track = null, lastAge = -1; // W58 clean: the worker's minutes at the spot, the same by the clock, and the frame's age they were read at
  const age = () => ageMin(valid, now()); // W58 clean: the slider's 0 is the clock's now; its minute m is the frame's m + age
  const have = new Set(); // the frames' times the worker holds
  let winter = null, winterAt = -Infinity, winterBusy = false; // W102 winter: the NWS's winter alert in effect, when it was last asked
  let harsh = null; // W198 walkcards: the same reply's cold or heat alert, for the walker's cards
  const forecasts = new Map(), asked = new Map(); // W201 weather2: each region's hours (weather-forecast.js hoursOf()) and when it was last asked
  try { const k = JSON.parse(localStorage.getItem(FORECAST_KEY) || "null"); if (k?.id && Number.isFinite(k.at) && Array.isArray(k.hours)) { forecasts.set(k.id, k); asked.set(k.id, k.at); } } catch { /* none kept */ } // W201 weather2: the last one, kept, so a reload within the hour asks nothing
  let spotRain = null, fcBusy = false; // W201 weather2: the rain ahead at the spot (rainOf(), with its `lasts`)

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
  let added = false;
  function addLayers() {
    if (added) return;
    added = true;
    const under = map.getLayer(before) ? before : undefined;
    // W112 weatherlook (SPEC §223): the contours' areas at 20, 35 and 45 dBZ, filled with rain streaks that stack (more and
    // stronger at each step), the same size at every zoom; no outline, so no line that says nothing (her note: "I cannot
    // tell if it indicates severity"); W200 rainlook (SPEC §355): each step's band alone, its own marks (drops, dashes, streaks), no longer stacked
    map.addSource(LINES, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    hatch();
    map.addLayer({ id: LINES, type: "fill", source: LINES,
      paint: { "fill-pattern": ["match", ["get", "level"], ...LEVELS.slice(0, -1).flatMap((l) => [l, hatchId(l)]), hatchId(LEVELS.at(-1))] } }, map.getLayer(rainBefore) ? rainBefore : under); // W177 weatherlook (SPEC §315): the dashes over the streets, under the bike lanes, the T, the course and every name, so the rain reads as one texture between and over the streets
  }
  /** W112 weatherlook: one level's streaks into `g`, tiled over w x h CSS px at `pr` device px each. */
  function streaks(g, { streaks: at, alpha, width, len }, pr, w = HATCH.size, h = HATCH.size) { // W200 rainlook: each step's own length
    g.strokeStyle = rgbOf(markInk(theme)); g.globalAlpha = alpha; g.lineWidth = width * pr; g.lineCap = "round"; // W206 rain2: the marks' own ink
    g.beginPath();
    for (let ox = -HATCH.size; ox < w + HATCH.size; ox += HATCH.size) for (let oy = -HATCH.size; oy < h; oy += HATCH.size) for (const [x, y] of at) { g.moveTo((ox + x) * pr, (oy + y) * pr); g.lineTo((ox + x + len[0]) * pr, (oy + y + len[1]) * pr); } // W177 weatherlook: from a tile before to one after, so a dash cut by the edge goes on
    g.stroke(); g.globalAlpha = 1;
  }
  /** W112 weatherlook: the streaks' images in the ink of the theme, added or redrawn, and the sheet's key: each step's
   *  wash and its streaks, as the chart draws them. */
  const pr = Math.min(3, Math.ceil(devicePixelRatio || 1)); // the first for the mount: updateImage keeps an image's size (a zoom later changes the ratio)
  function hatch() {
    const n = HATCH.size * pr, c = Object.assign(document.createElement("canvas"), { width: n, height: n }), g = c.getContext("2d", { willReadFrequently: true }); // W117: read back (W74 start F4)
    for (const l of HATCH.levels) {
      g.clearRect(0, 0, n, n); streaks(g, l, pr);
      const img = g.getImageData(0, 0, n, n), id = hatchId(l.level);
      if (map.hasImage(id)) map.updateImage(id, img); else map.addImage(id, img, { pixelRatio: pr });
    }
    $("wx-key")?.querySelectorAll("canvas").forEach((k, i) => {
      const { w, h } = RAIN_KEY, kg = k.getContext("2d"), { at, len, width, alpha } = keyMarks(i); k.width = w * pr; k.height = h * pr; // W228 looks7 (SPEC §480): RAIN_KEY's box (was 32 × 16), weather.css's
      kg.strokeStyle = rgbOf(markInk(theme)); kg.globalAlpha = alpha; kg.lineWidth = width * pr; kg.lineCap = "round"; kg.beginPath(); // W228 looks7: the step's own marks, whole, evenly spaced and centred (keyMarks, the Layers tile's ⓘ's too), was a crop of its pattern
      for (const [x, y] of at) { kg.moveTo(x * pr, y * pr); kg.lineTo((x + len[0]) * pr, (y + len[1]) * pr); } // W228 looks7
      kg.stroke(); kg.globalAlpha = 1; // W200 rainlook: the step's own marks alone, as the chart draws it; W211 maplook2: with no wash
    });
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
      if (r.ok) { const j = await r.json(); winter = winterOf(j, now()); harsh = harshOf(j, now()); } // W198 walkcards: harsh
      if (r.ok && winter?.level === "warning") warm(winterVoice(winter)); // W106 voicefix: its clip, as it comes
    } catch { /* again in 15 minutes */ } finally { winterBusy = false; }
    show();
  }
  /** W201 weather2 (SPEC §360): NWS's hourly forecast for the region the rider is in, at most once an hour a region, by the
   *  radar's rules (the layer on, the page in sight, online, the chart showing, Data Saver off); kept, and said with no position. */
  async function askForecast() {
    const id = regionOf(here(), regions()), url = forecastUrl(id);
    if (!url || fcBusy || !mayPoll(state()) || now() - (asked.get(id) ?? -Infinity) < FORECAST_MS) return;
    fcBusy = true; asked.set(id, now()); stats.forecast = (stats.forecast ?? 0) + 1;
    try {
      const r = await fetch(url, { ...ASK, cache: "no-cache" });
      if (r.ok) {
        const f = { id, at: now(), hours: hoursOf(await r.json()).filter((h) => h.end > now() && h.start < now() + 36 * 3600000) }; // today and tomorrow's
        forecasts.set(id, f); try { localStorage.setItem(FORECAST_KEY, JSON.stringify(f)); } catch { /* not kept */ }
        if (spotAt) relabel();
      }
    } catch { /* again in an hour */ } finally { fcBusy = false; }
    show();
  }
  /** W201 weather2: how long rain lasts, past the radar's end (`end`, ms) by the forecast of the rider's region, kept and fresh. */
  const lastsFor = (on, end) => { const f = forecasts.get(regionOf(here(), regions())); return lastsOf(on, on.open && f && now() - f.at < FORECAST_STALE_MS ? rainUntil(f.hours, end) : null); };
  const winterNow = () => (winter && !(winter.ends <= now() || winter.expires <= now()) ? winter : null); // W102 winter: an alert past its end, or its message's, is gone
  async function poll() {
    askWinter(); // W102 winter
    askForecast(); // W201 weather2
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
    if (!r?.series) { line = r && !r.inside ? "Outside the radar's reach" : null; onsetMin = null; track = null; spotRain = null; return; } // W201 weather2: spotRain
    track = spotByClock(r.series, r.past, lastAge);
    const ahead = track.subarray(PAST_MIN), o = rainOf(ahead); // W201 weather2: to the radar's end (was the hour and a half ahead), with its strength
    spotRain = o && { ...o, lasts: lastsFor(o, Math.floor(now() / 60000) * 60000 + (ahead.length - 1) * 60000) }; // W201 weather2: and how long, past the radar's end the forecast's
    line = chipLine(spotRain, undefined, { lasts: spotRain?.lasts, clock: (ms) => clockAt(new Date(ms)) }); onsetMin = o ? o.start : null; // W201 weather2
  }
  let drawing = null, again = false, drawnLines = 0, drawnAge = NaN; // W55 weather2: drawnLines, the contours on the chart; W102 leftovers: the frame's age the picture was drawn at
  // W102 leftovers (W58's repaint): the picture steps a minute by the clock only with its sheet open (and was in flight, where the
  // chart draws anyway; W211 maplook2: in flight, with its marks now, only once a new frame is overdue); parked with the sheet shut, every STEP_MIN (a frame's time), so a resting chart sleeps between, and an
  // old picture still moves on with no new frame (Data Saver, offline, the radar failing), up to the forecast's end (AHEAD_MIN,
  // ageMin's cap), where it stays: nothing clears it (W109 notes)
  const stepping = () => clockStep({ open: !sheet.hidden, flying: !parked(), age: age(), drawnAge }); // W211 maplook2: in flight once a radar frame (weather-logic.js), was every minute
  const contoured = () => !scrubbing; // W55 weather2: a picture's contours: the slider at rest; W211 maplook2: in flight too (W54 flight's were parked only), as there is no wash to show instead
  async function draw(m) {
    minute = m;
    if (drawing) { again = true; return drawing; }
    if (forced === null ? !contoured() : !forced) { flat = true; return; } // W211 maplook2: while the slider moves, the last marks stay until it rests (there is no wash to draw instead)
    drawing = (async () => {
      do {
        again = false;
        flat = forced === null ? !contoured() : !forced; // W55 weather2: no contours while scrubbing
        if (flat) continue; // W211 maplook2: as above, when the slider moved meanwhile
        drawnAge = age(); // W102 leftovers
        const r = await ask({ type: "draw", m: minute + drawnAge, lines: true }); // W58 clean: the frame's minute, + its age; W211 maplook2: no wash's ink
        stats.worker.draw.push(r.ms); stats.made = r.made; stats.kept = r.kept; // W55 weather2: the pictures made and kept
        const t0 = performance.now(); // W54 flight: the main thread's part, below
        if (r.lines.length || drawnLines) { // W55 weather2: no contours shown and none to show: the source left alone
          map.getSource(LINES)?.setData({ type: "FeatureCollection", features: r.lines.map(({ level, rings }) => ({ type: "Feature", properties: { level }, geometry: { type: "Polygon", coordinates: rings } })) }); // W112 weatherlook: areas
          drawnLines = r.lines.length; // W55 weather2
          stats.marks = (stats.marks ?? 0) + 1; // W211 maplook2: the marks' updates, a ride's once a radar frame
        }
        map.triggerRepaint();
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
    const vis = parked() && on; // W89 home: the row's circle, parked; the Log and Settings cover it (weather.css); W196 ui4 (SPEC §347, her row 26): only while the layer is on, so the two never fight
    if (flat === contoured() && added && on && Number.isFinite(valid) && !drawing) draw(minute); // W54 flight: landed, the contours again; launched, none; W55 weather2: the slider at rest
    if (chip.hidden === vis) chip.hidden = !vis;
    if ((!vis || !chart()) && !sheet.hidden) close(); // W89 home: chart(), as before
    const w = on ? words() : "Weather"; // W89 home: with the layer off, the circle's name
    const t = chip.querySelector(".t");
    if (t.textContent !== w) t.textContent = w;
    chip.classList.toggle("off", !on); // W89 home
    if (!on) { if (icon !== "") { icon = ""; chip.querySelector(".i").className = "i i-wx-off"; } chip.classList.remove("wet"); return; } // W89 home: a cloud and a sun until the layer is on
    const a = winterNow(), k = a && w === winterLine(a) ? a.kind : chipIcon(w); // W55 weather2: the icon says what the words say; W160 smallui: the same by day and night; W102 winter: snow or ice
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
    // rel-0.1.83 (W186 palette's third review): the wet runs in --caution over an edge layer, --wx-wet-edge (Plain by day her ink, so
    // her faint yellow bar keeps 3:1, as the rain dot's edge did (W217 weather3: the dot gone); weather.css), or --caution itself where none is set (SCUL, night: as before)
    const col = { wet: "var(--caution)", dry: "transparent", unknown: "transparent" };
    const under = { wet: "var(--wx-wet-edge, var(--caution))", dry: "var(--wx-dry)", unknown: "transparent" };
    const runs = track ? trackRuns(track) : [{ from: lo, to: hi, k: "unknown" }];
    const grad = (c) => `linear-gradient(to right, ${runs.map((r) => `${c[r.k]} ${pc(r.from)} ${pc(r.to)}`).join(", ")})`;
    $("wx-track").style.backgroundImage = `${grad(col)}, ${grad(under)}`;
    $("wx-track").dataset.wet = runs.filter((r) => r.k === "wet").map((r) => `${r.from}..${r.to}`).join(" "); // for tests: the wet minutes
    const t0 = now(), per = Math.max(0.5, $("wx-track").clientWidth / (hi - lo)); // R2 bigtext: px a minute
    const lay = (clearPx, every) => { // R2 bigtext: a label's room beside Now (px), and a label every `every` min
      const out = [], at = (tag, className, x, text = "") => { const el = Object.assign(document.createElement(tag), { className, textContent: text }); el.style.left = x; out.push(el); };
      for (const k of marks(lo, hi, t0, (t) => clockAt(new Date(t)), Math.ceil(clearPx / per), every)) {
        const f = (k.m - lo) / (hi - lo), x = pc(k.m);
        at("i", `tick${k.major ? " major" : ""}${k.now ? " now" : ""}`, x);
        if (k.label && (k.now || (f > 0.05 && f < 0.95))) at("span", `lab${k.now ? " now" : ""}`, x, k.label); // none at the very ends, where it would spill
      }
      $("wx-marks").replaceChildren(...out);
    };
    lay(36, 30); // a label's room beside Now: 36 px, and every :00 and :30
    // R2 bigtext (SPEC §450): with large text or on a narrow phone, a label every hour where 30 min of track is narrower than a
    // label and a gap (a quarter of its type), and Now's room its half and a label's, and that gap (measured: one layout a paint)
    const labs = [...$("wx-marks").querySelectorAll(".lab")], wide = (ls) => Math.max(0, ...ls.map((l) => l.offsetWidth));
    const lab = wide(labs.filter((l) => !l.classList.contains("now"))), gap = labs.length ? parseFloat(getComputedStyle(labs[0]).fontSize) / 4 : 0;
    const every = lab && 30 * per < lab + gap ? 60 : 30, clearPx = Math.max(36, lab && (wide(labs.filter((l) => l.classList.contains("now"))) + lab) / 2 + gap);
    if (every !== 30 || clearPx !== 36) lay(clearPx, every);
  }
  let watch = null;
  function open() {
    sheet.hidden = false;
    chip.setAttribute("aria-expanded", "true");
    if (conn()?.saveData === true && !Number.isFinite(valid)) { once = true; askWinter(); schedule(0); } // Data Saver: a tap asks once; W102 winter: the alerts too
    if (added && Number.isFinite(valid) && drawnAge !== age()) draw(minute); // W102 leftovers: the picture of now, as the sheet opens
    show();
    if (!watch) watch = closeOnBack(() => { watch = null; close(); }); // W152 app-rest J6: app/dom.js
  }
  swipeAway(sheet, { dirs: ["up"], close }); // W201 gestures (SPEC §362): it hangs from the top, so up and away, as its × (the slider keeps its drag)
  tapAway(sheet, { close, keep: (t) => chip.contains(t) || !!t.closest?.("#loctip") }); // W210 popups3 (SPEC §391, her row 34): a tap on the chart closes it, and only it, a drag or a pinch never; a tap on a control closes it and acts, as Layers'
  function close() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    chip.setAttribute("aria-expanded", "false");
    watch?.destroy(); watch = null;
    clearTimeout(scrubbing); scrubbing = 0; // W55 weather2: at rest
    if (+slider.value !== 0) { slider.value = "0"; draw(0); } // the chart shows now again
    detent.reset(); // W73 delight
  }
  chip.onclick = () => (sheet.hidden ? open() : close()); // the camera stays where it is; W196 ui4 (her row 26): the layer is on whenever the circle shows, and only Layers turns it on or off (W89 home's tap turned it on)
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
    document.documentElement.toggleAttribute("data-wx-on", on); // W196 ui4: the circle's first-frame rule (app/weather.css) follows the layer
    if (on) addLayers();
    if (added) map.setLayoutProperty(LINES, "visibility", on ? "visible" : "none"); // W58 clean: no credit layer; W211 maplook2: no wash layer
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
    if (Number.isFinite(valid) && age() !== lastAge) { relabel(); if (added && stepping()) draw(minute); } // W211 maplook2: clockStep's rule
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
    /** W201 weather2 (SPEC §360): the rain ahead at the pilot's spot, told whole: { start, dur, open, step, lasts } (weather-logic.js
     *  rainOf(), lastsOf()), or null, as onset(). */
    story: async () => { if (!(on && fresh())) return null; await spotLine(); return fresh() ? spotRain : null; },
    /** W201 weather2: along a route's `pts` (as along()'s), where it first rains as the pilot gets there, and the story there from
     *  that minute: { index, story: { start (the minutes to it), dur, open, step, lasts } }, or null. */
    alongStory: async (pts) => {
      if (!(on && fresh())) return null;
      const a = age(), r = await ask({ type: "along", pts: pts.map((p) => ({ ...p, m: p.m + a })), series: true });
      if (!(r.index >= 0) || !r.series) return null;
      const at = Math.max(0, Math.round(pts[r.index].m + a)), o = rainOf(r.series.subarray(at), RAIN_DBZ, 0); // from the frame's minute she gets there
      return o && { index: r.index, story: { ...o, start: pts[r.index].m, lasts: lastsFor(o, valid + (r.series.length - 1) * 60000) } };
    },
    /** W54 flight: the picture at minute `m` drawn again, as a new frame draws it (for tests and the bench). */
    redraw: async (m = minute, { lines = null } = {}) => { if (!Number.isFinite(valid)) return; forced = lines; try { await draw(m); } finally { forced = null; } }, // lines: the bench's, as before W54 (true) or not
    get contoured() { return !flat; }, // W54 flight
    get busy() { return !!drawing; }, get icon() { return icon; }, // W55 weather2: a picture on its way; the chip's icon
    theme(t) { theme = t; if (!added) return; hatch(); map.triggerRepaint(); if (Number.isFinite(valid)) draw(minute); }, // W112 weatherlook: the streaks in the new ink
    stop() { clearTimeout(timer); clearTimeout(clock); worker?.terminate(); }, // W58 clean: the minute's timer
    get winter() { return winterNow(); }, // W102 winter: the alert in effect, or null
    get harsh() { return harsh && !(harsh.ends <= now()) ? harsh : null; }, get fresh() { return fresh(); }, // W198 walkcards: a cold or heat alert (weather-winter.js harshOf()); a radar to tell dry from not known
    get age() { return age(); }, get track() { return track; }, // W58 clean: the frame's age in minutes; the spot's dBZ by the clock
    host: META,
  };
}
