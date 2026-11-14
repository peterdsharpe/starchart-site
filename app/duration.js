// W68 fixes (design/app-ui/SPEC.md §101): one way to write a duration, everywhere one shows. arclight, 2026-10-20:
// "anytime that you're talking about times of more than one hour … like 1H20M with like small h and small m".
//
//   dur(45)  "45 min"     dur(60) "1h"     dur(80) "1h 20m"     dur(120) "2h"     dur(125) "2h 5m"
//   durNodes(80)  "1", <i>h</i>, " 20", <i>m</i>: the same words, the units in <i>, smaller (the cards' " min")
// Spoken lines keep their minutes ("Radiation in twenty minutes."), and so does the flight readout's Min cell: at 34 px "80"
// reads at a glance, where "1h 20" ran into the LY beside it at 320 and 360 px.

/** [hours, minutes] of a whole number of minutes, or null under an hour. */
const hm = (min) => { const m = Math.max(0, Math.round(min)); return m < 60 ? null : [Math.floor(m / 60), m % 60]; };

/** A duration in minutes as text: "45 min" under an hour, else "1h 20m", and "2h" on the hour. */
export function dur(min) {
  const t = hm(min);
  if (!t) return `${Math.max(0, Math.round(min))} min`;
  return t[1] ? `${t[0]}h ${t[1]}m` : `${t[0]}h`;
}

/** The same as nodes: a duration in minutes, or a line with durations in it ("4.3 LY · 1h 14m · arrive 12:18"), each
 *  duration's unit in an <i class="du"> (small where it shows, and never in capitals): "1", <i>h</i>, " 20", <i>m</i>. */
export function durNodes(x, doc = globalThis.document) {
  const text = typeof x === "number" ? dur(x) : String(x), out = [];
  let at = 0;
  for (const m of text.matchAll(/(?<=\d)(h|m| min)(?!\p{L})/gu)) {
    out.push(text.slice(at, m.index), Object.assign(doc.createElement("i"), { className: "du", textContent: m[1] }));
    at = m.index + m[0].length;
  }
  out.push(text.slice(at));
  return out.filter((n) => n !== "");
}
