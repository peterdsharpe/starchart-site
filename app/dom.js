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
