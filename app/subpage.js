// W147 small6 (SPEC §264): Settings' pages (Send feedback, What's new, the install guide) open with show(), not showModal(), as
// Settings does (§244), so the bar stays live under them (her note: "The lower bar with the three tabs should always display").
// Android's back (a CloseWatcher) closes the page alone, back to what was under it; Esc too where there's no CloseWatcher.
// Over a modal (the welcome card) a page is modal too, or it would be inert under it.
const open = new Set();
export function showPage(d) {
  if (d.open) return;
  if (document.querySelector("dialog:modal")) return d.showModal();
  d.show();
  open.add(d);
  let back = null;
  if (window.CloseWatcher) try { back = new CloseWatcher(); back.onclose = () => d.close(); } catch { /* one per user gesture */ }
  d.addEventListener("close", () => { open.delete(d); back?.destroy(); }, { once: true });
}
/** The pages open with show(), for app/main.js's Esc and the bar's tabs. */
export const pagesOpen = () => [...open];
globalThis.addEventListener?.("keydown", (e) => { if (e.key === "Escape" && !window.CloseWatcher && open.size && !document.querySelector("dialog:modal")) { e.preventDefault(); [...open].at(-1).close(); } }); // app/main.js leaves Settings be
