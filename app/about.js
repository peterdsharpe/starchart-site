// About, wave 18: the route network and the search index on this droid, beside the chart's own rows (app/course.js
// stores them once the chart is in), and the screen's size and safe areas, so a pilot can report them from the road.
import { storedTiles } from "./offline.js";
import { pick, onLingo } from "./lingo-mode.js"; // W60 c

const WHAT = { graph: "Route network", search: "Search index", dem: "Hills", slope: "Steep ground" }; // W19 terrain (app/terrain.js stores them)
const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, ...(text != null && { textContent: text }) });

/** Fill (or refresh) a row per stored file after the chart's rows in `group`. */
let last = null; // W60 c: the rows again in the new words, when Words changes with Settings open
export async function aboutStores({ data, group, MB }) {
  if (!last) onLingo(() => aboutStores(last)); // W60 c
  last = { data, group, MB }; // W60 c
  for (const e of data.files.filter((f) => WHAT[f.kind])) {
    const st = await storedTiles(e).catch(() => null), ok = !!st?.current, name = WHAT[e.kind];
    let row = group.querySelector(`[data-kind="${e.kind}"]`);
    if (!row) { row = el("div", "row"); row.dataset.kind = e.kind; group.append(row); }
    const txt = el("div", "txt"), small = el("small", "", ok ? pick(`Stored on this droid (${MB(e.bytes)}) and checked.`, `Stored on this phone (${MB(e.bytes)}) and checked.`) // W55 layers2: "Works offline" beside it says the rest; W60 c
      : e.kind === "dem" || e.kind === "slope" ? `Drawn once it is stored, after the chart (${MB(e.bytes)}).` // W76 privacy: the hills are never read from the network (app/terrain.js)
      : `Read from the network until it is stored, after the chart (${MB(e.bytes)}).`);
    txt.append(el("span", "", name), small);
    row.replaceChildren(el("i", `i ${ok ? "i-check" : "i-download"}`), txt, el("span", ok ? "val ok" : "val", ok ? "Works offline" : ""));
  }
}

/** The screen as the app sees it: CSS pixels, the safe areas and how it runs (installed or in a browser tab). */
export function screenLine() {
  const probe = el("div", "inset-probe");
  document.body.append(probe);
  const cs = getComputedStyle(probe), px = (v) => Math.round(parseFloat(v) || 0);
  const line = `${innerWidth} × ${innerHeight}, safe areas ${px(cs.paddingTop)} top and ${px(cs.paddingBottom)} bottom, `
    + (matchMedia("(display-mode: standalone)").matches ? "installed" : "in a browser tab");
  probe.remove();
  return line;
}
