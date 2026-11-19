// W73 a11y (design/app-ui/SPEC.md §113): in Plain, index.html's words are Plain's from the first frame. A classic script in
// <head> (the CSP allows no inline script), so it runs before the body is parsed: it watches the parser, and swaps each
// element's data-plain* as it comes in, before anything paints. app/lingo-mode.js's swapWords() does the same once the
// modules are in, and every live switch after; it finds the SCUL words kept in data-scul* as it keeps them itself.
// With SCUL, the page's own words, nothing to do. Plain is the default since W130 plaindefault (§242).
(() => {
  let mode = null, stored = null;
  try { mode = new URLSearchParams(location.search).get("lingo"); } catch { /* no location */ }
  try { stored = localStorage.getItem("starchart.lingo"); } catch { /* storage off */ }
  if ((mode === "scul" || mode === "meatspace" ? mode : stored === "scul" ? "scul" : "meatspace") !== "meatspace") return; // lingo-mode.js lingo(); W130 plaindefault: Plain unless SCUL was chosen
  document.documentElement.dataset.lingo = "meatspace"; // as lingo-mode.js marks it
  const own = (el) => [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim()); // its own text, so its icon stays
  const texts = new Map(); // a text swapped, its element and Plain words: the parser may yet add to it (a split download)
  const swap = (el) => {
    for (const { name, value } of [...el.attributes]) {
      if (!name.startsWith("data-plain")) continue;
      const x = name.slice(11), attr = x && (el.hasAttribute(x) ? x : `data-${x}`), keep = x ? `data-scul-${x}` : "data-scul";
      if (el.hasAttribute(keep)) continue; // swapped already
      const node = attr ? null : own(el);
      if (!attr && !node) continue; // its text isn't parsed yet: again when it is
      el.setAttribute(keep, attr ? el.getAttribute(attr) ?? "" : node.nodeValue);
      if (attr) el.setAttribute(attr, value); else { node.nodeValue = value; texts.set(node, [el, value]); }
    }
  };
  const all = (n) => { if (n.nodeType !== 1) return; swap(n); for (const e of n.querySelectorAll("*")) swap(e); };
  /** The parser added to a text it had begun ("Lau", then "nch"): that rest is SCUL's, and the words stay Plain's. */
  const grew = (node) => { const [el, v] = texts.get(node) ?? []; if (el && node.nodeValue !== v && node.nodeValue.startsWith(v)) { el.setAttribute("data-scul", el.getAttribute("data-scul") + node.nodeValue.slice(v.length)); node.nodeValue = v; } };
  all(document.documentElement); // the head so far (the tab's icon)
  const watch = new MutationObserver((records) => { for (const r of records) { if (r.type === "characterData") grew(r.target); else { if (r.target.nodeType === 1) swap(r.target); r.addedNodes.forEach(all); } } });
  watch.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener("DOMContentLoaded", () => watch.disconnect(), { once: true });
})();
