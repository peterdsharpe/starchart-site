// W23 fromto (SPEC §26): From and To, as on Google Maps. The editor: two fields, From above To, with a swap button beside
// them, and under them the quick picks or the search results for the field that has focus. The preview's From → To row
// (fromRow) opens it on either field. W25 course: one search; the directions button went, and with no position, Set
// course (or a hold, or a search result) opens the editor on From, To filled: Choose start.
//
// app/course.js mounts it and gives it the search, the result rows and the preview; the rules are app/fromto-logic.js's.
import { pickEnd } from "./fromto-logic.js";
import { placeName } from "./course-logic.js"; // W60 b: the ends' names in the Words mode
import { pick as pickWords } from "./lingo-mode.js"; // W60 b
import { why, tip } from "./tip.js"; // W25 course; W40 flight: tip

/** The icons, drawn here and coloured by the stylesheet from the tokens (app/fromto.css). */
const SVG = {
  swap: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 20V5M4 8.5 8 4.5 12 8.5M16 4V19M12 15.5 16 19.5 20 15.5"/></svg>`,
  from: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle class="ring" cx="8" cy="8" r="5"/></svg>`,
  to: `<svg viewBox="0 0 16 20" width="16" height="20" aria-hidden="true"><path class="pin" d="M8 19C5 15.2 2 12 2 8A6 6 0 0 1 14 8C14 12 11 15.2 8 19Z"/><circle class="hole" cx="8" cy="8" r="2.2"/></svg>`,
  you: `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle class="halo" cx="14" cy="14" r="12"/><circle class="dot" cx="14" cy="14" r="6"/></svg>`,
  walk: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle class="head" cx="13.5" cy="4" r="2.2"/><path d="M12.6 8.2 10.8 14.6M12.6 8.2l2.6 3.4 2.8 1M12.2 9.4 9 11.8l-.6 3M10.8 14.6 8.2 20.6M10.8 14.6l3.4 2.6.9 3.6"/></svg>`, // W73 walk: a walker
  bike: `<svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true"><circle cx="6" cy="15.5" r="4.5"/><circle cx="22" cy="15.5" r="4.5"/><path d="M6 15.5 10.5 8h8.5L22 15.5M10.5 8 14 15.5 19 8M14 15.5H6M9 5h3.5M17.5 5H20l-1 3"/></svg>`, // W86 preview: a bike, for the mode switch
};
const svg = (cls, name) => { const s = document.createElement("span"); s.className = `ftic ic-${cls}`; s.innerHTML = SVG[name]; return s; };
/** W25 course (find B5): the search's words when its index can't load, what to do rather than the error. */
export const SEARCH_OFF = "Search downloads once, with a connection. Try again when you're online.";
/** W25 course: a hold on the chart fills the field with focus. */
const HINT_WORDS = { from: ["Places, starpaths, addresses. Hold the chart for the start.", "Places, streets, addresses. Hold the chart for the start."], // W60 b: [SCUL, Plain]
  to: ["Places, starpaths, addresses. Hold the chart for the destination.", "Places, streets, addresses. Hold the chart for the destination."] }; // W60 b
const BAR_WORDS = { group: ["From and To", "From and To"] }; // W86 preview: the From/To bar's name, [SCUL, Plain]
export const HINTS = { get from() { return pickWords(HINT_WORDS.from); }, get to() { return pickWords(HINT_WORDS.to); } }; // W60 b: read in the mode, each time

/**
 * `field` is the search pill; `rows(results, pick)` the search's result rows; `picks.all(other)` the quick picks;
 * `plan({ from, to })` opens the preview; `named`, `glyph`, `search`, `near`, `ready` and `watchBack` are course.js's.
 */
