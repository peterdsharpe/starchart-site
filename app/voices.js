// W97 voices (design/app-ui/SPEC.md §193): Settings › Sound › Voice. "My wife finds the current voice a bit annoying. Can you
// support more voices? … be sure the voices are nice." Lodestar, three warm and clear voices, and Burble, a silly one that
// babbles and keeps the key word ("… left!"). One row each, with a play button that says a typical line in that voice.
// W129 critter (SPEC §241): Burble became Critter, the same small, quick voice saying every word (his note, 2026-10-24).
//
// A pick downloads only that voice's eager lines for the word mode (build.json `voices`, app/build.mjs), through the service
// worker, which keeps them (app/sw.js); its lazy lines come on first use, as Lodestar's. Nothing downloads until a pick, and a
// play fetches only its sample's few clips. A pick is the rider's own request, so it goes ahead on Data Saver too; a change of
// word mode fetches the picked voice's other set unless Data Saver is on (W114 voicefix: `ahead`, mobile data too), and
// otherwise each line comes when it is first said. Lodestar is precached, as before, and stays SCUL's default.
// W110 looks: Plain's default is Warm (Vega, af_sarah): a rider who never picked a voice hears Warm in Plain and Lodestar in
// SCUL. Its Plain set downloads ahead unless Data Saver is on (W114 voicefix: mobile data too, as the precache it replaces);
// a clip that fails, or isn't here within design/sound/sfx.js's PICK_WAIT, plays Lodestar's.
import { get, set } from "./settings.js"; // W97 voices; W190 settingsreg: get, whose default is the word mode's (voiceNow)
import { STORE } from "./keys.js"; // W190 settingsreg: the voices and the defaults
import { pick, onLingo, lingo } from "./lingo-mode.js"; // W97 voices
import { tip } from "./tip.js"; // W97 voices: ▶ with Sound off says so

export const KEY = "starchart.voice"; // W97 voices
/** The voices, a value of starchart.voice and lines.json `files`'s key. */
export const VOICES = STORE["starchart.voice"].values; // W190 settingsreg: app/keys.js's // W97 voices; W147 voices2: no Calm (Rigel, her note 2: "I would get rid of the low voice"; app/settings.js migrate); W129 critter: Burble became Critter (app/settings.js migrate); W110 looks: no Mira (her note, 2026-10-24: "the British voice is fun but it takes too long to say sentences"); a stored "mira" is no voice, so the mode's default
/** The words, [SCUL, Plain] (W60 c's pick). Names are one word, beside the size or state (W144 settings5: no descriptor, her
 *  note 3: "No need to add a description for voices. Just write the storage need of the voice next to the voice's name"). */
export const WORDS = { // W97 voices
  row: ["Voice", "Voice"],
  lodestar: ["Lodestar", "Robot"], vega: ["Vega", "Classic"], critter: ["Critter", "Critter"], // W129 critter: was Burble / Silly; W147 voices2: no Rigel / Calm; W177 voices3 (SPEC §316): Warm is Classic, the stored "vega" as before, and Robot says Lodestar's own clips
  play: [(n) => `Play ${n}`, (n) => `Play ${n}`],
  stored: ["On this droid", "On this phone"],
  getting: [(pct) => `Getting… ${pct} %`, (pct) => `Getting… ${pct} %`],
  failed: ["Not all came in. Pick it again.", "Not all came in. Pick it again."],
  muted: ["Sound is off.", "Sound is off."],
  mb: (bytes) => `${Math.max(0.1, bytes / 1048576).toFixed(1)} MB`,
  sample: ["In a tenth of a light year, turn to port.", "In 500 feet, turn left."],
};
const mode = () => (lingo() === "meatspace" ? "meatspace" : "scul"); // W97 voices
/** W110 looks: the voice a rider who never picked one hears, by word mode. */
export const ahead = (c) => !c?.saveData; // W114 voicefix: the voice in use is stored ahead on any connection but Data Saver, mobile data too, as the precache it stands in for is: a turn call must never wait on the network
export const DEFAULT = STORE["starchart.voice"].default; // W110 looks; W190 settingsreg: app/keys.js's, which app/settings.js get() gives
const picked = () => { try { return globalThis.localStorage?.getItem(KEY); } catch { return null; } }; // W110 looks: the stored pick, or null
/** W110 looks: the picker's order in word mode `m`: its default first (Plain: Classic, W177 voices3, was Warm; SCUL: Lodestar), then the rest. */
export const voiceOrder = (m = mode()) => [DEFAULT[m === "meatspace" ? "meatspace" : "scul"], ...VOICES.filter((v) => v !== DEFAULT[m === "meatspace" ? "meatspace" : "scul"])]; // W110 looks
/** W110 looks: the voice in use: the rider's pick, else the word mode's default. */
export const voiceNow = () => get(KEY); // W110 looks; W190 settingsreg: get() gives the mode's default

