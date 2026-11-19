// The phone's GPS, from watchPosition (scratch/research/R7-sensors.md §5).
// A timeout or a lost signal means try again; only a denial is fatal.

export const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 };

/** A Geolocation position as a raw fix, timed on our clock: {lonlat, accuracy, speed, course, t, stamp}. */
export function rawFix(pos, t) {
  const c = pos.coords;
  const ok = (v) => (Number.isFinite(v) && v >= 0 ? v : null); // iOS sends -1, Chrome NaN or null, for "none"
  return { lonlat: [c.longitude, c.latitude], accuracy: c.accuracy, speed: ok(c.speed), course: ok(c.heading), t, stamp: pos.timestamp,
    alt: Number.isFinite(c.altitude) ? c.altitude : null }; // W17 log: the height, for the climb and the GPX
}

/**
 * GPS as a sensor. onFix(rawFix) for each new position; onStatus(status) with
 * "waiting" | "denied" | "unavailable" | "insecure" (the pose says "ok" once a fix passes its filter).
 */
export function gpsSensor({
  geolocation = globalThis.navigator?.geolocation, secure = globalThis.isSecureContext, now = () => performance.now(),
  onFix = () => {}, onStatus = () => {}, retryMs = 1000,
} = {}) {
  let watch = null, retry = null, stamp = null, on = false;
  function begin() {
    retry = null;
    watch = geolocation.watchPosition((p) => {
      if (p.timestamp === stamp) return; // the same fix again
      stamp = p.timestamp;
      onFix(rawFix(p, now()));
    }, (err) => {
      if (err.code === 1) { end(); on = false; onStatus("denied"); return; }
      onStatus(err.code === 3 ? "waiting" : "unavailable");
      // a timeout or no signal: watch again (some browsers end a watch after an error)
      end();
      if (on) { retry = setTimeout(begin, retryMs); retry?.unref?.(); }
    }, WATCH_OPTIONS);
  }
  function end() {
    if (watch !== null) geolocation.clearWatch(watch);
    watch = null;
    clearTimeout(retry);
    retry = null;
  }
  return {
    start() {
      if (on) return;
      if (!secure) { onStatus("insecure"); return; }
      if (!geolocation) { onStatus("unavailable"); return; }
      on = true;
      onStatus("waiting");
      begin();
    },
    stop() { on = false; end(); },
    get watching() { return watch !== null; },
  };
}
