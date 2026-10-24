// W21 glass: notices that can be dismissed (design/app-ui/SPEC.md §19). A notice is a line or sheet the app
// shows by itself while a cause lasts, outside any flow: the rough-position line, "No GPS fix yet.", the
// no-location help. Its × hides it:
//   - a short press, for now: it shows again the next time its cause comes back (the cause goes, then returns)
//   - a long press (500 ms, a ring, then a pop and a 10 ms buzz, as the other long presses; W26 hold), for good: localStorage
//     "starchart.hide.<id>" = "1", then a 5 s "Won't show this again" with Undo
// Settings' "Show hidden notices again" (app/settings.js) clears every such key. A new notice gets all of
// this from mountNotice (a line with its own ×) or holdToHide (a sheet that has an × already).
// Timed pills and Undo snackbars need none of it: they go by themselves.
import { longPress } from "./press.js";
import { say } from "./tip.js"; // W73 a11y

export const HIDE = "starchart.hide.";
export const SNACK_MS = 5000;
const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** Whether the pilot hid notice `id` for good. */
export const isHidden = (id) => { try { return store()?.getItem(HIDE + id) === "1"; } catch { return false; } };

/** Hide notice `id` for good, or (`on` false) let it show again. */
export function hideForGood(id, on = true) {
  try { if (on) store()?.setItem(HIDE + id, "1"); else store()?.removeItem(HIDE + id); } catch { /* storage off: for this visit only */ }
  changed(false);
}
/** window "starchart:notices", { reset }: the hidden set changed (Settings' row counts it); reset, all shown again. */
const changed = (reset) => globalThis.dispatchEvent?.(new CustomEvent("starchart:notices", { detail: { reset } }));

/** The ids of the notices hidden for good. */
export function hiddenIds() {
  const s = store(), ids = [];
  try { for (let i = 0; i < (s?.length ?? 0); i++) { const k = s.key(i); if (k?.startsWith(HIDE)) ids.push(k.slice(HIDE.length)); } } catch { /* storage off */ }
  return ids;
}

/** Settings' reset: every notice shows again. Returns how many were hidden. */
export function resetHidden() {
  const ids = hiddenIds();
  for (const id of ids) hideForGood(id, false);
  changed(true);
  return ids.length;
}

/** Which notice shows, given its current cause: a short dismissal lasts until the cause goes. */
export class NoticeGate {
  dismissed = "";
  /** `id` is the notice the cause asks for, or "" for none. True: show it. */
  shows(id) {
    if (!id) { this.dismissed = ""; return false; }
    return id !== this.dismissed && !isHidden(id);
  }
  dismiss(id) { this.dismissed = id; }
}

const el = (tag, cls) => Object.assign(document.createElement(tag), cls ? { className: cls } : {});
let snackEl = null, snackTimer = 0;
/** The 5 s "Won't show this again" bar, with Undo; W104 oss2: or `text`'s (the battery's Battery saver). */
export function wontShow(undo, text = "Won't show this again") { // W104 oss2: exported, and text
  clearTimeout(snackTimer);
  snackEl?.remove();
  const bar = el("div", "nsnack"), t = el("span", "t"), b = el("button"), timer = el("i", "timer");
  t.textContent = text; // W73 a11y: no role="status": say() reads it; W104 oss2: text
  b.append(el("i", "i i-undo"), document.createTextNode("Undo"));
  bar.append(t, b, timer);
  const close = () => { clearTimeout(snackTimer); bar.remove(); if (snackEl === bar) snackEl = null; };
  b.onclick = () => { close(); undo(); };
  snackTimer = setTimeout(close, SNACK_MS);
  document.body.append(bar);
  say(t.textContent); // W73 a11y
  snackEl = bar;
}

/**
 * The long press on a notice's × button: hide notice `id` for good, `close()` it, and offer Undo, which calls
 * `restore()`. The button's own click stays the short press. Returns a function that removes the listeners.
 */
export function holdToHide(button, id, { close, restore }) {
  return longPress(button, () => { // W26 hold: the white ring and the pop of every hold on a control (press.js)
    const which = typeof id === "function" ? id() : id;
    hideForGood(which);
    close();
    wontShow(() => { hideForGood(which, false); restore(which); });
  });
}

/**
 * A line that shows while its cause lasts, with an × (44 px target). `show(id, text)` each time the cause is
 * checked: `id` names the notice ("" for no cause), `text` is its words.
 */
export function mountNotice(node) {
  const gate = new NoticeGate();
  const t = el("span", "nt"), x = el("button", "nx");
  t.textContent = node.textContent;
  x.setAttribute("aria-label", "Hide. Hold to never show it again");
  x.append(el("i", "i i-close"));
  node.replaceChildren(t, x);
  let cur = "";
  const render = () => { node.hidden = !gate.shows(cur); };
  x.onclick = () => { gate.dismiss(cur); node.hidden = true; };
  holdToHide(x, () => cur, { close: () => { node.hidden = true; }, restore: () => { gate.dismissed = ""; render(); } });
  addEventListener("starchart:notices", (e) => { if (e.detail?.reset) { gate.dismissed = ""; render(); } });
  return {
    node,
    get id() { return cur; },
    /** W25 rest: forget a short dismissal (Launch: a new context). */
    again() { gate.dismissed = ""; render(); },
    show(id, text = "") {
      const was = node.hidden ? "" : t.textContent; // W73 a11y
      cur = id || "";
      if (cur && t.textContent !== text) t.textContent = text;
      render();
      if (!node.hidden && t.textContent !== was) say(t.textContent); // W73 a11y: shown, or new words
    },
  };
}
