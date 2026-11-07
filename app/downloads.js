// W26 downloads: the guard on big downloads (design/app-ui/SPEC.md §35).
//
// The offline data (the chart's tiles, then the routing graph, the search index and the hills, about 40 MB) and any later
// change of 5 MB or more wait for a tap while the connection is "careful": Data Saver on, or mobile data
// (navigator.connection, Chromium only; it has no metered flag, so cellular stands in for metered). One heads-up notice
// says so, with "Download now"; its × hides it for now, a long press for good (app/notice.js). A change to Wi-Fi or
// ethernet with Data Saver off starts the download by itself. With no API (Safari, so all of iOS, and Firefox) the
// download starts as before. Settings › Offline chart always says the state, with Download now or Pause (W40 settings: at the
// sheet's top level, the way back once the notice is hidden for good).
// The hold is offline.js's pause(): the downloads queue up behind it, so the graph, the index and the hills, which
// follow the chart (app/course.js, app/terrain.js), come under the same guard.
import { canStore, pause, paused, resume, storedBytes, storedTiles } from "./offline.js"; // W163 iosdownload: canStore, storedBytes
import { mountNotice } from "./notice.js";
import { pick, onLingo } from "./lingo-mode.js"; // W60 c

/** A download of this many bytes or more waits for a tap on a careful connection. */
export const BIG = 5 * 1048576;
/** Data Saver on, or mobile data. No API: false. */
export const careful = (c) => !!c && (c.saveData === true || c.type === "cellular");
/** Does a download of `bytes` wait for a tap on connection `c`? */
export const asks = (c, bytes, big = BIG) => bytes >= big && careful(c);
/** After a change of connection: Wi-Fi or ethernet with Data Saver off starts a held download by itself. */
export const freeAgain = (c) => !!c && !c.saveData && (c.type === "wifi" || c.type === "ethernet");
export const mb = (b) => `${Math.max(1, Math.round(b / 1048576))} MB`;

/** The heads-up's words. `first`: nothing is stored yet. */
export const headsUp = (c, bytes, first) =>
  `${first ? "The offline chart is" : "The chart's update is"} ${mb(bytes)}, and ${c?.saveData ? "Data Saver is on" : "you're on mobile data"}.`;

/** W86 settings: the chart's own row, first in the list of map packs, says what it covers as a pack's does (the same in both modes). */
export const BASE = { name: "Greater Boston", places: "Boston, Cambridge, Somerville, Brookline, Newton, Quincy" };

/** W163 iosdownload (SPEC §290): the row where storing fails (Safari Private Browsing), and an iPhone tab's note, which ends in a
 *  link to the install guide. */
export const STORE_WORDS = {
  nostore: ["This tab can't store the chart, so no street detail. Use a normal tab, or add the app to the droid's home screen.",
    "This tab can't store the map, so no street detail. Use a normal tab, or add the app to your home screen."], // W165: Plain says map, as its "Offline maps"
  ios: ["Safari keeps the chart for the home screen app, not a tab.", "Safari keeps the map for the home screen app, not a tab."], how: "How", // W165: [SCUL, Plain]
};
/** The Settings row: its words and its button ("Download now", "Pause" or none). `again`: a retry is on its way (W40 settings).
 *  W163 iosdownload: `nostore`, storing fails here: no button, as nothing would come of one. */
export function rowState({ supported, total, done, left, held, failed, started, again = false, full = false, nostore = false }) { // W74 integrity: full; W163 iosdownload: nostore
  if (nostore) return { text: pick(...STORE_WORDS.nostore), button: "" }; // W163 iosdownload
  if (!supported) return { text: "Needs a signal: this browser can't store files for the app.", button: "" };
  if (left <= 0) return { text: pick(`Stored on this droid, ${mb(total)}.`, `Stored on this phone, ${mb(total)}.`), button: "" }; // W60 c // W55 layers2: "Works with no signal" is what Offline says
  if (held || !started) return { text: `${mb(left)} to download.`, button: "Download now" };
  if (failed && full) return { text: pick("Not stored: the droid's storage is full.", "Not stored: the phone's storage is full."), button: "Download now" }; // W74 integrity
  if (failed) return { text: `The download stopped. ${mb(left)} to go; ${again ? "it tries again later" : "tap Download now to try again"}.`, button: "Download now" }; // W40 settings
  return { text: `Downloading, ${Math.floor((100 * done) / total)} %.`, button: "Pause" };
}

/**
 * Wire the guard. `entries` are data/manifest.json's files; `start()` begins the downloads (main.js storeChart);
 * `onPause()` tells the chart's own store row; `again()`: a retry of the chart is on its way (W40 settings). Returns { begin, show }:
 * call begin() where the download used to start, and show() when again() changes.
 */
