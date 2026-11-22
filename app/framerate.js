// W20 chrome: Smoothness and Show frame rate, and the ?perf=1 overlay. W28 settings: Smoothness is the Battery saver
// switch in Settings, and Show frame rate is in About › Developer.
//
// starchart.smooth sets the governor's rate for the follow camera and the ambient motion: "auto" (the default, W56
// perf: 60, or a steady 30 while 60 doesn't hold), "60" or "30" (Battery saver on). Developer's Frame rate picks any of
// the three, and says the rate Auto holds. Gestures always run at 60 (chart/prototype/perf.js). W102 fps30: in flight, Auto
// cruises at 30 while the chart barely moves (perf.js CRUISE). W50 crisp: Battery saver
// also caps the map's pixel ratio at 2 (chart.js's mapPixelRatio); off, the map draws at the device's own, as sharp as the
// page's text. W56 perf: in flight it is 2 at most too, from Launch to Land (`fr.flight()`).
// Show frame rate puts a short readout at the bottom (#fps); ?perf=1 shows the full overlay (#perf) as before.
// The measuring starts only when one of them is on, so a pilot who wants neither pays nothing for it.
import { PerfHud } from "../chart/prototype/perf.js";
import { mapPixelRatio } from "../chart/prototype/chart.js";
import { get, watchBattery } from "./settings.js"; // W104 oss2: watchBattery

/** W56 perf: the rate the governor holds, in words: Developer's line and the full overlay's. */
export function heldWords(gov) {
  if (!gov.auto) return gov.ambient === 30 ? "Holding 30 fps, as Battery saver." : "Holding 60 fps.";
  if (gov.held === 60) return "Auto: holding 60 fps.";
  return `Auto: holding a steady 30 fps; 60 came at ${Math.round(gov.measured)}.`;
}

export function mountFrameRate({ map, gov, full, $ = (id) => document.getElementById(id), extra = () => [], flying = () => false }) {
  const fr = { perf: null };
  const hud = () => (fr.perf ??= new PerfHud(map, null, { extra: () => [`rate     ${heldWords(gov)}`, ...extra()] })); // W56 perf: the rate held
  const ratio = () => {
    const r = mapPixelRatio(get("starchart.smooth") === "30" || flying()); // W50 crisp; W56 perf: 2 at most in flight
    if (map.getPixelRatio() !== r) map.setPixelRatio(r);
  };
  const smooth = () => {
    const v = get("starchart.smooth");
    gov.auto = v === "auto"; // W56 perf
    gov.ambient = +v || 60;
    ratio(); held();
  };
  const held = () => { const n = $("fps-held"); if (n) n.textContent = heldWords(gov); }; // W56 perf: Developer's Frame rate
  const line = () => {
    const on = get("starchart.showfps") === "1";
    document.body.classList.toggle("fps", on);
    if (on || fr.perf) hud().show($("fps"), on ? "line" : null);
  };
  smooth(); line();
  globalThis.navigator?.getBattery?.().then(watchBattery, () => {}); // W104 oss2: Chromium only
  if (full) hud().show($("perf"), "full");
  addEventListener("starchart:settings", (e) => {
    if (e.detail.key === "starchart.smooth") smooth();
    if (e.detail.key === "starchart.showfps") line();
  });
  fr.flight = ratio; // W56 perf: at Launch, Land and Undo
  fr.held = held;
  return fr;
}
