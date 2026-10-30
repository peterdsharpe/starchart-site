// W48 feedback (design/app-ui/SPEC.md §60): Settings › Send feedback, a full-screen page. A pilot writes what happened (the
// keyboard's microphone dictates into it: no audio leaves the droid, and the app does no speech-to-text), sees in full
// what goes with it, and sends it to a Google Form that only the devs read. The form is app/feedback.json:
//   { "action": "https://docs.google.com/forms/d/e/<id>/formResponse", "fields": { "message": "entry.N", "version": "entry.N", "state": "entry.N" } }
// Until its action is set, the row says so and nothing is sent; the build adds the action's origin to the CSP's connect-src
// only when it is set (app/build.mjs). hosting/README.md has the steps.
//
// The post is a simple request (form-encoded, mode "no-cors", no cookies), so it needs no CORS preflight; its answer is
// opaque, so a fetch that resolves counts as sent. Offline, or when the form doesn't answer, the message waits in
// localStorage and goes at the next chance: back online, the next start, or the next Send. A half-typed message is
// kept as it is typed (DRAFT), and comes back when the page opens again, until it is sent or queued.
//
// What goes with it never has the position: no coordinates, route points or place names from it. The state is JSON
// of a few plain words (app/main.js's `app()`, the settings, the droid) with the recent log, app/trail-log.js's, and
// every string in it but the browser's own line is scrubbed of coordinates.
import { trailLog, scrub, screenNow, errors, failedFetches } from "./trail-log.js"; // W88 feedbackinfo: errors, failedFetches
import { get } from "./settings.js"; // W88 feedbackinfo
import { keysWith } from "./keys.js"; // W190 settingsreg: the settings it reports
import { tip, why, say as speak } from "./tip.js"; // W160 smallui: speak, the button's words read out
import { pick } from "./lingo-mode.js"; // W60 c
import { showPage } from "./subpage.js"; // W147 small6
import { KEY as ROADS, OLD_KEY as OLD_ROADS, readAvoids, countLevels } from "./avoid-logic.js"; // W133 roadprefs: the streets' opinions, counted by level

// arclight, 2026-10-19: "4000 chars is very small. If someone wants to voice-dictate a 1 hour essay, I'm cool with that". A message
// may run to `message` characters (hours of dictation); one longer than `part` goes as numbered parts, each under a Google
// Sheets cell's 50,000 characters, so the sheet the form fills never cuts one short. The counter shows only near the end.
export const LIMITS = { message: 200_000, part: 45_000, attach: 24_000, queue: 20, postMs: 30_000 }; // W73 logsafe: queue, in messages, each whole; arclight 2026-10-23: no wait between sends ("we should be way less aggressive about trying to rate limit people who are trying to give us feedback"), so no rate; postMs: a post that hangs gives up and stays queued
const QUEUE = "starchart.feedback.queue";
export const DRAFT = "starchart.feedback.draft"; // the half-typed message: an update's reload or Android ending the app never loses it
export const NAME = "starchart.feedback.name"; // W128 small3 (her note): the name or contact of the last send that had one; a send without one clears it
export const WORDS = {
  unset: "Feedback isn't set up in this build yet, so nothing can be sent.",
  empty: "Write something first.",
  sent: "Sent!", // W177 tabsfeedback (SPEC §313, her note 13): a status bubble above Send, as the button reads Send again; was the button's own "Sent" for 2.5 s (W160 smallui)
  send: "Send", // W160 smallui: the button's words again; W177 tabsfeedback: at once, when it's gone
  saved: "Saved: it goes when you're back online.",
  failed: "Not sent: the feedback form didn't answer. It's saved, and goes at the next try.",
  full: ["Not saved: the droid's storage is full.", "Not saved: the phone's storage is full."], // W73 logsafe: the message stays in the box
  sending: "Sending…", // arclight 2026-10-23: at the tap, and at a second tap while it goes
  from: (who) => `From: ${who}`, // W128 small3: the message's first line, where the form has no field of its own for it
  nothing: ["Nothing but the version. The screen, the droid and the log stay here.", "Nothing but the version. The screen, the phone and the log stay here."], // W60 c: [SCUL, Plain]
};

/** The config is set when its action is an https address (or this site's own, for tests) and it names the message's field. */
export function isSet(c, base = globalThis.location?.href) {
  if (!c || typeof c.action !== "string" || !c.action || typeof c.fields?.message !== "string" || !c.fields.message) return false;
  try { const u = new URL(c.action, base); return u.protocol === "https:" || u.origin === new URL(base).origin; } catch { return false; }
}