/** The files a pick of `v` downloads for `m` (none for Lodestar, which is precached), and their bytes. */
export const voiceFiles = (build, v, m) => build?.voices?.[v]?.[m === "meatspace" ? "meatspace" : "scul"] || []; // W97 voices
export const voiceBytes = (build, v, m) => build?.voices?.[v]?.bytes?.[m === "meatspace" ? "meatspace" : "scul"] || 0; // W97 voices

/**
 * Fetch `v`'s lines for `m` that this phone doesn't have yet, four at a time (the service worker keeps each, keyed by its
 * SHA-256, as app/calls.js warmVoice does). `progress(done, total)` after each. A newer call stops an older one. Resolves to
 * { got, failed, total }: failed counts the files that didn't come in (no signal stops the rest).
 */
let fetching = 0; // W97 voices
export async function fetchVoice(v, m, { build, url = (p) => p, get: fetchIt = (u) => fetch(u), store = globalThis.caches, progress = () => {}, at = 4 } = {}) {
  const id = ++fetching, files = voiceFiles(build, v, m);
  let got = 0, failed = 0, done = 0, next = 0, offline = false;
  const one = async () => { // `at` at a time: a few hundred small clips
    while (next < files.length && id === fetching && !offline) {
      const p = files[next++];
      const have = store && (await store.match(url(p)) || await store.match(url(`voice-cache/${build.files[p]}`)));
      if (!have) {
        try {
          const r = await fetchIt(url(p)), key = url(`voice-cache/${build.files[p]}`);
          if (!r.ok) failed++;
          else { got++; if (store?.open && !(await store.match(key))) await (await store.open("starchart-voice")).put(key, r); } // the worker's key; kept even before it controls the page
        } catch { offline = true; failed += files.length - done; break; } // no signal: the rest wait
      }
      progress(++done, files.length);
    }
  };
  await Promise.all(Array.from({ length: at }, one));
  return { got, failed: Math.min(failed, files.length - got), total: files.length };
}

/** Is all of `v`'s set for `m` on this phone? Lodestar always is. */
export async function stored(v, m, { build, url = (p) => p, store = globalThis.caches } = {}) { // W97 voices
  const files = voiceFiles(build, v, m);
  if (!files.length || !store) return !files.length;
  for (const p of files) if (!(await store.match(url(p)) || await store.match(url(`voice-cache/${build.files[p]}`)))) return false;
  return true;
}

/**
 * The picker into `group` (a radiogroup in Settings › Sound): a row per voice, a radio with its name and its size (or "On this
 * phone"), and a ▶ that says the sample line in that voice. `sfx` is design/sound/sfx.js; `build` is build.json; `url(p)` a
 * path's address in the app.
 */
