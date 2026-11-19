// The bottom bar and the Log (wave 17, design/app-ui/SPEC.md §14 and §15).
//
// While parked, a bar at the bottom: Chart and Log. Launch slides it away and Land brings it back once
// the Undo window closes (main.js calls bar()). W190 screenstate: <html data-flight="parked"> (app/screen.js, was html.bar) gives --bar-h, the bar's height
// with the bottom safe area (0px without the bar): Launch, the location button and the OSM © sit on it.
//
// The Log is a page over the chart: the miles card (Week · Month · All: a period's columns, or the lifetime and the ladder; W235 logover), the
// pace, and the flights, a card each with its chalk thumbnail, its star and its bin, undone on the row (W235 logrides). A flight's page frames its route on the chart, with
// Go, Rename and Delete with Undo, the 3 × 3 stats, and Replay at 10× or 60× and GPX (W196 logsettings2: the foot's). "Delete every flight" (with
// Undo) is at the foot of the Log. The tracks come from the logbook worker (app/logbook.js); a flight the tab
// lost before its summary was written is offered back at the start.
//
// mountLog({map, maplibregl, box, logbook, at, hold, demo}): hold(view) is main.js's: "page" (the chart is
// covered: pause it), "route" (the chart shows a flight: the live camera lets go) or null (back to flying).
// `demo` is true in the demo, whose flights aren't kept. W25 rest: `recentre(tab)`, the Chart tab's tap while on the chart.
// W234 logfirst (SPEC §491): mounted as the app starts, before the map: the list, the miles card, a ride's numbers and Back up read
// the phone. The map's parts ({map, ghosts, hold, recentre, go, avatar}) come with attach() once it is in; till then a ride's page
// holds its map's place, and Go, Replay and the all-rides map say they wait, keep the tap and run it then.
import { BlackBox, CLASSES, CarGuard, LOGS, LY, classFor, nextClass, tiny } from "./blackbox.js"; // W68 logbulk: tiny; W127 walklog: BlackBox; W147 backup: LOGS
import { WALKER_SVG } from "./fromto.js"; // W127 walklog: the map's person on foot, a walk's mark
import { starSVG, get as setting, set as setSetting, paceStep, paceToLearn, walkPaceToLearn } from "./settings.js"; // W59 pace: setting, setSetting, paceStep; W86 eta: paceToLearn; W190 settingsreg: no KEYS (app/keys.js); W211 walkmore: walkPaceToLearn
import { Chunker, drawnTrack, gpx, gpxName, learnedPace, learnedWalkPace, plannedAt, rideName, statsFrom, thumbSVG, rideLines, unpackThumb, trackRuns, trimRuns } from "./logbook.js"; /* W228 backfill: rideLines, for trackLines */ // W211 walkmore: learnedWalkPace; // W21 gps: drawnTrack; W27 friction: rideName; W29 polish: trackLines; W67 logsafe: trackRuns, trimRuns
import { swipeAway, BOTTOM } from "./swipe.js"; // W201 gestures
import { tip, why, say, onNewAction } from "./tip.js"; // W24 quiet; W73 a11y: say; W196 ui4: onNewAction
import { LOCK, UNDO, heldLocks, holdLock } from "./resume.js"; import { browserOf } from "./install.js"; // W40 log
import { keep as keepStorage } from "./offline.js"; // W40 settings
import { pick, onLingo, plain } from "./lingo-mode.js"; // W60 c; W76 loghead: plain
import { saturnight } from "./season-logic.js"; // W76 loghead; W144 logmiles: no year headings, so no seasonOf
import { BIG, allName, gzip, packAll, readBackup, unpackAll, unpackBackup } from "./logsafe.js"; // W67 logsafe; W147 backup: the whole backup
import { keysWith, MODE_KEYS } from "./keys.js"; // W190 settingsreg: the backup's keys; W196 logsettings2: and an older backup's shared avatar and voice
import { KEY as STARRED, readStarred, OLD_HOME } from "./starred-logic.js"; /* W216 homefav: OLD_HOME; W219 favs3: no homeIn */ import { KEY as ROADS, readAvoids } from "./avoid-logic.js"; // W147 backup: what it holds
import { dur, durNodes } from "./duration.js"; // W68 fixes: "1h 20m"
import { flip, tapTick } from "./motion.js"; import { pulse, TURNS } from "./haptics.js"; // W69 motion; W208 pocketbuzz: TURNS
import { haunting } from "./ghosts.js"; // W73 ghosts: the season chart
import { axis, buckets, label as periodLabel, lifetime as lifeOf, since } from "./log-weeks.js"; // W88 logweek: the activity bars; W235 logover (SPEC §497): axis, lifetime, since (W88 logavg's average went)
import { pagesOpen } from "./subpage.js"; // W147 small6
import { COLOURS } from "./colours.js"; // W185 colours (SPEC §321): the named colours, from design/tokens.json
import { own as ownScreen, sync as syncScreen, isOpen, onTabLeave } from "./screen.js"; // W190 screenstate (SPEC §330): the Log and a flight's page are app/screen.js's parts; W203 popups: onTabLeave