/** The form's body: the message, the version and the state, each in its own field (a field the config leaves out isn't sent).
 *  W128 small3: and the rider's name or contact, `contact`, when the config names a field for it and there is one. */
export function formBody(c, { message, version = "", state = "", contact = "" }) {
  const b = new URLSearchParams();
  for (const [k, v] of [["message", String(message).slice(0, LIMITS.message)], ["version", version], ["state", state]]) if (c.fields[k]) b.append(c.fields[k], v);
  if (contact && c.fields.contact) b.append(c.fields.contact, contact); // W128 small3
  return b.toString();
}

/** A message as its parts: one, or for a long one, pieces of at most LIMITS.part characters cut at a space where there is one,
 *  each led by "Part i of n: ". */
export function parts(message, part = LIMITS.part) {
  const text = String(message).slice(0, LIMITS.message), out = [];
  if (text.length <= part) return [text];
  const room = part - 24; // "Part 12 of 12: " and spare
  for (let i = 0; i < text.length;) {
    let j = Math.min(text.length, i + room);
    if (j < text.length) { const sp = text.lastIndexOf(" ", j); if (sp > i + room / 2) j = sp + 1; }
    out.push(text.slice(i, j)); i = j;
  }
  return out.map((t, k) => `Part ${k + 1} of ${out.length}: ${t}`);
}

/** The bodies a Send posts, in order: the state goes with the first part only. W128 small3: so does the name or contact, in its
 *  own field, or as the message's first line ("From: …") where the config has no field for it. */
export const formBodies = (c, { message, version = "", state = "", contact = "" }) => {
  const who = String(contact).trim(), text = who && !c.fields.contact ? `${WORDS.from(who)}\n\n${message}` : message; // W128 small3
  return parts(text).map((m, k) => formBody(c, { message: m, version, state: k ? "" : state, contact: k ? "" : who }));
};

/** What goes with it, as JSON: the state (each string scrubbed, but the browser's own line) and the recent log, a line an
 *  entry, the oldest dropped to keep it under LIMITS.attach. */
export function attachment(state, log = "") {
  const clean = (v, k) => (typeof v === "string" ? (k === "browser" ? v : scrub(v)) : Array.isArray(v) ? v.map((x) => clean(x)) /* W88 feedbackinfo: a list stays one */ : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k2, x]) => [k2, clean(x, k2)])) : v);
  const head = clean(state);
  let rows = log ? log.split("\n") : [];
  const text = () => JSON.stringify({ ...head, log: rows }, null, 2);
  while (rows.length && text().length > LIMITS.attach) rows = rows.slice(Math.ceil(rows.length / 10));
  return text();
}

/** W73 logsafe: the queue `q` with a message's parts `bodies` added, all with one `at`, keeping the last `max` messages, each whole
 *  (a part-count cap dropped the start of a long message and sent "Part 2 of 5" alone). */
export function queued(q, bodies, at = Date.now(), max = LIMITS.queue) {
  const all = [...q, ...bodies.map((body) => ({ body, at }))], keep = [...new Set(all.map((e) => e.at))].slice(-max);
  return all.filter((e) => keep.includes(e.at));
}


const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }; // W73 logsafe: false when it isn't kept (full, or storage off)

// ---- W88 feedbackinfo (SPEC §180): what would have answered a rider's note at once, as words from fixed lists and counts. Never a
// coordinate, an address, a place's or a street's name, nor a search's words: the starred places, the avoided streets and the recent
// picks go as how many there are.
/** Every setting's value, by its key without "starchart." (each is one of its fixed words). W190 settingsreg: app/keys.js's
 *  settings, so Walk and T, the route style and the deep view too, each as get() gives it (the voice: this word mode's default
 *  when none was picked). W133 settings4 (SPEC §244): `motion`, with no switch, is what's in force: "calm (the phone's)"
 *  while the phone asks for reduced motion, "calm (Battery saver)" while Battery saver calms it (W113 settings2), or "full". */
