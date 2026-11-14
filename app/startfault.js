// W210 settingsgone (design/app-ui/SPEC.md §385, her rows 13, 37 and 39): a start that stops part way is said, never left as blank
// Settings rows. app/main.js runs each late mount through late(): a throw is caught, kept in the feedback's errors and the trail
// log, and the next mount still runs. A throw that stops app/main.js itself comes here too (its self-import, there). Either way the
// rider is told once, with Reload, and the next feedback carries what didn't start (startLine, in its app state).
import { note, keepError, errorLine } from "./trail-log.js";
import { say } from "./tip.js";
import { swipeAway, ALL } from "./swipe.js";

export const START_WORDS = { text: "Part of Starchart didn't start.", reload: "Reload" };
const faults = []; // what didn't start, by name
let done = false, told = false;

/** Runs `mount`; a throw is kept and said, and gives null, so the next mount still runs. */
export function late(what, mount) {
  try { return mount(); } catch (err) { startFault(what, err); return null; }
}
/** `what` didn't start, for `err`: kept in the trail log and the feedback's errors (unless `keep` is false: an uncaught error the
 *  trail log's own listeners keep), and the rider told once. */
export function startFault(what, err, { keep = true } = {}) {
  faults.push(what);
  if (keep) { note("error", `start: ${what}: ${errorLine(err)}`); keepError(err, what); }
  console.warn(`start: ${what}:`, err);
  tell();
}
/** app/main.js reached its end. */
export const startDone = () => { done = true; };
/** The start, in the feedback's words: done, still starting, or what didn't start. */
export const startLine = () => (faults.length ? `not started: ${faults.join(", ")}` : done ? "done" : "starting");

/** The bubble, once: the words and Reload, under the search over any page (app/launch.css); a tap elsewhere, a swipe or Escape sends it away. */
function tell() {
  if (told || !globalThis.document?.body) return;
  told = true;
  const n = Object.assign(document.createElement("div"), { id: "startnote", className: "ftip", popover: "manual" });
  const t = Object.assign(document.createElement("span"), { className: "t", textContent: START_WORDS.text });
  const b = Object.assign(document.createElement("button"), { className: "dlnow", onclick: () => location.reload() });
  b.textContent = START_WORDS.reload;
  n.append(t, b);
  document.body.append(n);
  n.showPopover?.();
  say(`${START_WORDS.text} ${START_WORDS.reload}`);
  const away = (e) => { if (!n.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  function close() { removeEventListener("pointerdown", away, true); removeEventListener("keydown", esc, true); n.remove(); }
  addEventListener("pointerdown", away, true);
  addEventListener("keydown", esc, true);
  swipeAway(n, { dirs: ALL, close });
}
