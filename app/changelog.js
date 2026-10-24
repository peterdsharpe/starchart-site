// W98 changelog (design/app-ui/SPEC.md §194): what each version changed. arclight, 2026-10-23: "Can you put a changelog
// on versions? Sometimes it's hard to tell what updated." The bullets are app/changelog.json's, newest first (hosting/pages.sh
// stamps its "next" at each release, through hosting/next-release.py). A bullet is a string, the same in both Words, or
// { scul, plain }, as pick() reads it.
// - The list: a full-screen page (BRIEF §7.8), #changelog, from About's What's new row and from the note below.
// - The note: the first time a new version runs, "Updated to 0.1.53" with What's new, once, above Launch. Never on a first
//   install, and never in flight or on a course: it waits until the ride ends (`canShow`). It is a transient note, with no ×:
//   the next tap elsewhere, or Escape, closes it, and that tap still does what it hits.
import { pick, onLingo } from "./lingo-mode.js";
import { say } from "./tip.js";

export const SEEN = "starchart.version"; // the version that last ran on this phone
/** "0.1.53" against "0.1.52": above 0 when a is the newer version, by its numbers ("0" for an install from before W98). */
export const newer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
/** Whether the note is due: some older version ran here before (never for a rollback to an older one: the W98 review). */
export const updated = (last, now) => !!last && newer(now, last) > 0;
/** "Oct 23, 2026", from "2026-10-23". */
export const day = (iso) => new Date(`${iso}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, ...(text != null && { textContent: text }) });
const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** The page and the note. `version` is this build's ("0.1.53"); `canShow()` says whether the note may show now. */
export function mountChangelog({ page, row, version, canShow }) {
  const list = page.querySelector(".cl-list");
  let log = null;
  const render = () => {
    if (!log) return;
    list.replaceChildren(...log.versions.map((v) => {
      const now = v.version === version, s = el("section", now ? "cl-v now" : "cl-v");
      const h = el("h3", "", `${v.version} `);
      h.append(el("span", "name", v.release));
      const when = el("p", "when", day(v.date));
      if (now) when.append(el("b", "", "This version"));
      const ul = el("ul");
      ul.append(...v.notes.map((n) => el("li", "", pick(n))));
      s.append(h, when, ul);
      return s;
    }));
  };
  onLingo(render);
  const open = async () => {
    log ??= await fetch("app/changelog.json").then((r) => r.json()).catch(() => null);
    if (!log) list.replaceChildren(el("p", "note", "The list didn't load. Try again with a signal."));
    render();
    if (!page.open) page.showModal();
    page.scrollTop = 0;
  };
  row.onclick = open;

  const s = store();
  let last = null;
  try { last = s?.getItem(SEEN) ?? null; if (!last) s?.setItem(SEEN, version); } catch { /* storage off: no note */ } // the W98 review: a phone from before this key gets its first note at the release after, not at the one that brings it (a welcome-seen guess would show it through most of the e2e suite, which seeds the welcome)
  if (!updated(last, version)) return { open };
  const note = el("div", "nsnack"), t = el("span", "t", `Updated to ${version}`), b = el("button", "", "What's new");
  note.id = "updated";
  note.append(t, b);
  const close = () => {
    note.remove();
    removeEventListener("pointerdown", away, true);
    removeEventListener("keydown", esc, true);
  };
  const away = (e) => { if (!note.contains(e.target)) close(); }; // the tap goes on to what it hits
  const esc = (e) => { if (e.key === "Escape") close(); };
  b.onclick = () => { close(); open(); };
  const timer = setInterval(() => {
    if (!canShow()) return;
    clearInterval(timer);
    try { s?.setItem(SEEN, version); } catch { /* storage off */ }
    document.body.append(note);
    say(`${t.textContent}. What's new`);
    addEventListener("pointerdown", away, true);
    addEventListener("keydown", esc, true);
  }, 1000);
  return { open };
}
