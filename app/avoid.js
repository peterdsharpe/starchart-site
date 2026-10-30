// W73 avoid (design/app-ui/SPEC.md §118): the streets with an opinion in this phone's storage, and Settings' row for them.
//   - avoids() and save(list): the list (app/avoid-logic.js); a save tells the open row and course.js ("starchart:avoid").
//   - mountAvoidRow({ label }): the row "Starpaths" / "Streets" in Settings' routing rows (W80 avoidmap: always; was only while the list had a street):
//     it opens in place (a fold, as About does) to the streets, each with its remove and, for a moment after, its Undo.
//     `label(street)` is its name in the Words mode's words (course.js has the lingo).
//   - W80 avoidmap (SPEC §151): the row is always there, the list's registry: "Prefer or avoid a starpath" when empty; each
//     street says since when ("since 3 Oct"); "Clear all" (two or more) clears every one, with Undo in their place.
//     avoidedLine(bent, label, key) is the preview's line for a course that went round streets: their names, or once per
//     street, 30 days on, "Still avoiding Starpath Elm? Settings › Starpaths" (a long press hides that for good).
//   - W133 roadprefs (SPEC §245): each street has a level, Prefer, Avoid or Never (levelControl, the peek's and the row's);
//     the row is "Starpaths" / "Streets", its line counts them by level; W73's list is migrated once (migrate).
import { KEY, OLD_KEY, LEVELS, readAvoids, removeAvoid, sameAvoid, setLevel, countLevels, splitBent, WORDS, stamp, sinceDate, oldAvoid, told } from "./avoid-logic.js"; // W80 avoidmap: stamp, sinceDate, oldAvoid, told; W133 roadprefs: OLD_KEY, LEVELS, setLevel, countLevels, splitBent
import { holdToHide, isHidden } from "./notice.js"; // W80 avoidmap: the old avoid's reminder, hidden for good with a long press
import { pick, onLingo } from "./lingo-mode.js";

export const EVENT = "starchart:avoid";
const UNDO_MS = 5000;
let mem = null; // storage off or full: the list lasts this visit
/** W133 roadprefs: W73's list, read once into the new key (each street Never, OLD_LEVEL), then dropped. */
function migrate() {
  const old = localStorage.getItem(OLD_KEY);
  if (old == null) return;
  if (localStorage.getItem(KEY) == null) try { localStorage.setItem(KEY, JSON.stringify(readAvoids(old))); } catch { mem = readAvoids(old); return; } // storage full: the old list this visit, its key kept for the next
  localStorage.removeItem(OLD_KEY);
}
export const avoids = () => { if (mem) return mem; try { migrate(); return mem ?? readAvoids(localStorage.getItem(KEY)); } catch { return []; } }; // W133 roadprefs: migrate
export function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); mem = null; } catch { mem = list; }
  dispatchEvent(new CustomEvent(EVENT, { detail: { list } }));
}

/** W133 roadprefs (SPEC §245): the three levels as one control, good to bad, the street's `level` pressed; a tap on another sets
 *  it, a tap on the pressed one clears it: choose(level or null). The peek's (a column) and Settings' rows' (a row). */
export function levelControl(level, choose, name = "") {
  const g = document.createElement("span");
  g.className = "levels"; g.setAttribute("role", "group"); if (name) g.setAttribute("aria-label", name);
  for (const l of LEVELS) {
    const b = document.createElement("button");
    b.className = `lv lv-${l}`; b.textContent = WORDS.level[l]; b.dataset.level = l; b.setAttribute("aria-pressed", String(l === level));
    b.onclick = (e) => { e.stopPropagation(); choose(l === level ? null : l); };
    g.append(b);
  }
  return g;
}

const CLOSE_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

