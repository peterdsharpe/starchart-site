// The bottom bar and the Log (wave 17, design/app-ui/SPEC.md §14 and §15).
//
// While parked, a bar at the bottom: Chart and Log. Launch slides it away and Land brings it back once
// the Undo window closes (main.js calls bar()). W190 screenstate: <html data-flight="parked"> (app/screen.js, was html.bar) gives --bar-h, the bar's height
// with the bottom safe area (0px without the bar): Launch, the location button and the OSM © sit on it.
//
// The Log is a page over the chart: the miles card (Week · Month · Life: a period's bars, or the lifetime, its star class and the ladder), the
// pace, and the flights with chalk thumbnails. A flight's page frames its route on the chart, with
// Replay at 10× or 60×, Rename, GPX, the 3 × 3 stats, and Delete with Undo. "Delete every flight" (with
// Undo) is at the foot of the Log. The tracks come from the logbook worker (app/logbook.js); a flight the tab
// lost before its summary was written is offered back at the start.
//
// mountLog({map, maplibregl, box, logbook, at, hold, demo}): hold(view) is main.js's: "page" (the chart is
// covered: pause it), "route" (the chart shows a flight: the live camera lets go) or null (back to flying).
// `demo` is true in the demo, whose flights aren't kept. W25 rest: `recentre(tab)`, the Chart tab's tap while on the chart.
import { BlackBox, CLASSES, CarGuard, LOGS, LY, classFor, nextClass, tiny } from "./blackbox.js"; // W68 logbulk: tiny; W127 walklog: BlackBox; W147 backup: LOGS
import { WALKER_SVG } from "./fromto.js"; // W127 walklog: the map's person on foot, a walk's mark
import { starSVG, get as setting, set as setSetting, paceStep, paceToLearn } from "./settings.js"; // W59 pace: setting, setSetting, paceStep; W86 eta: paceToLearn; W190 settingsreg: no KEYS (app/keys.js)
import { Chunker, drawnTrack, gpx, gpxName, learnedPace, rideName, statsFrom, thumbSVG, trackLines, unpackThumb, trackRuns, trimRuns } from "./logbook.js"; // W21 gps: drawnTrack; W27 friction: rideName; W29 polish: trackLines; W67 logsafe: trackRuns, trimRuns
import { tip, why, say } from "./tip.js"; // W24 quiet; W73 a11y: say
import { LOCK, UNDO, heldLocks, holdLock } from "./resume.js"; import { browserOf } from "./install.js"; // W40 log
import { keep as keepStorage } from "./offline.js"; // W40 settings
import { pick, onLingo, plain } from "./lingo-mode.js"; // W60 c; W76 loghead: plain
import { saturnight } from "./season-logic.js"; // W76 loghead; W144 logmiles: no year headings, so no seasonOf
import { BIG, allName, gzip, packAll, readBackup, unpackAll, unpackBackup } from "./logsafe.js"; // W67 logsafe; W147 backup: the whole backup
import { keysWith } from "./keys.js"; // W190 settingsreg: the backup's keys
import { KEY as STARRED, readStarred } from "./starred-logic.js"; import { KEY as ROADS, readAvoids } from "./avoid-logic.js"; // W147 backup: what it holds
import { longPress } from "./press.js"; // W68 logbulk: a long press on a row selects it
import { dur, durNodes } from "./duration.js"; // W68 fixes: "1h 20m"
import { flip, tapTick } from "./motion.js"; import { pulse } from "./haptics.js"; // W69 motion
import { haunting } from "./ghosts.js"; // W73 ghosts: the season chart
import { average, buckets, label as periodLabel, ticks } from "./log-weeks.js"; // W88 logweek: the activity bars; W88 logavg: average
import { pagesOpen } from "./subpage.js"; // W147 small6
import { COLOURS } from "./colours.js"; // W185 colours (SPEC §321): the named colours, from design/tokens.json
import { own as ownScreen, sync as syncScreen, isOpen } from "./screen.js"; // W190 screenstate (SPEC §330): the Log and a flight's page are app/screen.js's parts