export function mountVoices({ group, build, sfx, url = (p) => p, conn = () => globalThis.navigator?.connection }) { // W97 voices
  if (!group) return null;
  const rows = VOICES.filter((v) => v === "lodestar" || build?.voices?.[v]).map((v) => {
    const row = document.createElement("div");
    row.className = "voice"; row.dataset.v = v;
    const b = Object.assign(document.createElement("button"), { type: "button" });
    b.setAttribute("role", "radio"); b.dataset.v = v;
    b.innerHTML = "<span><span class=\"n\"></span><span class=\"sep\">&nbsp;·</span> <small></small></span>"; // W144 settings5: the size beside the name, wrapping as words do; the "·" stays with the name
    const play = Object.assign(document.createElement("button"), { type: "button", className: "play" });
    play.innerHTML = "<i class=\"i i-play\"></i>";
    row.append(b, play);
    group.append(row);
    return { v, row, b, play, state: "" };
  });
  const ordered = () => voiceOrder().map((v) => rows.find((r) => r.v === v)).filter(Boolean); // W110 looks: the mode's default first
  const paint = async () => {
    group.setAttribute("aria-label", pick(...WORDS.row));
    const m = mode();
    for (const r of ordered()) group.append(r.row); // W110 looks: in the mode's order, again at a change of Words
    for (const r of rows) {
      const name = pick(...WORDS[r.v]);
      r.b.querySelector(".n").textContent = name;
      r.play.setAttribute("aria-label", pick(...WORDS.play)(name));
      r.b.querySelector("small").textContent = r.state || (await stored(r.v, m, { build, url }) ? pick(...WORDS.stored) : WORDS.mb(voiceBytes(build, r.v, m))); // W177 voices3: no clipsOf // W144 settings5: its size or state only; Lodestar, precached, is always On this phone
    }
  };
  const show = () => { const v = voiceNow(); for (const r of rows) { r.b.setAttribute("aria-checked", String(r.v === v)); r.b.tabIndex = r.v === v ? 0 : -1; } }; // W110 looks: voiceNow, was get(KEY)
  const download = async (v, m) => {
    const r = rows.find((x) => x.v === v);
    if (!r || v === "lodestar") return; // W177 voices3: Plain's Robot is Lodestar's, precached
    const res = await fetchVoice(v, m, { build, url, progress: (d, n) => { r.state = pick(...WORDS.getting)(Math.round((100 * d) / n)); r.b.querySelector("small").textContent = r.state; } });
    r.state = res.failed ? pick(...WORDS.failed) : "";
    paint();
  };
  const choose = (v) => {
    if (v !== picked()) set(KEY, v); // W110 looks: a tap on the default is a pick too, so it stays in the other word mode
    sfx.setVoiceTreatment(v); // W177 voices3: no clipsOf
    show();
    download(v, mode()); // the rider's own request: on Data Saver too
  };
  group.addEventListener("click", (e) => {
    const b = e.target.closest("button"), r = rows.find((x) => x.row.contains(b));
    if (!b || !r) return;
    if (b === r.play) { if (sfx.isSilentRunning()) tip(r.play, pick(...WORDS.muted)); else sfx.say(pick(...WORDS.sample), 0, { voice: r.v, preview: true }); } // W147 voices2: the voice alone, one at a time; W177 voices3: no clipsOf
    else choose(r.v);
  });
  group.addEventListener("keydown", (e) => { // the arrow keys move the choice, as a radio group's do (settings.js's segs)
    const bs = ordered().map((r) => r.b), at = bs.indexOf(e.target.closest("button"));
    const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: bs.length - 1 }[e.key];
    if (to === undefined || at < 0) return;
    e.preventDefault();
    const b = bs[(to + bs.length) % bs.length];
    choose(b.dataset.v); b.focus();
  });
  sfx.setVoiceTreatment(voiceNow()); // W110 looks: voiceNow, was get(KEY); W177 voices3: no clipsOf
  show(); paint();
  const v0 = voiceNow(); // a pick that didn't all come in, or clips an update re-rendered: fetched again unless Data Saver is on (W114 voicefix: mobile data too); W110 looks: and Plain's default, Warm, the first time
  if (v0 !== "lodestar" && ahead(conn())) stored(v0, mode(), { build, url }).then((ok) => ok || download(v0, mode()));
  onLingo(() => { sfx.setVoiceTreatment(voiceNow()); show(); paint(); if (voiceNow() !== "lodestar" && ahead(conn())) download(voiceNow(), mode()); }); // W177 voices3: no clipsOf // W110 looks: the default follows the word mode
  addEventListener("starchart:settings", (e) => { if (e.detail.key === KEY) { sfx.setVoiceTreatment(voiceNow()); show(); } }); // W110 looks: voiceNow; W177 voices3: no clipsOf
  group.closest("dialog")?.addEventListener("close", () => sfx.hush?.()); // W147 voices2: leaving Settings stops a preview
  return { paint, choose };
}