export function mountAvoidRow({ label = (a) => a.name }) {
  const fold = document.getElementById("avoid-fold"), box = document.getElementById("avoid-list");
  if (!fold || !box) return null;
  const sum = fold.querySelector("summary"), title = sum.querySelector(".t"), names = sum.querySelector("small");
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let undo = null; // { street, at, timer, back(list) }: the street just removed, kept in its place for a moment
  function row(a, gone = false) {
    const r = el("div", `row avoid${gone ? " gone" : ""}`), t = el("span", "txt", label(a)), b = el("button", gone ? "undo" : "rm");
    if (a.missing && !gone) t.append(el("small", "", pick(WORDS.missing)));
    else if (Number.isFinite(a.since) && !gone) t.append(el("small", "since", WORDS.since(sinceDate(a.since)))); // W80 avoidmap
    if (gone) { b.textContent = "Undo"; b.onclick = () => { const u = undo; clearTimeout(u.timer); undo = null; save(u.back(avoids())); }; }
    else { b.innerHTML = CLOSE_SVG; b.setAttribute("aria-label", WORDS.remove(label(a))); b.title = b.getAttribute("aria-label"); b.onclick = () => remove(a); }
    r.dataset.level = a.level; // W133 roadprefs
    r.append(el("i", "i i-avoid"), t, b);
    if (!gone) r.append(levelControl(a.level, (l) => (l ? level(a, l) : remove(a)), label(a))); // W133 roadprefs: its level, changed in place; the pressed one clears it, as × does
    return r;
  }
  function level(a, l) { // W133 roadprefs: the street at level l, focus kept on it through the redraw
    const list = setLevel(avoids(), a, l, Date.now());
    save(list);
    box.querySelectorAll(".row.avoid:not(.gone)")[list.findIndex((x) => sameAvoid(x, a))]?.querySelector(`.lv-${l}`)?.focus();
  }
  function remove(a) {
    const at = avoids().findIndex((x) => sameAvoid(x, a)), { list, undo: back } = removeAvoid(avoids(), a);
    if (undo) clearTimeout(undo.timer);
    undo = { street: a, at, back, timer: setTimeout(() => { undo = null; draw(); }, UNDO_MS) };
    save(list);
    box.querySelector(".undo")?.focus();
  }
  function clearAll() { // W80 avoidmap: every street let back in, with Undo in their place
    const all = avoids();
    if (undo) clearTimeout(undo.timer);
    undo = { all, timer: setTimeout(() => { undo = null; draw(); }, UNDO_MS) };
    save([]);
    box.querySelector(".undo")?.focus();
  }
  function clearedRow(all) { // W80 avoidmap: "3 starpaths let back in", and Undo, which puts them back after any avoided since
    const r = el("div", "row avoid gone cleared"), b = el("button", "undo", "Undo");
    b.onclick = () => { clearTimeout(undo.timer); undo = null; const now = avoids(); save([...now, ...all.filter((a) => !now.some((x) => sameAvoid(x, a)))]); };
    r.append(el("i", "i i-avoid"), el("span", "txt", pick(WORDS.cleared(all.length))), b);
    return r;
  }
  function howRow() { // W86 settings: how to add one; W133 roadprefs: "Tap a street on the map, then Prefer, Avoid or Never."
    const r = el("div", "row avoid-how");
    r.append(el("span", "txt", pick(WORDS.how)));
    return r;
  }
  function draw() {
    const list = avoids();
    title.textContent = pick(WORDS.list);
    names.textContent = list.length ? WORDS.counts(countLevels(list)) : pick(WORDS.none); // W80 avoidmap: always there, and says when the list is empty; W133 roadprefs: how many at each level, not the names
    const rows = list.map((a) => row(a));
    if (undo?.street) rows.splice(Math.max(0, Math.min(rows.length, undo.at)), 0, row(undo.street, true));
    if (undo?.all) rows.push(clearedRow(undo.all)); // W80 avoidmap
    if (list.length > 1) { const c = el("button", "clear", pick(WORDS.clearAll)); c.onclick = clearAll; rows.push(c); } // W80 avoidmap
    rows.push(howRow()); // W86 settings: how to add one, at the list's foot
    box.replaceChildren(...rows);
  }
  addEventListener(EVENT, draw);
  addEventListener("storage", (e) => { if (e.key === KEY || e.key === OLD_KEY) draw(); }); // another tab's change
  onLingo(draw);
  const old = stamp(avoids(), Date.now()); if (old) save(old); // W80 avoidmap: a street kept before W80 is avoided since today
  draw();
  return { draw };
}

const reminded = new WeakMap(); // W80 avoidmap: the old avoid a preview (its key) reminds of, kept while it re-draws
/** W80 avoidmap: the preview's small line for a course that went round `bent`: "Avoiding Starpath Western" (and the
 *  others), or, for the first course 30 days after a street was avoided, once per street, the reminder. `key`, the open
 *  preview's (an object), so its re-draws keep the line it showed. */
export function avoidedLine(bent, label, key, forced = []) { // W133 roadprefs: forced, the Nevers it rode as there was no way round
  const n = document.createElement("span"), { round, onto } = splitBent(bent); // W133 roadprefs: round, the Avoids and Nevers it went round; onto, the Prefers it was drawn onto
  n.className = "avoided";
  const words = () => [round.length && WORDS.avoidingAll(round.map(label)), onto.length && WORDS.taking(onto.map(label)), forced.length && WORDS.noWay(forced.map(label))].filter(Boolean).join(" · "); // W133 roadprefs
  if (onto.length && !round.length && !forced.length) n.classList.add("onto"); // W133 roadprefs: the chalk mark's line, not the sign's
  let old = key && reminded.get(key);
  if (old === undefined) {
    old = isHidden("old-avoid") ? null : oldAvoid(avoids(), round, Date.now()); // W133 roadprefs: round
    if (old) save(told(avoids(), old));
    if (key) reminded.set(key, old);
  }
  if (old && !isHidden("old-avoid")) {
    n.classList.add("old");
    n.textContent = pick(WORDS.still(label(old)));
    holdToHide(n, "old-avoid", { close: () => { n.classList.remove("old"); n.textContent = words(); }, restore: () => {} }); // W133 roadprefs: words()
  } else n.textContent = words(); // W133 roadprefs
  return n;
}