import { UNDO_MS } from "./flight-state.js"; // W234 shell (SPEC §490): the app's one undo clock (was its own 5000; W19 course: 5 s, as Land and Cancel course)
const NOTE_MS = 8000; // W166 walkui: a note with no Undo stays 8 s
const MPH = 0.44704, FT = 3.28084;
const counted = BlackBox.counted; // W127 walklog: a walk's none, as the lifetime's
const walked = (f) => Math.max(0, f.metres - (f.excluded_m || 0)); // W127 walklog (SPEC §236): a walk's own distance, in miles in both modes
/** W127 walklog: flights' distance in a snack: Plain's miles, a walk's as its row; SCUL's light years, its walks' none (walks alone: their miles). */
const distOf = (...fs) => (fs.every((f) => f.foot) || plain() ? `·\u00a0${(fs.reduce((a, f) => a + (f.foot ? walked(f) : counted(f)), 0) / LY).toFixed(1)}\u00a0mi` : w("dist", (fs.reduce((a, f) => a + counted(f), 0) / LY).toFixed(1))); // R2 bigtext (SPEC §450): no-break spaces, the number with its unit and the dot with them
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
  learned: [(pct, n) => `Your flight pace is now ${pct} %, from your last ${n} flights`, (pct, n) => `Your biking pace is now ${pct} %, from your last ${n} rides`], // W86 eta; 0.1.98's words review: the row's name (Settings' Biking pace, SCUL Flight pace), as walkLearned's
  walkLearned: [(pct, n) => `Your space walk pace is now ${pct} %, from your last ${n} space walks`, (pct, n) => `Your walking pace is now ${pct} %, from your last ${n} walks`], // W211 walkmore (SPEC §395)
  // W60 c
  demo: ["Demo flights aren't kept", "Demo rides aren't kept"],
  count: [(n) => `${n} flight${s_(n)}`, (n) => `${n} ride${s_(n)}`],
  ly: ["LY", "mi"], // the unit after a number
  hifives: [(n) => `${n} hi-five${s_(n)}`, ""], // W144 logmiles (SPEC §259): the season row's last cell, now the miles card's; Plain has no tallies (W60 a hides their buttons)
  resetAll: ["Delete every flight", "Delete every ride"],
  demoKept: ["Demo flights aren't kept.", "Demo rides aren't kept."],
  noneToDelete: ["No flights to delete.", "No rides to delete."],
  allDeleted: ["Every flight deleted ", "Every ride deleted "],
  dist: [(ly) => `·\u00a0${ly}\u00a0LY`, (mi) => `·\u00a0${mi}\u00a0mi`], // R2 bigtext: as distOf's
  walk: ["Space walk", "Walk"], // W127 walklog: a walk's mark, by W79's words ("Space walk ended")
  walks: [(n) => `${n} space walk${s_(n)}`, (n) => `${n} walk${s_(n)}`], // W127 walklog: the season's and a delete's walks, apart
  empty: ["Your flights show here. Launch to start one.", "Your rides show here. Tap Record to start one."], // W88 ridemodes: Plain's bar says Record; W140 words
  gpsOnly: ["GPS flights only, less any stretch above Warp 35 for over 20 s (a car or train).", // W140 words
    "GPS rides only, less any stretch above 35 mph for over 20 s (a car or train)."],
  toGo: [(n) => `${n} LY to go`, (n) => `${n} mi to go`],
  reached: (d) => `Reached ${d}`, // W144 logmiles: a milestone's day, in Life's ladder; W235 logover: "Reached Oct 5" (her words), on the name's line at 320 px
  classes: ["Star classes", "Milestones"], // W65 plainlook; W144 logmiles: the ladder's name, for a screen reader
  noClass: [() => "No class yet", () => "First milestone"], // W65 plainlook: before the first; W88 logavg: next says how far, so firstTo and toClass went
  className: [(c) => c.name, (c) => `${c.ly} miles`], // W65 plainlook: Plain's ladder is plain mileage milestones
  flight: ["Flight", "Ride"], name: ["Flight name", "Ride name"],
  noTrack: ["No track for this flight.", "No track for this ride."],
  tiles: [["LY", "Earth time", "Avg warp", "Top warp", "Climb", "Hi-fives", "Cups"],
    ["mi", "Time", "Avg mph", "Top mph", "Climb"]], // Plain: no tallies; W68 fixes: Earth time, Time, their value "1h 20m"; W150 logtidy (her note 10): no traffic lights or rotaries
  leftOut: [(ly) => `${ly}\u00a0LY left out`, (mi) => `${mi}\u00a0mi left out`], // R2 bigtext: a number with its unit
  leftWhy: [": above Warp 35 for over 20 s, so a car or a train.", ": above 35 mph for over 20 s, so a car or a train."], // W140 words
  del: ["Delete this flight", "Delete this ride"], delWalk: ["Delete this space walk", "Delete this walk"], // W127 walklog: delWalk
  deleted: ["Flight deleted ", "Ride deleted "],
  walkDeleted: ["Space walk deleted ", "Walk deleted "], // W127 walklog; W196 ui4: no "Ride saved" nor "Walk saved" (her row 19)
  gap: ["Part flew dark (screen off or no GPS), so its distance may be short.", "Part wasn't tracked (screen off or no GPS), so its distance may be short."], // W166 walkui (her note 8): what a gap means; W196 ui4: alone, with no "Walk saved"
  filled: ["Part filled in along the course.", "Part filled in along the route."], // W228 backfill (SPEC §477): a ride's page, for a stretch filled from the route while she was in another app
  trim: "Trim the ends", whole: "Whole track", short: "Too short to trim.", // W67 logsafe: GPX's menu (SPEC §96)
  // W147 backup (SPEC §263): Back up and Restore are Settings › App's; an empty Log links to Restore, at its foot
  toRestore: "Restore · in Settings", // R2 bigtext (SPEC §450): its › drawn after it, hidden from a screen reader (mountLog's toRestore)
  // W160 logsettings (SPEC §286, her note 6): each action asks first, in one short dialog; W192 uitabs: the Log's Back up is Settings' row, in Overview
  backUp: "Back up", choose: "Choose file", // W192 uitabs (SPEC §339, her row 7): no "Back up all rides" link; Overview has Settings' row
  backupQ: ["Back up all flights?", "Back up all rides?"], restoreQ: "Restore a backup?",
  backupWhat: [(where) => `Your flights, places and settings, in one file ${where}. Nothing is uploaded.`, (where) => `Your rides, places and settings, in one file ${where}. Nothing is uploaded.`],
  toShare: "to share or save", toDownloads: "in Downloads",
  restoreWhat: ["It replaces this droid's flights, places and settings with the backup file's.", "It replaces this device's rides, places and settings with the backup file's."], // W200 small8 (SPEC §356): device
  starredN: (n) => `${n} starred`, streetsN: (n) => `${n} street${s_(n)}`, settings: "settings", // W147 backup: the file's one line
  restoredAll: "Backup restored", landFirst: ["Land first.", "End the ride first."], noLog: "No backup made: the Log can't be read.", // W147 backup; noLog, its store off; R2 words6 (SPEC §451): what failed, the backup
  newer: "From a newer Starchart: update the app first.", notBackup: "Not a Starchart backup.", full: "Storage full: nothing restored.", // W67 logsafe; W147 backup: any backup
  remove: "Delete", // W68 logbulk: a ride's page's pill (W235 logrides: Select, its bar, the swipe and Archive went, SPEC §498)
  // W235 logrides (SPEC §498, her points 10 and 11): the rides' heading, its switch, a card's star and bin and their undo on the row
  rides: ["Flights", "Rides"], favs: ["Starred", "Favorites"], // the heading; the switch's second half, Where to?'s word for her starred places (app/starred-logic.js)
  noFavs: ["None starred yet. Tap a flight's star to add one.", "No favorites yet. Tap a ride's star to add one."], // Favorites with none, in one line at her 411 px
  star: ["Star", "Add to favorites"], starred: ["Starred", "In favorites"], unstarred: ["Unstarred", "Removed from favorites"], // as a place's card says them (app/course.js PLACES)
  unstarUndo: ["Unstarred. Undo", "Removed from favorites. Undo"], delUndo: "Deleted. Undo", // the button while its ring runs, for a screen reader
  tooShort: "Too short to save", keep: "Keep", // W203 popups (SPEC §369): End's bar's words (app/index.html #snack .short), as a lost flight's bar has them
  // W76 loghead (SPEC §135): a year heading, SCUL's by SCUL's season (Plain's by the calendar year); Saturnight in the head, SCUL only (D10)
  allRides: ["All flights", "All rides"], // W144 logmiles: the list's one heading (W76 loghead's year headings went); W235 logrides: the switch's first half, and the all-rides map's title
  // W234 logfirst (SPEC §491): a tap on what draws the map before it is in, kept and done once it is (soon)
  replaySoon: ["Replaying once the chart is in.", "Replaying once the map is in."], goSoon: ["Plotting the course once the chart is in.", "Finding the route once the map is in."],
  mapAllSoon: ["Showing all flights once the chart is in.", "Showing all rides once the map is in."],
  overview: "Overview", // W192 uitabs (SPEC §339, her row 7): the miles card's section, above All rides
  mapAllRow: ["Chart of all flights", "Map of all rides"], since: (d) => `Since ${d}`, // W235 logover (SPEC §497, her point 08): All's last row, the all-rides map; All's period
  saturnight: [(k) => (k === "now" ? "It's Saturnight" : "Saturnight tonight"), ""], // Plain: none
  // W88 logweek (SPEC §177): the activity bars, distance and climb by week or month
  week: "Week", month: "Month", life: "All", miles: ["Light years", "Miles"], // W144 logmiles (SPEC §259): the miles card's three, and its name; W235 logover (her point 07): "Life" becomes "All"
  activity: [(u) => `Light years and climb by ${u}`, (u) => `Miles and climb by ${u}`], // W88 logweek: the bars' name, for a screen reader
  column: [(p, n, ly, ft) => `${p}: ${n}, ${ly}\u00a0LY, ${ft}\u00a0ft`, (p, n, mi, ft) => `${p}: ${n}, ${mi}\u00a0mi, ${ft}\u00a0ft`], // W235 logover (SPEC §497): a column's button, for a screen reader
};
/** W60 c: the mode's words for `k`, filled in with `a` when they are a phrase. */
const w = (k, ...a) => { const v = pick(WORDS[k]); return typeof v === "function" ? v(...a) : v; };
/** W150 logtidy (SPEC §268, her note 9: "offered 125 % because I am riding 3 % faster than planned"): Pace's suggestion, the
 *  5 % step nearest the pace a landing learns (learnedPace, one sum by time), with how much quicker that is than her pace now
 *  (`cur`, in %): {rides, pct, quicker, to}, or null under 3. */
export const paceAdvice = (flights, cur = 100) => { const l = learnedPace(flights); return l && { ...l, quicker: Math.round((l.pct / cur - 1) * 100), to: paceStep(l.pct) }; };
const ftOf = (m) => (Math.round((m * FT) / 10) * 10).toLocaleString("en-US"); // W88 logweek: climb to the nearest 10 ft, as a flight's tile

