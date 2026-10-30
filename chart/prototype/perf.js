// The frame governor and the hidden performance HUD (brief §8, rules 3, 8 and 10).
//
// The governor runs our per-frame work (fly the ship, move the camera, step the chart's
// animation clock) at 60 fps while the pilot's fingers move the chart (pan, pinch, rotate), at the
// `ambient` rate for the heading-up follow camera and the ambient animation (30 fps by default; the
// app's Smoothness setting picks 60 or 30), and not at all when nothing changes; MapLibre then
// renders on demand. The "warp core saver" setting halves every rate.
//
// W56 perf: Auto (`auto`, the app's default). A phone that can't hold 60 (an A51 gave 37-38) looks smoother at a steady
// 30, so the follow camera and the ambient motion hold 30 by themselves when the frames aimed at 60 come at under LOW a
// second over a window, and try 60 again later: after RETRY_MS, then twice as long after each try that fails, up to
// RETRY_MAX_MS. `held` is the rate it holds; gestures stay at 60.
export const AUTO = { LOW: 50, WINDOW_MS: 2000, RETRY_MS: 30_000, RETRY_MAX_MS: 240_000 };
// W102 fps30 (SPEC §200): in flight on Auto, the follow camera and the ambient motion cruise at CRUISE.FPS while the chart
// barely moves (straight riding at bike speed): its fastest point on the screen under PX_S CSS px a second (the ship's
// motion, plus the chart's turn and zoom at its corners: 2 px a frame at 30), the ship turning under DEG_S degrees a second,
// and no finger, glide or reframe. Any of those asks for the held rate at once; cruising comes back after SETTLE_MS of quiet.
// Parked, and on a manual 60 or 30, nothing changes.
export const CRUISE = { FPS: 30, PX_S: 60, DEG_S: 15, SETTLE_MS: 1500 };
/** W102 fps30: does the chart move enough to want the held rate? px_s: its fastest point on the screen; deg_s: the ship's turn. */
export const lively = ({ px_s = 0, deg_s = 0, touch = false, glide = false }) => touch || glide || px_s > CRUISE.PX_S || deg_s > CRUISE.DEG_S;

