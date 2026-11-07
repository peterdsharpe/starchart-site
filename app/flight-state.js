// The flight's state: parked, flying, then landed for 5 s with Undo, then parked again
// (design/app-ui/SPEC.md §8, W12-ux R7). While landed the screen is already the parked chart (wave 18):
// the next action (Launch, a tap on the chart, a tab, a sheet) makes the landing final at once. Pure, so Node can test it (app/tests/flight-state.test.mjs).
// Times are in ms on any clock that only goes forward; distances in metres along the flown course.
//
// Parked is a quiet chart: the counters, the moments and the wake lock run only while flying.
// Landing needs no "are you sure?": Undo puts the flight back as if Land had not been pressed, with
// the same clock (the minutes count on through the gap) and the same distance.
// W21 flight: a Land while the ship still moves (a stray tap at speed) keeps Undo until it slows: the window's 5 s
// count from then (tick's `moving`).

export const UNDO_MS = 5000;

export class FlightState {
  constructor({ undoMs = UNDO_MS } = {}) {
    this.undoMs = undoMs;
    this.state = "parked";
    this.t0 = 0; // the launch
    this.s0 = 0; // metres along the course at the launch
    this.end = null; // {t, s} at Land
    this.from = 0; // W21 flight: where the undo window counts from: Land, or the last tick that moved
  }

  get flying() { return this.state === "flying"; }

  /** Launch from parked. Returns false if there is nothing to do. */
  launch(t, s = 0) {
    if (this.state !== "parked") return false;
    Object.assign(this, { state: "flying", t0: t, s0: s, end: null });
    return true;
  }

  /** Land at once; the flight stays undoable for undoMs. */
  land(t, s = 0) {
    if (this.state !== "flying") return false;
    this.state = "landed";
    this.end = { t, s };
    this.from = t;
    return true;
  }

  /** Undo the landing, within the window. */
  undo(t) {
    if (this.state !== "landed" || t - this.from >= this.undoMs) return false;
    this.state = "flying";
    this.end = null;
    return true;
  }

  /** The pilot moved on: the landing is final now. Returns true if it was landed. */
  commit() {
    if (this.state !== "landed") return false;
    this.state = "parked";
    return true;
  }

  /** Call often: after the undo window the landing is final. Returns true when it just became so. `moving`: the ship
   *  still rides on, so the window waits (W21 flight). */
  tick(t, moving = false) {
    if (this.state === "landed" && moving) this.from = t;
    if (this.state !== "landed" || t - this.from < this.undoMs) return false;
    this.state = "parked";
    return true;
  }

  /** How much of the undo window is left, 1 to 0 (0 when not landed). */
  undoLeft(t) { return this.state === "landed" ? Math.max(0, 1 - (t - this.from) / this.undoMs) : 0; }

  /** The flight's earth milliseconds and metres: running while flying, frozen at Land, 0 when parked. */
  elapsed(t) { return this.state === "parked" ? 0 : (this.end ? this.end.t : t) - this.t0; }
  metres(s) { return this.state === "parked" ? 0 : Math.max(0, (this.end ? this.end.s : s) - this.s0); }
}
