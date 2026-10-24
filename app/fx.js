// The Ingress picks on the chart (wave 15; their mock-ups are design/app-ui/ideas/): the sonar ping, the
// map as ground, the charting boot, the crossing flash, the tilt setting and the in-flight tint.
// app/fx.css has their looks, and the chamfered small cards.
//
// None of them asks the chart for a frame. The ping and the flash are CSS animations on DOM marks over
// the chart (the ping's at the spot of the ship, app/ship3d.js), the tint is a still edge, the boot is a
// few lines of text, and the map as ground is one set of style changes at Launch and one at Land.
//
// app/main.js makes one with startFx() as it starts, gives it the map with attach(), and tells it
// of the first fix, the location button, Launch and Land. The settings come from localStorage and the
// starchart:settings event; a new theme from starchart:theme (scratch W15-common).

/** Multiply a paint value by k: a number, each stop of a top-level zoom interpolate or step, else an expression. */
import { pick } from "./lingo-mode.js"; // W60: the Words setting (no imports of its own, so safe this early)

export function scaled(v, k) {
  if (typeof v === "number") return v * k;
  if (Array.isArray(v) && v[0] === "interpolate") return v.map((x, i) => (i >= 4 && i % 2 === 0 ? scaled(x, k) : x)); // the outputs, not the stops
  if (Array.isArray(v) && v[0] === "step") return v.map((x, i) => (i >= 2 && i % 2 === 0 ? scaled(x, k) : x));
  return ["*", k, v];
}

const MAJOR = ["primary", "secondary", "trunk", "motorway"];
/**
 * The map as ground, while flying: the streets fainter and thinner, street names on the big roads and the
 * hyperspace byways only, no anchorages or sandworm nests. Opacity, width, a filter and visibility only,
 * never a colour, so the same rules work on every theme (the ideas page's GROUND, without its hull colour).
 * [layer, kind, property, value from the style's own].
 */
// W59 daystar: by day the streets fade less, as bright sun fades them already (the tester: "light purple on a cream
// background ... low contrast"): ×0.75 and the band unfaded (W64 daystar2, after arclight's "STILL aren't visible enough"), against ×0.5 and ×0.6 on
// Dark and Night vision.
const byDay = () => globalThis.document?.documentElement.dataset.theme === "light"; // W59 daystar
export const GROUND = [
  ["starpath", "paint", "line-opacity", (v) => scaled(v ?? 1, byDay() ? 0.75 : 0.5)], // W59 daystar: by day 0.75
  ["starpath", "paint", "line-width", (v) => scaled(v ?? 1, 0.6)],
  ["starpath-edge", "paint", "line-opacity", (v) => scaled(v ?? 1, 0.45)],
  ["starpath-band", "paint", "line-opacity", (v) => scaled(v ?? 1, byDay() ? 1 : 0.6)], // W59 daystar; W64 daystar2: by day the band (the road's shape) keeps its strength in flight: 3.25, 2.16 in glare
  ["starpath-label", "filter", null, (f) => ["all", ...(f ? [f] : []),
    ["any", ["match", ["get", "class"], MAJOR, true, false], ["==", ["get", "kind"], "hyperspace_byway"]]]],
  ["anchorage", "layout", "visibility", () => "none"],
  ["sandworm-nest", "layout", "visibility", () => "none"],
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The map as ground on a map: apply(true) at Launch, apply(false) at Land, restyled() after a theme change.
 * It keeps each layer's own value. After a new style it takes the new style's values as its own, unless a
 * layer still has the value this put there (a theme that kept the layers as they were).
 */
export class Ground {
  constructor(map, rules = GROUND) { this.map = map; this.rules = rules; this.was = []; this.put = []; this.on = false; }
  get(id, kind, prop) {
    const m = this.map;
    return kind === "filter" ? m.getFilter(id) : kind === "paint" ? m.getPaintProperty(id, prop) : m.getLayoutProperty(id, prop);
  }
  set(id, kind, prop, v) {
    const m = this.map;
    if (kind === "filter") m.setFilter(id, v);
    else if (kind === "paint") m.setPaintProperty(id, prop, v);
    else m.setLayoutProperty(id, prop, v ?? "visible");
  }
  apply(on) {
    this.on = on;
    this.rules.forEach(([id, kind, prop, f], i) => {
      if (!this.map.getLayer(id)) return;
      if (!(i in this.was)) this.was[i] = this.get(id, kind, prop);
      const v = on ? f(this.was[i]) : this.was[i];
      this.set(id, kind, prop, v);
      this.put[i] = v;
    });
  }
  restyled() {
    this.rules.forEach(([id, kind, prop], i) => {
      if (!this.map.getLayer(id)) return;
      const cur = this.get(id, kind, prop);
      if (!(i in this.put) || !same(cur, this.put[i])) this.was[i] = cur; // the new style's own
    });
    this.apply(this.on);
  }
}

/**
 * The passing of a pulsar or a black hole. No event marks it: the engine says pulsar_ahead and
 * black_hole_ahead 30 to 160 m before (chart/EVENTS.md), with the place and its distance ahead along the
 * course. So the passing is where the course reaches that distance: at along_m + ahead_m metres flown.
 * add() takes the event; due(s) returns the places reached at s metres, each once. A place more than
 * `late` metres behind (a jump of the course) is dropped without a flash.
 */
export class Crossings {
  constructor({ late = 60 } = {}) { this.late = late; this.ahead = []; }
  add(e) {
    const d = e.data || {};
    if (!["pulsar_ahead", "black_hole_ahead"].includes(e.kind) || !d.lonlat || !Number.isFinite(d.ahead_m)) return false;
    this.ahead.push({ at: (d.along_m || 0) + d.ahead_m, lonlat: d.lonlat, kind: e.kind === "pulsar_ahead" ? "pulsar" : "black_hole" });
    return true;
  }
  due(s) {
    const now = this.ahead.filter((c) => s >= c.at);
    this.ahead = this.ahead.filter((c) => s < c.at);
    return now.filter((c) => s - c.at <= this.late);
  }
  clear() { this.ahead = []; }
}

/** The tilt setting: "flat" (the default) or "tilted". */
export const tiltSetting = (v) => (v === "tilted" ? "tilted" : "flat");
export const TILT_DEG = 45;

const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, ...(text ? { textContent: text } : {}) });