export class Governor {
  constructor({ saver = false, ambient = 30, auto = false, now = () => performance.now() } = {}) {
    this.saver = saver;
    this.ambient = ambient; // W20 chrome: the follow camera's and the ambient animation's rate
    this.auto = auto; // W56 perf
    this.held = 60; // W56 perf: Auto's rate, 60 or 30
    this.cruising = false; // W102 fps30: in flight on Auto, the chart quiet for SETTLE_MS: CRUISE.FPS
    this.loudAt = -Infinity; // W102 fps30: the last frame that wasn't quiet
    this.measured = 0; // W56 perf: the last window's frames a second at 60
    this.retryAt = 0;
    this.wait = AUTO.RETRY_MS;
    this.lastDue = -1e9;
    this.lastFps = 0;
    this.lastGap = 0; // W74 start
    this.winMs = 0;
    this.winN = 0;
    this.now = now;
    this.last = -1e9;
    this.prev = null;
    this.vsync = 1000 / 60; // ms per display frame, learnt from the rAF timestamps
    this.dts = new Float64Array(60);
    this.sorted = new Float64Array(60);
    this.n = 0;
  }
  /**
   * Learn the display's frame interval from the last 60 rAF intervals: their mean, without the
   * dropped frames (more than 30 % off the median). The mean of a run is its span over its count,
   * so the timestamps' jitter cancels out.
   */
  learn(t) {
    const d = this.prev === null ? 0 : t - this.prev;
    this.prev = t;
    if (d < 2 || d > 50) return; // a hidden tab or a long task, not the display
    this.dts[this.n++ % 60] = d;
    if (this.n % 60) return;
    this.sorted.set(this.dts);
    const m = this.sorted.sort()[30];
    let sum = 0, k = 0;
    for (const x of this.dts) if (Math.abs(x - m) < 0.3 * m) { sum += x; k++; }
    if (Math.abs(sum / k - this.vsync) > 0.01 * this.vsync) this.vsync = sum / k; // steady: no flip-flop of the divisor
  }
  /** Frames per second for this moment: a gesture, the follow camera or ambient animation, or idle (0). */
  target(gesture, animating) {
    if (gesture) return this.saver ? 30 : 60;
    const ambient = this.auto ? (this.cruising ? Math.min(this.held, CRUISE.FPS) : this.held) : this.ambient; // W56 perf; W102 fps30: cruising
    if (animating) return this.saver ? ambient / 2 : ambient;
    return 0;
  }
  /** W102 fps30: on every rAF, before target(): is the chart quiet (in flight, nothing `lively`)? It cruises after SETTLE_MS of it. */
  pace(t, quiet) {
    if (!quiet || !this.auto) this.loudAt = t;
    this.cruising = t - this.loudAt >= CRUISE.SETTLE_MS;
  }
  /**
   * W56 perf: Auto's watch, on each frame that is due. The gaps between frames aimed at 60 in a row (a gap over 250 ms
   * is a pause, not a frame) fill a window of WINDOW_MS; a window under LOW frames a second holds 30.
   * W74 start: a rAF aimed lower (idle) ends the row, and a gap of 250 ms to WINDOW_MS after another is a frame, so under
   * 4 fps holds 30; one long task, or a hidden tab's minutes and the heavy frame after them, stay a pause.
   */
  watch(t, fps) {
    const gap = t - this.lastDue, slow = gap < AUTO.WINDOW_MS && this.lastGap >= 250 && this.lastGap < AUTO.WINDOW_MS; // W74 start
    const run = fps >= 60 && this.lastFps >= 60 && (gap < 250 || slow); // W74 start: slow
    this.lastDue = t; this.lastFps = fps; this.lastGap = gap; // W74 start: lastGap
    if (this.held === 30 && t >= this.retryAt) { this.held = 60; this.winMs = this.winN = 0; } // try 60 again
    if (!run) return;
    this.winMs += gap; this.winN++;
    if (this.winMs < AUTO.WINDOW_MS) return;
    this.measured = (this.winN * 1000) / this.winMs;
    this.winMs = this.winN = 0;
    if (this.held !== 60) return;
    if (this.measured >= AUTO.LOW) { this.wait = AUTO.RETRY_MS; return; } // it holds: a later miss waits the shortest
    this.held = 30;
    this.retryAt = t + this.wait;
    this.wait = Math.min(AUTO.RETRY_MAX_MS, this.wait * 2);
  }
  /**
   * W77 rest: the frame loop woke from its sleep: the next frame is due at once, whatever the rate, and it ends Auto's row
   * of frames aimed at 60 (the time asleep, or between a sleeping chart's looks, is no slow frame).
   */
  wake() { this.last = -1e9; this.lastFps = 0; }
  /**
   * Is it time for a frame? Call it on every requestAnimationFrame, also while idle.
   * Frames come every n-th display frame, with n the largest divisor that still gives `fps`, so
   * the intervals are even: 30 fps is 37.5 at 75 Hz and 36 at 144 Hz, never 25 (motion-4).
   */
  due(t, fps) {
    this.learn(t);
    if (fps < 60) this.lastFps = fps; // W74 start: an idle rAF, due or not, ends Auto's row of frames aimed at 60
    if (!fps) return false;
    const n = Math.max(1, Math.floor(1000 / fps / this.vsync + 0.1));
    if (t - this.last < (n - 0.5) * this.vsync) return false; // half a frame of slack for rAF jitter
    this.last = t;
    if (this.auto) this.watch(t, fps); // W56 perf
    return true;
  }
}

/** Fixed-size sample buffer, so measuring allocates nothing in the frame loop. */
class Samples {
  constructor(n = 600) { this.a = new Float64Array(n); this.n = 0; this.i = 0; }
  push(v) { this.a[this.i] = v; this.i = (this.i + 1) % this.a.length; this.n = Math.min(this.n + 1, this.a.length); }
  pct(p) {
    if (!this.n) return 0;
    const s = Array.from(this.a.subarray(0, this.n)).sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  }
}