export function mountFromTo({ el, icon, named, glyph, rows, search, near, picks, plan, ready, watchBack, onOpen = () => {}, home = null }) { // W25 course: home(place), a Set as home button
  const ui = { box: null, ends: { from: null, to: null }, which: "to", typed: 0, shown: 0, enterSoon: false }; // W40 flight (E4): shown, the answer the rows are; enterSoon, an Enter waits for it
  const inputs = {};
  /** A quick pick: your position as the ship's dot; the rest by their glyph, as the search's picks. */
  const chip = (r, pick) => {
    const b = el("button", r.kind === "you" ? "you" : "");
    b.append(r.kind === "you" ? svg("you", "you") : glyph(r.kind, 28), named("span", "", r.kind, placeName(r))); // W60 b: placeName
    b.onclick = () => pick(r);
    return b;
  };
  const show = (which) => {
    const n = inputs[which], end = ui.ends[which];
    n.value = end ? placeName(end) : ""; // W60 b
    n.classList.toggle("you", !!end?.kind && end.kind === "you");
    if (which !== "to" || !home) return;
    n.parentElement.querySelector(".home")?.remove(); // W25 course: Set as home, for a place in To
    if (end?.lonlat && !end.you) n.parentElement.append(home(end));
  };

  /** Opens the editor with these ends, the cursor in `focus` (else the first empty field, else To). */
  function open({ from = picks.from(), to = null, focus = null } = {}) {
    close();
    onOpen();
    ui.ends = { from, to };
    const box = ui.box = el("section", "cresults cfromto idle");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Directions");
    const head = el("div", "ft-head"), fields = el("div", "ft-fields"), back = el("button", "ft-back"), swap = el("button", "ft-swap");
    back.setAttribute("aria-label", "Close directions");
    back.append(icon("back"));
    back.onclick = () => close();
    swap.setAttribute("aria-label", "Swap From and To");
    swap.title = "Swap From and To";
    swap.append(svg("swap", "swap"));
    swap.onclick = () => { done({ from: ui.ends.to, to: ui.ends.from }, true); };
    for (const [which, label, hint] of [["from", "From", "Choose start"], ["to", "To", "Choose destination"]]) {
      const f = el("label", `ft-f ft-${which}`), n = inputs[which] = Object.assign(el("input"), { type: "search", placeholder: hint, enterKeyHint: "search", autocomplete: "off" });
      n.setAttribute("aria-label", label);
      f.append(svg(which, which), n);
      n.addEventListener("focus", () => { ui.which = which; n.select(); results(); });
      n.addEventListener("input", () => { ui.ends[which] = null; n.classList.remove("you"); if (which === "to") f.querySelector(".home")?.remove(); results(); });
      n.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return; // W40 flight
        if (ui.shown !== ui.typed) ui.enterSoon = true; // W40 flight (E4): the rows are for earlier words; it picks once these words' come
        else if (!box.querySelector("ul button") && box.classList.contains("idle")) tip(n, "Type two letters, or pick one above."); // W40 flight (E6): never silent
        else box.querySelector("ul button")?.click();
      });
      fields.append(f);
      show(which);
    }
    box.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); } }); // the editor only, not the preview under it; W26 peek (friction 6): from any of its controls, and not the CloseWatcher of the preview, next in line
    head.append(back, fields, swap);
    box.append(head, el("div", "picks"), el("ul"), el("p", "note"));
    document.body.append(box);
    document.body.classList.add("has-cfromto");
    watchBack("fromto", close);
    ready().catch(() => { if (ui.box === box) box.querySelector(".note").textContent = SEARCH_OFF; }); // W25 course
    ui.which = focus || (!from ? "from" : "to");
    inputs[ui.which].focus();
    results();
  }
  function close() {
    if (!ui.box) return;
    ui.box.remove();
    ui.box = null;
    ui.typed++;
    watchBack("fromto");
    document.body.classList.remove("has-cfromto");
  }
  /** The ends are set: both, and the preview plots them (`swapped` too, when only one is); else the other field. */
  function done(ends, swapped = false) {
    ui.ends = ends;
    show("from"); show("to");
    if (ends.from && ends.to) { close(); plan(ends); return; }
    if (!swapped) inputs[ends.from ? "to" : "from"].focus();
    results();
  }
  const pick = (r) => done(pickEnd(ui.ends, ui.which, r));
  /** The quick picks before two letters; the search's rows from there, as the search shows them. */
  async function results() {
    const box = ui.box;
    if (!box) return;
    const q = ui.ends[ui.which] ? "" : inputs[ui.which].value.trim(), n = ++ui.typed;
    const list = box.querySelector("ul"), note = box.querySelector(".note"), chips = box.querySelector(".picks");
    box.classList.toggle("idle", q.length < 2);
    chips.hidden = q.length >= 2;
    ui.enterSoon = false; // W40 flight: a new field or a pick
    if (q.length < 2) {
      ui.shown = n; // W40 flight
      chips.replaceChildren(...picks.all(ui.ends[ui.which === "from" ? "to" : "from"]).map((r) => chip(r, pick))); // W25 course: never the other end
      list.replaceChildren();
      note.textContent = HINTS[ui.which];
      return;
    }
    let res;
    try { res = await search(q, near()); } catch { note.textContent = SEARCH_OFF; if (n === ui.typed) ui.shown = n; return; } // W25 course; W40 flight: shown
    if (n !== ui.typed || ui.box !== box) return; // a later letter, or another field, has its own answer
    note.textContent = res.length ? "" : `Not on the chart. It covers Greater Boston. ${HINTS[ui.which].split(". ")[1]}`; // W25 course
    list.replaceChildren(...rows(res, pick));
    ui.shown = n; // W40 flight
    if (ui.enterSoon) { ui.enterSoon = false; list.querySelector("button")?.click(); } // W40 flight: an Enter typed before these rows came
  }

  /**
   * The preview's From/To bar (W86 preview: at the top of the screen, as the editor's fields were): From over To, each a button
   * that opens the editor on it, ⇅ and share beside them, and the bike / walk + T switch at the end. In flight it is words only: From is
   * the ship, and there is no typing in flight.
   */
  function fromRow({ from, to, flying, swap, walk = null }) { // W73 walk: walk { on, label, tip, toggle }, the ship/walker switch; W86 preview: and bike { label, tip }
    const row = el("section", "ftrow pvbar"), fields = el("div", "ft-fields"); // W86 preview: the bar, over the chart
    row.setAttribute("role", "group"); row.setAttribute("aria-label", pickWords(BAR_WORDS.group)); // W86 preview
    const part = (which, end) => {
      const b = el("button", `ft-p ft-${which}${end ? "" : " empty"}${end?.kind === "you" ? " you" : ""}`);
      b.setAttribute("aria-label", `${which === "from" ? "From" : "To"}: ${end ? placeName(end) : "choose"}`); // W60 b: placeName
      const name = end ? (end.kind === "you" ? el("b", "", end.lingo_name) : named("b", "", end.kind, placeName(end))) : el("b", "", which === "from" ? "Choose start" : "Choose destination"); // W60 b
      name.dataset.essential = ""; // W22 fit: never cut
      b.append(svg(which, which), name);
      if (flying) why(b, pickWords("In flight, From is your ship.", "While you ride, From is where you are.")); // W60 b // W25 course: it says why it can't open, rather than nothing
      b.onclick = () => open({ from, to, focus: which });
      return b;
    };
    const sw = el("button", "ft-swap");
    sw.setAttribute("aria-label", "Swap From and To");
    sw.title = "Swap From and To";
    sw.append(svg("swap", "swap"));
    sw.onclick = swap;
    sw.hidden = flying || !from;
    fields.append(part("from", from), part("to", to)); // W86 preview: From over To, as in the editor
    const tools = el("div", "pv-tools"); tools.append(sw); // W86 preview: ⇅, and the share course.js adds under it
    row.append(fields, tools); // W86 preview
    if (walk) { // W86 preview: a two-way switch, bike or walk + T (the same starchart.walk), in place of W73's lone walker
      const modes = el("div", "ft-modes"); modes.setAttribute("role", "group"); modes.setAttribute("aria-label", walk.group); // W86 preview
      for (const [cls, on, w] of [["bike", !walk.on, walk.bike], ["walk", walk.on, walk]]) { // W86 preview
        const b = el("button", `ft-mode ft-${cls}`); b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", w.label); b.title = w.tip; // W86 preview
        b.append(svg(cls, cls)); b.onclick = () => (on ? tip(b, w.tip) : walk.toggle()); modes.append(b); // W86 preview: the chosen one says what it is (no silent controls)
      } // W86 preview
      row.append(modes); // W86 preview
    } // W86 preview
    return row;
  }
  /** W25 course: a hold on the chart, while the editor is open, fills the field with focus. */
  const fill = (r) => { if (ui.box) pick(r); };
  return { open, close, fill, fromRow, get isOpen() { return !!ui.box; } };
}