const UNDO_MS = 5000; // W19 course: 5 s, as Land and Cancel course
const NOTE_MS = 8000; // W166 walkui: a note with no Undo stays 8 s
const MPH = 0.44704, FT = 3.28084;
const counted = BlackBox.counted; // W127 walklog: a walk's none, as the lifetime's
const walked = (f) => Math.max(0, f.metres - (f.excluded_m || 0)); // W127 walklog (SPEC §236): a walk's own distance, in miles in both modes
/** W127 walklog: flights' distance in a snack: Plain's miles, a walk's as its row; SCUL's light years, its walks' none (walks alone: their miles). */
const distOf = (...fs) => (fs.every((f) => f.foot) || plain() ? `· ${(fs.reduce((a, f) => a + (f.foot ? walked(f) : counted(f)), 0) / LY).toFixed(1)} mi` : w("dist", (fs.reduce((a, f) => a + counted(f), 0) / LY).toFixed(1)));
/** W127 walklog: rides and walks apart, "3 rides · 2 walks" (walks alone: "2 walks"); `and` joins them in a question. W144 logmiles: or counts, `rides` and `k` walks. */
const tallyN = (rides, k, and = " · ") => [...(rides || !k ? [w("count", rides)] : []), ...(k ? [w("walks", k)] : [])].join(and); // W144 logmiles
const tally = (fs, and = " · ") => { const k = fs.filter((f) => f.foot).length; return tallyN(fs.length - k, k, and); }; // W144 logmiles: tallyN
let DAY, CLOCK; // made once: a row's day and time cost a formatter each, which 150 rows notice (W21 logfix); W76 start: on first use, not at the start (app/logbook.js)
const day = (t) => (DAY ||= new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" })).format(t); // W76 start
const clock = (t) => (CLOCK ||= new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })).format(t); // W76 start
const n0 = (v, f = String) => (v == null ? "—" : f(v));
const node = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const icon = (name) => node("i", { className: `i i-${name}` });
const s_ = (n) => (n === 1 ? "" : "s");
/** The Log's words, [SCUL, Plain] (W59 pace's first; W60 c the rest, design/app-ui/SPEC.md §89). One value: both modes'. */
export const WORDS = {
  planned: [(plan, flew) => `Planned ${dur(plan)} · flew ${dur(flew)}`, (plan, flew) => `Planned ${dur(plan)} · rode ${dur(flew)}`], // W68 fixes: dur
  suggest: [(pct) => `Based on recent flights, your suggested pace is ${pct} %.`, (pct) => `Based on recent rides, your suggested pace is ${pct} %.`], // W160 logsettings (SPEC §286, her note 4): one line, no button
  learned: [(pct, n) => `Your pace is now ${pct} %, from your last ${n} flights`, (pct, n) => `Your pace is now ${pct} %, from your last ${n} rides`], // W86 eta
  // W60 c
  demo: ["Demo flights aren't kept", "Demo rides aren't kept"],
  count: [(n) => `${n} flight${s_(n)}`, (n) => `${n} ride${s_(n)}`],
  ly: ["LY", "mi"], // the unit after a number
  hifives: [(n) => `${n} hi-five${s_(n)}`, ""], // W144 logmiles (SPEC §259): the season row's last cell, now the miles card's; Plain has no tallies (W60 a hides their buttons)
  row: [(d, ly, min) => `${d} · ${ly} LY · ${dur(min)}`, (d, mi, min) => `${d} · ${mi} mi · ${dur(min)}`], // W68 fixes: dur
  resetAll: ["Delete every flight", "Delete every ride"],
  demoKept: ["Demo flights aren't kept.", "Demo rides aren't kept."],
  noneToDelete: ["No flights to delete.", "No rides to delete."],
  allDeleted: ["Every flight deleted ", "Every ride deleted "],
  dist: [(ly) => `· ${ly} LY`, (mi) => `· ${mi} mi`],
  walk: ["Space walk", "Walk"], // W127 walklog: a walk's mark, by W79's words ("Space walk ended")
  walks: [(n) => `${n} space walk${s_(n)}`, (n) => `${n} walk${s_(n)}`], // W127 walklog: the season's and a delete's walks, apart
  empty: ["Your flights show here. Launch to start one.", "Your rides show here. Tap Record to start one."], // W88 ridemodes: Plain's bar says Record; W140 words
  gpsOnly: ["GPS flights only, less any stretch above Warp 35 for over 20 s (a car or train).", // W140 words
    "GPS rides only, less any stretch above 35 mph for over 20 s (a car or train)."],
  toGo: [(n) => `${n} LY to go`, (n) => `${n} mi to go`],
  reached: (d) => `Reached ${d}`, // W144 logmiles: a milestone's day, in Life's ladder
  classes: ["Star classes", "Milestones"], // W65 plainlook; W144 logmiles: the ladder's name, for a screen reader
  noClass: [() => "No class yet", () => "First milestone"], // W65 plainlook: before the first; W88 logavg: next says how far, so firstTo and toClass went
  className: [(c) => c.name, (c) => `${c.ly} miles`], // W65 plainlook: Plain's ladder is plain mileage milestones
  flight: ["Flight", "Ride"], name: ["Flight name", "Ride name"],
  noTrack: ["No track for this flight.", "No track for this ride."],
  tiles: [["LY", "Earth time", "Avg warp", "Top warp", "Climb", "Hi-fives", "Cups"],
    ["mi", "Time", "Avg mph", "Top mph", "Climb"]], // Plain: no tallies; W68 fixes: Earth time, Time, their value "1h 20m"; W150 logtidy (her note 10): no traffic lights or rotaries
  leftOut: [(ly) => `${ly} LY left out`, (mi) => `${mi} mi left out`],
  leftWhy: [": above Warp 35 for over 20 s, so a car or a train.", ": above 35 mph for over 20 s, so a car or a train."], // W140 words
  del: ["Delete this flight", "Delete this ride"], delWalk: ["Delete this space walk", "Delete this walk"], // W127 walklog: delWalk
  deleted: ["Flight deleted ", "Ride deleted "],
  saved: ["Flight saved ", "Ride saved "],
  walkDeleted: ["Space walk deleted ", "Walk deleted "], walkSaved: ["Space walk saved ", "Walk saved "], // W127 walklog
  gap: ["Part flew dark (screen off or no GPS), so its distance may be short.", "Part wasn't tracked (screen off or no GPS), so its distance may be short."], // W166 walkui (her note 8): under "Walk saved", what it means
  trim: "Trim the ends", whole: "Whole track", short: "Too short to trim.", // W67 logsafe: GPX's menu (SPEC §96)
  // W147 backup (SPEC §263): Back up and Restore are Settings › App's; an empty Log links to Restore, at its foot
  toRestore: "Restore · in Settings ›",
  // W160 logsettings (SPEC §286, her note 6): each action asks first, in one short dialog; W192 uitabs: the Log's Back up is Settings' row, in Overview
  backUp: "Back up", choose: "Choose file", // W192 uitabs (SPEC §339, her row 7): no "Back up all rides" link; Overview has Settings' row
  backupQ: ["Back up all flights?", "Back up all rides?"], restoreQ: "Restore a backup?",
  backupWhat: [(where) => `Your flights, places and settings, in one file ${where}. Nothing is uploaded.`, (where) => `Your rides, places and settings, in one file ${where}. Nothing is uploaded.`],
  toShare: "to share or save", toDownloads: "in Downloads",
  restoreWhat: ["It replaces this droid's flights, places and settings with the backup file's.", "It replaces this phone's rides, places and settings with the backup file's."],
  starredN: (n) => `${n} starred`, streetsN: (n) => `${n} street${s_(n)}`, settings: "settings", // W147 backup: the file's one line
  restoredAll: "Backup restored", landFirst: ["Land first.", "End the ride first."], noLog: "Can't read the Log: nothing saved.", // W147 backup; noLog, its store off
  newer: "From a newer Starchart: update the app first.", notBackup: "Not a Starchart backup.", full: "Storage full: nothing restored.", // W67 logsafe; W147 backup: any backup
  again: ["Fly again", "Ride again"], // W67 routefile: the flight's trail as a course (SPEC §94)
  // W68 logbulk (SPEC §99): select several, swipe, tiny flights
  selected: (n) => `${n} selected`, clear: "Clear selection", star: "Star", unstar: "Unstar", archive: "Archive", unarchive: "Unarchive",
  remove: "Delete", all: "Select all", starred: "Starred", archived: "Archived",
  selTiny: [(n) => `Select ${n} tiny flight${s_(n)}`, (n) => `Select ${n} tiny ride${s_(n)}`],
  gone: [(n) => `${n} flights deleted `, (n) => `${n} rides deleted `],
  archivedN: [(n) => (n === 1 ? "Flight archived" : `${n} flights archived`), (n) => (n === 1 ? "Ride archived" : `${n} rides archived`)],
  unarchivedN: [(n) => (n === 1 ? "Flight unarchived" : `${n} flights unarchived`), (n) => (n === 1 ? "Ride unarchived" : `${n} rides unarchived`)],
  tooShort: "Too short to keep", keep: "Keep",
  // W76 loghead (SPEC §135): a year heading, SCUL's by SCUL's season (Plain's by the calendar year); Saturnight in the head, SCUL only (D10)
  allRides: ["All flights", "All rides"], // W144 logmiles: the list's one heading (W76 loghead's year headings went)
  overview: "Overview", // W192 uitabs (SPEC §339, her row 7): the miles card's section, above All rides
  mapAll: ["All flights, on the chart", "All rides, on the map"], // W150 logtidy (SPEC §268): the heading's words for a screen reader, its tap
  saturnight: [(k) => (k === "now" ? "It's Saturnight" : "Saturnight tonight"), ""], // Plain: none
  // W88 logweek (SPEC §177): the activity bars, distance and climb by week or month
  week: "Week", month: "Month", life: "Life", miles: ["Light years", "Miles"], // W144 logmiles (SPEC §259): the miles card's three, and its name
  thisWeek: "This week", thisMonth: "This month", // W88 logweek; W144 logmiles: no bar filters the list, so no "Show every ride"
  total: [(ly, ft) => `${ly} LY · ▲ ${ft} ft`, (mi, ft) => `${mi} mi · ▲ ${ft} ft`], // W88 logweek
  activity: [(u) => `Light years and climb by ${u}`, (u) => `Miles and climb by ${u}`], // W88 logweek: the bars' name, for a screen reader
  avg: [(ly) => `avg ${ly}`, (mi) => `avg ${mi}`], // W88 logavg: her own average, beside the period's distance, in its unit (said once: the minimal-text rule; and a picked month's line fits at 320 px)
};
/** W60 c: the mode's words for `k`, filled in with `a` when they are a phrase. */
const w = (k, ...a) => { const v = pick(WORDS[k]); return typeof v === "function" ? v(...a) : v; };
/** W150 logtidy (SPEC §268, her note 9: "offered 125 % because I am riding 3 % faster than planned"): Pace's suggestion, the
 *  5 % step nearest the pace a landing learns (learnedPace, one sum by time), with how much quicker that is than her pace now
 *  (`cur`, in %): {rides, pct, quicker, to}, or null under 3. */
