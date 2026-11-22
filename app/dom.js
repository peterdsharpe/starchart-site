// W152 app-rest J2, J6 (design/app-ui/SPEC.md §280): two small DOM helpers that files had each written out.
// Files whose el() differs in meaning (props, a falsy text, no text) keep their own.

/** An element: `tag`, its class (none when empty), and its text (none when null or undefined). */
export const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
/** W152 app-rest J6: Android's back gesture (and a desktop's Esc) calls `onclose`, where there is a CloseWatcher: the watcher,
 *  else null (none, or one per user gesture already made). */
export const closeOnBack = (onclose) => {
  if (!globalThis.CloseWatcher) return null;
  try { const w = new CloseWatcher(); w.onclose = onclose; return w; } catch { return null; /* one per user gesture */ }
};
/** W210 popups3 (SPEC §391): closeOnBack for a pop-up, on a touch screen only, where Back is the way out (as W29 polish's back
 *  guard). A desktop's CloseWatcher hears Escape too, and one made while an Escape was being dispatched (the no-map bubble, shown
 *  as that Escape closed the search over it) took that same key; there each pop-up's own Escape closes it. */
export const backOnTouch = (onclose) => (globalThis.matchMedia?.("(pointer: coarse)").matches ? closeOnBack(onclose) : null);