/**
 * The frame readouts. Each number has its words (W20 chrome). show(el, mode) puts one in an element:
 * "full" is the ?perf=1 overlay, "line" the short one that Settings' Show frame rate puts at the bottom.
 * `extra()` gives the full overlay more lines, such as the GPS. They redraw twice a second while shown.
 */
export class PerfHud {
  constructor(map, el, { extra = () => [] } = {}) {
    this.extra = extra;
    this.views = new Map();
    this.timer = 0;
    this.frames = new Samples(); // ms between rendered frames
    this.work = new Samples(); // ms of our own JS per tick
    this.longTasks = 0;
    this.longTaskMs = 0;
    this.rendered = 0;
    this.lastRender = 0;
    this.started = performance.now();
    map.on("render", () => {
      const t = performance.now();
      if (this.lastRender && t - this.lastRender < 1000) this.frames.push(t - this.lastRender);
      this.lastRender = t;
      this.rendered++;
    });
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) { this.longTasks++; this.longTaskMs += e.duration; } })
        .observe({ type: "longtask", buffered: true });
    } catch { /* no longtask support */ }
    this.window = { t: performance.now(), n: 0 };
    this.fps = 0;
    if (el) this.show(el, "full");
    window.__perf = this;
  }
  tick(ms) { this.work.push(ms); }
  /** Show a readout in el ("full" or "line"), or hide it (null). */
  show(el, mode) {
    if (mode) this.views.set(el, mode); else this.views.delete(el);
    el.hidden = !mode;
    if (this.views.size && !this.timer) this.timer = setInterval(() => this.draw(), 500);
    if (!this.views.size && this.timer) { clearInterval(this.timer); this.timer = 0; }
    if (mode) this.draw();
  }
  snapshot() {
    const t = performance.now();
    const dt = (t - this.window.t) / 1000;
    if (dt >= 1) { this.fps = (this.rendered - this.window.n) / dt; this.window = { t, n: this.rendered }; }
    const mem = performance.memory;
    return {
      fps: +this.fps.toFixed(1),
      frame_p50_ms: +this.frames.pct(50).toFixed(1),
      frame_p95_ms: +this.frames.pct(95).toFixed(1),
      js_p95_ms: +this.work.pct(95).toFixed(2),
      long_tasks: this.longTasks,
      heap_mb: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null,
      frames: this.rendered,
    };
  }
  /** The readouts' words, from a snapshot `s`, the governor's target `aim` and the motion layer's stats `m`. */
  static text(mode, s, aim, m = {}, extra = []) {
    const goal = aim === undefined ? "" : aim <= 4 ? "idle" : `aim ${aim}`;
    if (mode === "line") return `${Math.round(s.fps)} fps${goal ? `, ${goal}` : ""}\nframe ${Math.round(s.frame_p50_ms)} ms\nslow 5 % ${Math.round(s.frame_p95_ms)} ms`;
    return [
      `frames   ${s.fps} a second${goal ? `, ${goal === "idle" ? "idle" : `aiming at ${aim}`}` : ""}`,
      `frame    ${s.frame_p50_ms} ms typical, ${s.frame_p95_ms} ms slowest 5 %`,
      `our js   ${s.js_p95_ms} ms a frame, slowest 5 %`,
      `long     ${s.long_tasks} tasks over 50 ms`,
      `heap     ${s.heap_mb ?? "—"} MB of JS`,
      `drawn    ${m.pulsars ?? 0} pulsars, ${m.holes ?? 0} black holes`,
      `         ${m.particles ?? 0} wormhole dots, built in ${m.rebuildMs ?? 0} ms`,
      ...extra,
    ].join("\n");
  }
  draw() {
    const s = this.snapshot(), m = window.__motion?.stats || {}, aim = window.__fpsTarget;
    let extra = null;
    for (const [el, mode] of this.views) {
      if (mode === "full") extra ??= this.extra();
      const text = PerfHud.text(mode, s, aim, m, mode === "full" ? extra : []);
      if (el.textContent !== text) el.textContent = text;
    }
  }
}