export function mountDownloads({ entries, supported, start, onPause = () => {}, again = () => false, note, row, conn = globalThis.navigator?.connection, ios = false, guide = () => {} }) { // W163 iosdownload: ios, an iPhone tab; guide() opens the install guide
  const files = new Map(); // kind -> { bytes, loaded, done, need, failed }
  const big = globalThis.__downloadBig ?? BIG; // the e2e tests' fixture data is 3 MB
  let first = true, guarded = false, started = false;
  const failed = () => [...files.values()].some((x) => x.failed && !x.done); // W40 settings: by file, so another file's progress doesn't hide one that failed
  const full = () => [...files.values()].some((x) => x.failed && x.full && !x.done); // W74 integrity: the storage is full
  const nostore = () => supported && !canStore(); // W163 iosdownload: OPFS is there but won't open
  const ready = (async () => {
    if (!supported || nostore()) return; // W163 iosdownload: nostore
    for (const e of entries) {
      const st = await storedTiles(e);
      if (st) first = false;
      const part = st?.current ? 0 : Math.min(e.bytes, await storedBytes(e)); // W163 iosdownload: what a download before this visit stored
      files.set(e.kind, { bytes: e.bytes, loaded: Math.max(part, !st && e.prefix_bytes ? e.prefix_bytes : 0), done: !!st?.current, need: !st?.current }); // W76 privacy: the chart's prefix comes at every start, unasked (app/offline.js); W163 iosdownload: part
    }
  })();
  const sum = (f) => [...files.values()].reduce((a, x) => a + f(x), 0);
  const left = () => sum((x) => (x.done ? 0 : x.bytes - x.loaded));
  const notice = mountNotice(note);
  const button = row.querySelector("button"), text = row.querySelector("small.st") ?? row.querySelector("small"); // W86 settings: .st, its state
  const tip = ios ? document.createElement("span") : null; // W163 iosdownload: an iPhone tab's note, with a link to the install guide's steps
  if (tip) {
    const how = Object.assign(document.createElement("a"), { href: "#", textContent: STORE_WORDS.how, onclick: (e) => { e.preventDefault(); guide(); } });
    text.after(Object.assign(document.createElement("small"), { className: "ios" }));
    text.nextElementSibling.append(tip, how);
  }
  for (const [sel, words] of [[".t", BASE.name], [".pl", BASE.places]]) { const n = row.querySelector(sel); if (n) n.textContent = words; } // W86 settings
  let action = null;
  function show() {
    const todo = sum((x) => (x.need ? x.bytes : 0)), got = sum((x) => (x.need ? (x.done ? x.bytes : x.loaded) : 0));
    const s = rowState({ supported, total: left() > 0 ? todo : sum((x) => x.bytes), done: got, left: left(), held: paused(), failed: failed(), started, again: again(), full: full(), nostore: nostore() }); // W40 settings; W74 integrity: full; W163 iosdownload: nostore
    action = s.button === "Pause" ? manualPause : failed() && !paused() ? retry : go;
    text.textContent = s.text;
    if (tip) tip.textContent = nostore() ? "" : `${pick(...STORE_WORDS.ios)} `; // W163 iosdownload: the row's own words say it where storing fails
    button.textContent = s.button;
    button.hidden = !s.button;
    row.dataset.stored = String(left() <= 0 && supported && !nostore()); showLine(row); // W163 iosdownload: nostore // W88 settings3: the Offline maps fold's line
    notice.show(guarded && left() > 0 ? "big-download" : "", headsUp(conn, left(), first));
  }
  const hold = () => { guarded = true; pause(); onPause(); show(); };
  const unfail = () => { for (const x of files.values()) x.failed = false; }; // W40 settings
  const go = () => { guarded = false; unfail(); if (paused()) resume(); if (!started) { started = true; start(); } show(); };
  const now = document.createElement("button");
  now.className = "dlnow";
  now.textContent = "Download now";
  now.onclick = go;
  note.insertBefore(now, note.querySelector(".nx"));
  const manualPause = () => { guarded = false; pause(); onPause(); show(); }; // a Pause waits for Download now, on any connection
  const retry = () => { unfail(); start(); show(); };
  button.onclick = () => action?.();
  addEventListener("starchart:store", ({ detail: d }) => {
    const f = files.get(d.kind);
    if (!f) return;
    if (d.type === "progress" || d.type === "verifying") { f.loaded = d.loaded; f.failed = false; }
    if (d.type === "done") f.done = true;
    if (d.type === "error") { f.failed = true; f.full = !!d.full; } // W74 integrity: full
    show();
  });
  conn?.addEventListener?.("change", () => {
    if (guarded && freeAgain(conn)) go();
    else if (!guarded && started && !paused() && asks(conn, left(), big)) hold(); // mobile data mid-download: wait again
    else show();
  });
  ready.then(show);
  onLingo(show); // W60 c: the row's words, at once
  return {
    show, // W40 settings
    async begin() {
      await ready;
      if (started) return;
      if (asks(conn, left(), big)) hold();
      started = true;
      start();
      show();
    },
  };
}