export function mountLog({ map, maplibregl, box, logbook, at, hold = () => {}, demo = false, recentre = null, go = null, ghosts = null, leave = () => false, avatar = null }) { // W201 walkstops: avatar(layer), app/main.js replayShip, the replay's marker // W192 uitabs: leave, app/main.js leaveSettings // W25 rest: recentre; W196 logsettings2: go(lonlat), Go's route (was W67 routefile's again, Fly again); W73 ghosts: ghosts (app/ghosts.js); W150 logtidy: no feedback link
  const html = document.documentElement, body = document.body;
  box.unarchive(); // W235 logrides (SPEC §498): Archive went; its marks go once, at this version's first start (app/blackbox.js)

  // ---- the bar ----------------------------------------------------------------------------------
  const tab = (id, label, name) => { const b = node("button", { className: "tab", id }, icon(name), node("span", { textContent: label })); return b; };
  const chartTab = document.getElementById("tab-chart") || tab("tab-chart", "Chart", "fold-chart"), logTab = document.getElementById("tab-log") || tab("tab-log", "Log", "black-box"); // W25 rest: index.html has them from the first frame
  const stack = document.getElementById("stack"), corner = ["about", "sound"].map((id) => document.getElementById(id)); // W23 bar: Settings and Sound, in the bar's right corner
  const settings = document.getElementById("about-sheet"), setTab = document.getElementById("about"); // W133 settings4: the Settings tab, lit while its page is open
  const bar = document.getElementById("bar") || node("nav", { id: "bar", ariaLabel: "Fort" }, chartTab, logTab, ...(stack ? [stack] : [])); // W25 rest: so has the bar
  body.append(bar);
  if (settings) new MutationObserver(() => { if (settings.open) rowsDone(); showBar(); paceTip(); }).observe(settings, { attributes: true, attributeFilter: ["open"] }); // W133 settings4: however it opens or closes; W150 logtidy: Pace's suggestion, as the rides are now; W235 logrides: Settings over the Log, every row's count done
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
  const settingsUp = () => !!settings?.open || pagesOpen().length > 0; // W211 noflash: what leave() closes
  // W24 quiet: a tap always answers; W25 rest: on the chart, it recentres on the ship; W73 ghosts: !season; W133 settings4: leave; W147 small6: to the chart from a flight's page under Settings
  chartTab.onclick = () => (leave() ? (page.hidden && !shown && !season) || close() : page.hidden && !shown && !season ? (recentre ? recentre(chartTab) : tip(chartTab, pick("You're on the chart.", "You're on the map."))) : close()); // rel-0.1.122: Plain says map
  logTab.onclick = () => (opening ? null /* W211 noflash: tapped again while it comes, nothing more: its open closes Settings as it shows */ : settingsUp() ? (page.hidden && !shown && !season ? open(false, leave) : leave()) /* W211 noflash (SPEC §392, her row 31): Settings goes as the Log shows, filled */ : shown ? closeFlight(true) : season ? closeSeason() : !page.hidden && page.scrollTop < 1 ? null : open()); // W24 quiet; scrolled, it goes back to the top; W192 uitabs (SPEC §339, her row 9): at its top, nothing (no "You're in the Log." bubble); W133 settings4: from Settings, the Log as it was; W147 small6: from a flight's page or the season chart, the list
  setTab?.addEventListener("click", () => { if (opening === leave) { opening = null; close(); } }); // W211 noflash: Settings tapped while a Log tapped from Settings comes unseen calls that open off, so Settings stays (else the Log closes it as it shows); any other open goes on under Settings, as on the base

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
    if (undo) unwatch = onNewAction(settle); // W196 ui4 (her row 13): a new action ends the Undo window at once
    unleave = onTabLeave(settle); // W203 popups (SPEC §369, her row 6): it stays on its tab: on another, its window ends, and a note goes
    snack.querySelector(".t").replaceChildren(...text);
    snack.querySelector(".undo").hidden = !undo;
    snack.querySelector(".timer").hidden = !undo; // W166 walkui (her note 8: "a timer, but I didn't know what to do"): the bar counts the Undo window, so a note has none
    snack.hidden = false;
    say(snack.querySelector(".t").textContent); // W73 a11y
    snack.classList.remove("run"); void snack.offsetWidth; snack.classList.add("run");
    snackTimer = setTimeout(settle, undo ? UNDO_MS : NOTE_MS); // W166 walkui: a note, up to two lines, a little longer to read
  }
  let unwatch = () => {}, unleave = () => {}; // W196 ui4; W203 popups: unleave
  swipeAway(snack, { dirs: BOTTOM, close: () => settle() }); // W201 gestures (SPEC §362): the Undo bar swipes away, and what it offered to undo is done
  function settle() { unwatch(); unleave(); clearTimeout(snackTimer); snack.hidden = true; const p = pending; pending = null; p?.commit(); letGo(); } // W40 log: letGo; W196 ui4: unwatch
  snack.querySelector(".undo").onclick = () => { unwatch(); unleave(); clearTimeout(snackTimer); snack.hidden = true; const p = pending; pending = null; p?.undo(); letGo(); flip(page, render); pulse(); }; // W40 log: letGo; W69 motion: Undo brings the row back the way it went, with Undo's pulse; W196 ui4: unwatch

  // ---- the list -----------------------------------------------------------------------------------
  const page = node("section", { id: "log-page", className: "page", ariaLabel: "Log", hidden: true }); // W217 chrome5: on the pages' shell (app/app.css .page)
  body.append(page);
  // W102 logscale (SPEC §201): the rows are built as the list comes into view, a screen ahead: ROWS at a time, a task each, while
  // a list's tail (a placeholder as tall as its rows) is within a screen of the view. Opening, the page in parts, a task
  // each, under its fade-in, and no rows (they come as the tails near the view); a re-render while open, at once, with the rows
  // built down to a screen past the view, and at least EAGER (a screen). W106 gatefix: and any tail above the view, so one a fast
  // scroll passed (or jumped) still grows, a task a part, and at the foot every row is there.
  const EAGER = 12, ROWS = 6, GAP = 8; // W235 logrides: GAP, the 8 px between her ride cards (log.css)
  /** W235 logrides (SPEC §498): a ride's card and the gap under it, by text size (was ROW_PX, 75): the larger of its two 44 px buttons
   *  stacked (and the card's hairline) and its three lines of words (a name of one line, the day, the time: log.css's sizes at 1.3) with
   *  8 px above and below, so a tail sized before its rows are in the page is as tall as they will be (W109 notes). */
  const rowPx = () => Math.ceil(Math.max(90, 18 + (parseFloat(getComputedStyle(html).fontSize) || 16) * 3.66)) + GAP;
  const tails = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) e.target.grow(); }, { root: page, rootMargin: "1000000px 0px 100% 0px" });
  /** W235 logrides (her point 10: "Long names may take 2 lines. Only then do date and time share a line"): a card whose name wraps
   *  takes .two, so its day and time share one line and the card keeps its three lines; told after layout, before the frame's paint. */
  const lines = typeof ResizeObserver === "function" ? new ResizeObserver((es) => { for (const e of es) e.target.closest("li")?.classList.toggle("two", e.contentRect.height > 1.5 * (parseFloat(getComputedStyle(e.target).lineHeight) || 22)); }) : null;
  let staging = null; // an open's build, until its last part
  let opening = null; // W211 noflash (SPEC §392, her row 31): an open's then(), what goes as the Log shows, while its parts come unseen
  let favs = false, reveal = null; // W235 logrides: the list's Favorites (the visit's; All rides at each open); a ride's row to show at the open (a ride's page's Delete)
  let room = 0; // W235 logrides: Favorites' room under the foot, so its shorter list leaves the switch where she tapped it (ridesHead)
  function render() {
    tails.disconnect(); lines?.disconnect(); staging = null;
    let near = 0; // a re-render builds the rows built down to a screen past the view, so nothing moves
    if (!page.hidden) { const y0 = page.getBoundingClientRect().top, reach = 2 * page.clientHeight; for (const b of page.querySelectorAll(".flight")) { if (b.getBoundingClientRect().top - y0 > reach) break; near++; } }
    const all = box.flights, top = page.scrollTop; // one parse of the box a render; W241 leftovers8: the scroll she had
    page.replaceChildren(...[...build(all, page.hidden ? 0 : Math.max(EAGER, near))].flat());
    if (favs && !page.hidden) keepRoom(top); // W241 leftovers8 (SPEC §504): in Favorites every render keeps the room for her scroll, so the switch stays (a count done as she leaves the app or backs up was a fifth caller, missed)
    ready(); // W211 noflash: a render while it opens, its parts all in
  }
  function stage() { // opening: build()'s parts, a task each, so none is long (the first, in the click)
    tails.disconnect(); lines?.disconnect(); page.replaceChildren();
    const all = box.flights, k = reveal ? listOf(all.slice().reverse()).findIndex((f) => f.id === reveal) : -1; // W235 logrides: the rows down to the one to show, built with the list
    const parts = build(all, k < 0 ? 0 : k + EAGER), go = staging = () => {
      if (staging !== go) return; // a render came first
      const { value, done } = parts.next();
      if (done) { staging = null; return ready(); } // W211 noflash: ready
      page.append(...value);
      setTimeout(go);
    };
    go();
  }
  /** W211 noflash: an opening Log shows once its parts are in and the tails in view have grown their rows (a task each, 10 at
   *  most), and the old screen goes in that frame: never the chart or an empty page between. */
  function ready(n = 0) {
    if (!opening || staging || (!cutIn && !demo)) return; // W234 logfirst: and the start's flights cut short are in (cutOnce)
    if (reveal) { page.querySelector(`.flight[data-id="${CSS.escape(reveal)}"]`)?.parentElement.scrollIntoView({ block: "center" }); reveal = null; } // W235 logrides: a ride's page's Delete: its row, ring and all, in view
    if (n < 10 && [...page.querySelectorAll(".tail")].some((t) => t.getBoundingClientRect().top < innerHeight)) return void setTimeout(() => ready(n + 1), 16);
    shows();
  }
  /** W235 logrides (her point 10): the list, always the whole history newest first (the Overview's switch filters nothing); Favorites,
   *  her starred rides in the same order. */
  const listOf = (flights) => (favs ? flights.filter((f) => f.star) : flights);
  /** The page's parts, in order: none (the box parsed); the head and the miles card; the list and the foot. */
  function* build(all, budget) {
    const flights = all.slice().reverse(), life = all.reduce((a, f) => a + counted(f), 0) / LY, now = classFor(life), next = nextClass(life); // one parse of the box, not two
    yield []; // opening, the click parses the box and no more: the page shows (from opacity 0) and lays out nothing yet
    const per = miles(all, life, now, next); // W144 logmiles: the one miles card, Week · Month · All (its columns filter nothing: her 08:09 note)
    yield [...headOf(), ...overview(per, all.length)]; // W102 logscale: all, the box parsed once; W88 logweek: per; W192 uitabs: in Overview; W217 chrome5: its parts
    const none = !flights.length, shown = listOf(flights); // W73 polish: an empty Log is the hero, one line and Restore: no zeros, no empty season, no control that can't act
    const list = (fs) => { // W102 logscale: the budget's rows now, the rest as its tail nears the view
      const n = Math.min(fs.length, budget), ul = node("ul", { className: "flights" }, ...fs.slice(0, n).map(card)); // W235 logrides: a card a ride (was W234 shell's one card for the list)
      budget -= n;
      if (n === fs.length) return ul;
      let i = n;
      const tail = node("li", { className: "tail", ariaHidden: "true" });
      tail.style.height = `${(fs.length - i) * rowPx() - GAP}px`; // W235 logrides: its own 8 px above it (log.css)
      tail.grow = () => {
        tail.before(...fs.slice(i, i + ROWS).map(card));
        i = Math.min(fs.length, i + ROWS);
        tails.unobserve(tail);
        if (i === fs.length) return tail.remove();
        tail.style.height = `${(fs.length - i) * ((tail.previousElementSibling?.getBoundingClientRect().height + GAP) || rowPx()) - GAP}px`; // W106 gatefix: a built row's real height (more with larger text), so the list's foot lands where it will be and nothing above the view shifts a batch; W235 logrides: and the gap under each card
        tails.observe(tail); // again: still in reach, it grows again, in a task of its own
      };
      ul.append(tail);
      tails.observe(tail);
      return ul;
    };
    const reset = node("button", { className: "reset", textContent: w("resetAll") }); // W60 c // W27 friction: a small plain link, below the note
    why(reset, flights.length ? null : demo ? w("demoKept") : w("noneToDelete")); // W60 c // W24 quiet: dim, and says why
    reset.onclick = () => sure(box.flights, () => { // W39 confirm: asks first, then Undo as before
      rowsDone(true); // W235 logrides: a row's delete or unstar counting is done first, so the Undo brings back what the list had
      const gone = box.flights, undo = box.reset();
      render();
      offer([w("allDeleted"), node("em", { textContent: distOf(...gone) })], // W60 c; W127 walklog: distOf, a walk's miles in Plain
        { undo, commit: () => { for (const f of gone) if (!box.get(f.id)) logbook.drop(f.id); } });
    });
    const toRestore = () => node("button", { className: "tosafe", onclick: () => openSafe(loadRow) }, w("toRestore"), " ", node("span", { ariaHidden: "true", textContent: "›" })); // W147 backup: to Settings' row, on an empty Log; R2 bigtext: the › a picture
    const footAt = { className: "foot", ...(favs && room ? { style: `padding-bottom:${room}px` } : {}) }; // W235 logrides: Favorites' room under it (keepRoom)
    yield [...(none ? [node("p", { className: "note", textContent: w("empty") })] // W60 c; W73 polish: no season heading
      : [...ridesHead(), shown.length ? list(shown) : node("p", { className: "nofavs row-desc", textContent: w("noFavs") })]), // W235 logrides (SPEC §498, her point 10): RIDES, its switch, a card a ride; Favorites with none says how to star one
      node("div", footAt, ...(none ? [node("div", { className: "safe" }, toRestore())] : [node("p", { className: "note", textContent: w("gpsOnly") }), reset]))]; // W27 friction: the shorter note, no demo; W60 c; W67 logsafe: .safe; W73 polish: none; W147 backup: no list, the link here; W160 logsettings: Restore's only (W192 uitabs: Back up is Overview's row)
  }
  /** W235 logrides (SPEC §498, her point 10 and her pictures): a ride's card (shell's .group, 8 px apart): at the left its map, 72 px
   *  (her 104 image px at her phone's 1.4), the route's line alone; its name in the title's style, its day and its time with the bike or
   *  the walker in the description's (day and time on one line when the name takes two); a ›; the whole is the button that opens its
   *  page. At the right, joined by a hairline, its star over her bin, each a 44 px button, undone on the row (count). No miles or
   *  minutes (on its page). A tiny ride is really grey (arclight's call of 10-20). */
  function card(f) {
    const title = node("b", { className: "row-title", textContent: rideName(f) }), mode = f.foot ? node("i", { className: "fwalk", role: "img", ariaLabel: w("walk"), innerHTML: WALKER_SVG }) : node("i", { className: "i i-bike", role: "img", ariaLabel: w("flight") }); // W127 walklog: a walk's mark; W235 logrides: a ride's, her bike
    const b = node("button", { className: "flight", innerHTML: thumbSVG(unpackThumb(f.thumb), 72) }, node("span", { className: "ft" }, title, node("span", { className: "when row-desc" },
      node("span", { className: "d", textContent: day(f.start) }), node("span", { className: "dot", textContent: " · " }), node("span", { className: "t" }, clock(f.start), mode))), node("i", { className: "chev", ariaHidden: "true", textContent: "›" }));
    b.dataset.id = f.id;
    b.onclick = () => openFlight(f.id);
    const star = node("button", { className: "fstar", onclick: () => tapStar(f.id) }), bin = node("button", { className: "fbin", onclick: () => tapBin(f.id) });
    dress(star, f, "star"); dress(bin, f, "del");
    lines?.observe(title);
    return node("li", { className: `group${tiny(f) ? " tiny" : ""}` }, b, node("span", { className: "racts" }, star, bin));
  }
  /** W235 logrides: the list's heading, RIDES (SCUL FLIGHTS), words only (her point 10: it opens no map now; All's last row does), and
   *  under it on the page her switch, All rides | Favorites (SCUL All flights | Starred), shell's .seg. */
  function ridesHead() {
    const seg = node("div", { className: "seg lseg", role: "radiogroup", ariaLabel: `${w("allRides")} / ${w("favs")}` }, ...[false, true].map((on, i) => {
      const b = node("button", { role: "radio", textContent: w(on ? "favs" : "allRides"), onclick: () => {
        if (favs === on) return;
        const had = document.activeElement === b, top = page.scrollTop; // W235 logrides: the switch stays where she tapped it (UX 10, 87)
        favs = on; room = 0; render(); // W241 leftovers8: in Favorites, the render keeps its room for this scroll
        if (!on) page.scrollTop = top;
        if (had) page.querySelectorAll(".lseg button")[i]?.focus({ preventScroll: true });
      } });
      b.setAttribute("aria-checked", String(favs === on));
      return b;
    }));
    return [node("h3", { className: "sect-h", textContent: w("rides") }), seg];
  }
  /** W235 logrides: Favorites' room for the scroll `top`: the page's ground under the foot, as much as keeps that scroll from being
   *  clamped (her switch where she tapped it, UX 10 and 87), measured from the foot (scrollHeight is never less than the view's); then
   *  the scroll. W241 leftovers8: after every render while Favorites shows (render), and a resize. */
  function keepRoom(top) {
    const foot = page.querySelector(".foot");
    if (!foot) return;
    foot.style.paddingBottom = "";
    const end = foot.getBoundingClientRect().bottom - page.getBoundingClientRect().top + page.scrollTop + parseFloat(getComputedStyle(page).paddingBottom); // the page's own height
    room = Math.max(0, Math.ceil(top + page.clientHeight - end));
    if (room) foot.style.paddingBottom = `${room}px`;
    page.scrollTop = top;
  }
  addEventListener("resize", () => { if (favs && room && !page.hidden) keepRoom(page.scrollTop); }); // W235 logrides: a turn or a resize, the room measured again (a resize only, nothing a frame)

  // ---- W235 logrides (SPEC §498, her point 11; UX rule 95): a row's delete and unstar, undone on the row ---------------------
  // A tap on the bin, or on a starred ride's star, turns that button into Undo: a circle with a ring in the accent that runs down over
  // the app's one undo clock (UNDO_MS, --undo); the row stays as it is. When the ring runs out the delete is done (the row goes with
  // the list's motion, the Overview's numbers with it) or the star goes. Several rows may count at once, and a row's two buttons both;
  // a tap on Undo ends its count. Leaving the Log (a tab, a ride's page, the all-rides map, the app out of sight) makes every count
  // done. The box changes only then, so another tab sees the same end; the Undo lock keeps the deleted rides' tracks meanwhile.
  const pend = new Map(); // `${kind} ${id}` (kind "del" or "star") -> { at, timer }
  let letRows = () => {}; // the Undo lock while a row's delete counts (holdLock(UNDO))
  const pkey = (id, k) => `${k} ${id}`;
  /** A row's button as its ride and its count are: the star (filled in the accent when starred, else a grey outline) or the bin; while
   *  it counts, Undo on its circle with the ring, the ring at its time left (a row built again mid-count). */
  function dress(btn, f, k) {
    const p = pend.get(pkey(f.id, k)), on = k === "star" && !!f.star;
    btn.classList.toggle("on", on); btn.classList.toggle("counting", !!p);
    if (p) btn.removeAttribute("aria-pressed"); else if (k === "star") btn.setAttribute("aria-pressed", String(on));
    btn.ariaLabel = p ? (k === "del" ? w("delUndo") : w("unstarUndo")) : k === "del" ? w(f.foot ? "delWalk" : "del") : w(on ? "starred" : "star");
    btn.replaceChildren(...(p ? [node("span", { className: "undoc", style: `--left:${-Math.min(UNDO_MS, performance.now() - p.at)}ms` }, node("span", { className: "ra" }, node("i")), node("span", { className: "rb" }, node("i")), icon("undo"))] : [icon(k === "del" ? "trash" : on ? "star-on" : "star")])); // the ring's two halves (log.css)
  }
  const rowBtn = (id, k) => page.querySelector(`.flight[data-id="${CSS.escape(id)}"]`)?.parentElement.querySelector(k === "del" ? ".fbin" : ".fstar");
  /** The bin: its delete counts (on Undo, back). */
  function tapBin(id) { if (pend.has(pkey(id, "del"))) return undoRow(id, "del"); const f = box.get(id); if (f) count(f, "del"); }
  /** The star: a ride not starred is starred at once; a starred one's unstar counts (on Undo, back). */
  function tapStar(id) {
    if (pend.has(pkey(id, "star"))) return undoRow(id, "star");
    const f = box.get(id);
    if (!f) return;
    if (f.star) return count(f, "star");
    box.mark([id], "star", true); tapTick();
    const btn = rowBtn(id, "star");
    if (btn) dress(btn, box.get(id), "star");
  }
  function count(f, k) {
    if (k === "del" && ![...pend.keys()].some((key) => key.startsWith("del "))) letRows = holdLock(UNDO); // W40 log: another tab's start leaves the tracks alone till then
    const key = pkey(f.id, k);
    pend.set(key, { at: performance.now(), timer: setTimeout(() => done(key), UNDO_MS) });
    const btn = rowBtn(f.id, k);
    if (btn) dress(btn, f, k);
    say(k === "del" ? w("delUndo") : w("unstarUndo")); // W73 a11y
  }
  function undoRow(id, k) {
    const key = pkey(id, k), p = pend.get(key);
    if (!p) return;
    clearTimeout(p.timer); pend.delete(key); unlock();
    const f = box.get(id), btn = rowBtn(id, k);
    if (f && btn) dress(btn, f, k);
    pulse(); // W69 motion: Undo's pulse
  }
  function unlock() { if (![...pend.keys()].some((key) => key.startsWith("del "))) { letRows(); letRows = () => {}; } }
  /** A count run out: the box changes; the list follows (the row goes, the rest close up under it; an unstarred row in Favorites goes
   *  too), the button alone where the row stays. */
  function done(key) {
    const p = pend.get(key);
    if (!p) return;
    clearTimeout(p.timer); pend.delete(key);
    const [k, id] = [key.slice(0, key.indexOf(" ")), key.slice(key.indexOf(" ") + 1)], f = box.get(id);
    apply(k, f);
    unlock();
    if (!f || page.hidden) return;
    say(k === "del" ? w(f.foot ? "walkDeleted" : "deleted").trim() : w("unstarred"));
    if (favs || k === "del") return keepFocus(() => flip(page, render)); // W235 logrides: in Favorites the switch stays where it is, the rest closing up under it (W241 leftovers8: the render keeps the room)
    const btn = rowBtn(id, k);
    if (btn) dress(btn, box.get(id), k);
  }
  function apply(k, f) { if (!f) return; if (k === "del") { box.remove(f.id); logbook.drop(f.id); } else box.mark([f.id], "star", false); }
  /** Every count done at once, as she leaves the Log (or `quiet`, for Delete every ride): the box changes, and the list with it if it
   *  is still in view. True if a row went. */
  function rowsDone(quiet = false) {
    if (!pend.size) return false;
    const keys = [...pend.keys()];
    for (const key of keys) { const p = pend.get(key); clearTimeout(p.timer); pend.delete(key); const k = key.slice(0, key.indexOf(" ")); apply(k, box.get(key.slice(k.length + 1))); }
    unlock();
    if (!quiet && !page.hidden && !opening) render();
    return true;
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) rowsDone(); }); addEventListener("pagehide", () => rowsDone()); // the app out of sight
  /** A render under a keyboard's focus keeps it on the same row's same button (a ring run out while she tabs the list). */
  function keepFocus(fn) {
    const a = document.activeElement, li = a?.closest?.("#log-page .flights > li"), id = li?.querySelector(".flight")?.dataset.id, cls = li && ["flight", "fstar", "fbin"].find((c) => a.classList.contains(c));
    fn();
    if (id && cls && !li.isConnected) page.querySelector(`.flight[data-id="${CSS.escape(id)}"]`)?.parentElement.querySelector(`.${cls}`)?.focus({ preventScroll: true });
  }

  // ---- W88 logweek (SPEC §177): distance and climb by week (the last 12) or month (the last 12), at the Log's top --------------
  // W144 logmiles (SPEC §259): one miles card, Week · Month · All, on Week each time the Log opens. W235 logover (SPEC §497, her
  // points 07 and 08 of 11-14): the card is hers: the switch, then a header of the period's count and dates at the left and its
  // miles and climb at the right (no averages, no minutes), over twelve columns of miles up and climb down, each column a button
  // that selects its period (the one now in when the page opens); All: the lifetime's header, the milestones and the all-rides map.
  let unit = "week", lifeOn = false, picked = null; // the bars' period; W144 logmiles: All (was Life) shown; W235 logover: the selected column's start (null: the period now in)
  function miles(all, life, now, next) { // W144 logmiles
    const none = !all.length, segs = ["week", "month", "life"]; // an empty Log: the lifetime alone, no control that can't act (W73 polish)
    const seg = node("div", { className: "seg", role: "radiogroup", ariaLabel: segs.map((u) => w(u)).join(" / ") }, ...segs.map((u, i) => {
      const on = u === "life" ? lifeOn : !lifeOn && unit === u;
      const b = node("button", { role: "radio", textContent: w(u), onclick: () => {
        if (on) return;
        const had = document.activeElement === b;
        lifeOn = u === "life"; if (!lifeOn) unit = u;
        picked = null; // W235 logover: a new period opens on the one now in
        render(); // W235 logrides: in Favorites, its room for the scroll she had (W241 leftovers8: the render's)
        if (had) page.querySelectorAll(".miles .seg button")[i]?.focus();
      } });
      b.setAttribute("aria-checked", String(on));
      return b;
    }));
    return node("section", { className: "miles", ariaLabel: w("miles") }, ...(none ? [] : [seg]), lifeOn || none ? lifetime(all, life, now, next, none) : activity(all));
  }
  /** W235 logover (SPEC §497): the header row: at the left the count in the title's style (`cls`, the tests' .wsub or .lsub) over the
   *  period in the description's; at the right the miles in the accent and the climb, in the odometer's type, top-aligned with it. */
  function sumHead(cls, n, when, metres, climb_m, id) {
    const hf = pick(WORDS.hifives) && n?.hifives; // W144 logmiles: and (SCUL) hi-fives, when there are some (arclight's tallies, BRIEF §3's Debriefer): after the dates, the supervisor's ruling of 11-15 (the count is the outings')
    const count = n && node("span", { className: `${cls} row-title` }, countOf(n.rides, n.walks)); // an empty Log: none
    const odo = node("span", { className: "odo" }, node("b", { ...(id ? { id } : {}), textContent: (metres / LY).toFixed(1) }), node("span", { textContent: w("ly") }));
    const climb = climb_m == null ? "" : node("span", { className: "climb" }, "▲\u00a0", node("b", { textContent: ftOf(climb_m) }), node("span", { textContent: "ft" }));
    return node("div", { className: "whead" }, node("div", { className: "wleft" }, ...(n ? [count] : []), ...(when ? [node("span", { className: "wwhen row-desc" }, node("span", { textContent: when }), ...(hf ? [" · ", node("span", { textContent: w("hifives", hf) })] : []))] : [])), node("div", { className: "wtot" }, odo, climb));
  }
  /** W144 logmiles: All (was Life): the lifetime and each class: when it was reached, or how far to go, the next one's bar. W235 logover (SPEC
   *  §497, her point 08): its header is the count since the Log's first day, the lifetime's miles and climb (no star beside them); each
   *  milestone's star in her colours (log.css), "N mi to go" on its name's line; the card's last row maps every ride (openSeason). */
  function lifetime(all, life, now, next, none) {
    const n = lifeOf(all, counted), reached = {};
    let cum = 0;
    for (const f of all) { cum += counted(f) / LY; for (const c of CLASSES) if (!reached[c.id] && cum >= c.ly) reached[c.id] = f; } // the box's order, oldest first
    const head = none ? sumHead("lsub", null, "", 0, null, "log-ly") : sumHead("lsub", n, w("since", since(n.since)), n.metres, n.climb_m, "log-ly"); // W73 polish: an empty Log, its odometer alone
    const bar = node("div", { className: "bar6" }, node("i"));
    if (next) bar.firstChild.style.transform = `scaleX(${Math.min(1, life / next.ly)})`;
    const ladder = node("ol", { className: "ladder", ariaLabel: w("classes") }, ...CLASSES.map((c) => { // W65 plainlook: Plain's are mileage milestones
      const f = reached[c.id];
      return node("li", { className: `cls-${c.id}${f ? " got" : ""}${c === next ? " next" : ""}`, innerHTML: starSVG(c.id) }, node("div", {}, node("b", { textContent: w("className", c) }),
        node("small", { className: "row-desc", textContent: f ? w("reached", since(f.start)) : w("toGo", Math.ceil(c.ly - life)) }), ...(c === next ? [bar] : [])), node("span", { textContent: pick(`${c.ly} ${w("ly")}`, "") })); // Plain's name says the miles; W235 logover: how far at the description's size
    }));
    const map = !demo && haunting(all).length ? node("button", { className: "mapall", onclick: (e) => openSeason(e.currentTarget) }, icon("fold-chart"), node("span", { className: "row-title", textContent: w("mapAllRow") }), node("i", { className: "chev", ariaHidden: "true", textContent: "›" })) : ""; // W235 logover: with trails to map, as the heading's link (allRides)
    return node("div", { className: "life" }, head, node("span", { id: "log-class", className: "sr", textContent: now ? w("className", now) : w("noClass") }), ladder, map); // W88 logavg: the class reached, for a screen reader
  }
  /** W192 uitabs (SPEC §339, her row 7): the Log in Settings' sections: Overview, a card of the miles card; W235 logover (SPEC §497, her
   *  point 09): then Back up in a card of its own, 8 px under it (log.css), Settings' own row (its element, its words and its question,
   *  as one action has one look), with rides to back up and off the demo. */
  function overview(per, any) {
    const row = !demo && any && saveRow?.cloneNode(true);
    if (row) { row.removeAttribute("id"); row.onclick = () => askBackUp(); }
    return [node("h3", { className: "sect-h", textContent: w("overview") }), node("div", { className: "group ov" }, per), ...(row ? [node("div", { className: "group" }, row)] : [])]; // W234 shell (SPEC §490): the one heading and card (app/app.css)
  }
  /** W144 logmiles: the box's count of rides (and walks). W150 logtidy (her note 10): no link; "Map of all rides" (All's last row) maps them. */
  const countOf = (rides, k) => node("span", { className: "count" }, ...tallyN(rides, k).split(" · ").flatMap((t, i) => [...(i ? [" · "] : []), node("span", { textContent: t })])); // W235 logover: it breaks only at its dot (log.css)
  /** W235 logover (SPEC §497, her point 07): Week and Month: the selected period's header over twelve columns, each a button that
   *  selects its period (a tap fills the header with its numbers, in place); miles up and climb down, each on its own scale, the
   *  tallest of each filling its part of the chart's fixed height; the middle line one empty column further left, with MI and FT
   *  (SCUL's LY) there; under each column its day or month, the month or the year under the first of a run (log-weeks.js axis). */
  function activity(flights) {
    const bs = buckets(flights, { unit, now: Date.now() }), ax = axis(bs, unit); // W127 walklog: the bars are her rides', the walks counted apart (log-weeks.js)
    let k = bs.findIndex((b) => b.start === picked); if (k < 0) k = bs.length - 1; // the period now in, till a column is chosen
    const top = Math.max(...bs.map((b) => b.metres)), topC = Math.max(...bs.map((b) => b.climb_m));
    const headOfK = (b, cls = "wsub") => sumHead(cls, b, periodLabel(b, unit), b.metres, b.climb_m);
    let head = headOfK(bs[k]);
    const heads = node("div", { className: "wheads" }, head, node("div", { className: "wsizes", ariaHidden: "true" }, ...bs.map((b) => headOfK(b, "wsz")))); // every period's header, unseen, under the one shown: the header is as tall as its tallest, so a tap never moves the chart
    const cols = bs.map((b, i) => {
      const c = node("button", { className: `wcol${i === k ? " on" : ""}`, ariaLabel: w("column", unit === "month" ? `${ax[i].top} ${new Date(b.start).getFullYear()}` : periodLabel(b, unit), tallyN(b.rides, b.walks, ", "), (b.metres / LY).toFixed(1), ftOf(b.climb_m)), onclick: () => choose(i) }, // its name holds the words it shows ("Dec 2025", "Aug 24 – 30": WCAG 2.5.3)
        node("span", { className: "wd" }, node("i", { style: `--h:${top ? b.metres / top : 0}` })), node("span", { className: "wc" }, node("i", { style: `--h:${topC ? b.climb_m / topC : 0}` })),
        node("span", { className: "wt" }, ...(unit === "month" ? [node("span", { textContent: ax[i].top[0] }), node("span", { className: "rest", textContent: ax[i].top.slice(1) })] : [ax[i].top]))); // Month: the name's first letter apart, alone where three letters run together (log.css)
      c.setAttribute("aria-pressed", String(i === k));
      return c;
    });
    function choose(i) { // in place: the header and the two columns' marks, so the page doesn't move under her finger
      if (i === k) return;
      for (const [j, on] of [[k, false], [i, true]]) { cols[j].classList.toggle("on", on); cols[j].setAttribute("aria-pressed", String(on)); }
      k = i; picked = bs[i].start;
      const h = headOfK(bs[i]); head.replaceWith(h); head = h;
    }
    const bars = node("div", { className: `wbars ${unit}${unit === "month" && ax[0].under ? (ax[1]?.under ? " pair" : ax[2]?.under ? " near" : "") : ""}`, role: "group", ariaLabel: w("activity", unit) }, // W235 logover: .pair, two years side by side; .near, two columns apart (log.css)
      node("span", { className: "wkey", ariaHidden: "true" }, node("i", { textContent: w("ly") }), node("i", { textContent: "ft" })), ...cols,
      ...ax.map((a, i) => node("span", { className: `wm${i ? "" : " w0"}`, ariaHidden: "true", style: `grid-column:${i + 2}`, textContent: a.under })), node("i", { className: "wmid", ariaHidden: "true" })); // the month or the year under the first of a run, a row under the columns (their names, a screen reader's, say it)
    return node("div", { className: "weeks" }, heads, bars); // W144 logmiles: in the miles card (the plot has the activity's name)
  }

  // ---- the page's head ----------------------------------------------------------------------------------------------
  function headOf() { // W213 log4 (SPEC §408): the page's title (W235 logrides: no selecting any more)
    const k = saturnight(Date.now()), sat = k && w("saturnight", k); // W76 loghead (D10): SCUL only
    return [node("header", { className: "top" }, node("h2", { textContent: "Log" }), ...(sat ? [node("span", { className: "sat", textContent: sat })] : [])), // W76 loghead; W217 chrome5 (SPEC §418): the pages' shell's header (app/app.css .page > .top), the title and Saturnight only
      ...(demo ? [node("p", { className: "demo", textContent: w("demo") })] : [])]; // W60 c; W150 logtidy (her note 8): no count, the miles card has it; W192 uitabs (SPEC §339, her row 7): no "Back up all rides" (W160 logsettings), Overview's Back up row; W217 chrome5: the demo's line under the header, which holds one line
  }
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
    const had = document.activeElement?.matches?.("#log-page > .group > button.row"); // the Overview's Back up row, the dialog's focus given back
    if (rowsDone() && had) page.querySelector(":scope > .group > button.row")?.focus({ preventScroll: true }); // W235 logrides: a row's delete or unstar counting is done first, so the file holds the Log as the list will be; the list built again, the focus on the new row
    if (!demo) await cutOnce(); // W234 logfirst: a ride the start saves as cut short goes in the file too
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
  const OLD_WEATHER = "starchart.tradeoffs.weather"; // W203 tradeoffs2 (SPEC §365): 0.1.93's one weather beam (app/settings.js migrate)
  const DONE = "starchart:restored", flying = async () => !!(await navigator.locks?.query().catch(() => null))?.held?.some((l) => l.name === "starchart:flying"); // as main.js's otherFlies
  async function restoreFrom(file) {
    const r = unpackAll(await readBackup(file), [...KEPT, ...MODE_KEYS, OLD_WEATHER, OLD_HOME, TURNS]); /* W216 homefav (SPEC §414): and its home, which the restart's migrateHome makes a favourite named Home (app/starred.js) */ // W196 logsettings2: an older backup's avatar, colour and voice, for both modes then: the restart's migrate gives them to the mode now; W203 tradeoffs2: and 0.1.93's one weather lean, both tabs' then; W208 pocketbuzz (SPEC §383): and its Vibrate at turns, which the restart's migrateSound reads (app/calls.js)
    if (r.bad) return offer([w(r.bad === "newer" ? "newer" : "notBackup")]);
    if (await flying()) return offer([w("landFirst")]);
    const fs = unpackBackup(r.log).flights, store = r.store || {};
    const line = [...(fs.length || !r.store ? [tally(fs, ", ")] : []), ...(store[STARRED] && readStarred(store[STARRED]).length ? [w("starredN", readStarred(store[STARRED]).length)] : []),
      ...(store[ROADS] && readAvoids(store[ROADS]).length ? [w("streetsN", readAvoids(store[ROADS]).length)] : []), ...(r.store ? [w("settings")] : [])].join(", ");
    const release = holdLock(UNDO); // another tab's start, meanwhile, leaves the tracks alone; W160 logsettings: no second confirm, askRestore asked before the file
    try {
      settle(); // a delete's Undo window commits first
      // the summaries and the keys first, then the tracks in one transaction: a refusal anywhere puts the summaries and keys back
      const was = box.flights, keys = [LOGS, ...KEPT, ...MODE_KEYS, OLD_WEATHER, OLD_HOME, TURNS].map((k) => [k, box.store.getItem(k)]); /* W216 homefav: OLD_HOME */ // W196 logsettings2: an older backup's shared avatar and voice go too; W203 tradeoffs2: and its weather lean; W208 pocketbuzz: and its Vibrate at turns
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
  ownScreen("log", () => !page.hidden && !opening); ownScreen("flight-page", () => !fpage.hidden && !fpage.classList.contains("staging")); // W190 screenstate: were body.log-page and body.log-flight; W211 noflash: not while they come unseen
  ownScreen("tab", () => (opening || (!fpage.hidden && fpage.classList.contains("staging")) ? "log" : "")); // W211 noflash: but they are the tab the tap opened (app/screen.js tab)
  body.append(fpage);
  let shown = null, fixes = [], watcher = null, fromChart = false; // W27 friction: fromChart, the page opened from the chart (the landed sticker)
  const css = (v) => getComputedStyle(html).getPropertyValue(v).trim();
  function routeLayers() {
    if (map.getSource("log-route")) return;
    const before = map.getLayer("system-nebula") ? "system-nebula" : undefined, round = { "line-cap": "round", "line-join": "round" };
    const zw = (a, b, fa = a, fb = b) => ["interpolate", ["linear"], ["zoom"], 11, ["case", ["has", "filled"], fa, a], 16, ["case", ["has", "filled"], fb, b]]; // W228 backfill: fa, fb, a filled stretch's (thinner, no glow)
    map.addSource("log-route", { type: "geojson", data: fc([]) });
    map.addSource("log-replay", { type: "geojson", data: fc([]), lineMetrics: true });
    map.addLayer({ id: "log-route-glow", type: "line", source: "log-route", layout: round, paint: { "line-opacity": 0.35, "line-width": zw(10, 18, 0, 0), "line-blur": zw(6, 10) } }, before); // W21 gps: the trail's glow
    map.addLayer({ id: "log-route-casing", type: "line", source: "log-route", layout: round, paint: { "line-opacity": 0.85, "line-width": zw(6, 11, 3, 5) } }, before);
    map.addLayer({ id: "log-route", type: "line", source: "log-route", layout: round, paint: { "line-opacity": 0.95, "line-width": zw(2.6, 5, 1, 2) } }, before);
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
    if (pend.has(pkey(id, "del"))) undoRow(id, "del"); // W235 logrides: a tap on a card whose delete counts keeps that ride and opens it (a tap that just missed Undo deleted it for good)
    rowsDone(); // W235 logrides: leaving the Log for a ride's page, every other row's count is done
    const f = box.get(id);
    if (!f) return;
    shown = f;
    fromChart = page.hidden; // W27 friction: ← goes back where the page was opened
    fpage.classList.add("staging"); fpage.hidden = false; // W211 noflash (SPEC §392): laid out unseen, the Log (or the chart) over it till its ride is drawn and framed (below)
    drawFlight(f);
    watch(() => closeFlight());
    fixes = drawnTrack(await logbook.fixes(id)); // W21 gps: the matched track; the GPX keeps the raw fixes
    if (shown !== f) return;
    page.scrollTop = 0; page.hidden = true; // W102 logscale: the top, set while it shows (hidden, it would keep its place)
    fpage.classList.remove("staging"); // W211 noflash: the page, the route and its framing in one frame (was the chart where it was, then the ride)
    syncScreen(); // W190 screenstate: was body.log-flight, and no body.log-page
    hold("route");
    showBar();
    for (const b of fpage.querySelectorAll(".replay, .gpx")) why(b, fixes.length < 2 ? w("noTrack") : null); // W60 c // W24 quiet: dim, and says why
    for (const b of fpage.querySelectorAll(".acts .go")) why(b, fixes.length || unpackThumb(f.thumb).length ? null : w("noTrack")); // W196 logsettings2: Go needs only the end
    if (map) drawRoute(f); // W234 logfirst: else once the map is in (attach); till then its place shows the map's loading
  }
  /** W234 logfirst: a ride's page's map part (was openFlight's end): its route drawn and framed. */
  function drawRoute(f) {
    const pts = fixes.length > 1 ? fixes.map((x) => [x.lon, x.lat]) : unpackThumb(f.thumb);
    routeLayers(); routeInk();
    const dot = (p, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: p } });
    const { tracked, filled } = fixes.length > 1 ? rideLines(fixes, f.fills) : { tracked: [pts], filled: [] }; // W29 polish: a gap where no fix came (a resume, the screen off), as the live trail; W228 backfill: a stretch filled from the route drawn apart, thinner
    const multi = (lines, props = {}) => (lines.length > 1 ? { type: "Feature", properties: props, geometry: { type: "MultiLineString", coordinates: lines } } : { ...line(lines[0] ?? pts), properties: props });
    map.getSource("log-route")?.setData(fc(pts.length > 1 ? [multi(tracked), ...(filled.length ? [multi(filled, { filled: true })] : []), dot(pts[0]), dot(pts.at(-1), { end: true })] : []));
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
      n0(f.climb_m, (v) => `▲\u00a0${Math.round((v * FT) / 10) * 10}\u00a0ft`), n0(f.hifives), n0(f.cups)].slice(0, tw.length).map((v, i) => [tw[i], v]); // W60 c; W127 walklog: tw; R2 bigtext: the climb's no-break spaces
    const name = node("input", { className: "name", value: rideName(f), readOnly: true, ariaLabel: w("name"), maxLength: 80, enterKeyHint: "done" });
    name.onclick = () => { if (name.readOnly) rename(name); }; // W25 rest: a tap on the name starts Rename
    const back = node("button", { className: "back", ariaLabel: fromChart ? pick("Back to the chart", "Back to the map") : "Back to the Log", onclick: () => closeFlight() }, icon("back"));
    // W196 logsettings2 (SPEC §348, her row 24): the pills are Go, Rename and Delete; Replay and GPX are the foot's links (Ride again went)
    const acts = node("div", { className: "acts" },
      ...(go || !map ? [node("button", { className: "go", onclick: () => goEnd(f) }, icon("course"), "Go")] : []), // W196 logsettings2: a fresh route to the ride's end; W234 logfirst: before the map too, its go comes with it
      node("button", { className: "rename", onmousedown: (e) => { if (name === document.activeElement) e.preventDefault(); }, // W40 log: renaming, it's Done:
        onclick: () => (name.readOnly ? rename(name) : name.blur()) }, icon("pen"), "Rename"), // the tap keeps the focus, and only confirms; W210 favs2: the pen (was the chalk tag)
      node("button", { className: "del", ariaLabel: w(f.foot ? "delWalk" : "del"), onclick: () => remove(f) }, icon("trash"), w("remove"))); // W60 c; W127 walklog: a walk's; W196 logsettings2: a pill, "Delete"
    const links = [node("button", { className: "replay", onclick: () => replay(60) }, "Replay"), // W196 logsettings2: the foot's, where Delete was
      node("button", { className: "gpx", onclick: (e) => gpxMenu(e.currentTarget, box.get(f.id) || f) }, "GPX")]; // its name now, after a rename; W67 logsafe: its menu
    for (const b of [...links, ...acts.querySelectorAll(".go")]) why(b, "Loading the track."); // W24 quiet: until the track is in; W196 logsettings2: Go's end too
    const note = f.excluded_m ? node("p", { className: "note" }, node("b", { textContent: w("leftOut", (f.excluded_m / LY).toFixed(1)) }), w("leftWhy")) : ""; // W60 c; W150 logtidy (her note 10): no towns
    const filled = f.fills?.length ? node("p", { className: "note filled", textContent: w("filled") }) : ""; // W228 backfill (SPEC §477): one short line, under the numbers that count it
    const plan = f.plan_s > 0 && f.flew_s > 0 ? node("p", { className: "plan" }, ...durNodes(w("planned", Math.max(1, Math.round(plannedAt(f) / 60)), Math.max(1, Math.round(f.flew_s / 60))))) : ""; // W59 pace: old flights have no plan, and say nothing; W200 parkwalk: plannedAt // W68 fixes: durNodes
    const seg = node("div", { className: "seg", role: "radiogroup", ariaLabel: "Replay speed" },
      ...[10, 60].map((x) => { const b = node("button", { role: "radio", textContent: `${x}×` }); b.dataset.x = x; return b; }));
    const rbar = node("div", { className: "replaybar", hidden: true },
      node("button", { className: "pp", ariaLabel: "Pause" }, icon("pause")), seg, node("div", { className: "scrub" }, node("i")),
      node("span", { className: "clock" }), node("button", { className: "x", ariaLabel: "End the replay", onclick: () => endReplay() }, icon("close")));
    fpage.replaceChildren(
      node("div", { className: "topbar" }, back, node("div", { className: "ttl" }, name, node("small", { textContent: `${day(f.start)} · ${clock(f.start)}` }))),
      node("div", { className: "fsheet" }, node("div", { className: "handle", ariaHidden: "true" }), acts,
        node("div", { className: "stats" }, ...tiles.map(([k, v]) => node("div", {}, Array.isArray(v) ? node("b", {}, ...v) : node("b", { textContent: v }), node("span", { textContent: k })))), // W68 fixes: or nodes
        plan, note, filled, node("div", { className: "foot" }, ...links, node("span", { className: "osm", textContent: "OpenStreetMap" }))), // W59 pace: plan; W150 logtidy: no feedback link. W58's plain credit, as on the chart (About keeps the full one); W196 logsettings2: Replay and GPX
      rbar);
  }
  function closeFlight(toLog = !fromChart) { // W27 friction: back to the chart when opened from it
    closeGpxMenu(false); // W67 logsafe
    endReplay(false);
    shown = null; fixes = [];
    later = null; // W234 logfirst: a tap kept for the map goes with its page
    const off = () => { fpage.hidden = true; fpage.classList.remove("staging"); syncScreen(); /* W190 screenstate */ map?.getSource("log-route")?.setData(fc([])); }; // W234 logfirst: map?, none yet
    if (toLog) open(true, off); else { off(); close(); } // W27 friction; W144 logmiles: true; W211 noflash (SPEC §392): its page goes as the Log shows
  }

  /** W196 logsettings2 (SPEC §348, her row 24): Go: a fresh route to where the ride ended (its track's last fix, else its
   *  thumbnail's), planned from here as a dropped pin is, on the chart. */
  function goEnd(f) {
    const end = fixes.at(-1), p = end ? [end.lon, end.lat] : unpackThumb(f.thumb).at(-1);
    if (!p) return; // why() said so
    if (!go) return soon(fpage.querySelector(".acts .go"), "goSoon", () => goEnd(f)); // W234 logfirst
    closeFlight(false); // to the chart
    go(p);
  }

  // ---- W73 ghosts (SPEC §121): the season chart, every trail framed (W150 logtidy: in blue; W235 logover: from All's "Map of all rides") ----
  let season = false;
  async function openSeason(from = page.querySelector(".mapall")) { // W150 logtidy: every flight (W144 logmiles' period went with the box's link); W235 logover: from All's last row (`from`); W235 logrides: the list's heading no longer opens it
    if (!ghosts) return soon(from, "mapAllSoon", () => openSeason(from)); // W234 logfirst
    rowsDone(); // W235 logrides: leaving the Log for the all-rides map, every row's count is done
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
  function closeSeason() { open(true, () => { season = false; ghosts.season = false; ghosts.refresh(); fpage.hidden = true; fpage.ariaLabel = w("flight"); syncScreen(); /* W190 screenstate */ }); } // W144 logmiles: true; W211 noflash: it goes as the Log shows

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
      fpage.classList.remove("renaming"); face("pen", "Rename"); // W40 log; W210 favs2: the pen
      if (save && f && input.value !== was) input.value = rideName(box.rename(f.id, input.value)); // 0.1.104: only a change is a name she gave: a tap on the name and a tap away had kept "To Coffee" as one, and a name she gave goes out in the ride's GPX
      else input.value = was;
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(true); input.blur(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); input.blur(); }
    };
    input.onblur = () => done(true);
  }

  // ---- delete, with Undo ----------------------------------------------------------------------------
  function remove(f) { // W235 logrides (SPEC §498): back to the list, where its row's bin is Undo with its ring (was the Undo bar)
    count(f, "del"); reveal = f.id;
    closeFlight(true); // W27 friction: to the Log
  }

  // ---- GPX: shared as a file where the phone can, else downloaded. Nothing is uploaded. --------------
  /** W67 logsafe (SPEC §96): GPX's menu, a small card over the button as §69's share menu is: "Trim the ends" first (200 m off
   *  each end; W219 favs3: no home to trim round, SPEC §425), then "Whole track". Escape, Back or a tap elsewhere close it. */
  let gmenu = null;
  function gpxMenu(btn, f) {
    closeGpxMenu();
    const trim = node("button", { className: "send trim" }, icon("gpx"), w("trim")), whole = node("button", { className: "whole" }, w("whole"));
    const m = node("div", { className: "cshare gpxmenu", role: "dialog", ariaLabel: "GPX" }, node("div", { className: "acts" }, trim, whole));
    why(trim, trimRuns(trackRuns(fixes)).flat().length < 2 ? w("short") : null); // W219 favs3: the ride's two ends only (was and her home's, W216's homeAt)
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
    hand(new Blob([gpx(f, pts, { trim })], { type: "application/gpx+xml" }), gpxName(f), rideName(f, undefined, true), "GPX"); // 0.1.104: the share's title as the file's // W67 logsafe: trim; hand; W219 favs3: no home
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
  // W201 walkstops (SPEC §363, her row 10): the ship is the chart's own marker, the word mode's avatar in its colour (avatar(), a layer;
  // was the SCUL ship's sprite in both modes), on foot for a walk, its wheels at the track's own speed
  let ship = null; // W201 walkstops
  const R = { on: false, x: 60, rt: 0, i: 0, playing: false, raf: 0, last: 0, drawn: 0 };
  function replay(x) {
    if (fixes.length < 2) return;
    if (!map) return soon(fpage.querySelector(".replay"), "replaySoon", () => replay(x)); // W234 logfirst
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
    if (fresh && avatar) { // W201 walkstops: the mode's pick now, a walk's on foot
      ship = avatar(ship); ship.setGait(shown?.foot ? "walk" : "ride"); ship.lngLat = here.p; ship.heading = here.b; ship.on = true; ship.cue("launch");
      if (!map.getLayer(ship.id)) map.addLayer(ship); // W201 walkstops: over the trail; again after a style that dropped it
    }
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
    const v = (111320 * Math.hypot((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat)) / Math.max(1, (b.t - a.t) / 1000); // W201 walkstops: m/s, for the wheels
    return { p, b: brg, v };
  }
  function step(now) {
    if (!R.on) return;
    const total = fixes.at(-1).t - fixes[0].t;
    if (R.playing) {
      R.rt = Math.min(total, R.rt + (now - R.last) * R.x);
      const here = at_(R.rt);
      if (ship) { ship.lngLat = here.p; ship.heading = here.b; ship.speed = here.v; } // W201 walkstops: drawn with the frame jumpTo asks for
      if (now > R.easeUntil) map.jumpTo({ center: here.p }, { follow: true }); // W244 leftovers10: a camera that moves every frame, as the follow camera (app/placenames.js ended)
      if (now - R.drawn > 250) { // the trail and the readout, four times a second
        R.drawn = now;
        map.getSource("log-replay")?.setData(line([...fixes.slice(0, R.i + 1).map((x) => [x.lon, x.lat]), here.p]));
        fpage.querySelector(".scrub i").style.transform = `scaleX(${(R.rt / total).toFixed(4)})`;
        fpage.querySelector(".replaybar .clock").textContent = clock(fixes[0].t + R.rt).replace(/ [AP]M$/, "");
      }
      if (R.rt >= total) { R.playing = false; R.drawn = 0; showPlay(); }
      if (!R.playing && ship) { ship.speed = 0; map.triggerRepaint(); } // W201 walkstops: at the end, stopped
    }
    R.last = now;
    if (R.playing) R.raf = requestAnimationFrame(step);
  }
  function pause() { R.playing = false; showPlay(); if (ship) { ship.speed = 0; map.triggerRepaint(); } } // W201 walkstops: paused, stopped
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
    if (ship) { ship.on = false; ship.speed = 0; map.triggerRepaint(); } // W201 walkstops: its layer stays, drawing nothing
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
    if (e.key !== "Escape" || watcher || document.querySelector("dialog[open]") || e.target.matches?.("input:not([readonly], .tick)")) return; // W40 log: a CloseWatcher hears Escape too, so it alone goes back; W210 log3: a ride's checkbox focused, Escape still leaves
    if (gmenu) closeGpxMenu(); else if (R.on) endReplay(); else if (shown) closeFlight(); else if (season) closeSeason(); /* W73 ghosts */ else if (!page.hidden) close(); // W235 logrides: no selecting
  });
  function open(back = false, then = () => {}) { // W144 logmiles: back, from a flight's page or the season chart; W211 noflash: then(), what goes as it shows
    if (!demo) cutOnce(); // W234 logfirst: the start's flights cut short first, if the start's end hasn't asked yet
    if (!back) { unit = "week"; lifeOn = false; picked = null; favs = false; } // W144 logmiles (SPEC §259): and on Week; back from a flight, as it was; W235 logover: on the period now in; W235 logrides: and All rides
    room = 0; // W235 logrides: it opens at its top, where Favorites needs no room
    watch(() => close());
    if (!page.hidden) { render(); page.scrollTop = 0; } // the Log tab's tap, scrolled
    else { opening = then; page.classList.add("staging"); page.hidden = false; return stage(); } // W102 logscale: in parts; hidden, it went to the top as it hid, so the click lays nothing out; W211 noflash: unseen, the old screen over it, till ready()
    shows(then);
  }
  function shows(then = opening) { // W211 noflash: the Log, filled, and the old screen gone, in one frame
    opening = null; page.classList.remove("staging");
    then?.();
    syncScreen(); // W190 screenstate: was body.log-page
    hold("page");
    showBar();
  }
  function close() {
    rowsDone(true); // W235 logrides: leaving the Log, every row's count is done (the page goes, so no render)
    favs = false; unit = "week"; lifeOn = false; picked = null; // W235 logrides: the visit ends, so a ride's page opened from the map goes back (its Delete, the Log tab) to All rides, and the Overview on Week, its week now in (SPEC §259)
    const then = opening; opening = null; staging = null; page.classList.remove("staging"); fpage.classList.remove("staging"); then?.(); // W211 noflash: an open called off: the old screen goes all the same
    closeGpxMenu(false); // W67 logsafe
    later = null; // W234 logfirst
    if (shown) { endReplay(false); shown = null; fpage.hidden = true; map?.getSource("log-route")?.setData(fc([])); } // W234 logfirst: map?, none yet
    if (season) { season = false; ghosts.season = false; ghosts.refresh(); fpage.hidden = true; fpage.ariaLabel = w("flight"); } // W73 ghosts
    page.scrollTop = 0; page.hidden = true; // W102 logscale: the top, set while it shows (hidden, it would keep its place)
    syncScreen(); // W190 screenstate
    watcher?.destroy(); watcher = null;
    hold(null);
    showBar();
  }

  // ---- W234 logfirst (SPEC §491): what draws the map, tapped before it is in ------------------------------------------------
  // The bubble says it waits; the tap is kept and runs once the map is in (attach), if its page is still the one open (its ride's
  // page, or the Log for the all-rides map). The button keeps its look: it will work (no fade to say it waits).
  let later = null;
  function soon(btn, k, run) { later = { f: shown, run }; tip(btn || page, w(k)); }

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
  /** W234 logfirst (SPEC §491): the start's cutShort, once: at the Log's first open if it comes before the start's end (app/main.js
   *  ready), and the Log shows once it is done (ready()), so a ride it saves is in the list from the first frame, never coming in
   *  under her finger; at most CUT_MS (a worker that never answers), then a late row comes in as before (kept). cutShort itself
   *  runs at each call (another tab's start, in tests). */
  let cut = null, cutIn = false;
  const CUT_MS = 2000;
  const cutOnce = () => (cut ??= Promise.race([cutShort().catch(() => {}), new Promise((r) => setTimeout(r, CUT_MS))]).then(() => { cutIn = true; ready(); }));
  /** W28 resume: a flight saved at the start. W196 ui4 (SPEC §347, her row 19): with no "Flight saved" popup; it is in the Log. */
  function kept(f) {
    if (!f) return;
    persist();
    if (!page.hidden) render();
  }
  let current = () => "";
  function keep(id, fx) {
    const { metres, stats } = statsFrom(fx), g = new CarGuard();
    for (const f of fx) if (!f.filled) g.fix({ lonlat: [f.lon, f.lat], t: f.t, speed_mps: null }); // rel-0.1.121: a filled stretch never through the car guard, as the ride's record (app/blackbox.js fill)
    g.close();
    const f = box.add({ id, start: fx[0].t, end: fx.at(-1).t, metres, minutes: (fx.at(-1).t - fx[0].t) / 60000, excluded_m: Math.min(metres, g.excluded), ...stats });
    if (f) logbook.final(id); // W28 resume: a full store leaves it to try again at the next start
    return f; // W28 resume
  }
  /** W68 logbulk (SPEC §99): a flight just written (Land, or kept by the black box or at the start) that is tiny is taken out at
   *  once (W124 settings3: always, with no setting; a test's window.__keepTiny keeps it), so the totals and classes never count
   *  it. One snack says so, with Keep, which puts it back; its track goes when the window closes (and a start after a close in the window drops it, as a deleted one's). */
  function dropTiny(f, said = false) { // W203 popups: said, End's own bar said "Too short to save"
    if (!f || demo || globalThis.__keepTiny || !tiny(f)) return false; // W124 settings3: no setting
    const undo = box.remove(f.id);
    if (said) logbook.drop(f.id); // W203 popups (SPEC §369, her row 6): one ending, one message, so no second bar; End's Undo was its undo
    else offer([w("tooShort")], { undo: () => { undo(); persist(); }, keep: true, commit: () => { if (!box.get(f.id)) logbook.drop(f.id); } }); // W203 popups: else
    if (!page.hidden) render();
    return true;
  }
  /** Ask the browser to keep the Log when a flight is saved, while it isn't kept (W40 settings: not only at the first). */
  function persist() { keepStorage(); }
  /** W86 eta (SPEC §172): a flight saved sets Pace from her last rides on a course, said once, unless she set it by hand. */
  function learn() { // W86 eta
    const l = demo ? null : learnedPace(box.flights), to = paceToLearn(l); // W86 eta
    if (to) { setSetting("starchart.pace", to); offer([w("learned", to, l.rides)]); } // W86 eta
    const lw = demo ? null : learnedWalkPace(box.flights), tw = walkPaceToLearn(lw); // W211 walkmore: Walking pace from her walks, as Pace from her rides
    if (tw && !to) { setSetting("starchart.walkpace", tw); offer([w("walkLearned", tw, lw.walks)]); } // W211 walkmore: one line at a time (a ride's pace first; the walk's at the next save)
  } // W86 eta

  onLingo(() => { if (!page.hidden) render(); fpage.ariaLabel = w("flight"); }); // W60 c: the Log in the new words at once (Settings opens over the list, never over a flight's page)
  addEventListener("starchart:theme", () => { if (map?.getLayer("log-route")) routeInk(); }); // W73 logsafe: a flight's route in the new theme's inks, as the other layers; W234 logfirst: map?, none yet
  showBar();
  return {
    /** Parked (the bar shows) or not (Launch slid it away). */
    bar(on) { if (on === barWanted) return; barWanted = on; showBar(); }, // W28 resume: no cut-short offer to hide
    /** A flight was saved, or the box changed: draw the Log again if it is open. */
    saved() { persist(); learn(); if (!page.hidden) render(); }, // W86 eta: learn
    /** A line on the snackbar, with no Undo: "Log full: flight not saved". */
    say(text) { offer([text]); },
    /** W166 walkui (her note 8, "Part of this ride wasn't tra…"): a flight with a gap, saved: what the gap means, whole. */
    gapped() { offer([w("gap")]); }, // W196 ui4 (SPEC §347, her row 19): no "Ride saved", only what the gap means
    open, close, openFlight, replay, cutShort, kept, // W28 resume: kept
    cutOnce, // W234 logfirst: the start's cutShort, once (app/main.js ready)
    /** W234 logfirst (SPEC §491): the map's parts, once it is in ({map, ghosts, hold, recentre, go, avatar}): a ride's page open
     *  meanwhile gets its route, framed; the Log open meanwhile holds the chart (hold); a tap kept for the map runs (soon). */
    attach(parts) {
      ({ map, ghosts, hold, recentre, go, avatar } = parts);
      if (shown && !fpage.classList.contains("staging")) { hold("route"); drawRoute(shown); } else if (!page.hidden && !opening) hold("page"); // a page still coming does both itself
      const l = later; later = null;
      if (l && l.f === shown && (shown || !page.hidden) && !settingsUp()) l.run(); // on another tab (Settings) meanwhile, it goes
    },
    /** W68 logbulk: a flight written at Land or by the black box: true if it was tiny and taken out (a snack offers Keep). */
    dropTiny,
    set current(fn) { current = fn; },
    get shown() { return shown?.id || null; },
    get replaying() { return R.on ? { x: R.x, rt: R.rt, playing: R.playing, ...(ship && { avatar: { build: ship.build, tint: ship.avatar, gait: ship.gait, box: ship.getBoundingClientRect(), ring: ship.ring, beam: ship.beam } }) } : null; }, // W201 walkstops: avatar, for tests
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