/**
 * Start the effects: the boot's lines at once. Then attach({ map, maplibregl, ship, camera, s }) once
 * the map is made, where ship is the ship's layer (its .lngLat, and .on once it shows) and s() is the
 * metres flown (the course's s) or null.
 */
export function startFx({ region = "Greater Boston", bootMs = 1200 } = {}) {
  // ---- the charting boot: three plain lines while the first screen's tiles arrive (the bar stays) ----
  const box = el("div", "fx-boot");
  box.setAttribute("aria-hidden", "true");
  const line = (word, rest) => {
    const d = el("div", "", word);
    if (rest !== undefined) d.append(" ", el("span", "", rest));
    box.append(d);
    return d;
  };
  // All three at once: CSS brings them in at 0, 260 and 560 ms and fades them by 1.2 s, so a main
  // thread busy with the first load cannot hold them up.
  const lines = [line("Chart", region), line("Tiles", "loading"), line(pick("Finding your ship", "Finding you"))]; // W60: Plain's words (W65 plainlook found it)
  document.body.append(box);
  const tilesN = lines[1].querySelector("span");
  const timer = setTimeout(() => bootEnd(), bootMs); // never longer, however slow the tiles
  const seen = new Set(), done = new Set();
  const showTiles = () => { tilesN.textContent = seen.size ? `${done.size} of ${seen.size}` : "loading"; };
  let booting = true;
  function bootEnd() {
    if (!booting) return;
    booting = false;
    clearTimeout(timer);
    for (const l of lines) l.classList.add("done");
    box.classList.add("gone");
    setTimeout(() => box.remove(), 300);
  }

  // ---- the in-flight tint: a still phosphor edge, only between Launch and Land ----
  const tint = el("div", "fx-tint");
  tint.setAttribute("aria-hidden", "true");
  for (const side of ["t", "r", "b", "l"]) tint.append(el("i", side));
  document.body.append(tint);

  let map = null, mgl = null, ship = null, pingAt = null, camera = null, flownM = () => null, ground = null, flying = false;
  let tilt = tiltSetting(localStorage.getItem("starchart.tilt"));
  const crossings = new Crossings();
  let watch = 0;

  /** The pitch heading mode eases to: 45° with the tilted setting while flying, else the pilot's own. */
  function showTilt(move) {
    if (!camera) return;
    const want = tilt === "tilted" && flying ? TILT_DEG : 0;
    const was = camera.tilt;
    camera.tilt = want;
    if (move && camera.mode === "heading" && want !== was) camera.glide({ pitch: want });
  }

  function flash(c) {
    const f = el("div", "fx-flash " + c.kind);
    f.append(el("i", ""), el("i", ""));
    const m = new mgl.Marker({ element: f, pitchAlignment: "map" }).setLngLat(c.lonlat).addTo(map);
    setTimeout(() => m.remove(), 360);
  }
  function check() {
    const s = flownM();
    if (s === null || s === undefined) return;
    for (const c of crossings.due(s)) flash(c);
    if (!crossings.ahead.length) { clearInterval(watch); watch = 0; }
  }
  addEventListener("starchart:event", (e) => {
    if (!flying || !map || !crossings.add(e.detail)) return;
    watch ||= setInterval(check, 250); // only while a place is ahead: the readout's rate
  });
  addEventListener("starchart:settings", (e) => {
    if (e.detail?.key !== "starchart.tilt") return;
    tilt = tiltSetting(e.detail.value);
    showTilt(true);
  });
  addEventListener("starchart:theme", () => ground?.restyled());

  return {
    attach(o) {
      ({ map, ship, camera } = o);
      mgl = o.maplibregl;
      flownM = o.s || flownM;
      ground = new Ground(map);
      const key = (e) => e.tile && (e.tile.tileID?.key ?? e.tile);
      map.on("dataloading", (e) => { if (booting && e.tile) { seen.add(key(e)); showTiles(); } });
      map.on("data", (e) => { if (booting && e.tile) { seen.add(key(e)); done.add(key(e)); showTiles(); } });
      showTilt(false);
    },
    /** The first full render: the boot's lines go. */
    bootEnd,
    /** One ring from the ship, 600 ms (a fade in Calm chart): the first fix, the location button, Launch. */
    ping() {
      if (!ship?.on) return;
      pingAt?.remove();
      const box = el("div", ""), r = el("i", "fx-ping");
      const m = (pingAt = new mgl.Marker({ element: box, pitchAlignment: "map" }).setLngLat(ship.lngLat).addTo(map));
      box.append(r);
      const done = () => { m.remove(); if (pingAt === m) pingAt = null; };
      r.addEventListener("animationend", done);
      setTimeout(done, 900); // and if no animation runs
    },
    /** Launch (and Undo): true; Land: false. Before the camera's mode changes, so heading mode tilts. */
    flying(on) {
      if (on === flying) return;
      flying = on;
      document.body.classList.toggle("fx-flying", on);
      if (!on) { crossings.clear(); clearInterval(watch); watch = 0; }
      ground?.apply(on);
      showTilt(false);
    },
    get tilt() { return tilt; },
    ground: () => ground, crossings,
  };
}
