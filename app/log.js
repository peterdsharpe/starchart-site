// The bottom bar and the Log (wave 17, design/app-ui/SPEC.md §14 and §15).
//
// While parked, a bar at the bottom: Chart and Log. Launch slides it away and Land brings it back once
// the Undo window closes (main.js calls bar()). It sets html.bar, which gives --bar-h, the bar's height
// with the bottom safe area (0px without the bar): Launch, the location button and the OSM © sit on it.
//
// The Log is a page over the chart: lifetime light years and the star class (a tap opens the ladder), the
// season, and the flights with chalk thumbnails. A flight's page frames its route on the chart, with
// Replay at 10× or 60×, Rename, GPX, the 3 × 3 stats, and Delete with Undo. "Delete every flight" (with
// Undo) is at the foot of the Log. The tracks come from the logbook worker (app/logbook.js); a flight the tab
// lost before its summary was written is offered back at the start.
//
// mountLog({map, maplibregl, box, logbook, at, hold, demo}): hold(view) is main.js's: "page" (the chart is
// covered: pause it), "route" (the chart shows a flight: the live camera lets go) or null (back to flying).
// `demo` is true in the demo, whose flights aren't kept. W25 rest: `recentre(tab)`, the Chart tab's tap while on the chart.
import { CLASSES, CarGuard, LY, classFor, nextClass, tiny } from "./blackbox.js"; // W68 logbulk: tiny
import { starSVG, get as setting, set as setSetting, paceStep, paceToLearn } from "./settings.js"; // W59 pace: setting, setSetting, paceStep; W86 eta: paceToLearn
import { Chunker, drawnTrack, gpx, gpxName, paceOf, learnedPace, rideName, statsFrom, thumbSVG, trackLines, unpackThumb, trackRuns, trimRuns } from "./logbook.js"; // W21 gps: drawnTrack; W27 friction: rideName; W29 polish: trackLines; W59 pace: paceOf; W67 logsafe: trackRuns, trimRuns
import { tip, why, say } from "./tip.js"; // W24 quiet; W73 a11y: say
import { LOCK, UNDO, heldLocks, holdLock } from "./resume.js"; import { browserOf } from "./install.js"; // W40 log
import { keep as keepStorage } from "./offline.js"; // W40 settings
import { pick, onLingo, plain } from "./lingo-mode.js"; // W60 c; W76 loghead: plain
import { seasonOf, saturnight } from "./season-logic.js"; // W76 loghead
import { backupName } from "./logsafe.js"; // W67 logsafe
import { longPress } from "./press.js"; // W68 logbulk: a long press on a row selects it
import { dur, durNodes } from "./duration.js"; // W68 fixes: "1h 20m"
import { flip, tapTick } from "./motion.js"; import { pulse } from "./haptics.js"; // W69 motion
import { WORDS as GHOST_WORDS, haunting } from "./ghosts.js"; // W73 ghosts: the season chart
import { average, buckets, label as periodLabel, ticks } from "./log-weeks.js"; // W88 logweek: the activity bars; W88 logavg: average

const UNDO_MS = 5000; // W19 course: 5 s, as Land and Cancel course
const MPH = 0.44704, FT = 3.28084;
const counted = (f) => Math.max(0, f.metres - (f.excluded_m || 0));
let DAY, CLOCK; // made once: a row's day and time cost a formatter each, which 150 rows notice (W21 logfix); W76 start: on first use, not at the start (app/logbook.js)
const day = (t) => (DAY ||= new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" })).format(t); // W76 start
const clock = (t) => (CLOCK ||= new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })).format(t); // W76 start
const n0 = (v, f = String) => (v == null ? "—" : f(v));
const node = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const icon = (name) => node("i", { className: `i i-${name}` });
const pace = (q) => (q === 0 ? "as planned" : `${Math.abs(q)} % ${q > 0 ? "quicker" : "slower"} than planned`);
const s_ = (n) => (n === 1 ? "" : "s");
/** The Log's words, [SCUL, Plain] (W59 pace's first; W60 c the rest, design/app-ui/SPEC.md §89). One value: both modes'. */
export const WORDS = {
  planned: [(plan, flew) => `Planned ${dur(plan)} · flew ${dur(flew)}`, (plan, flew) => `Planned ${dur(plan)} · rode ${dur(flew)}`], // W68 fixes: dur
  head: [(n, q) => `On ${n} course${s_(n)} you flew ${pace(q)}`, (n, q) => `On ${n} route${s_(n)} you rode ${pace(q)}`],
  offer: (pct) => `Set your pace to ${pct} %`,
  already: (pct) => `Your pace is already ${pct} %.`,
  set: (pct) => `Your pace is now ${pct} %.`,
  learned: [(pct, n) => `Your pace is now ${pct} %, from your last ${n} flights`, (pct, n) => `Your pace is now ${pct} %, from your last ${n} rides`], // W86 eta
  // W60 c
  demo: ["Demo flights aren't kept", "Demo rides aren't kept"],
  count: [(n) => `${n} flight${s_(n)}`, (n) => `${n} ride${s_(n)}`],
  ly: ["LY", "mi"], // the unit after a number
  cells: [["flights", "LY", "earth time", "hi-fives"], ["rides", "mi", "time"]], // the season's; Plain has no tallies (W60 a hides their buttons); W68 fixes: time, its value "1h 20m"
  row: [(d, ly, min) => `${d} · ${ly} LY · ${dur(min)}`, (d, mi, min) => `${d} · ${mi} mi · ${dur(min)}`], // W68 fixes: dur
  resetAll: ["Delete every flight", "Delete every ride"],
  demoKept: ["Demo flights aren't kept.", "Demo rides aren't kept."],
  noneToDelete: ["No flights to delete.", "No rides to delete."],
  allDeleted: ["Every flight deleted ", "Every ride deleted "],
  dist: [(ly) => `· ${ly} LY`, (mi) => `· ${mi} mi`],
  empty: ["Launch on GPS and land: each flight shows here, with its route.", "Tap Record, ride, and tap End: each ride shows here, with its route."], // W88 ridemodes: Plain's bar says Record
  gpsOnly: ["Only GPS flights count. A stretch over 35 mph for more than 20 s, like a car or a train, is left out.",
    "Only GPS rides count. A stretch over 35 mph for more than 20 s, like a car or a train, is left out."],
  what: [(n) => (n === 1 ? "1 flight" : `${n} flights`), (n) => (n === 1 ? "1 ride" : `${n} rides`)],
  sureOne: ["Delete your 1 flight?", "Delete your 1 ride?"],
  ladder: ["Lifetime light years on this droid: every GPS flight, less any stretch at transport speed.",
    "Lifetime miles on this phone: every GPS ride, less any stretch at car speed."],
  toGo: [(n) => `${n} LY to go`, (n) => `${n} mi to go`],
  classes: ["Star classes", "Milestones"], allClasses: ["Every class reached", "Every milestone reached"], // W65 plainlook
  noClass: [() => "No class yet", () => "First milestone"], // W65 plainlook: before the first; W88 logavg: next says how far, so firstTo and toClass went
  className: [(c) => c.name, (c) => `${c.ly} miles`], // W65 plainlook: Plain's ladder is plain mileage milestones
  flight: ["Flight", "Ride"], name: ["Flight name", "Ride name"],
  noTrack: ["No track for this flight.", "No track for this ride."],
  tiles: [["LY", "Earth time", "Avg warp", "Top warp", "Climb", "Pulsars", "Black holes", "Hi-fives", "Cups"],
    ["mi", "Time", "Avg mph", "Top mph", "Climb", "Traffic lights", "Rotaries"]], // Plain: no tallies; W68 fixes: Earth time, Time, their value "1h 20m"
  leftOut: [(ly) => `${ly} LY left out`, (mi) => `${mi} mi left out`],
  leftWhy: [": a stretch above Warp 35 for more than 20 s, so a car or a train. It doesn't count toward your light years.",
    ": a stretch above 35 mph for more than 20 s, so a car or a train. It doesn't count toward your miles."],
  systems: [(s) => `Systems: ${s}.`, (s) => `Towns: ${s}.`],
  del: ["Delete this flight", "Delete this ride"],
  deleted: ["Flight deleted ", "Ride deleted "],
  saved: ["Flight saved ", "Ride saved "],
  trim: "Trim the ends", whole: "Whole track", short: "Too short to trim.", // W67 logsafe: GPX's menu (SPEC §96)
  backup: "Back up the Log", restore: "Restore", noneToBack: ["No flights to back up.", "No rides to back up."], // W67 logsafe: the backup (SPEC §96)
  restored: [(n) => `${n} flight${s_(n)} restored `, (n) => `${n} ride${s_(n)} restored `], allHere: ["Every flight in it is already here.", "Every ride in it is already here."], // W67 logsafe
  newer: "From a newer Starchart: update the app first.", notBackup: "Not a Starchart Log backup.", full: "Log full: nothing restored.", // W67 logsafe
  again: ["Fly again", "Ride again"], // W67 routefile: the flight's trail as a course (SPEC §94)
  // W68 logbulk (SPEC §99): select several, swipe, tiny flights
  selected: (n) => `${n} selected`, clear: "Clear selection", star: "Star", unstar: "Unstar", archive: "Archive", unarchive: "Unarchive",
  remove: "Delete", all: "Select all", starred: "Starred", archived: "Archived",
  selTiny: [(n) => `Select ${n} tiny flight${s_(n)}`, (n) => `Select ${n} tiny ride${s_(n)}`],
  gone: [(n) => `${n} flights deleted `, (n) => `${n} rides deleted `],
  archivedN: [(n) => (n === 1 ? "Flight archived" : `${n} flights archived`), (n) => (n === 1 ? "Ride archived" : `${n} rides archived`)],
  unarchivedN: [(n) => (n === 1 ? "Flight unarchived" : `${n} flights unarchived`), (n) => (n === 1 ? "Ride unarchived" : `${n} rides unarchived`)],
  tooShort: "Too short to keep", keep: "Keep",
  feedback: "Send feedback", // W74 flightlog: a flight's page, with its log (SPEC §129)
  // W76 loghead (SPEC §135): a year heading, SCUL's by SCUL's season (Plain's by the calendar year); Saturnight in the head, SCUL only (D10)
  season: [(s) => (s.off ? `${s.year}–${String(s.year + 1).slice(2)} off-season` : `${s.year} season`), (s) => `${s.year} season`],
  saturnight: [(k) => (k === "now" ? "It's Saturnight" : "Saturnight tonight"), ""], // Plain: none
  // W88 logweek (SPEC §177): the activity bars, distance and climb by week or month
  weeks: "Weeks", months: "Months", thisWeek: "This week", thisMonth: "This month", showAll: ["Show every flight", "Show every ride"], // W88 logweek
  total: [(ly, ft) => `${ly} LY · ▲ ${ft} ft`, (mi, ft) => `${mi} mi · ▲ ${ft} ft`], // W88 logweek
  activity: [(u) => `Light years and climb by ${u}`, (u) => `Miles and climb by ${u}`], // W88 logweek: the bars' name, for a screen reader
  noneThen: [(u) => `No flights that ${u}.`, (u) => `No rides that ${u}.`], // W88 logweek
  next: [(c, n) => `Next: ${c.name} · ${n} LY to go`, (c, n) => `Next: ${c.ly} mi · ${n} to go`], // W88 logavg (SPEC §182): the milestone in one line
  avg: [(ly) => `avg ${ly}`, (mi) => `avg ${mi}`], // W88 logavg: her own average, beside the period's distance, in its unit (said once: the minimal-text rule; and a picked month's line fits at 320 px)
};
/** W60 c: the mode's words for `k`, filled in with `a` when they are a phrase. */
const w = (k, ...a) => { const v = pick(WORDS[k]); return typeof v === "function" ? v(...a) : v; };
const ftOf = (m) => (Math.round((m * FT) / 10) * 10).toLocaleString("en-US"); // W88 logweek: climb to the nearest 10 ft, as a flight's tile

