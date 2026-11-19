// W60 a: the Words setting, SCUL or Plain (design/app-ui/SPEC.md §84). One mode for the whole app: the chart's labels,
// the readout, the cards and the voice read it here, and follow a change live, mid-flight too.
//
//   lingo()            "scul" | "meatspace": ?lingo= (the tests'), else localStorage "starchart.lingo", else "meatspace" (W130 plaindefault)
//   plain()            true in Plain ("meatspace", the glossary's word; only the screen says "Plain")
//   pick(scul, plain)  the mode's words; pick([scul, plain]) and pick({ scul, plain }) for a WORDS entry, and a lone
//                      string or function is both modes' (a string with no SCUL word keeps one value)
//   onLingo(fn)        fn(mode) after each change; returns the function that stops it
//   setLingo(v)        writes the key and tells everyone, as app/settings.js set() does (W130 plaindefault's card offer used it; W150 welcome2 removed the offer)
//   swapWords(root)    index.html's static text: an element's data-plain is its own text in Plain, and data-plain-<x>
//                      attribute x's, or data-x's (data-plain-aria-label, data-plain-more); the SCUL words stay in data-scul*
//   <html data-lingo>  the mode, for CSS (W65 plainlook)
//
// No imports, so app/first.js's welcome card can load it before main.js's files (W47 firstload).
export const KEY = "starchart.lingo";
export const LINGOS = ["scul", "meatspace"];

let url = null;
try { url = new URLSearchParams(globalThis.location?.search ?? "").get("lingo"); } catch { /* no location */ }
url = LINGOS.includes(url) ? url : null;
let kept = null; // W130 plaindefault: this visit's pick, for when storage is off
const stored = () => { try { return globalThis.localStorage?.getItem(KEY); } catch { return kept; } };

export const lingo = () => url ?? (stored() === "scul" ? "scul" : "meatspace"); // W130 plaindefault: Plain unless SCUL was chosen
export const plain = () => lingo() === "meatspace";

export function pick(scul, plainWords) {
  if (arguments.length > 1) return plain() && plainWords !== undefined ? plainWords : scul;
  if (Array.isArray(scul)) return plain() && scul.length > 1 ? scul[1] : scul[0];
  if (scul && typeof scul === "object" && "scul" in scul) return plain() && scul.plain !== undefined ? scul.plain : scul.scul;
  return scul;
}

export function onLingo(fn) {
  const hear = (e) => { if (e.detail?.key === KEY) fn(lingo()); };
  globalThis.addEventListener?.("starchart:settings", hear);
  return () => globalThis.removeEventListener?.("starchart:settings", hear);
}
// a pick in this visit wins over ?lingo=, so the row and the card always do what they show; with storage off, it lasts the visit
globalThis.addEventListener?.("starchart:settings", (e) => { if (e.detail?.key === KEY) { url = null; kept = e.detail.value; } }); // W130 plaindefault: kept
// W65 plainlook: <html data-lingo>, so CSS can draw Plain's own icons (app/app.css), from the first frame and live
const mark = () => { const d = globalThis.document?.documentElement?.dataset; if (d) d.lingo = lingo(); }; // a test's fake document may have none
mark(); globalThis.addEventListener?.("starchart:settings", (e) => { if (e.detail?.key === KEY) mark(); });

export function setLingo(v) {
  v = LINGOS.includes(v) ? v : "meatspace"; // W130 plaindefault
  try { globalThis.localStorage?.setItem(KEY, v); } catch { /* storage off: the change lasts this visit */ }
  globalThis.dispatchEvent?.(new CustomEvent("starchart:settings", { detail: { key: KEY, value: v } }));
  return v;
}

const own = (el) => [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim()); // its own text, so its icon stays
export function swapWords(root = globalThis.document) {
  const p = plain();
  for (const el of root?.querySelectorAll?.("*") ?? []) {
    for (const { name, value } of [...el.attributes]) {
      if (!name.startsWith("data-plain")) continue;
      const x = name.slice(11), attr = x && (el.hasAttribute(x) ? x : `data-${x}`), keep = x ? `data-scul-${x}` : "data-scul";
      const node = attr ? null : own(el);
      if (!el.hasAttribute(keep)) el.setAttribute(keep, attr ? el.getAttribute(attr) ?? "" : node?.nodeValue ?? "");
      const v = p ? value : el.getAttribute(keep);
      if (attr) el.setAttribute(attr, v); else if (node) node.nodeValue = v;
    }
  }
}