export const settingsNow = (read = get) => {
  const o = Object.fromEntries(keysWith("reported").map((k) => [k.replace(/^starchart[.:]/, ""), read(k)])); // W190 settingsreg
  o.motion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "calm (the phone's)" : o.smooth === "30" ? "calm (Battery saver)" : "full"; // W133 settings4: as app/settings.js calmFrom
  return o;
};
const mins = (s) => (s > 0 ? Math.max(1, Math.round(s / 60)) : null), miles = (m) => Math.round(m / 160.9344) / 10;
/** The Log as numbers: how many flights, and the last one's day, miles, minutes, and planned against flown minutes. */
export function ridesNow(flights = []) {
  const f = flights.at(-1);
  if (!f) return { flights: 0 };
  return { flights: flights.length, last: { date: new Date(f.start).toLocaleDateString("en-CA"), mi: miles(f.metres || 0), minutes: f.minutes ?? null,
    plannedMin: f.plan_s > 0 ? mins(f.plan_s / (f.pace || 1)) : null, flownMin: mins(f.flew_s), ...(f.foot ? { foot: true } : {}) } }; // W127 walklog: a walk says so
}
/** The course being flown, `c` { style, metres, planned_s, ride_s, along_m }, or "none". */
export const courseNow = (c) => (c ? { style: c.style || "unknown", mi: miles(c.metres || 0), plannedMin: mins(c.planned_s), minSoFar: Math.round((c.ride_s || 0) / 60),
  done: `${Math.round((100 * (c.along_m || 0)) / (c.metres || 1))} %` } : "none");
/** How many items a stored list has (localStorage key `k`), or 0. */
export const countOf = (k, s = globalThis.localStorage) => { try { const v = JSON.parse(s.getItem(k)); return Array.isArray(v) ? v.length : 0; } catch { return 0; } };
/** W133 roadprefs: how many streets at each level, { prefer, avoid, never }, never their names (W73's list, not yet migrated, as Nevers). */
export const streetsOf = (s = globalThis.localStorage) => { try { return countLevels(readAvoids(s.getItem(ROADS) ?? s.getItem(OLD_ROADS))); } catch { return countLevels([]); } };
/** The map packs (app/packs.js list()'s states) as how many are in each state, e.g. { stored: 1, none: 6 }. */
export const packsNow = (states = []) => states.reduce((o, s) => ({ ...o, [s]: (o[s] || 0) + 1 }), {});
/** The GPS's accuracy over the last minute: its fixes' median accuracy, in metres. Never a position. */
export class GpsQuality {
  constructor() { this.fixes = []; }
  add(accuracy, t = Date.now()) { if (Number.isFinite(accuracy)) this.fixes.push([t, accuracy]); this.trim(t); }
  trim(t) { while (this.fixes.length && t - this.fixes[0][0] > 60_000) this.fixes.shift(); }
  now(t = Date.now()) {
    this.trim(t);
    const a = this.fixes.map((x) => x[1]).sort((x, y) => x - y), m = a.length >> 1;
    return a.length ? { fixesLastMinute: a.length, accuracyMedianM: Math.round(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) } : { fixesLastMinute: 0 };
  }
}
export const gpsQuality = new GpsQuality();

/** The app's state, the device and the settings; no position. W73 logsafe: the key is "device" in both modes, not "droid" (the rider sees it).
 *  W88 feedbackinfo: every setting, the course, the Log's numbers, storage, health, the GPS's accuracy and the errors; `env` is
 *  what the browser answers only asynchronously (storage used and free, the service worker). */
export function stateNow(app, env = {}) {
  const mm = (q) => !!globalThis.matchMedia?.(q).matches, conn = navigator.connection; // W88 feedbackinfo: conn
  const { router, silent, flights, course, packs, ...top } = app(); // W88 feedbackinfo
  return {
    under: screenNow().replace(/^Send feedback(, )?/, "") || "the chart", ...top,
    settings: settingsNow(), // W88 feedbackinfo: every one
    course: courseNow(course), rides: ridesNow(flights), // W88 feedbackinfo
    storage: { offlineChart: document.querySelector("#dl-row small.st")?.textContent.trim() || "unknown", packs: packs ? packsNow(packs) : "unknown", // W88 feedbackinfo
      starred: countOf("starchart.starred"), streets: streetsOf(), // W133 roadprefs: was avoided, a count
      recentPlaces: countOf("starchart.places"), ...env.storage },
    health: { router: router || "not loaded", voice: silent ? "silent" : "on", serviceWorker: env.sw || "unknown", // W88 feedbackinfo
      connection: conn ? { type: conn.type || "unknown", effective: conn.effectiveType || "unknown", saveData: !!conn.saveData } : "unknown" },
    gps: gpsQuality.now(), // W88 feedbackinfo
    errors: errors.slice(), failedFetches: { ...failedFetches }, // W88 feedbackinfo
    device: { kind: mm("(pointer: coarse)") ? "phone or tablet" : "computer", viewport: `${innerWidth} × ${innerHeight}`, dpr: Math.round((devicePixelRatio || 1) * 100) / 100,
      online: navigator.onLine, installed: mm("(display-mode: standalone)") },
    browser: navigator.userAgent,
  };
}