export const paceAdvice = (flights, cur = 100) => { const l = learnedPace(flights); return l && { ...l, quicker: Math.round((l.pct / cur - 1) * 100), to: paceStep(l.pct) }; };
const ftOf = (m) => (Math.round((m * FT) / 10) * 10).toLocaleString("en-US"); // W88 logweek: climb to the nearest 10 ft, as a flight's tile

export function mountLog({ map, maplibregl, box, logbook, at, hold = () => {}, demo = false, recentre = null, again = null, ghosts = null, leave = () => false }) { // W192 uitabs: leave, app/main.js leaveSettings // W25 rest: recentre; W67 routefile: again(line), Fly again's course; W73 ghosts: ghosts (app/ghosts.js); W150 logtidy: no feedback link
  const html = document.documentElement, body = document.body;

  // ---- the bar ----------------------------------------------------------------------------------
  const tab = (id, label, name) => { const b = node("button", { className: "tab", id }, icon(name), node("span", { textContent: label })); return b; };
  const chartTab = document.getElementById("tab-chart") || tab("tab-chart", "Chart", "fold-chart"), logTab = document.getElementById("tab-log") || tab("tab-log", "Log", "black-box"); // W25 rest: index.html has them from the first frame
  const stack = document.getElementById("stack"), corner = ["about", "sound"].map((id) => document.getElementById(id)); // W23 bar: Settings and Sound, in the bar's right corner
  const settings = document.getElementById("about-sheet"), setTab = document.getElementById("about"); // W133 settings4: the Settings tab, lit while its page is open
  const bar = document.getElementById("bar") || node("nav", { id: "bar", ariaLabel: "Fort" }, chartTab, logTab, ...(stack ? [stack] : [])); // W25 rest: so has the bar
  body.append(bar);
  if (settings) new MutationObserver(() => { showBar(); paceTip(); }).observe(settings, { attributes: true, attributeFilter: ["open"] }); // W133 settings4: however it opens or closes; W150 logtidy: Pace's suggestion, as the rides are now
  let barWanted = true;
  function showBar() {
    const on = barWanted; // W147 small6 (SPEC §264): on a flight's page too (it was away there)
    bar.classList.toggle("away", !on);
    bar.inert = !on;
    const home = barWanted ? stack : body; // W23 bar: in flight the bar is away, and Settings and Sound ride in the right column (app.css)
    for (const b of corner) if (b && stack && b.parentNode !== home) home.append(b);
    const set = !!settings?.open, logOn = isOpen("log", "flight-page"); // W190 screenstate; W133 settings4 (SPEC §244): Settings, the third tab, over either; W147 small6: a flight's page is the Log's
    for (const [b, cur] of [[chartTab, !logOn && !set], [logTab, logOn && !set], [setTab, set]].filter(([b]) => b)) { // W133 settings4
      b.classList.toggle("on", cur);
      if (cur) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    }
  }
  // W133 settings4: Chart and Log leave Settings, a tab; W147 small6: and its pages; W192 uitabs: leave(), app/main.js's, keeps where it was
  chartTab.onclick = () => (leave() ? (page.hidden && !shown && !season) || close() : page.hidden && !shown && !season ? (recentre ? recentre(chartTab) : tip(chartTab, "You're on the chart.")) : close()); // W24 quiet: a tap always answers; W25 rest: on the chart, it recentres on the ship; W73 ghosts: !season; W133 settings4: leave; W147 small6: to the chart from a flight's page under Settings
  logTab.onclick = () => (leave() ? page.hidden && !shown && !season && open() : shown ? closeFlight(true) : season ? closeSeason() : !page.hidden && page.scrollTop < 1 ? null : open()); // W24 quiet; scrolled, it goes back to the top; W192 uitabs (SPEC §339, her row 9): at its top, nothing (no "You're in the Log." bubble); W133 settings4: from Settings, the Log as it was; W147 small6: from a flight's page or the season chart, the list

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
    snack.querySelector(".timer").hidden = !undo; // W166 walkui (her note 8: "a timer, but I didn't know what to do"): the bar counts the Undo window, so a note has none
    snack.hidden = false;
    say(snack.querySelector(".t").textContent); // W73 a11y
    snack.classList.remove("run"); void snack.offsetWidth; snack.classList.add("run");
    snackTimer = setTimeout(settle, undo ? UNDO_MS : NOTE_MS); // W166 walkui: a note, up to two lines, a little longer to read
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
  const EAGER = 12, ROWS = 6, ROW_PX = 75; // ROW_PX: a row's min-height (log.css); W109 notes: 75, a real row's height, so a tail sized before its rows are in the page is as tall as they will be
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
  /** The page's parts, in order: none (the box parsed); the head and the miles card; the lists and the foot. */
  function* build(all, budget) {
    const flights = all.slice().reverse(), life = all.reduce((a, f) => a + counted(f), 0) / LY, now = classFor(life), next = nextClass(life); // one parse of the box, not two
    yield []; // opening, the click parses the box and no more: the page shows (from opacity 0) and lays out nothing yet
    const per = miles(all, life, now, next); // W144 logmiles: the one miles card, Week · Month · Life (its bars filter nothing: her 08:09 note)
    const live = flights.filter((f) => !f.archived), archived = flights.filter((f) => f.archived); // W68 logbulk: archived flights at the foot
    yield [headOf(all), ...overview(per, all.length)]; // W102 logscale: all, the box parsed once; W68 logbulk: headOf, or the select bar; W88 logweek: per; W192 uitabs: in Overview
    const none = !flights.length; // W73 polish: an empty Log is the hero, one line and Restore: no zeros, no empty season, no control that can't act
    const item = (f) => { // W102 logscale: a flight's row
      const title = rideName(f); // W150 logtidy (her note 10): no towns line
      const b = node("button", { className: `flight${tiny(f) ? " tiny" : ""}`, innerHTML: thumbSVG(unpackThumb(f.thumb)) }, // W68 logbulk: tiny, greyed
        node("div", { className: "ft" }, node("div", { className: "tl" }, node("b", { textContent: title }), ...(f.star ? [node("i", { className: "fstar", role: "img", ariaLabel: w("starred") })] : [])), node("span", {}, ...(f.foot ? [node("i", { className: "fwalk", role: "img", ariaLabel: w("walk"), title: w("walk"), innerHTML: WALKER_SVG })] : []), ...durNodes((f.foot ? WORDS.row[1] : pick(WORDS.row))(`${day(f.start)} · ${clock(f.start)}`, ((f.foot ? walked(f) : counted(f)) / LY).toFixed(1), f.minutes)))), // W60 c; W68 logbulk: .tl, the title and its star; W127 walklog: a walk's mark and miles
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
        tail.style.height = `${(fs.length - i) * (tail.previousElementSibling?.getBoundingClientRect().height || ROW_PX)}px`; // W106 gatefix: a built row's real height (W109 notes: 75 px, as log.css's min-height now is; more with larger text), so the list's foot lands where it will be and nothing above the view shifts by 18 px a batch
        tails.observe(tail); // again: still in reach, it grows again, in a task of its own
      };
      ul.append(tail);
      tails.observe(tail);
      return ul;
    };
    const reset = node("button", { className: "reset", textContent: w("resetAll") }); // W60 c // W27 friction: a small plain link, below the note
    why(reset, flights.length ? null : demo ? w("demoKept") : w("noneToDelete")); // W60 c // W24 quiet: dim, and says why
    reset.onclick = () => sure(box.flights, () => { // W39 confirm: asks first, then Undo as before
      const gone = box.flights, undo = box.reset();
      render();
      offer([w("allDeleted"), node("em", { textContent: distOf(...gone) })], // W60 c; W127 walklog: distOf, a walk's miles in Plain
        { undo, commit: () => { for (const f of gone) if (!box.get(f.id)) logbook.drop(f.id); } });
    });
    const toRestore = () => node("button", { className: "tosafe", textContent: w("toRestore"), onclick: () => openSafe(loadRow) }); // W147 backup: to Settings' row, on an empty Log
    const arch = archived.length ? node("details", { className: "archived", open: archOpen, ontoggle: () => { archOpen = arch.open; } }, // W68 logbulk: collapsed, with its count
      node("summary", {}, node("span", { textContent: w("archived") }), node("small", { textContent: archived.length })), list(archived)) : ""; // W68 logbulk
    yield [...(live.length ? [allRides(live), list(live)] // W192 uitabs (SPEC §339): a section as Settings' are, its rows a card (log.css); W76 loghead; W144 logmiles (her 08:04 note): one list, "All rides", not split by year; W150 logtidy: its tap maps them
        : archived.length ? [] : [node("p", { className: "note", textContent: w("empty") })]), arch, // W60 c; W68 logbulk: arch; W73 polish: no season heading; W88 logweek: noneThen
      node("div", { className: "foot" }, ...(none ? [node("div", { className: "safe" }, toRestore())] : [node("p", { className: "note", textContent: w("gpsOnly") }), reset]))]; // W27 friction: the shorter note, no demo; W60 c; W67 logsafe: .safe; W73 polish: none; W147 backup: no list, the link here; W160 logsettings: Restore's only (W192 uitabs: Back up is Overview's row)
  }

  // ---- W88 logweek (SPEC §177): distance and climb by week (the last 12) or month (the last 12), at the Log's top --------------
  // W144 logmiles (SPEC §259): one miles card, Week · Month · Life, on Week each time the Log opens: a period's distance, rides
  // and time over its bars, or the lifetime, its star class and the ladder of classes inline (the ladder's popup went).
  let unit = "week", lifeOn = false; // the bars' period; W144 logmiles: Life shown
  function miles(all, life, now, next) { // W144 logmiles
    const none = !all.length, segs = ["week", "month", "life"]; // an empty Log: the lifetime alone, no control that can't act (W73 polish)
    const seg = node("div", { className: "seg", role: "radiogroup", ariaLabel: segs.map((u) => w(u)).join(" / ") }, ...segs.map((u, i) => {
      const on = u === "life" ? lifeOn : !lifeOn && unit === u;
      const b = node("button", { role: "radio", textContent: w(u), onclick: () => {
        if (on) return;
        const had = document.activeElement === b;
        lifeOn = u === "life"; if (!lifeOn) unit = u;
        render();
        if (had) page.querySelectorAll(".miles .seg button")[i]?.focus();
      } });
      b.setAttribute("aria-checked", String(on));
      return b;
    }));
    return node("section", { className: "miles", ariaLabel: w("miles") }, ...(none ? [] : [seg]), lifeOn || none ? lifetime(all, life, now, next, none) : activity(all));
  }
  /** W144 logmiles: Life: the lifetime and its star, the time and (SCUL) hi-fives, and each class: when it was reached, or how far to go, the next one's bar. */
  function lifetime(all, life, now, next, none) {
    const rides = all.filter((f) => !f.foot), reached = {}, sum = (k) => rides.reduce((a, f) => a + (f[k] || 0), 0), hf = pick(WORDS.hifives) && sum("hifives"); // W127 walklog: her rides'
    let cum = 0;
    for (const f of all) { cum += counted(f) / LY; for (const c of CLASSES) if (!reached[c.id] && cum >= c.ly) reached[c.id] = f; } // the box's order, oldest first
    const star = node("span", { className: `star cls-${(now || CLASSES[0]).id}${now ? "" : " none"}`, innerHTML: starSVG((now || CLASSES[0]).id) });
    const head = node("div", { className: "lhead" }, node("div", { className: "odo" }, node("b", { id: "log-ly", textContent: life.toFixed(1) }), node("span", { textContent: w("ly") })), // W60 c
      star, node("span", { id: "log-class", className: "sr", textContent: now ? w("className", now) : w("noClass") }), // W88 logavg: the class the star shows, for a screen reader
      ...(none ? [] : [node("small", { className: "lsub" }, countOf(rides.length, all.length - rides.length), ...[dur(sum("minutes")), ...(hf ? [w("hifives", hf)] : [])].flatMap((t) => [" · ", node("span", { textContent: t })]))])); // the lifetime's rides (walks apart), time and hi-fives
    const bar = node("div", { className: "bar6" }, node("i"));
    if (next) bar.firstChild.style.transform = `scaleX(${Math.min(1, life / next.ly)})`;
    const ladder = node("ol", { className: "ladder", ariaLabel: w("classes") }, ...CLASSES.map((c) => { // W65 plainlook: Plain's are mileage milestones
      const f = reached[c.id];
      return node("li", { className: `cls-${c.id}${f ? " got" : ""}${c === next ? " next" : ""}`, innerHTML: starSVG(c.id) }, node("div", {}, node("b", { textContent: w("className", c) }),
        node("small", { textContent: f ? w("reached", day(f.start)) : w("toGo", Math.ceil(c.ly - life)) }), ...(c === next ? [bar] : [])), node("span", { textContent: pick(`${c.ly} ${w("ly")}`, "") })); // Plain's name says the miles
    }));
    return node("div", { className: "life" }, head, ladder);
  }
  /** W192 uitabs (SPEC §339, her row 7): the Log in Settings' sections: Overview, a card of the miles card and then Back up, Settings'
   *  own row (its element, its words and its question, as one action has one look), with rides to back up and off the demo. */
  function overview(per, any) {
    const row = !demo && any && saveRow?.cloneNode(true);
    if (row) { row.removeAttribute("id"); row.onclick = () => askBackUp(); }
    return [node("h3", { textContent: w("overview") }), node("div", { className: "group" }, per, ...(row ? [row] : []))];
  }
  /** W144 logmiles: the box's count of rides (and walks). W150 logtidy (her note 10): no link; "All rides" maps them. */
  const countOf = (rides, k) => node("span", { className: "count", textContent: tallyN(rides, k) });
  /** W150 logtidy (SPEC §268): the list's heading, "All rides": with GPS rides to show, the tap that maps every one, in blue
   *  (the season chart, app/ghosts.js), as a ride's page draws its own. */
  function allRides(live) {
    if (!ghosts || demo || !haunting(live).length) return node("h3", { textContent: w("allRides") });
    return node("h3", {}, node("button", { className: "allrides", ariaLabel: w("mapAll"), onclick: () => openSeason() },
      node("span", { textContent: w("allRides") }), icon("fold-chart"), node("i", { className: "chev", ariaHidden: "true", textContent: "›" })));
  }
  function activity(flights) {
    const walks = buckets(flights.filter((f) => f.foot), { unit, now: Date.now() }); // W144 logmiles: a period's walks, counted apart (W127 walklog)
    flights = flights.filter((f) => !f.foot); // W127 walklog: the bars and her average are her rides'
    const bs = buckets(flights, { unit, now: Date.now() }), tk = ticks(bs, unit), cur = bs.length - 1;
    const top = Math.max(...bs.map((b) => b.metres)), topC = Math.max(...bs.map((b) => b.climb_m));
    const avg = average(bs, flights.reduce((a, f) => Math.min(a, f.start), Infinity)); // W88 logavg (SPEC §182): her own, over the completed periods since her first ride
    const tot = w("total", (bs[cur].metres / LY).toFixed(1), ftOf(bs[cur].climb_m)).split(" · ").toSpliced(1, 0, ...(avg ? [w("avg", (avg.metres / LY).toFixed(1))] : [])); // W88 logavg: the distance, her average, the climb
    const sub = [...(pick(WORDS.hifives) && bs[cur].hifives ? [w("hifives", bs[cur].hifives)] : [])]; // W144 logmiles: and (SCUL) hi-fives
    const whenEl = node("span", { className: "wwhen", textContent: w(unit === "week" ? "thisWeek" : "thisMonth") });
    const totEl = node("b", { className: "wtot" }, ...tot.flatMap((t, i, a) => [...(i ? [" · "] : []), node("span", { className: i === 1 && a.length > 2 ? "wav" : "", textContent: t })])); // the distance in its bars' green, the climb in theirs; W88 logavg: her average between
    const subEl = node("small", { className: "wsub" }, countOf(bs[cur].rides, walks[cur].rides), ...[...(bs[cur].minutes ? [dur(bs[cur].minutes)] : []), ...sub].flatMap((t) => [" · ", node("span", { textContent: t })])); // W144 logmiles: this period's rides (and walks), time and tallies
    const head = node("div", { className: "whead" }, whenEl, totEl, subEl); // W144 logmiles (her 08:09 note): the bars don't take taps, so the box shows the period now in, no ×
    const cols = bs.map((b, k) => node("span", { className: `wcol${k === cur ? " now on" : ""}` },
      node("span", { className: "wd" }, node("i", { style: `--h:${top ? b.metres / top : 0}` }, ...(b.metres && b.metres === top ? [node("small", { textContent: (b.metres / LY).toFixed(b.metres / LY < 10 ? 1 : 0) })] : []))),
      node("span", { className: "wc" }, node("i", { style: `--h:${topC ? b.climb_m / topC : 0}` })), node("span", { className: "wt", textContent: tk[k] })));
    const line = (cls, a) => node("i", { className: `wavg ${cls}`, ariaHidden: "true", style: `--a:${a}` }); // W88 logavg: her average, dashed across the plot
    const bars = node("div", { className: "wbars", role: "img", ariaLabel: `${w("activity", unit)}: ${bs.map((b) => `${periodLabel(b, unit)} ${(b.metres / LY).toFixed(1)} ${w("ly")}, ${ftOf(b.climb_m)} ft`).join(", ")}` }, ...cols, // W144 logmiles: a picture, not a control
      ...(avg && top ? [line("d", avg.metres / top)] : []), ...(avg && topC ? [line("c", avg.climb_m / topC)] : [])); // W88 logavg: distance's, and climb's on its own scale
    return node("div", { className: "weeks" }, head, bars); // W144 logmiles: in the miles card (the plot has the activity's name)
  }

  // ---- W68 logbulk (SPEC §99): select several, as Gmail does; swipe a row for Archive and Delete ----------------------------
  let sel = null, archOpen = false; // the ids selected (null: not selecting); the Archived section open
  function headOf(flights = box.flights) { // W102 logscale: flights, the flights render has
    if (!sel) {
      const k = saturnight(Date.now()), sat = k && w("saturnight", k); // W76 loghead (D10): SCUL only
      return node("header", {}, node("h2", { textContent: "Log" }), ...(sat ? [node("span", { className: "sat", textContent: sat })] : []), // W76 loghead
        ...(demo ? [node("small", { textContent: w("demo") })] : [])); // W60 c; W150 logtidy (her note 8): no count, the miles card has it; W192 uitabs (SPEC §339, her row 7): no "Back up all rides" (W160 logsettings), Overview's Back up row
    }
    const fs = flights.filter((f) => sel.has(f.id)), allArch = fs.every((f) => f.archived), allStar = fs.every((f) => f.star), ids = [...sel];
    const scope = flights.filter((f) => !!f.archived === allArch), allIn = scope.every((f) => sel.has(f.id)); // Select all: the section the selection is in
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
    const fs = box.flights.filter((f) => ids.includes(f.id)), undo = box.remove(ids), walks = fs.filter((f) => f.foot).length, rides = fs.length - walks; // W127 walklog: walks apart
    const what = fs.length === 1 ? w(walks ? "walkDeleted" : "deleted") : !walks ? w("gone", rides) : `${[...(rides ? [w("count", rides)] : []), w("walks", walks)].join(", ")} deleted `; // W127 walklog
    if (sel) endSel();
    flip(page, render); // W69 motion: the row collapses, and the rest slide up
    offer([what, node("em", { textContent: distOf(...fs) })], // W127 walklog: what, distOf
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

  // ---- W147 backup (SPEC §263): Settings › App's Back up and Restore, everything the rider made in one file ---------------------
  /** The keys a backup keeps besides the Log's: every choice in Settings and Layers, the route style and Walk and T, and her own
   *  places and streets: starred, home, recent, and the streets' Prefer, Avoid and Never. Not the caches, the tips, the notices
   *  or the feedback's queue. W190 settingsreg: app/keys.js's kinds say which (a setting or hers). */
  const KEPT = keysWith("backup"); // W190 settingsreg
  const saveRow = document.getElementById("backup-save"), loadRow = document.getElementById("backup-restore");
  if (saveRow) saveRow.onclick = () => askBackUp(); // W160 logsettings (SPEC §286, her note 6): each asks first
  if (loadRow) loadRow.onclick = () => askRestore();
  /** W160 logsettings: Back up's dialog: what it saves, and where (the share sheet where it takes the file, as hand() does, else Downloads). */
  function askBackUp() {
    const probe = typeof File === "function" ? new File(["{}"], allName(), { type: "application/json" }) : null;
    ask(w("backupQ"), w("backupWhat", w(probe && navigator.canShare?.({ files: [probe] }) ? "toShare" : "toDownloads")), w("backUp"), () => backUp());
  }
  /** W160 logsettings: Restore's dialog: what it replaces; then the file, a backup's JSON only (no camera offer on Android). */
  function askRestore() { ask(w("restoreQ"), w("restoreWhat"), w("choose"), () => picker.click()); }
  /** The Log's link: Settings, scrolled to the `row`, Back up (or Restore). */
  function openSafe(row) {
    if (!settings?.open) setTab?.click();
    for (const p of pagesOpen()) p.close(); // W192 uitabs: at the row, not on a page the Settings tab brought back
    requestAnimationFrame(() => { row?.scrollIntoView({ block: "center" }); row?.focus({ preventScroll: true }); });
  }
  /** Back up: one file, "starchart-backup-2026-10-25.json" (".json.gz" when large), shared or downloaded as a GPX is; it goes
   *  nowhere else. The Log's part comes from the logbook worker, with every track. */
  async function backUp() {
    const flights = box.withLogs(), life = box.lifetimeLy, store = {}; // W74 flightlog: each flight's log goes too
    try { for (const k of KEPT) { const v = localStorage.getItem(k); if (v != null) store[k] = v; } } catch { /* storage off */ }
    const log = await logbook.backup(flights, { flights: flights.length, ly: +life.toFixed(2), class: classFor(life)?.id ?? null }).catch(() => null);
    if (!log) return offer([w("noLog")]);
    const text = JSON.stringify(packAll({ log, store })), gz = text.length > BIG;
    hand(gz ? await gzip(text) : new Blob([text], { type: "application/json" }), allName(Date.now(), gz), "Starchart backup", "Backup");
  }
  /** Restore: a backup (or W67's Log-only file) read; it replaces the Log (and the kept keys, where it has them), then the app
   *  starts again with it and says what came back ("7 rides, 3 starred, 2 streets, settings"). W160 logsettings: asked before
   *  the file (askRestore), so the file's pick is the go. */
  const picker = node("input", { type: "file", hidden: true, id: "log-restore-file", accept: "application/json,.json,application/gzip,.gz" }); // W160 logsettings (her note 6): a backup's JSON (or its .json.gz, above BIG) only, so Android offers files, not the camera (W67 logsafe's iOS greyed a .gz out with no .gz listed)
  picker.onchange = () => { const file = picker.files?.[0]; picker.value = ""; if (file) restoreFrom(file); };
  body.append(picker);
  const DONE = "starchart:restored", flying = async () => !!(await navigator.locks?.query().catch(() => null))?.held?.some((l) => l.name === "starchart:flying"); // as main.js's otherFlies
  async function restoreFrom(file) {
    const r = unpackAll(await readBackup(file), KEPT);
    if (r.bad) return offer([w(r.bad === "newer" ? "newer" : "notBackup")]);
    if (await flying()) return offer([w("landFirst")]);
    const fs = unpackBackup(r.log).flights, store = r.store || {};
    const line = [...(fs.length || !r.store ? [tally(fs, ", ")] : []), ...(store[STARRED] && readStarred(store[STARRED]).length ? [w("starredN", readStarred(store[STARRED]).length)] : []),
      ...(store[ROADS] && readAvoids(store[ROADS]).length ? [w("streetsN", readAvoids(store[ROADS]).length)] : []), ...(r.store ? [w("settings")] : [])].join(", ");
    const release = holdLock(UNDO); // another tab's start, meanwhile, leaves the tracks alone; W160 logsettings: no second confirm, askRestore asked before the file
    try {
      settle(); // a delete's Undo window commits first
      // the summaries and the keys first, then the tracks in one transaction: a refusal anywhere puts the summaries and keys back
      const was = box.flights, keys = [LOGS, ...KEPT].map((k) => [k, box.store.getItem(k)]);
      const fail = (word) => { try { for (const [k, v] of keys) { box.store.removeItem(k); if (v != null) box.store.setItem(k, v); } } catch { /* storage off */ } box.write(was); return offer([w(word)]); };
      try { box.store.removeItem(LOGS); } catch { /* storage off */ }
      if (!box.write([]) || !box.restore(fs)) return fail("full");
      if (r.store) try { for (const k of KEPT) localStorage.removeItem(k); for (const [k, v] of Object.entries(r.store)) localStorage.setItem(k, v); } catch { return fail("full"); }
      const got = await logbook.replace(r.log).catch(() => ({ bad: "not" }));
      if (got.bad) return fail(got.bad === "full" ? "full" : "notBackup");
      try { sessionStorage.setItem(DONE, line || "1"); } catch { /* storage off */ } // W160 logsettings: the file's line, for the answer
      persist();
      location.reload(); // every part reads its settings, places and streets again
    } finally { release(); }
  }
  try { const got = sessionStorage.getItem(DONE); if (got) { sessionStorage.removeItem(DONE); setTimeout(() => offer([`${w("restoredAll")} `, ...(got === "1" ? [] : [node("em", { className: "own", textContent: got })])])); } } catch { /* storage off */ } // W160 logsettings: what came back, on its own line

  /** W59 pace (SPEC §81). W150 logtidy (SPEC §268, her note 9): in Settings, under Pace (the Log's line went), while the step her
   *  rides say isn't hers: the step a landing's learning (W86 eta) would set. W160 logsettings (SPEC §286, her note 4): one line,
   *  "Based on recent rides, your suggested pace is 110 %.", and no button: − and + set it. */
  const paceRow = document.getElementById("pace-row"), paceBox = paceRow && node("div", { className: "pacetip", hidden: true });
  paceRow?.append(paceBox || ""); // under its line and stepper (the row wraps)
  function paceTip() {
    if (!paceBox || !settings?.open) return;
    const cur = +setting("starchart.pace"), a = paceAdvice(box.flights, cur);
    paceBox.hidden = !a || a.to === cur;
    if (paceBox.hidden) return paceBox.replaceChildren();
    paceBox.replaceChildren(node("p", { textContent: w("suggest", a.to) })); // W160 logsettings
  }
  addEventListener("starchart:settings", (e) => { if (["starchart.pace", "starchart.lingo"].includes(e.detail?.key)) paceTip(); }); // W160 logsettings: and the words' change

  /** W39 confirm (SPEC §51): "Delete all 12 flights?", the one bulk action that asks first. Cancel has the focus; its ×,
   *  Escape and Back cancel (a modal <dialog> closes on them by itself); only Delete runs `go`. */
  function sure(fs, go) {
    const what = tally(fs, " and "), q = fs.length === 1 ? `Delete your ${what}?` : fs.some((f) => f.foot) ? `Delete ${what}?` : `Delete all ${what}?`; // W60 c; W127 walklog: "Delete 3 rides and 2 walks?"
    ask(q, "", `Delete ${what}`, go);
  }
  /** W147 backup: sure()'s dialog, asking `q` with an optional `line` under it; `act` names the button that runs go(). */
  function ask(q, line, act, go) {
    const d = node("dialog", { id: "log-confirm", ariaLabel: q },
      node("form", { method: "dialog" }, node("h2", { textContent: q }), ...(line ? [node("p", { textContent: line })] : []), // W147 backup: line
        node("div", { className: "acts" }, node("button", { className: "no", value: "cancel", autofocus: true, textContent: "Cancel" }),
          node("button", { className: "go", value: "delete", textContent: act })),
        node("button", { className: "nx", value: "cancel", ariaLabel: "Close" }, icon("close"))));
    d.addEventListener("close", () => { d.remove(); if (d.returnValue === "delete") go(); });
    body.append(d);
    d.showModal();
  }

  // ---- a flight's page ------------------------------------------------------------------------------
  const fpage = node("section", { id: "log-flight", ariaLabel: w("flight"), hidden: true }); // W60 c
  ownScreen("log", () => !page.hidden); ownScreen("flight-page", () => !fpage.hidden); // W190 screenstate: were body.log-page and body.log-flight
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
    const funk = (css("--funk").match(/#[0-9a-f]{6}/gi) || [COLOURS.funk[0], COLOURS.funk[3]]).reverse(); // W185 colours // the funk, from the launch to the ship
    map.setPaintProperty("log-replay", "line-gradient", ["interpolate", ["linear"], ["line-progress"], ...funk.flatMap((c, k) => [k / (funk.length - 1), c])]);
  }
  const fc = (features) => ({ type: "FeatureCollection", features });
  const line = (pts) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts } });

  async function openFlight(id) {
    const f = box.get(id);
    if (!f) return;
    shown = f;
    fromChart = page.hidden; // W27 friction: ← goes back where the page was opened
    page.scrollTop = 0; page.hidden = true; // W102 logscale: the top, set while it shows (hidden, it would keep its place)
    fpage.hidden = false;
    syncScreen(); // W190 screenstate: was body.log-flight, and no body.log-page
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
    const under = innerHeight - fpage.getBoundingClientRect().bottom; // W147 small6: the bar under the page
    const padding = side ? { top: 80, bottom: 30 + under, left: 40, right: sheet.offsetWidth + 30 }
      : { top: 110, bottom: Math.min(innerHeight - 200, sheet.offsetHeight + 15 + under), left: 40, right: 40 };
    map.fitBounds(b, { padding, duration: 0, bearing: 0, pitch: 0, maxZoom: 16.5 });
  }
  function drawFlight(f) {
    const ly = (f.foot ? walked(f) : counted(f)) / LY, hours = (f.end - f.start) / 3.6e6, avg = hours > 0 ? ly / hours : 0; // W27 friction: the real duration, not whole minutes; W127 walklog: a walk's miles
    const tw = f.foot ? WORDS.tiles[1] : w("tiles"); // W127 walklog: a walk's in mi and mph, in both modes, as its readout
    const tiles = [ly.toFixed(2), durNodes(f.minutes), avg.toFixed(1), // W68 fixes: durNodes
      n0(f.top_mps, (v) => Math.round(v / MPH)), // W60 c: the words from WORDS.tiles
      n0(f.climb_m, (v) => `▲ ${Math.round((v * FT) / 10) * 10} ft`), n0(f.hifives), n0(f.cups)].slice(0, tw.length).map((v, i) => [tw[i], v]); // W60 c; W127 walklog: tw
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
    const note = f.excluded_m ? node("p", { className: "note" }, node("b", { textContent: w("leftOut", (f.excluded_m / LY).toFixed(1)) }), w("leftWhy")) : ""; // W60 c; W150 logtidy (her note 10): no towns
    const plan = f.plan_s > 0 && f.flew_s > 0 ? node("p", { className: "plan" }, ...durNodes(w("planned", Math.max(1, Math.round(f.plan_s / (f.pace || 1) / 60)), Math.max(1, Math.round(f.flew_s / 60))))) : ""; // W59 pace: old flights have no plan, and say nothing // W68 fixes: durNodes
    const del = node("button", { className: "del", textContent: w(f.foot ? "delWalk" : "del"), onclick: () => remove(f) }); // W60 c; W127 walklog: a walk's
    const seg = node("div", { className: "seg", role: "radiogroup", ariaLabel: "Replay speed" },
      ...[10, 60].map((x) => { const b = node("button", { role: "radio", textContent: `${x}×` }); b.dataset.x = x; return b; }));
    const rbar = node("div", { className: "replaybar", hidden: true },
      node("button", { className: "pp", ariaLabel: "Pause" }, icon("pause")), seg, node("div", { className: "scrub" }, node("i")),
      node("span", { className: "clock" }), node("button", { className: "x", ariaLabel: "End the replay", onclick: () => endReplay() }, icon("close")));
    fpage.replaceChildren(
      node("div", { className: "topbar" }, back, node("div", { className: "ttl" }, name, node("small", { textContent: `${day(f.start)} · ${clock(f.start)}` }))),
      node("div", { className: "fsheet" }, node("div", { className: "handle", ariaHidden: "true" }), acts,
        node("div", { className: "stats" }, ...tiles.map(([k, v]) => node("div", {}, Array.isArray(v) ? node("b", {}, ...v) : node("b", { textContent: v }), node("span", { textContent: k })))), // W68 fixes: or nodes
        plan, note, node("div", { className: "foot" }, del, node("span", { className: "osm", textContent: "OpenStreetMap" }))), // W59 pace: plan; W150 logtidy: no feedback link. W58's plain credit, as on the chart (About keeps the full one)
      rbar);
  }
  function closeFlight(toLog = !fromChart) { // W27 friction: back to the chart when opened from it
    closeGpxMenu(false); // W67 logsafe
    endReplay(false);
    shown = null; fixes = [];
    fpage.hidden = true;
    syncScreen(); // W190 screenstate
    map.getSource("log-route")?.setData(fc([]));
    if (toLog) open(true); else close(); // W27 friction; W144 logmiles: true
  }

  /** W67 routefile: Fly again: the trail (as drawn, matched to the roads) matched to the chart as a course, its preview on the chart. */
  function flyAgain() { // W67 routefile
    if (fixes.length < 2) return; // W67 routefile: why() said so
    const line = fixes.map((x) => [x.lon, x.lat]); // W67 routefile
    closeFlight(false); // W67 routefile: to the chart
    again(line); // W67 routefile
  } // W67 routefile

  // ---- W73 ghosts (SPEC §121): the season chart, every trail framed (W150 logtidy: in blue, from "All rides") -------------------
  let season = false;
  async function openSeason() { // W150 logtidy: every flight, from "All rides" (W144 logmiles' period went with the box's link)
    await ghosts.refresh();
    const b = ghosts.bounds;
    if (!b || page.hidden) return;
    season = true; ghosts.season = true;
    page.scrollTop = 0; page.hidden = true; fpage.hidden = false; fpage.ariaLabel = w("allRides"); syncScreen(); // W190 screenstate // W102 logscale: page.scrollTop; W150 logtidy: "All rides", the tap's words
    hold("route"); showBar();
    const n = ghosts.n, back = node("button", { className: "back", ariaLabel: "Back to the Log", onclick: () => closeSeason() }, icon("back"));
    fpage.replaceChildren(node("div", { className: "topbar" }, back, node("div", { className: "ttl" },
      node("h2", { className: "name", textContent: w("allRides") }), node("small", { textContent: w("count", n) }))));
    map.fitBounds(b, { padding: { top: 110, bottom: 50 + innerHeight - fpage.getBoundingClientRect().bottom, left: 40, right: 40 }, duration: 0, bearing: 0, pitch: 0, maxZoom: 16 }); // W147 small6: above the bar
    watch(() => closeSeason());
  }
  function closeSeason() { season = false; ghosts.season = false; ghosts.refresh(); fpage.hidden = true; fpage.ariaLabel = w("flight"); syncScreen(); /* W190 screenstate */ open(true); } // W144 logmiles: true

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
    offer([w(f.foot ? "walkDeleted" : "deleted"), node("em", { textContent: distOf(f) })], // W60 c; W127 walklog: distOf, a walk's words
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
    offer([ios ? `${what} exported ` : `${what} saved to Downloads `, node("em", { className: "own", textContent: name })]); // W25 rest: where it went; W40 log: ios; W67 logsafe: what; W160 logsettings (her note 6: "st…"): the file's whole name, on its own line
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
  function open(back = false) { // W144 logmiles: back, from a flight's page or the season chart
    sel = null; swipe.shut(); // W68 logbulk
    if (!back) { unit = "week"; lifeOn = false; } // W144 logmiles (SPEC §259): and on Week; back from a flight, as it was
    if (!page.hidden) { render(); page.scrollTop = 0; } // the Log tab's tap, scrolled
    else { stage(); page.hidden = false; } // W102 logscale: in parts; hidden, it went to the top as it hid, so the click lays nothing out
    syncScreen(); // W190 screenstate: was body.log-page
    hold("page");
    showBar();
    watch(() => close());
  }
  function close() {
    closeGpxMenu(false); // W67 logsafe
    if (shown) { endReplay(false); shown = null; fpage.hidden = true; map.getSource("log-route")?.setData(fc([])); }
    if (season) { season = false; ghosts.season = false; ghosts.refresh(); fpage.hidden = true; fpage.ariaLabel = w("flight"); } // W73 ghosts
    page.scrollTop = 0; page.hidden = true; // W102 logscale: the top, set while it shows (hidden, it would keep its place)
    syncScreen(); // W190 screenstate
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
    offer([w(f.foot ? "walkSaved" : "saved"), node("em", { textContent: `· ${when}${clock(f.start)} ${distOf(f)}` })]); // W60 c; W127 walklog: distOf, a walk's words
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
  /** W68 logbulk (SPEC §99): a flight just written (Land, or kept by the black box or at the start) that is tiny is taken out at
   *  once (W124 settings3: always, with no setting; a test's window.__keepTiny keeps it), so the totals and classes never count
   *  it. One snack says so, with Keep, which puts it back; its track goes when the window closes (and a start after a close in the window drops it, as a deleted one's). */
  function dropTiny(f) {
    if (!f || demo || globalThis.__keepTiny || !tiny(f)) return false; // W124 settings3: no setting
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
    /** W166 walkui (her note 8, "Part of this ride wasn't tra…"): a flight with a gap, saved: "Walk saved", and what the gap means, whole. */
    gapped(f) { offer([w(f.foot ? "walkSaved" : "saved"), node("em", { className: "own line", textContent: w("gap") })]); },
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