// W82 packui (design/app-ui/SPEC.md §156): Settings › Offline chart's row per map pack, under the chart's: its name, places and
// size, and its one action (app/packs.js): Download, Pause while it comes, Remove once stored, Update when a new release changed
// it (Remove beside), and its why when it failed. Pack and place names are packs.json's, the same in both modes.
export const PACK_WORDS = {
  size: (b) => [`${mb(b)} to download.`, `${mb(b)} to download.`],
  getting: (pct) => [`Downloading, ${pct} %.`, `Downloading, ${pct} %.`],
  paused: (pct) => [`Paused at ${pct} %.`, `Paused at ${pct} %.`],
  stored: (b) => [`Stored, ${mb(b)}.`, `Stored, ${mb(b)}.`],
  update: (b) => [`Stored, ${mb(b)}. A new version is out.`, `Stored, ${mb(b)}. A new version is out.`],
  download: "Download", pause: "Pause", remove: "Remove", updateBtn: "Update",
};
/** A pack's row: its state line and its buttons, [words, action][], from app/packs.js's list() item. */
export function packRow(p) {
  const pct = Math.floor((100 * p.got) / p.bytes);
  if (p.state === "downloading") return { text: pick(...PACK_WORDS.getting(pct)), buttons: [[PACK_WORDS.pause, "pause"]] };
  if (p.state === "stored" && p.update) return { text: pick(...PACK_WORDS.update(p.bytes)), buttons: [[PACK_WORDS.updateBtn, "download"], [PACK_WORDS.remove, "remove"]] };
  if (p.state === "stored") return { text: pick(...PACK_WORDS.stored(p.bytes)), buttons: [[PACK_WORDS.remove, "remove"]] };
  if (p.state === "failed") return { text: p.why, buttons: [[PACK_WORDS.download, "download"]] };
  if (p.state === "paused") return { text: pick(...PACK_WORDS.paused(pct)), buttons: [[PACK_WORDS.download, "download"]] };
  return { text: pick(...PACK_WORDS.size(p.bytes)), buttons: [[PACK_WORDS.download, "download"]] };
}
/** The rows, after `row` (#dl-row), from `template` (#pack-row); each follows its pack's changes and the Words mode. */
export function mountPackRows({ packs, row, template }) {
  const rows = new Map();
  let after = row;
  for (const p of packs.list()) {
    const r = template.content.firstElementChild.cloneNode(true);
    r.dataset.pack = p.id;
    r.querySelector(".t").textContent = p.name;
    r.querySelector(".pl").textContent = p.places;
    after.after(r);
    rows.set(p.id, (after = r));
  }
  const show = (p) => {
    const r = rows.get(p.id);
    if (!r) return;
    const s = packRow(p), btns = [...r.querySelectorAll("button")];
    r.querySelector(".st").textContent = s.text;
    r.dataset.state = p.state; showLine(row); // W88 settings3: the Offline maps fold's line
    btns.forEach((b, i) => {
      const [t, act] = s.buttons[i] || [];
      b.hidden = !t;
      b.textContent = t || "";
      b.onclick = act ? () => packs[act](p.id) : null;
    });
  };
  const all = () => { for (const p of packs.list()) show(p); };
  all();
  packs.ready.then(all);
  packs.on(show);
  onLingo(all);
}

// W88 settings3 (design/app-ui/SPEC.md §175): Settings › Offline maps is one fold, shut, and its row says what is stored and
// how many more there are, so the list of packs no longer fills Settings: "Greater Boston stored", "7 more available".
// Until the chart is stored, its own row's state: "Greater Boston", "Downloading, 40 %.". The same words in both modes.
export const OFFLINE_WORDS = {
  stored: (n) => (n ? `${BASE.name} and ${n} more stored` : `${BASE.name} stored`),
  more: (n) => (n ? `${n} more available` : ""),
};
/** The fold's row, { t, small }: `base` is the chart's { stored, text }, `packs` each pack's { stored }. */
export function offlineLine({ base, packs }) {
  if (!base.stored) return { t: BASE.name, small: base.text };
  const kept = packs.filter((p) => p.stored).length;
  return { t: OFFLINE_WORDS.stored(kept), small: OFFLINE_WORDS.more(packs.length - kept) };
}
function showLine(row) { // `row` is #dl-row, its packs' rows after it, all inside the fold
  const sum = row.closest("details")?.querySelector(":scope > summary");
  if (!sum) return;
  const packs = [...row.parentElement.querySelectorAll(".pack-row")].map((r) => ({ stored: r.dataset.state === "stored" }));
  const l = offlineLine({ base: { stored: row.dataset.stored === "true", text: row.querySelector(".st")?.textContent ?? "" }, packs });
  sum.querySelector(".t").textContent = l.t;
  sum.querySelector("small").textContent = l.small;
}