/**
 * Settings' row (after Install, W168 settings8) and the page (app/index.html's #feedback). `version()` is the version and its name;
 * `app()` is { flight, source, camera, lingo }, plain words. `config` is the form's config, a promise.
 */
export function mountFeedback({ $ = (id) => document.getElementById(id), version = () => "", app = () => ({}),
  config = fetch(new URL("feedback.json", import.meta.url)).then((r) => r.json()) } = {}) {
  const page = $("feedback"), settings = $("about-sheet"), msg = $("fb-msg"), send = $("fb-send"), attach = $("fb-attach"), pre = $("fb-pre");
  const who = $("fb-name"); // W128 small3: the optional name or contact, as the last send that had one left it
  if (who) try { who.value = localStorage.getItem(NAME) ?? ""; } catch { /* storage off */ }
  const row = Object.assign(document.createElement("button"), { className: "row unhide", id: "feedback-row" });
  row.innerHTML = `<i class="i i-feedback"></i><span class="txt">Send feedback<small></small></span><span class="val">›</span>`;
  $("install").after(row); // W168 settings8 (SPEC §295): App's second, after Install (was above About)
  let cfg = null, busy = false;

  const shown = () => {
    row.querySelector("small").textContent = cfg ? "" : "Not set up yet"; // W55 layers2: no line saying what feedback is
    why(row, cfg ? null : WORDS.unset);
    const n = busy ? 0 : read(QUEUE, []).length; // arclight 2026-10-23: while it goes, the bubble says so
    $("fb-status").textContent = n ? `${n === 1 ? "One message waits" : `${n} messages wait`} to go.` : "";
  };
  let env = {}; // W88 feedbackinfo: storage used and free, and the service worker's state, read as the page opens
  const refresh = async () => { // W88 feedbackinfo
    const sw = navigator.serviceWorker, [est, reg, keys] = await Promise.all([navigator.storage?.estimate?.().catch(() => null),
      sw?.getRegistration?.().catch(() => null), globalThis.caches?.keys().catch(() => []) ?? []]);
    env = { storage: est ? { usedMB: Math.round(est.usage / 1e6), quotaMB: Math.round(est.quota / 1e6) } : { usedMB: "unknown" },
      sw: reg ? { controlling: !!sw.controller, state: reg.active?.state || "none", waiting: !!reg.waiting, installing: !!reg.installing,
        shells: (keys || []).filter((k) => /^starchart-[0-9a-f]{16}$/.test(k)).map((k) => k.slice(10)) } : "none" };
    if (page.open) fold();
  };
  const state = () => attachment(stateNow(app, env), trailLog.text()); // W150 logtidy: no flight's log (the Log has no feedback link)
  const fold = () => { pre.textContent = attach.checked ? state() : pick(WORDS.nothing); $("fb-ver").textContent = version(); }; // W60 c: pick
  const count = () => { const n = msg.value.length, c = $("fb-count"); c.hidden = n < LIMITS.message * 0.9; c.textContent = `${n.toLocaleString("en-US")} / ${LIMITS.message.toLocaleString("en-US")}`; }; // minimal text: only near the end

  const post = (body) => fetch(cfg.action, { method: "POST", mode: "no-cors", credentials: "omit", referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: globalThis.AbortSignal?.timeout?.(LIMITS.postMs) }); // arclight 2026-10-23: a post that hangs gives up
  /** Sends the queue in order: true once it's empty, false when the form doesn't answer (it stays queued). One at a time:
   *  a Send while it runs joins it, and its loop picks the new message up (arclight 2026-10-23: no wait between sends). */
  let flushing = null;
  function flush() {
    if (!cfg || !navigator.onLine) return Promise.resolve(false);
    if (flushing) return flushing;
    busy = true;
    return (flushing = (async () => {
      await null; // its end clears `flushing` only after this assignment, even when the queue is empty (it once kept a settled promise, and every Send after said "Sent" with nothing posted)
      shown();
      try {
        for (let q = read(QUEUE, []); q.length; q = read(QUEUE, [])) {
          await post(q[0].body);
          write(QUEUE, read(QUEUE, []).slice(1));
        }
        return true;
      } catch { return false; /* still not answering: it stays queued */ } finally { busy = false; flushing = null; shown(); }
    })());
  }
  const enqueue = (bodies) => write(QUEUE, queued(read(QUEUE, []), bodies)); // W73 logsafe: a message's parts in one write, true when kept

  config.then((c) => { cfg = isSet(c) ? c : null; }).catch(() => { cfg = null; }).finally(() => {
    shown(); flush();
    if (cfg) $("ab-hosts")?.after(Object.assign(document.createElement("p"), { className: "note", id: "ab-feedback",
      textContent: `Feedback goes to ${new URL(cfg.action, location.href).host}, with no location.` })); // About lists every host it talks to; W133 settings4: concise
  });
  shown();
  addEventListener("online", flush);

  row.onclick = () => { refresh(); /* W88 feedbackinfo */ if (!msg.value) try { msg.value = localStorage.getItem(DRAFT) ?? ""; } catch { /* storage off */ } fold(); count(); shown(); showPage(page); /* W147 small6 (SPEC §264): the bar stays under it */ };
  page.addEventListener("restore", () => { refresh(); fold(); }); // W192 uitabs (SPEC §339): brought back by the Settings tab (app/main.js openSheet), the report of now
  $("fb-back").onclick = () => page.close();
  page.addEventListener("close", () => { keepDraft(); if (settings.open) row.focus(); });
  attach.onchange = fold;
  $("fb-what").addEventListener("toggle", fold);
  let draftT = 0;
  const keepDraft = () => { clearTimeout(draftT); try { if (msg.value) localStorage.setItem(DRAFT, msg.value); else localStorage.removeItem(DRAFT); } catch { /* storage off */ } };
  msg.addEventListener("input", () => { count(); clearTimeout(draftT); draftT = setTimeout(keepDraft, 400); });
  addEventListener("pagehide", keepDraft); // out of sight, at once: the app may not come back
  document.addEventListener("visibilitychange", () => { if (document.hidden) keepDraft(); });

  /** W160 smallui (SPEC §287), her note 27: "Instead of having a pop-up that says sending and then sent! in the feedback form, change
   *  the wording on the button itself": "Sending…" on the button, read out by the live region (tip.js say). W177 tabsfeedback (SPEC
   *  §313), her notes 12 and 13: "go from writing Sending... to again writing send with an empty box. The "sent" interval is
   *  unnecessary waiting time", and "display a "Sent!" Pop-up above the send button": Send at once, and Sent! in a status bubble. */
  const label = (words) => { send.textContent = words; if (words !== WORDS.send) speak(words); };
  send.onclick = async (e) => {
    e.preventDefault();
    if (!cfg) return tip(send, WORDS.unset);
    const message = msg.value.trim();
    if (!message) return busy ? speak(WORDS.sending) : tip(send, WORDS.empty); // arclight 2026-10-23: a second tap while it goes; W160 smallui: the button says it
    fold(); // what it shows is what goes
    const say = (words) => { label(WORDS.send); if (page.open) tip(send, words, words === WORDS.sent ? {} : { ms: 4000 }); else if (words === WORDS.sent) speak(words); }; // the page may have closed while it went; W177 tabsfeedback: Sent! a status bubble (its reading time, a tap anywhere fades it and still acts), as a failure is explained beside it
    const taken = () => { msg.value = ""; keepDraft(); count(); }; // queued: the box empties at once, and the draft goes
    if ($("fb-hp").value) { taken(); shown(); return say(WORDS.sent); } // the honeypot: a person never fills it
    const contact = who?.value.trim() || ""; // W128 small3
    const bodies = formBodies(cfg, { message, version: version(), state: attach.checked ? pre.textContent : "", contact }); // a long message, in parts; W128 small3: contact
    if (!enqueue(bodies)) return tip(send, pick(WORDS.full), { ms: 4000 }); // W73 logsafe: not queued, so the message stays in the box
    taken();
    try { if (contact) localStorage.setItem(NAME, contact); else localStorage.removeItem(NAME); } catch { /* storage off */ } // W128 small3: kept for next time, or forgotten by a send without one
    if (!navigator.onLine) { shown(); return say(WORDS.saved); } // W73 logsafe
    label(WORDS.sending); // arclight 2026-10-23: it goes now, with no wait; the outbox keeps it if the form never answers; W160 smallui: on the button
    say((await flush()) ? WORDS.sent : WORDS.failed);
  };
  return { get config() { return cfg; }, flush, state }; // W150 logtidy: no open(lines), the Log's link went
}