export function mountLog({ map, maplibregl, box, logbook, at, hold = () => {}, demo = false, recentre = null, again = null, ghosts = null, feedback = null }) { // W25 rest: recentre; W67 routefile: again(line), Fly again's course; W73 ghosts: ghosts (app/ghosts.js); W74 flightlog: feedback(lines)
  const html = document.documentElement, body = document.body;

  // ---- the bar ----------------------------------------------------------------------------------
  const tab = (id, label, name) => { const b = node("button", { className: "tab", id }, icon(name), node("span", { textContent: label })); return b; };
  const chartTab = document.getElementById("tab-chart") || tab("tab-chart", "Chart", "fold-chart"), logTab = document.getElementById("tab-log") || tab("tab-log", "Log", "black-box"); // W25 rest: index.html has them from the first frame
  const stack = document.getElementById("stack"), corner = ["about", "sound"].map((id) => document.getElementById(id)); // W23 bar: Settings and Sound, in the bar's right corner
  const bar = document.getElementById("bar") || node("nav", { id: "bar", ariaLabel: "Fort" }, chartTab, logTab, ...(stack ? [stack] : [])); // W25 rest: so has the bar
  body.append(bar);
  let barWanted = true;
  function showBar() {
    const on = barWanted && !body.classList.contains("log-flight");
    bar.classList.toggle("away", !on);
    bar.inert = !on;
    html.classList.toggle("bar", on);
    const home = barWanted ? stack : body; // W23 bar: in flight the bar is away, and Settings and Sound ride in the right column (app.css)
    for (const b of corner) if (b && stack && b.parentNode !== home) home.append(b);
    for (const [b, cur] of [[chartTab, !body.classList.contains("log-page")], [logTab, body.classList.contains("log-page")]]) {
      b.classList.toggle("on", cur);
      if (cur) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    }
  }
  chartTab.onclick = () => (page.hidden && !shown && !season ? (recentre ? recentre(chartTab) : tip(chartTab, "You're on the chart.")) : close()); // W24 quiet: a tap always answers; W25 rest: on the chart, it recentres on the ship; W73 ghosts: !season
  logTab.onclick = () => (!page.hidden && page.scrollTop < 1 ? tip(logTab, "You're in the Log.") : open()); // W24 quiet; scrolled, it goes back to the top

  // ---- the snackbar, for Undo ---------------------------------------------------------------------
  const snack = node("div", { id: "log-snack", hidden: true }, node("span", { className: "t" }), // W73 a11y: no role="status": say() reads it
    node("button", { className: "undo" }, icon("undo"), "Undo"), node("div", { className: "timer" }));
  body.append(snack);
  let pending = null, snackTimer = 0, letGo = () => {}; // W40 log: letGo, the Undo window's lock
  /** Show `text` with Undo for 5 s; commit() runs when the window closes, undo() if Undo is tapped. No undo: a line, no button. */
  function offer(text, { undo, commit = () => {}, keep = false } = {}) { // W68 logbulk: keep, the button says Keep
    settle();
    snack.querySelector(".undo").replaceChildren(icon(keep ? "check" : "undo"), keep ? w("keep") : "Undo"); // W68 logbulk
    pending = { undo, commit };
    if (undo) letGo = holdLock(UNDO); // W40 log: another tab's start leaves the tracks of flights deleted here alone till then
    snack.querySelector(".t").replaceChildren(...text);
    snack.querySelector(".undo").hidden = !undo;
    snack.hidden = false;
    say(snack.querySelector(".t").textContent); // W73 a11y
    snack.classList.remove("run"); void snack.offsetWidth; snack.classList.add("run");
    snackTimer = setTimeout(settle, UNDO_MS);
  }
  function settle() { clearTimeout(snackTimer); snack.hidden = true; const p = pending; pending = null; p?.commit(); letGo(); } // W40 log: letGo
  snack.querySelector(".undo").onclick = () => { clearTimeout(snackTimer); snack.hidden = true; const p = pending; pending = null; p?.undo(); letGo(); flip(page, render); pulse(); }; // W40 log: letGo; W69 motion: Undo brings the row back the way it went, with Undo's pulse

  // ---- the list -----------------------------------------------------------------------------------
  const page = node("section", { id: "log-page", ariaLabel: "Log", hidden: true });
  body.append(page);
  // W102 logscale (SPEC §201): the rows are built as the list comes into view, a screen ahead: ROWS at a time, a task each, while
  // a list's tail (a placeholder as tall as its rows) is within a screen of the view. Opening, the page in parts, a task
  // each, under its fade-in, and no rows (they come as the tails near the view); a re-render while open, at once, with the rows
  // built down to a screen past the view, and at least EAGER (a screen). W106 gatefix: and any tail above the view, so one a fast
  // scroll passed (or jumped) still grows, a task a part, and at the foot every row is there.
  const EAGER = 12, ROWS = 6, ROW_PX = 72; // ROW_PX: a row's min-height (log.css)
  const tails = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) e.target.grow(); }, { root: page, rootMargin: "1000000px 0px 100% 0px" });
  let staging = null; // an open's build, until its last part
  function render() {
    tails.disconnect(); staging = null;
    let near = 0; // a re-render builds the rows built down to a screen past the view, so nothing moves
    if (!page.hidden) { const y0 = page.getBoundingClientRect().top, reach = 2 * page.clientHeight; for (const b of page.querySelectorAll(".flight")) { if (b.getBoundingClientRect().top - y0 > reach) break; near++; } }
    const all = box.flights; // one parse of the box a render
    page.replaceChildren(...[...build(all, page.hidden ? 0 : Math.max(EAGER, near))].flat());
    showSel(all); // W68 logbulk; W102 logscale: all
  }
  function stage() { // opening: build()'s parts, a task each, so none is long (the first, in the click)
    tails.disconnect(); page.replaceChildren();
    const all = box.flights, parts = build(all, 0), go = staging = () => {
      if (staging !== go) return; // a render came first
      const { value, done } = parts.next();
      if (done) { staging = null; return showSel(all); }
      page.append(...value);
      setTimeout(go);
    };
    go();
  }
  /** The page's parts, in order: none (the box parsed); the head and the weeks; the odometer, the season and the pace; the lists and the foot. */
  function* build(all, budget) {
    const flights = all.slice().reverse(), life = all.reduce((a, f) => a + counted(f), 0) / LY, now = classFor(life), next = nextClass(life); // one parse of the box, not two
    yield []; // opening, the click parses the box and no more: the page shows (from opacity 0) and lays out nothing yet
    const per = flights.length ? activity(flights) : null; // W88 logweek: a tapped bar filters the list to its period (inPk)
    if (sel) { const ids = new Set(flights.filter(inPk).map((f) => f.id)); for (const id of sel) if (!ids.has(id)) sel.delete(id); if (!sel.size) sel = null; } // W68 logbulk; W88 logweek: only the rows shown stay selected
    const live = flights.filter((f) => !f.archived && inPk(f)), archived = flights.filter((f) => f.archived && inPk(f)); // W68 logbulk: archived flights at the foot; W88 logweek: inPk
    yield [headOf(all), ...(per ? [per] : [])]; // W102 logscale: all, the box parsed once; W68 logbulk: headOf, or the select bar; W88 logweek: per
    const none = !flights.length; // W73 polish: an empty Log is the hero, one line and Restore: no zeros, no empty season, no control that can't act
    const star = node("span", { className: `star cls-${(now || CLASSES[0]).id}${now ? "" : " none"}`, innerHTML: starSVG((now || CLASSES[0]).id) });
    const awards = node("button", { className: "awards" }, // W65 plainlook; W73 a11y: named by its words, then by what it opens (.sr, below)
      node("div", { className: "odo" }, node("b", { id: "log-ly", textContent: life.toFixed(1) }), node("span", { textContent: w("ly") })), // W60 c
      star, node("span", { id: "log-class", className: "sr", textContent: now ? w("className", now) : w("noClass", next && w("className", next)) }), // W88 logavg: the class the star shows, for a screen reader
      node("small", { className: "next", textContent: next ? w("next", next, Math.ceil(next.ly - life)) : w("allClasses") }), // W88 logavg (SPEC §182): one line, "Next: 150 mi · 38 to go"
      node("div", { className: "bar6" }, node("i", { className: next ? "" : "full" })), node("span", { className: "sr", textContent: `, ${w("classes")}` })); // W73 a11y
    awards.querySelector(".bar6 i").style.transform = `scaleX(${next ? Math.min(1, life / next.ly) : 1})`;
    awards.onclick = ladder;
    const yrs = new Map(), yearOf = (f) => { if (!yrs.has(f)) yrs.set(f, w("season", plain() ? { year: new Date(f.start).getFullYear(), off: false } : seasonOf(f.start))); return yrs.get(f); }, year = flights.length ? yearOf(flights[0]) : null; // the newest flight's season; W76 loghead: its heading, SCUL's season in SCUL; W102 logscale: once a flight (yrs)
    const season = flights.filter((f) => yearOf(f) === year);
    const sum = (k) => season.reduce((a, f) => a + (k(f) || 0), 0);
    const cell = (v, k) => node("div", {}, Array.isArray(v) ? node("b", {}, ...v) : node("b", { textContent: v }), k); // W68 fixes: or nodes
    const row = node("div", { className: "season" }, ...[season.length, (sum(counted) / LY).toFixed(1), durNodes(sum((f) => f.minutes)), sum((f) => f.hifives)] // W60 c; W68 fixes: durNodes
      .slice(0, w("cells").length).map((v, i) => cell(v, w("cells")[i]))); // W60 c
    yield [awards, ...(none ? [] : [row]), ...paceLine(all)]; // W59 pace; W73 polish: none; W102 logscale: all
    const item = (f) => { // W102 logscale: a flight's row
      const title = rideName(f), more = f.systems?.some((s) => !title.includes(s)); // W29 polish: no systems line that only says the title again
      const b = node("button", { className: `flight${tiny(f) ? " tiny" : ""}`, innerHTML: thumbSVG(unpackThumb(f.thumb)) }, // W68 logbulk: tiny, greyed
        node("div", { className: "ft" }, node("div", { className: "tl" }, node("b", { textContent: title }), ...(f.star ? [node("i", { className: "fstar", role: "img", ariaLabel: w("starred") })] : [])), node("span", {}, ...durNodes(w("row", `${day(f.start)} · ${clock(f.start)}`, (counted(f) / LY).toFixed(1), f.minutes))), // W60 c; W68 logbulk: .tl, the title and its star
          ...(more ? [node("small", { textContent: f.systems.join(" · ") })] : [])),
        node("i", { className: "chev", ariaHidden: "true", textContent: "›" }));
      b.dataset.id = f.id;
      if (sel) { b.classList.toggle("on", sel.has(f.id)); b.setAttribute("aria-pressed", String(sel.has(f.id))); } // W102 logscale: a row built while selecting, as showSel draws them
      b.onclick = (e) => { if (swipe.eat(b)) return; if (sel || e.target.closest(".thumb")) toggle(f.id); else openFlight(f.id); }; // W68 logbulk: the leading glyph selects; selecting, a tap toggles
      longPress(b, () => toggle(f.id)); // W68 logbulk
      const li = node("li", {}, b);
      swipe.on(li, b, f); // W68 logbulk
      return li;
    };
    const list = (fs) => { // W102 logscale: the budget's rows now, the rest as its tail nears the view
      const n = Math.min(fs.length, budget), ul = node("ul", { className: "flights" }, ...fs.slice(0, n).map(item));
      budget -= n;
      if (n === fs.length) return ul;
      let i = n;
      const tail = node("li", { className: "tail", ariaHidden: "true" });
      tail.style.height = `${(fs.length - i) * ROW_PX}px`;
      tail.grow = () => {
        tail.before(...fs.slice(i, i + ROWS).map(item));
        i = Math.min(fs.length, i + ROWS);
        tails.unobserve(tail);
        if (i === fs.length) return tail.remove();
        tail.style.height = `${(fs.length - i) * (tail.previousElementSibling?.getBoundingClientRect().height || ROW_PX)}px`; // W106 gatefix: a built row's real height (75 px, where log.css's min-height is 72), so the list's foot lands where it will be and nothing above the view shifts by 18 px a batch
        tails.observe(tail); // again: still in reach, it grows again, in a task of its own
      };
      ul.append(tail);
      tails.observe(tail);
      return ul;
    };
    const years = [...new Set(live.map(yearOf))]; // a heading wherever the year changes; W68 logbulk: live
    const reset = node("button", { className: "reset", textContent: w("resetAll") }); // W60 c // W27 friction: a small plain link, below the note
    why(reset, flights.length ? null : demo ? w("demoKept") : w("noneToDelete")); // W60 c // W24 quiet: dim, and says why
    reset.onclick = () => sure(box.flights.length, () => { // W39 confirm: asks first, then Undo as before
      const gone = box.flights, undo = box.reset();
      render();
      offer([w("allDeleted"), node("em", { textContent: w("dist", life.toFixed(1)) })], // W60 c
        { undo, commit: () => { for (const f of gone) if (!box.get(f.id)) logbook.drop(f.id); } });
    });
    const backup = node("button", { className: "backup", textContent: w("backup"), onclick: () => backUp() }), restore = node("button", { className: "restore", textContent: w("restore"), onclick: () => pickBackup() }); // W67 logsafe
    why(backup, flights.length ? null : demo ? w("demoKept") : w("noneToBack")); // W67 logsafe
    const arch = archived.length ? node("details", { className: "archived", open: archOpen, ontoggle: () => { archOpen = arch.open; } }, // W68 logbulk: collapsed, with its count
      node("summary", {}, node("span", { textContent: w("archived") }), node("small", { textContent: archived.length })), list(archived)) : ""; // W68 logbulk
    yield [...(live.length ? years.flatMap((y) => [node("h3", { textContent: y }), // W76 loghead: y is the heading
        list(live.filter((f) => yearOf(f) === y))]) // W68 logbulk: live
        : archived.length ? [] : [node("p", { className: "note", textContent: pk ? w("noneThen", unit) : w("empty") })]), arch, // W60 c; W68 logbulk: arch; W73 polish: no season heading; W88 logweek: noneThen
      node("div", { className: "foot" }, node("div", { className: "safe" }, ...(none ? [] : [backup]), restore), ...(none ? [] : [node("p", { className: "note", textContent: w("gpsOnly") }), reset]))]; // W27 friction: the shorter note, no demo; W60 c; W67 logsafe: .safe; W73 polish: none
  }

  // ---- W88 logweek (SPEC §177): distance and climb by week (the last 12) or month (the last 12), at the Log's top --------------
  let unit = "week", pk = null; // the bars' period; the period tapped ({start, end}), which filters the list, or null
  function inPk(f) { return !pk || (f.start >= pk.start && f.start < pk.end); } // the flight f is in the list's period
  function activity(flights) {
    const bs = buckets(flights, { unit, now: Date.now() }), tk = ticks(bs, unit), cur = bs.length - 1;
    if (pk && !bs.some((b) => b.start === pk.start)) pk = null;
    const on = pk ? bs.findIndex((b) => b.start === pk.start) : cur;
    const top = Math.max(...bs.map((b) => b.metres)), topC = Math.max(...bs.map((b) => b.climb_m));
    const avg = average(bs, flights.reduce((a, f) => Math.min(a, f.start), Infinity)); // W88 logavg (SPEC §182): her own, over the completed periods since her first ride
    const tot = (b, mine = false) => w("total", (b.metres / LY).toFixed(1), ftOf(b.climb_m)).split(" · ").toSpliced(1, 0, ...(avg && mine ? [w("avg", (avg.metres / LY).toFixed(1))] : [])); // W88 logavg: the distance, her average, the climb // W88 logavg review: the average beside the current period only (her comparison); a picked past one shows its own, the dashed line still drawn
    const when = (k) => (k === cur ? w(unit === "week" ? "thisWeek" : "thisMonth") : periodLabel(bs[k], unit));
    const seg = node("div", { className: "seg", role: "radiogroup", ariaLabel: `${w("weeks")} / ${w("months")}` }, ...["week", "month"].map((u) => {
      const b = node("button", { role: "radio", textContent: w(u === "week" ? "weeks" : "months"), onclick: () => { if (unit !== u) { unit = u; pk = null; render(); } } });
      b.setAttribute("aria-checked", String(unit === u));
      return b;
    }));
    const whenEl = node("span", { className: "wwhen" }), totEl = node("b", { className: "wtot" });
    const head = node("div", { className: "whead" }, whenEl, seg, totEl, // the period's name and the toggle, then its totals (and ×, while it filters the list)
      ...(pk ? [node("button", { className: "wall", ariaLabel: w("showAll"), title: w("showAll"), onclick: () => { pk = null; render(); } }, icon("close"))] : []));
    const cols = bs.map((b, k) => node("span", { className: `wcol${k === cur ? " now" : ""}${pk && k === on ? " picked" : ""}` },
      node("span", { className: "wd" }, node("i", { style: `--h:${top ? b.metres / top : 0}` }, ...(b.metres && b.metres === top ? [node("small", { textContent: (b.metres / LY).toFixed(b.metres / LY < 10 ? 1 : 0) })] : []))),
      node("span", { className: "wc" }, node("i", { style: `--h:${topC ? b.climb_m / topC : 0}` })), node("span", { className: "wt", textContent: tk[k] })));
    // The plot is one control, a slider over the periods, so its target is the whole plot (12 columns are 22 px each at 320 px):
    // a tap picks the period under the finger, a sideways drag scrubs through them (a vertical one scrolls the Log), the same
    // period again shows every ride; ← and → step.
    const line = (cls, a) => node("i", { className: `wavg ${cls}`, ariaHidden: "true", style: `--a:${a}` }); // W88 logavg: her average, dashed across the plot
    const bars = node("div", { className: "wbars", role: "slider", tabIndex: 0, ariaLabel: w("activity", unit), ariaValueMin: "0", ariaValueMax: String(cur) }, ...cols,
      ...(avg && top ? [line("d", avg.metres / top)] : []), ...(avg && topC ? [line("c", avg.climb_m / topC)] : [])); // W88 logavg: distance's, and climb's on its own scale
    let shownK = -1;
    const show = (k) => { // the period k's name and totals above, its column lit: in place, as the finger moves
      if (k === shownK) return;
      shownK = k;
      whenEl.textContent = when(k);
      totEl.replaceChildren(...tot(bs[k], k === cur).flatMap((t, i, a) => [...(i ? [" · "] : []), node("span", { className: i === 1 && a.length > 2 ? "wav" : "", textContent: t })])); // the distance in its bars' green, the climb in theirs; W88 logavg: tot's parts, her average between
      cols.forEach((c, i) => c.classList.toggle("on", i === k));
      bars.ariaValueNow = String(k); bars.ariaValueText = `${when(k)}: ${tot(bs[k], k === cur).join(" · ")}`; // W88 logavg: join
    };
    const choose = (k) => { // filter the list to period k (null: every ride), and keep the focus on the plot
      const had = document.activeElement === bars;
      pk = k == null ? null : { start: bs[k].start, end: bs[k].end };
      render();
      if (had) page.querySelector(".weeks .wbars")?.focus();
    };
    const kAt = (x) => { const r = bars.getBoundingClientRect(); return Math.max(0, Math.min(cur, Math.floor(((x - r.left) / r.width) * bs.length))); };
    let down = null;
    bars.onpointerdown = (e) => { if (e.button > 0) return; down = { id: e.pointerId, moved: false }; try { bars.setPointerCapture(e.pointerId); } catch { /* gone */ } show(kAt(e.clientX)); };
    bars.onpointermove = (e) => { if (down?.id !== e.pointerId) return; const k = kAt(e.clientX); if (k !== shownK) { down.moved = true; show(k); } };
    bars.onpointerup = (e) => { if (down?.id !== e.pointerId) return; const k = kAt(e.clientX), again = !down.moved && pk && k === on; down = null; choose(again ? null : k); };
    bars.onpointercancel = () => { down = null; show(on); }; // the Log scrolled instead
    bars.onkeydown = (e) => { const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, Home: -bs.length, End: bs.length }[e.key]; if (!d) return; e.preventDefault(); choose(Math.max(0, Math.min(cur, on + d))); };
    show(on);
    return node("section", { className: "weeks", ariaLabel: w("activity", unit) }, head, bars);
  }

  // ---- W68 logbulk (SPEC §99): select several, as Gmail does; swipe a row for Archive and Delete ----------------------------
  let sel = null, archOpen = false; // the ids selected (null: not selecting); the Archived section open
  function headOf(flights = box.flights) { // W102 logscale: flights, the flights render has
    if (!sel) {
      const n = flights.length;
      const k = saturnight(Date.now()), sat = k && w("saturnight", k); // W76 loghead (D10): SCUL only
      const count = demo ? w("demo") : w("count", n), g = ghosts && !demo && haunting(flights).length; // W73 ghosts
      return node("header", {}, node("h2", { textContent: "Log" }), ...(sat ? [node("span", { className: "sat", textContent: sat })] : []), // W76 loghead
        ...(g ? [node("button", { className: "ghosts", ariaLabel: `${count}, ${pick(GHOST_WORDS.season).toLowerCase()}`, onclick: () => openSeason() }, icon("ghosts"), count)] // W73 ghosts: the count opens the season chart
          : demo || n ? [node("small", { textContent: count })] : [])); // W60 c; W73 polish: no "No flights yet" over the line that says so
    }
    const fs = flights.filter((f) => sel.has(f.id)), allArch = fs.every((f) => f.archived), allStar = fs.every((f) => f.star), ids = [...sel];
    const scope = flights.filter((f) => !!f.archived === allArch && inPk(f)), allIn = scope.every((f) => sel.has(f.id)); // Select all: the section the selection is in
    const small = scope.filter((f) => tiny(f) && !sel.has(f.id));
    const btn = (cls, label, ico, onclick) => node("button", { className: cls, ariaLabel: label, title: label, onclick }, icon(ico));
    const all = btn("sall", w("all"), "select-all", () => { if (allIn) { sel = null; watch(() => close()); } else for (const f of scope) sel.add(f.id); showSel(); });
    all.setAttribute("aria-pressed", String(allIn));
    const bar = node("div", { className: "selbar", role: "toolbar", ariaLabel: w("selected", fs.length) },
      node("div", { className: "row1" }, btn("sx", w("clear"), "close", () => endSel()), node("b", { className: "n", textContent: fs.length }),
        btn("sdel", w("remove"), "trash", () => del(ids)), btn("sstar", allStar ? w("unstar") : w("star"), allStar ? "star-on" : "star", () => { box.mark(ids, "star", !allStar); render(); }),
        btn("sarch", allArch ? w("unarchive") : w("archive"), allArch ? "unarchive" : "archive", () => archive(ids, !allArch)), all),
      ...(small.length ? [node("button", { className: "stiny", textContent: w("selTiny", small.length), onclick: () => { for (const f of small) sel.add(f.id); showSel(); } })] : [])); // "Select tiny", only when there are some
    return bar;
  }
  /** The bar and the rows as the selection is, in place (a re-render would drop the row under the finger). */
  function showSel(flights) { // W102 logscale: flights, render's (else the box's)
    page.querySelector(":scope > header, :scope > .selbar")?.replaceWith(headOf(flights));
    page.classList.toggle("selecting", !!sel);
    for (const b of page.querySelectorAll(".flight")) {
      const on = !!sel?.has(b.dataset.id);
      b.classList.toggle("on", on);
      if (sel) b.setAttribute("aria-pressed", String(on)); else b.removeAttribute("aria-pressed");
    }
  }
  function toggle(id) {
    swipe.shut();
    const was = !!sel;
    sel ??= new Set();
    if (sel.has(id)) sel.delete(id); else sel.add(id);
    tapTick(); // W69 motion: a tap's selection ticks (a long press buzzed already)
    if (!sel.size) sel = null;
    if (!!sel !== was) watch(() => (sel ? endSel() : close())); // Back leaves select mode first
    showSel();
  }
  function endSel() { sel = null; showSel(); if (!page.hidden) watch(() => close()); }
  /** Delete the flights `ids`, with one Undo; their tracks go once the window closes. */
  function del(ids) {
    const fs = box.flights.filter((f) => ids.includes(f.id)), undo = box.remove(ids), ly = (fs.reduce((a, f) => a + counted(f), 0) / LY).toFixed(1);
    if (sel) endSel();
    flip(page, render); // W69 motion: the row collapses, and the rest slide up
    offer([fs.length === 1 ? w("deleted") : w("gone", fs.length), node("em", { textContent: w("dist", ly) })],
      { undo, commit: () => { for (const f of fs) if (!box.get(f.id)) logbook.drop(f.id); } });
  }
  /** Archive the flights `ids` (`on`), or bring them back, with Undo. */
  function archive(ids, on) {
    const undo = box.mark(ids, "archived", on);
    if (sel) endSel();
    flip(page, render); // W69 motion
    offer([w(on ? "archivedN" : "unarchivedN", ids.length)], { undo });
  }
  /** A swipe left on a row shows Archive and Delete behind it; a tap on one does it, with Undo. Only a sideways drag (the
   *  rows are touch-action: pan-y, so the page scrolls as ever), not from the screen's edges (the back gesture), not selecting. */
  const swipe = (() => {
    const W = 144, EDGE = 24;
    let open = null, eaten = null, eatenAt = 0;
    const eatNext = (b) => { eaten = b; eatenAt = performance.now(); };
    const shut = () => { if (!open) return; const o = open; open = null; o.b.style.transform = ""; o.li.classList.remove("open"); setTimeout(() => { if (open?.li !== o.li) o.li.querySelector(".swipe")?.remove(); }, 250); };
    addEventListener("pointerdown", (e) => { if (!open || open.li.contains(e.target)) return; const t = e.target.closest?.("#log-page .flight"); shut(); if (t) eatNext(t); }, true); // a tap elsewhere closes it, and a row's does only that
    function acts(li, f) {
      if (li.querySelector(".swipe")) return;
      const a = (cls, label, ico, fn) => node("button", { className: cls, onclick: () => { shut(); fn(); } }, icon(ico), node("span", { textContent: label }));
      li.prepend(node("div", { className: "swipe" }, a("sarch", f.archived ? w("unarchive") : w("archive"), f.archived ? "unarchive" : "archive", () => archive([f.id], !f.archived)),
        a("sdel", w("remove"), "trash", () => del([f.id]))));
    }
    function on(li, b, f) {
      let id = null, x0 = 0, y0 = 0, base = 0, dx = 0, moving = false;
      b.addEventListener("pointerdown", (e) => {
        if (sel || e.button > 0 || e.clientX < EDGE || e.clientX > innerWidth - EDGE) return;
        id = e.pointerId; x0 = e.clientX; y0 = e.clientY; moving = false; base = open?.li === li ? -W : 0;
      });
      b.addEventListener("pointermove", (e) => {
        if (e.pointerId !== id) return;
        const mx = e.clientX - x0, my = e.clientY - y0;
        if (!moving) {
          if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { id = null; return; } // a scroll
          if (Math.abs(mx) < 12 || Math.abs(mx) < 1.5 * Math.abs(my) || (mx > 0 && !base)) return;
          moving = true;
          if (open && open.li !== li) shut();
          acts(li, f); li.classList.add("swiping");
          try { b.setPointerCapture(id); } catch { /* gone */ }
        }
        dx = Math.max(-W * 1.2, Math.min(0, base + mx));
        b.style.transform = `translateX(${dx}px)`;
      });
      const up = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        if (!moving) return;
        eatNext(b); li.classList.remove("swiping");
        if (dx < -W / 2) { open = { li, b }; li.classList.add("open"); b.style.transform = `translateX(${-W}px)`; } else { open = { li, b }; shut(); }
      };
      b.addEventListener("pointerup", up); b.addEventListener("pointercancel", (e) => { if (e.pointerId === id && moving) { dx = base; up(e); } else if (e.pointerId === id) id = null; });
    }
    /** The click that ends a swipe, or a tap on the open row (which closes it), does nothing more. */
    function eat(b) {
      if (eaten === b && performance.now() - eatenAt < 1000) { eaten = null; return true; }
      eaten = null;
      if (open?.b === b) { shut(); return true; }
      return false;
    }
    return { on, eat, shut, get open() { return open?.b.dataset.id ?? null; } };
  })();

  /** W67 logsafe (SPEC §96): "Back up the Log": one file, "Starchart Log 2026-10-20.json.gz", with every flight, its track,
   *  name, stats and taps, and the lifetime totals and class, made in the logbook worker; shared or downloaded as a GPX is. */
  async function backUp() {
    const flights = box.withLogs(), life = box.lifetimeLy; // W74 flightlog: each flight's log goes too
    const blob = await logbook.backup(flights, { flights: flights.length, ly: +life.toFixed(2), class: classFor(life)?.id ?? null }).catch(() => null);
    if (blob) hand(blob, backupName(), "Starchart Log", "Backup");
  }
  /** W67 logsafe: "Restore": a backup read back in the logbook worker. The flights this phone hasn't (by id) come in, so none
   *  counts twice toward the lifetime; one snack says what came in, with Undo. */
  const picker = node("input", { type: "file", hidden: true, id: "log-restore-file" }); // W67 logsafe: no accept list, which iOS would grey a .gz out by
  picker.onchange = () => { const file = picker.files?.[0]; picker.value = ""; if (file) restoreFrom(file); };
  body.append(picker);
  function pickBackup() { picker.click(); }
  async function restoreFrom(file) {
    const release = holdLock(UNDO); // another tab's start, meanwhile, leaves the tracks it writes alone
    try {
      settle(); // W73 logsafe: a delete's Undo window commits first, so its tracks are gone and a backup that has the flight brings it back
      const r = await logbook.restore(file, box.flights.map((f) => f.id)).catch(() => ({ bad: "not" }));
      if (r.bad) return offer([w(r.bad === "newer" ? "newer" : r.bad === "full" ? "full" : "notBackup")]); // W73 logsafe: full
      const added = box.restore(r.flights);
      if (!added) { for (const f of r.flights) logbook.drop(f.id); return offer([w("full")]); }
      if (!added.length) return offer([w("allHere")]);
      const ids = new Set(added.map((f) => f.id)), ly = added.reduce((a, f) => a + counted(f), 0) / LY;
      render();
      offer([w("restored", added.length), node("em", { textContent: w("dist", ly.toFixed(1)) })],
        { undo: () => { box.write(box.flights.filter((f) => !ids.has(f.id))); for (const id of ids) logbook.drop(id); } });
      persist();
    } finally { release(); }
  }

  /** W59 pace (SPEC §81): with 3 flights or more flown on a course, "On 8 courses you flew 12 % quicker than planned"; a tap
   *  offers "Set your pace to 115 %", or says the pace is that already. W86 eta: the pace her rides set (learnedPace, SPEC §172),
   *  so the offer and the learning never undo each other; §81's sum of them until those are 3. */
  function paceLine(all) { // W102 logscale: all, the flights render has
    const p = paceOf(all);
    if (!p) return [];
    const to = paceStep(learnedPace(all)?.pct ?? p.pct), line = node("button", { className: "paceline", textContent: w("head", p.courses, p.quicker) }); // W60 c
    const offer = node("button", { className: "paceset", hidden: true, textContent: w("offer", to) }); // W60 c
    line.setAttribute("aria-expanded", "false");
    line.onclick = () => {
      if (+setting("starchart.pace") === to) return tip(line, w("already", to)); // W60 c
      offer.hidden = !offer.hidden; line.setAttribute("aria-expanded", String(!offer.hidden));
    };
    offer.onclick = () => { setSetting("starchart.pace", to); offer.hidden = true; line.setAttribute("aria-expanded", "false"); tip(line, w("set", to)); }; // W60 c
    return [node("div", { className: "pace" }, line, offer)];
  }

  /** W39 confirm (SPEC §51): "Delete all 12 flights?", the one bulk action that asks first. Cancel has the focus; its ×,
   *  Escape and Back cancel (a modal <dialog> closes on them by itself); only Delete runs `go`. */
  function sure(n, go) {
    const what = w("what", n), q = n === 1 ? w("sureOne") : `Delete all ${what}?`; // W60 c
    const d = node("dialog", { id: "log-confirm", ariaLabel: q },
      node("form", { method: "dialog" }, node("h2", { textContent: q }),
        node("div", { className: "acts" }, node("button", { className: "no", value: "cancel", autofocus: true, textContent: "Cancel" }),
          node("button", { className: "go", value: "delete", textContent: `Delete ${what}` })),
        node("button", { className: "nx", value: "cancel", ariaLabel: "Close" }, icon("close"))));
    d.addEventListener("close", () => { d.remove(); if (d.returnValue === "delete") go(); });
    body.append(d);
    d.showModal();
  }

  /** The ladder: each class, the LY it needs, and when it was reached or how far to go. */
  function ladder() {
    const life = box.lifetimeLy, reached = {};
    let cum = 0;
    for (const f of box.flights) { cum += counted(f) / LY; for (const c of CLASSES) if (!reached[c.id] && cum >= c.ly) reached[c.id] = f; }
    const sheet = node("dialog", { id: "log-ladder", className: "sheet" },
      node("div", { className: "top" }, node("div", { className: "handle", ariaHidden: "true" }),
        node("button", { className: "x", ariaLabel: "Close", onclick: () => sheet.close() }, icon("close")), node("h2", { textContent: w("classes") })), // W65 plainlook
      node("p", { className: "note", textContent: w("ladder") }), // W60 c
      node("ol", {}, ...CLASSES.map((c) => {
        const f = reached[c.id];
        return node("li", { className: `cls-${c.id}${f ? " got" : ""}`, innerHTML: starSVG(c.id) }, node("div", {}, node("b", { textContent: w("className", c) }), // W65 plainlook: className
          node("small", { textContent: f ? `Reached ${day(f.start)}, on ${rideName(f)}` : w("toGo", Math.ceil(c.ly - life)) })), node("span", { textContent: pick(`${c.ly} ${w("ly")}`, "") })); // W60 c; W65 plainlook: Plain's name says the miles
      })));
    sheet.addEventListener("close", () => sheet.remove());
    sheet.addEventListener("click", (e) => { if (e.target === sheet && e.clientY < sheet.getBoundingClientRect().top) sheet.close(); });
    body.append(sheet);
    sheet.showModal();
  }

  // ---- a flight's page ------------------------------------------------------------------------------
  const fpage = node("section", { id: "log-flight", ariaLabel: w("flight"), hidden: true }); // W60 c
  body.append(fpage);
  let shown = null, fixes = [], watcher = null, fromChart = false; // W27 friction: fromChart, the page opened from the chart (the landed sticker)
  const css = (v) => getComputedStyle(html).getPropertyValue(v).trim();
  function routeLayers() {
    if (map.getSource("log-route")) return;
    const before = map.getLayer("system-nebula") ? "system-nebula" : undefined, round = { "line-cap": "round", "line-join": "round" };
    const zw = (a, b) => ["interpolate", ["linear"], ["zoom"], 11, a, 16, b];
    map.addSource("log-route", { type: "geojson", data: fc([]) });
    map.addSource("log-replay", { type: "geojson", data: fc([]), lineMetrics: true });
    map.addLayer({ id: "log-route-glow", type: "line", source: "log-route", layout: round, paint: { "line-opacity": 0.35, "line-width": zw(10, 18), "line-blur": zw(6, 10) } }, before); // W21 gps: the trail's glow
    map.addLayer({ id: "log-route-casing", type: "line", source: "log-route", layout: round, paint: { "line-opacity": 0.85, "line-width": zw(6, 11) } }, before);
    map.addLayer({ id: "log-route", type: "line", source: "log-route", layout: round, paint: { "line-opacity": 0.95, "line-width": zw(2.6, 5) } }, before);
    map.addLayer({ id: "log-replay", type: "line", source: "log-replay", layout: round, paint: { "line-width": zw(2, 4) } }, before);
    map.addLayer({ id: "log-route-start", type: "circle", source: "log-route", filter: ["all", ["==", ["geometry-type"], "Point"], ["!", ["has", "end"]]],
      paint: { "circle-radius": 6, "circle-stroke-width": 2.5 } });
    map.addLayer({ id: "log-route-end", type: "circle", source: "log-route", filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "end"]],
      paint: { "circle-radius": 4, "circle-stroke-width": 2 } }); // the landing end: a small chalk dot
  }
  function routeInk() {
    map.setPaintProperty("log-route-casing", "line-color", css("--void"));
    map.setPaintProperty("log-route", "line-color", css("--you")); // W21 gps: the star trail's blue, not --chalk
    map.setPaintProperty("log-route-glow", "line-color", css("--you")); // W21 gps
    map.setPaintProperty("log-route-start", "circle-color", css("--phosphor"));
    map.setPaintProperty("log-route-start", "circle-stroke-color", css("--void"));
    map.setPaintProperty("log-route-end", "circle-color", css("--chalk"));
    map.setPaintProperty("log-route-end", "circle-stroke-color", css("--void"));
    const funk = (css("--funk").match(/#[0-9a-f]{6}/gi) || ["#ff4fd8", "#2ef2ff"]).reverse(); // the funk, from the launch to the ship
    map.setPaintProperty("log-replay", "line-gradient", ["interpolate", ["linear"], ["line-progress"], ...funk.flatMap((c, k) => [k / (funk.length - 1), c])]);
  }
  const fc = (features) => ({ type: "FeatureCollection", features });
  const line = (pts) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts } });

  async function openFlight(id) {
    const f = box.get(id);
    if (!f) return;
    shown = f;
    fromChart = page.hidden; // W27 friction: ← goes back where the page was opened
    body.classList.add("log-flight");
    body.classList.remove("log-page");
    page.scrollTop = 0; page.hidden = true; // W102 logscale: the top, set while it shows (hidden, it would keep its place)
    fpage.hidden = false;
    hold("route");
    showBar();
    drawFlight(f);
    watch(() => closeFlight());
    fixes = drawnTrack(await logbook.fixes(id)); // W21 gps: the matched track; the GPX keeps the raw fixes
    if (shown !== f) return;
    const pts = fixes.length > 1 ? fixes.map((x) => [x.lon, x.lat]) : unpackThumb(f.thumb);
    for (const b of fpage.querySelectorAll(".replay, .gpx, .fly-again")) why(b, fixes.length < 2 ? w("noTrack") : null); // W60 c // W24 quiet: dim, and says why; W67 routefile: .again
    routeLayers(); routeInk();
    const dot = (p, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: p } });
    const lines = fixes.length > 1 ? trackLines(fixes) : [pts]; // W29 polish: a gap where no fix came (a resume, the screen off), as the live trail
    const track = lines.length > 1 ? { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } } : line(lines[0] ?? pts);
    map.getSource("log-route")?.setData(fc(pts.length > 1 ? [track, dot(pts[0]), dot(pts.at(-1), { end: true })] : []));
    frame(pts);
  }
  function frame(pts) {
    if (pts.length < 2) return;
    const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
    const sheet = fpage.querySelector(".fsheet"), side = sheet.offsetLeft > 0; // landscape: the sheet is a column at the right
    const padding = side ? { top: 80, bottom: 30, left: 40, right: sheet.offsetWidth + 30 }
      : { top: 110, bottom: Math.min(innerHeight - 200, sheet.offsetHeight + 15), left: 40, right: 40 };
    map.fitBounds(b, { padding, duration: 0, bearing: 0, pitch: 0, maxZoom: 16.5 });
  }
  function drawFlight(f) {
    const ly = counted(f) / LY, hours = (f.end - f.start) / 3.6e6, avg = hours > 0 ? ly / hours : 0; // W27 friction: the real duration, not whole minutes
    const tiles = [ly.toFixed(2), durNodes(f.minutes), avg.toFixed(1), // W68 fixes: durNodes
      n0(f.top_mps, (v) => Math.round(v / MPH)), // W60 c: the words from WORDS.tiles
      n0(f.climb_m, (v) => `▲ ${Math.round((v * FT) / 10) * 10} ft`), n0(f.pulsars), n0(f.holes), n0(f.hifives), n0(f.cups)].slice(0, w("tiles").length).map((v, i) => [w("tiles")[i], v]); // W60 c
    const name = node("input", { className: "name", value: rideName(f), readOnly: true, ariaLabel: w("name"), maxLength: 80, enterKeyHint: "done" });
    name.onclick = () => { if (name.readOnly) rename(name); }; // W25 rest: a tap on the name starts Rename
    const back = node("button", { className: "back", ariaLabel: fromChart ? "Back to the chart" : "Back to the Log", onclick: () => closeFlight() }, icon("back"));
    const acts = node("div", { className: "acts" },
      node("button", { className: "replay", onclick: () => replay(60) }, icon("launch"), "Replay"),
      node("button", { className: "rename", onmousedown: (e) => { if (name === document.activeElement) e.preventDefault(); }, // W40 log: renaming, it's Done:
        onclick: () => (name.readOnly ? rename(name) : name.blur()) }, icon("tag"), "Rename"), // the tap keeps the focus, and only confirms
      node("button", { className: "gpx", onclick: (e) => gpxMenu(e.currentTarget, box.get(f.id) || f) }, icon("gpx"), "GPX")); // its name now, after a rename; W67 logsafe: its menu
    if (again) acts.append(node("button", { className: "fly-again", onclick: () => flyAgain() }, icon("course"), w("again"))); // W67 routefile
    for (const b of acts.querySelectorAll(".replay, .gpx, .fly-again")) why(b, "Loading the track."); // W24 quiet: until the track is in; W67 routefile: .again
    const note = f.excluded_m ? node("p", { className: "note" }, node("b", { textContent: w("leftOut", (f.excluded_m / LY).toFixed(1)) }), w("leftWhy")) // W60 c
      : node("p", { className: "note", textContent: f.systems?.length ? w("systems", f.systems.join(", ")) : "" }); // W60 c
    const plan = f.plan_s > 0 && f.flew_s > 0 ? node("p", { className: "plan" }, ...durNodes(w("planned", Math.max(1, Math.round(f.plan_s / (f.pace || 1) / 60)), Math.max(1, Math.round(f.flew_s / 60))))) : ""; // W59 pace: old flights have no plan, and say nothing // W68 fixes: durNodes
    const del = node("button", { className: "del", textContent: w("del"), onclick: () => remove(f) }); // W60 c
    const fb = feedback && box.log(f.id) ? node("button", { className: "fb", textContent: w("feedback"), onclick: () => feedback(box.log(f.id)) }) : ""; // W74 flightlog: only with its log
    const seg = node("div", { className: "seg", role: "radiogroup", ariaLabel: "Replay speed" },
      ...[10, 60].map((x) => { const b = node("button", { role: "radio", textContent: `${x}×` }); b.dataset.x = x; return b; }));
    const rbar = node("div", { className: "replaybar", hidden: true },
      node("button", { className: "pp", ariaLabel: "Pause" }, icon("pause")), seg, node("div", { className: "scrub" }, node("i")),
      node("span", { className: "clock" }), node("button", { className: "x", ariaLabel: "End the replay", onclick: () => endReplay() }, icon("close")));
    fpage.replaceChildren(
      node("div", { className: "topbar" }, back, node("div", { className: "ttl" }, name, node("small", { textContent: `${day(f.start)} · ${clock(f.start)}` }))),
      node("div", { className: "fsheet" }, node("div", { className: "handle", ariaHidden: "true" }), acts,
        node("div", { className: "stats" }, ...tiles.map(([k, v]) => node("div", {}, Array.isArray(v) ? node("b", {}, ...v) : node("b", { textContent: v }), node("span", { textContent: k })))), // W68 fixes: or nodes
        plan, note, node("div", { className: "foot" }, del, fb, node("span", { className: "osm", textContent: "OpenStreetMap" }))), // W59 pace; W74 flightlog: fb: plan. W58's plain credit, as on the chart (About keeps the full one)
      rbar);
  }
  function closeFlight(toLog = !fromChart) { // W27 friction: back to the chart when opened from it
    closeGpxMenu(false); // W67 logsafe
    endReplay(false);
    shown = null; fixes = [];
    fpage.hidden = true;
    body.classList.remove("log-flight");
    map.getSource("log-route")?.setData(fc([]));
    if (toLog) open(); else close(); // W27 friction
  }

  /** W67 routefile: Fly again: the trail (as drawn, matched to the roads) matched to the chart as a course, its preview on the chart. */
  function flyAgain() { // W67 routefile
    if (fixes.length < 2) return; // W67 routefile: why() said so
    const line = fixes.map((x) => [x.lon, x.lat]); // W67 routefile
    closeFlight(false); // W67 routefile: to the chart
    again(line); // W67 routefile
  } // W67 routefile

  // ---- W73 ghosts (SPEC §121): the season chart, every ghost trail framed and brighter, from the Log's count -----------------
  let season = false;
  async function openSeason() {
    await ghosts.refresh();
    const b = ghosts.bounds;
    if (!b || page.hidden) return;
    season = true; ghosts.season = true;
    body.classList.add("log-flight"); body.classList.remove("log-page");
    page.scrollTop = 0; page.hidden = true; fpage.hidden = false; fpage.ariaLabel = pick(GHOST_WORDS.season); // W102 logscale: page.scrollTop
    hold("route"); showBar();
    const n = ghosts.n, back = node("button", { className: "back", ariaLabel: "Back to the Log", onclick: () => closeSeason() }, icon("back"));
    fpage.replaceChildren(node("div", { className: "topbar" }, back, node("div", { className: "ttl" },
      node("h2", { className: "name", textContent: pick(GHOST_WORDS.season) }), node("small", { textContent: w("count", n) }))));
    map.fitBounds(b, { padding: { top: 110, bottom: 50, left: 40, right: 40 }, duration: 0, bearing: 0, pitch: 0, maxZoom: 16 });
    watch(() => closeSeason());
  }
  function closeSeason() { season = false; ghosts.season = false; fpage.hidden = true; fpage.ariaLabel = w("flight"); body.classList.remove("log-flight"); open(); }

  // ---- rename -------------------------------------------------------------------------------------
  function rename(input) {
    const f = shown, was = input.value, btn = fpage.querySelector(".rename"), face = (i, t) => btn?.replaceChildren(icon(i), t); // W40 log: face
    input.readOnly = false;
    fpage.classList.add("renaming"); face("check", "Done"); // W40 log
    input.focus();
    input.select();
    const done = (save) => {
      input.onblur = input.onkeydown = null;
      input.readOnly = true;
      fpage.classList.remove("renaming"); face("tag", "Rename"); // W40 log
      if (save && f) input.value = rideName(box.rename(f.id, input.value));
      else input.value = was;
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(true); input.blur(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); input.blur(); }
    };
    input.onblur = () => done(true);
  }

  // ---- delete, with Undo ----------------------------------------------------------------------------
  function remove(f) {
    const undo = box.remove(f.id);
    closeFlight(true); // W27 friction: to the Log, where the flight is gone and Undo shows
    offer([w("deleted"), node("em", { textContent: w("dist", (counted(f) / LY).toFixed(1)) })], // W60 c
      { undo, commit: () => { if (!box.get(f.id)) logbook.drop(f.id); } });
  }

  // ---- GPX: shared as a file where the phone can, else downloaded. Nothing is uploaded. --------------
  /** W67 logsafe (SPEC §96): GPX's menu, a small card over the button as §69's share menu is: "Trim the ends" first (200 m off
   *  each end and around home), then "Whole track". Escape, Back or a tap elsewhere close it. */
  let gmenu = null;
  const homeAt = () => { try { return JSON.parse(localStorage.getItem("starchart.home"))?.lonlat || null; } catch { return null; } };
  function gpxMenu(btn, f) {
    closeGpxMenu();
    const trim = node("button", { className: "send trim" }, icon("gpx"), w("trim")), whole = node("button", { className: "whole" }, w("whole"));
    const m = node("div", { className: "cshare gpxmenu", role: "dialog", ariaLabel: "GPX" }, node("div", { className: "acts" }, trim, whole));
    why(trim, trimRuns(trackRuns(fixes), homeAt()).flat().length < 2 ? w("short") : null);
    trim.onclick = () => { closeGpxMenu(); exportGpx(f, true); };
    whole.onclick = () => { closeGpxMenu(); exportGpx(f, false); };
    body.append(m);
    const b = btn.getBoundingClientRect(), mw = m.offsetWidth, above = b.top - m.offsetHeight - 8, under = fpage.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
    Object.assign(m.style, { left: `${Math.max(8, Math.min(innerWidth - mw - 8, b.left))}px`, top: `${above >= under + 4 ? above : b.bottom + 8}px` }); // above the button, or under it where the top bar is in the way
    gmenu = m;
    watch(() => closeGpxMenu());
    setTimeout(() => addEventListener("pointerdown", function away(e) { if (gmenu !== m) return removeEventListener("pointerdown", away, true); if (!m.contains(e.target)) { removeEventListener("pointerdown", away, true); closeGpxMenu(); } }, true));
  }
  function closeGpxMenu(back = true) {
    if (!gmenu) return;
    gmenu.remove(); gmenu = null;
    if (back && shown) watch(() => closeFlight()); // then back leaves the flight
  }
  async function exportGpx(f, trim = false) { // W67 logsafe: trim
    const pts = fixes.length ? fixes : await logbook.fixes(f.id);
    if (pts.length < 2) return;
    hand(new Blob([gpx(f, pts, { trim, home: trim ? homeAt() : null })], { type: "application/gpx+xml" }), gpxName(f), rideName(f), "GPX"); // W67 logsafe: trim; hand
  }
  /** W67 logsafe: a file (`what`, "GPX" or "Backup") to the phone's share sheet where it takes files, else downloaded. */
  async function hand(blob, name, title, what) {
    const file = typeof File === "function" ? new File([blob], name, { type: blob.type }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); return; } catch (e) { if (e?.name === "AbortError") return; } // W67 logsafe: title
    }
    const url = URL.createObjectURL(blob), a = node("a", { href: url, download: name });
    body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    const ios = browserOf({ ua: navigator.userAgent, standalone: navigator.standalone, touch: navigator.maxTouchPoints }) === "ios"; // W40 log: iOS opens it instead
    offer([ios ? `${what} exported ` : `${what} saved to Downloads `, node("em", { textContent: `· ${name}` })]); // W25 rest: where it went; W40 log: ios; W67 logsafe: what
  }

  // ---- replay: the ship flies the track at its own pace, 10× or 60×, with a trail behind it ---------
  const shipEl = node("div", { className: "ship replay-ship" }, node("img", { alt: "", src: at("design/ships/sprites/tig-spark-gap-top-trail.svg") }));
  const ship = new maplibregl.Marker({ element: shipEl, rotationAlignment: "map", pitchAlignment: "map" });
  const R = { on: false, x: 60, rt: 0, i: 0, playing: false, raf: 0, last: 0, drawn: 0 };
  function replay(x) {
    if (fixes.length < 2) return;
    const fresh = !R.on;
    Object.assign(R, { on: true, x, playing: true, last: performance.now() });
    if (fresh) { R.rt = 0; R.i = 0; watch(() => endReplay()); } // W40 log: back (and Escape) ends the replay first
    fpage.classList.add("replaying");
    const rbar = fpage.querySelector(".replaybar");
    rbar.hidden = false;
    for (const b of rbar.querySelectorAll(".seg button")) {
      b.setAttribute("aria-checked", String(+b.dataset.x === x));
      b.onclick = () => replay(+b.dataset.x);
    }
    rbar.querySelector(".pp").onclick = () => (R.playing ? pause() : play());
    showPlay();
    const here = at_(R.rt);
    if (fresh) ship.setLngLat(here.p).setRotation(here.b).addTo(map);
    map.easeTo({ center: here.p, zoom: x === 10 ? 16 : 14.6, bearing: 0, pitch: 0, duration: fresh ? 600 : 300 });
    R.easeUntil = performance.now() + (fresh ? 650 : 350);
    cancelAnimationFrame(R.raf);
    R.raf = requestAnimationFrame(step);
  }
  /** Where the ship is `rt` ms into the flight: {p, b (bearing)}. Moves R.i along, so each frame is O(1). */
  function at_(rt) {
    const t = fixes[0].t + rt;
    while (R.i < fixes.length - 2 && fixes[R.i + 1].t <= t) R.i++;
    while (R.i > 0 && fixes[R.i].t > t) R.i--;
    const a = fixes[R.i], b = fixes[R.i + 1], k = Math.max(0, Math.min(1, (t - a.t) / Math.max(1, b.t - a.t)));
    const p = [a.lon + (b.lon - a.lon) * k, a.lat + (b.lat - a.lat) * k];
    const brg = (Math.atan2((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 180) / Math.PI;
    return { p, b: brg };
  }
  function step(now) {
    if (!R.on) return;
    const total = fixes.at(-1).t - fixes[0].t;
    if (R.playing) {
      R.rt = Math.min(total, R.rt + (now - R.last) * R.x);
      const here = at_(R.rt);
      ship.setLngLat(here.p).setRotation(here.b);
      if (now > R.easeUntil) map.jumpTo({ center: here.p });
      if (now - R.drawn > 250) { // the trail and the readout, four times a second
        R.drawn = now;
        map.getSource("log-replay")?.setData(line([...fixes.slice(0, R.i + 1).map((x) => [x.lon, x.lat]), here.p]));
        fpage.querySelector(".scrub i").style.transform = `scaleX(${(R.rt / total).toFixed(4)})`;
        fpage.querySelector(".replaybar .clock").textContent = clock(fixes[0].t + R.rt).replace(/ [AP]M$/, "");
      }
      if (R.rt >= total) { R.playing = false; R.drawn = 0; showPlay(); }
    }
    R.last = now;
    if (R.playing) R.raf = requestAnimationFrame(step);
  }
  function pause() { R.playing = false; showPlay(); }
  function play() {
    if (R.rt >= fixes.at(-1).t - fixes[0].t) { R.rt = 0; R.i = 0; }
    R.playing = true; R.last = performance.now(); showPlay();
    R.raf = requestAnimationFrame(step);
  }
  function showPlay() {
    const pp = fpage.querySelector(".pp");
    pp.setAttribute("aria-label", R.playing ? "Pause" : "Play");
    pp.firstChild.className = `i i-${R.playing ? "pause" : "play"}`;
  }
  function endReplay(reframe = true) {
    if (!R.on) return;
    R.on = R.playing = false;
    cancelAnimationFrame(R.raf);
    ship.remove();
    map.getSource("log-replay")?.setData(fc([]));
    fpage.classList.remove("replaying");
    fpage.querySelector(".replaybar").hidden = true;
    if (reframe && shown) { frame(fixes.map((x) => [x.lon, x.lat])); watch(() => closeFlight()); } // W40 log: then back leaves the flight
  }

  // ---- opening and closing --------------------------------------------------------------------------
  /** Android's back gesture and Esc go back one level (CloseWatcher, where there is one). */
  function watch(fn) {
    watcher?.destroy(); watcher = null;
    if (window.CloseWatcher) { try { watcher = new CloseWatcher(); watcher.onclose = () => { watcher = null; fn(); }; } catch { /* needs a user gesture */ } }
  }
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || watcher || document.querySelector("dialog[open]") || e.target.matches?.("input:not([readonly])")) return; // W40 log: a CloseWatcher hears Escape too, so it alone goes back
    if (gmenu) closeGpxMenu(); else if (R.on) endReplay(); else if (shown) closeFlight(); else if (season) closeSeason(); /* W73 ghosts */ else if (sel && !page.hidden) endSel(); else if (!page.hidden) close(); // W68 logbulk: sel
  });
  function open() {
    sel = null; swipe.shut(); // W68 logbulk
    pk = null; // W88 logweek: the Log opens on every ride
    if (!page.hidden) { render(); page.scrollTop = 0; } // the Log tab's tap, scrolled
    else { stage(); page.hidden = false; } // W102 logscale: in parts; hidden, it went to the top as it hid, so the click lays nothing out
    body.classList.add("log-page");
    hold("page");
    showBar();
    watch(() => close());
  }
  function close() {
    closeGpxMenu(false); // W67 logsafe
    if (shown) { endReplay(false); shown = null; fpage.hidden = true; body.classList.remove("log-flight"); map.getSource("log-route")?.setData(fc([])); }
    if (season) { season = false; ghosts.season = false; fpage.hidden = true; fpage.ariaLabel = w("flight"); body.classList.remove("log-flight"); } // W73 ghosts
    page.scrollTop = 0; page.hidden = true; // W102 logscale: the top, set while it shows (hidden, it would keep its place)
    body.classList.remove("log-page");
    watcher?.destroy(); watcher = null;
    hold(null);
    showBar();
  }

  // ---- a flight cut short: saved at the next start -------------------------------------------------------
  // W28 resume: a flight the app lost before its summary goes to the Log as it was, with a note and no question (pilots
  // are adults; a flight's page deletes it, with Undo). One closed mid-flight is resumed instead (app/resume.js).
  async function cutShort() {
    const stored = await logbook.flights(), have = new Set(box.flights.map((f) => f.id)), busy = await heldLocks(); // W40 log: busy
    for (const s of stored) if (s.final && !have.has(s.id) && !busy.has(UNDO)) logbook.drop(s.id); // deleted, and the tab closed in the Undo window; W40 log: not another tab's
    const lost = stored.filter((s) => !s.final && !have.has(s.id) && s.id !== current() && !busy.has(LOCK + s.id)); // W40 log: nor another tab's flight
    for (const s of lost) {
      const fx = await logbook.fixes(s.id);
      if (fx.length < 2) { logbook.drop(s.id); continue; }
      const f = keep(s.id, fx); // W68 logbulk: a tiny one isn't kept (Keep keeps it)
      if (!dropTiny(f)) kept(f);
    }
  }
  /** W28 resume: the note for a flight saved at the start: "Flight saved · 8:40 PM · 0.6 LY", with its weekday when it began
   *  on another day. Short, so it fits on one line at 320 px. */
  function kept(f) {
    if (!f) return;
    const d = new Date(f.start), when = d.toDateString() === new Date().toDateString() ? "" : d.toLocaleDateString("en-US", { weekday: "short" }) + " ";
    offer([w("saved"), node("em", { textContent: `· ${when}${clock(f.start)} ${w("dist", (counted(f) / LY).toFixed(1))}` })]); // W60 c
    persist();
    if (!page.hidden) render();
  }
  let current = () => "";
  function keep(id, fx) {
    const { metres, stats } = statsFrom(fx), g = new CarGuard();
    for (const f of fx) g.fix({ lonlat: [f.lon, f.lat], t: f.t, speed_mps: null });
    g.close();
    const f = box.add({ id, start: fx[0].t, end: fx.at(-1).t, metres, minutes: (fx.at(-1).t - fx[0].t) / 60000, excluded_m: Math.min(metres, g.excluded), ...stats });
    if (f) logbook.final(id); // W28 resume: a full store leaves it to try again at the next start
    return f; // W28 resume
  }
  /** W68 logbulk (SPEC §99): a flight just written (Land, or kept by the black box or at the start) that is tiny, with Skip tiny
   *  flights on, is taken out at once, so the totals and classes never count it. One snack says so, with Keep, which puts it
   *  back; its track goes when the window closes (and a start after a close in the window drops it, as a deleted one's). */
  function dropTiny(f) {
    if (!f || demo || setting("starchart.skiptiny") !== "on" || !tiny(f)) return false;
    const undo = box.remove(f.id);
    offer([w("tooShort")], { undo: () => { undo(); persist(); }, keep: true, commit: () => { if (!box.get(f.id)) logbook.drop(f.id); } });
    if (!page.hidden) render();
    return true;
  }
  /** Ask the browser to keep the Log when a flight is saved, while it isn't kept (W40 settings: not only at the first). */
  function persist() { keepStorage(); }
  /** W86 eta (SPEC §172): a flight saved sets Pace from her last rides on a course, said once, unless she set it by hand. */
  function learn() { // W86 eta
    const l = demo ? null : learnedPace(box.flights), to = paceToLearn(l); // W86 eta
    if (to) { setSetting("starchart.pace", to); offer([w("learned", to, l.rides)]); } // W86 eta
  } // W86 eta

  onLingo(() => { if (!page.hidden) render(); fpage.ariaLabel = w("flight"); }); // W60 c: the Log in the new words at once (Settings opens over the list, never over a flight's page)
  addEventListener("starchart:theme", () => { if (map.getLayer("log-route")) routeInk(); }); // W73 logsafe: a flight's route in the new theme's inks, as the other layers
  showBar();
  return {
    /** Parked (the bar shows) or not (Launch slid it away). */
    bar(on) { if (on === barWanted) return; barWanted = on; showBar(); }, // W28 resume: no cut-short offer to hide
    /** A flight was saved, or the box changed: draw the Log again if it is open. */
    saved() { persist(); learn(); if (!page.hidden) render(); }, // W86 eta: learn
    /** A line on the snackbar, with no Undo: "Log full: flight not saved". */
    say(text) { offer([text]); },
    open, close, openFlight, replay, cutShort, kept, // W28 resume: kept
    /** W68 logbulk: a flight written at Land or by the black box: true if it was tiny and taken out (a snack offers Keep). */
    dropTiny,
    set current(fn) { current = fn; },
    get shown() { return shown?.id || null; },
    get replaying() { return R.on ? { x: R.x, rt: R.rt, playing: R.playing } : null; },
    /** For tests: a GPS flight from its fixes ({t, lon, lat, alt}), stored as the recorder would. */
    async write(fx, extra = {}) {
      const id = extra.id || fx[0].t.toString(36), k = new Chunker((n, c) => logbook.put(id, n, c));
      for (const f of fx) k.fix(f);
      k.flush();
      const { metres, stats } = statsFrom(fx);
      const f = box.add({ id, start: fx[0].t, end: fx.at(-1).t, metres, minutes: (fx.at(-1).t - fx[0].t) / 60000, ...stats, ...extra });
      await logbook.final(id);
      if (!page.hidden) render();
      return f;
    },
  };
}
