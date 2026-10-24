// W97 voices (design/app-ui/SPEC.md §193): Settings › Sound › Voice. "My wife finds the current voice a bit annoying. Can you
// support more voices? … be sure the voices are nice." Lodestar, three warm and clear voices, and Burble, a silly one that
// babbles and keeps the key word ("… left!"). One row each, with a play button that says a typical line in that voice.
//
// A pick downloads only that voice's eager lines for the word mode (build.json `voices`, app/build.mjs), through the service
// worker, which keeps them (app/sw.js); its lazy lines come on first use, as Lodestar's. Nothing downloads until a pick, and a
// play fetches only its sample's few clips. A pick is the rider's own request, so it goes ahead on Data Saver too; a change of
// word mode fetches the picked voice's other set only on a connection that isn't careful (app/downloads.js), and otherwise
// each line comes when it is first said. Lodestar is precached, as before, and stays the default.
import { get, set } from "./settings.js"; // W97 voices
import { pick, onLingo, lingo } from "./lingo-mode.js"; // W97 voices
import { careful } from "./downloads.js"; // W97 voices
import { tip } from "./tip.js"; // W97 voices: ▶ with Sound off says so

export const KEY = "starchart.voice"; // W97 voices
/** The voices, in the picker's order (the first, the default); a value of starchart.voice and lines.json `files`'s key. */
export const VOICES = ["lodestar", "vega", "rigel", "mira", "burble"]; // W97 voices
/** The words, [SCUL, Plain] (W60 c's pick). Names are one word; `about` is two or three, beside the size. The row's (i) is
 *  app/index.html's data-more, the same in both modes. */
export const WORDS = { // W97 voices
  row: ["Voice", "Voice"],
  lodestar: ["Lodestar", "Classic"], vega: ["Vega", "Warm"], rigel: ["Rigel", "Calm"], mira: ["Mira", "Bright"], burble: ["Burble", "Silly"],
  about: {
    lodestar: ["Faintly robotic", "Crisp"], vega: ["Warm", "Friendly"], rigel: ["Calm", "Low"], mira: ["Bright", "British"],
    burble: ["Silly babble", "Babble"],
  },
  play: [(n) => `Play ${n}`, (n) => `Play ${n}`],
  stored: ["On this droid", "On this phone"],
  getting: [(pct) => `Getting… ${pct} %`, (pct) => `Getting… ${pct} %`],
  failed: ["Not all came in. Pick it again.", "Not all came in. Pick it again."],
  muted: ["Sound is off.", "Sound is off."],
  mb: (bytes) => `${Math.max(0.1, bytes / 1048576).toFixed(1)} MB`,
  sample: ["In a tenth of a light year, turn to port.", "In 500 feet, turn left."],
};
const mode = () => (lingo() === "meatspace" ? "meatspace" : "scul"); // W97 voices

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
    b.innerHTML = "<span class=\"n\"></span><small></small>";
    const play = Object.assign(document.createElement("button"), { type: "button", className: "play" });
    play.innerHTML = "<i class=\"i i-play\"></i>";
    row.append(b, play);
    group.append(row);
    return { v, row, b, play, state: "" };
  });
  const paint = async () => {
    group.setAttribute("aria-label", pick(...WORDS.row));
    const m = mode();
    for (const r of rows) {
      const name = pick(...WORDS[r.v]);
      r.b.querySelector(".n").textContent = name;
      r.play.setAttribute("aria-label", pick(...WORDS.play)(name));
      const tail = r.v === "lodestar" ? "" : r.state || (await stored(r.v, m, { build, url }) ? pick(...WORDS.stored) : WORDS.mb(voiceBytes(build, r.v, m)));
      r.b.querySelector("small").textContent = [pick(...WORDS.about[r.v]), tail].filter(Boolean).join(" · "); // Lodestar is always here: its words only
    }
  };
  const show = () => { const v = get(KEY); for (const r of rows) { r.b.setAttribute("aria-checked", String(r.v === v)); r.b.tabIndex = r.v === v ? 0 : -1; } };
  const download = async (v, m) => {
    const r = rows.find((x) => x.v === v);
    if (!r || v === "lodestar") return;
    const res = await fetchVoice(v, m, { build, url, progress: (d, n) => { r.state = pick(...WORDS.getting)(Math.round((100 * d) / n)); r.b.querySelector("small").textContent = `${pick(...WORDS.about[v])} · ${r.state}`; } });
    r.state = res.failed ? pick(...WORDS.failed) : "";
    paint();
  };
  const choose = (v) => {
    if (v !== get(KEY)) set(KEY, v);
    sfx.setVoiceTreatment(v);
    show();
    download(v, mode()); // the rider's own request: on Data Saver too
  };
  group.addEventListener("click", (e) => {
    const b = e.target.closest("button"), r = rows.find((x) => x.row.contains(b));
    if (!b || !r) return;
    if (b === r.play) { if (sfx.isSilentRunning()) tip(r.play, pick(...WORDS.muted)); else sfx.say(pick(...WORDS.sample), 0, { voice: r.v }); }
    else choose(r.v);
  });
  group.addEventListener("keydown", (e) => { // the arrow keys move the choice, as a radio group's do (settings.js's segs)
    const bs = rows.map((r) => r.b), at = bs.indexOf(e.target.closest("button"));
    const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: bs.length - 1 }[e.key];
    if (to === undefined || at < 0) return;
    e.preventDefault();
    const b = bs[(to + bs.length) % bs.length];
    choose(b.dataset.v); b.focus();
  });
  sfx.setVoiceTreatment(get(KEY));
  show(); paint();
  const v0 = get(KEY); // a pick that didn't all come in, or clips an update re-rendered: fetched again on a connection that isn't careful
  if (v0 !== "lodestar" && !careful(conn())) stored(v0, mode(), { build, url }).then((ok) => ok || download(v0, mode()));
  onLingo(() => { paint(); if (get(KEY) !== "lodestar" && !careful(conn())) download(get(KEY), mode()); });
  addEventListener("starchart:settings", (e) => { if (e.detail.key === KEY) { sfx.setVoiceTreatment(get(KEY)); show(); } });
  return { paint, choose };
}
