// Starchart sound effects: a procedural WebAudio library. No samples.
//
// One ship, one voice: every effect is in D dorian (D E F G A B C), built
// from the same five timbres (sonar ping, funk pluck, horn stab, swoop, and
// filtered-noise whoosh), and played through the same chain:
//
//   effect -> trim -> [space echo] -> high-pass 90 Hz -> low-pass 7.5 kHz
//          -> limiter -> -3 dB headroom -> master (silent running) -> out
//
// Usage:
//   import * as sfx from "./sfx.js";
//   sfx.play("pulsar_ahead");
//   window.dispatchEvent(new CustomEvent("starchart:event",
//     { detail: { kind: "system_enter", voice: "Now entering the Watertown System." } }));
//
// The same code renders the .ogg files offline (renderOffline), so what the
// lab plays live is what the phone plays from disk.

// ---- Pitch: D dorian ------------------------------------------------------
const MIDI = { D3: 50, E3: 52, F3: 53, G3: 55, A3: 57, B3: 59, C4: 60, D4: 62, E4: 64,
  F4: 65, G4: 67, A4: 69, B4: 71, C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, A5: 81,
  C6: 84, D6: 86, E6: 88, A6: 93 };
const hz = (n) => 440 * 2 ** (((typeof n === "number" ? n : MIDI[n]) - 69) / 12);
const S = 60 / 112 / 4; // one sixteenth at 112 bpm: the ship's groove
const db = (x) => 10 ** (x / 20);

// ---- Loudness trims (dB), measured by scripts/render_sfx.py ---------------
// BEGIN TRIM
const TRIM = {
  navi_away: 1.8,
  course_set: 13.2,
  reroute: 7.4,
  arrive: 0.3,
  pulsar_ahead: 17.9,
  pulsar_transit: 22.5,
  black_hole_approach: 5.3,
  black_hole_exit: 4.0,
  wormhole_enter: 2.8,
  wormhole_exit: 3.8,
  byway_enter: 6.1,
  system_enter: 4.7,
  quadrant_enter: 16.3,
  g_well_negi: 8.6,
  g_well_posi: 2.2,
  ly_milestone: 6.5,
  radiation_alert: 14.3,
  daystar_set: 3.0,
  hi_five: 19.2,
  cup_crush: 2.6,
  chalk_tag: 27.4,
  silent_running_on: -1.9,
  silent_running_off: -1.9,
  ui_tap: 24.7,
  ui_back: 5.5,
  plain_cue: 12.1, // W65 plainlook
  christening: 1.8,
  sticker_slap: 9.8,
};
// END TRIM

// ---- Deterministic noise, so renders are reproducible ---------------------
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0), r = rng(7);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

// ---- The ship's chain ------------------------------------------------------
function makeChain(ctx) {
  const input = ctx.createGain();
  const hp = new BiquadFilterNode(ctx, { type: "highpass", frequency: 90, Q: 0.7 });
  const warm = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 7500, Q: 0.5 });
  const limiter = new DynamicsCompressorNode(ctx, { threshold: -8, knee: 2, ratio: 20, attack: 0.002, release: 0.12 });
  const headroom = new GainNode(ctx, { gain: db(-3) });
  const master = new GainNode(ctx, { gain: 1 });
  input.connect(hp).connect(warm).connect(limiter).connect(headroom).connect(master).connect(ctx.destination);

  // Space echo: a dotted-eighth tape echo, darker on every repeat.
  const wet = ctx.createGain();
  const delay = new DelayNode(ctx, { delayTime: S * 3, maxDelayTime: 1 });
  const fb = new GainNode(ctx, { gain: 0.22 });
  const tone = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 2400, Q: 0.3 });
  const ret = new GainNode(ctx, { gain: 0.26 });
  wet.connect(delay).connect(tone).connect(fb).connect(delay);
  tone.connect(ret).connect(hp);

  // Voice lines skip the effects limiter (they are mastered already) but
  // still go through the master gain, so silent running mutes them too.
  const voice = new GainNode(ctx, { gain: 1 });
  voice.connect(master);
  return { input, wet, master, voice };
}

// ---- The five timbres ------------------------------------------------------
// Each takes v = { ctx, out, wet } and a start time t (seconds).

function envGain(v, t, a, peak, d, dest = v.out) {
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  g.connect(dest);
  return g;
}

function osc(v, type, f, t, end) {
  const o = new OscillatorNode(v.ctx, { type, frequency: f });
  o.start(t);
  o.stop(end + 0.05);
  return o;
}

// Sonar ping: sine with a soft octave, a tiny downward "pew", into the echo.
function ping(v, t, note, { dur = 0.45, gain = 0.4, wet = 0.5, bend = 0.6, att = 0.004 } = {}) {
  const f = hz(note);
  const g = envGain(v, t, att, gain, dur);
  if (wet) g.connect(new GainNode(v.ctx, { gain: wet })).connect(v.wet);
  const a = osc(v, "sine", f, t, t + dur);
  if (bend) {
    a.frequency.setValueAtTime(f * 2 ** (bend / 12), t);
    a.frequency.exponentialRampToValueAtTime(f, t + 0.05);
  }
  a.connect(g);
  const b = osc(v, "triangle", f * 2, t, t + dur);
  b.connect(new GainNode(v.ctx, { gain: 0.08 })).connect(g);
}

// Funk pluck: a clavinet-ish saw through a resonant, snapping low-pass.
function pluck(v, t, note, { dur = 0.22, gain = 0.32, bright = 2600, q = 6, wet = 0.2, type = "sawtooth" } = {}) {
  const f = hz(note);
  const g = envGain(v, t, 0.003, gain, dur);
  if (wet) g.connect(new GainNode(v.ctx, { gain: wet })).connect(v.wet);
  const lp = new BiquadFilterNode(v.ctx, { type: "lowpass", Q: q, frequency: bright });
  lp.frequency.setValueAtTime(bright, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.2, 200), t + dur * 0.7);
  lp.connect(g);
  osc(v, type, f, t, t + dur).connect(lp);
  const o2 = osc(v, "square", f, t, t + dur);
  o2.detune.value = -7;
  o2.connect(new GainNode(v.ctx, { gain: 0.35 })).connect(lp);
}

// Horn stab: three detuned saws per note, scooped up, with a brassy filter blat.
function horn(v, t, notes, { dur = 0.12, gain = 0.22, fall = 0, wet = 0.25, bright = 3000 } = {}) {
  const ctx = v.ctx, end = t + dur + 0.09;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.014);
  g.gain.setValueAtTime(gain, t + dur);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  g.connect(v.out);
  if (wet) g.connect(new GainNode(ctx, { gain: wet })).connect(v.wet);
  const lp = new BiquadFilterNode(ctx, { type: "lowpass", Q: 1.1, frequency: 500 });
  lp.frequency.setValueAtTime(500, t);
  lp.frequency.exponentialRampToValueAtTime(bright, t + 0.03);
  lp.frequency.exponentialRampToValueAtTime(bright * 0.4, end);
  lp.connect(g);
  for (const n of notes) {
    const f = hz(n);
    for (const det of [-9, 0, 8]) {
      const o = osc(v, "sawtooth", f, t, end);
      o.detune.setValueAtTime(det - 60, t);
      o.detune.linearRampToValueAtTime(det, t + 0.04);
      if (fall) {
        o.detune.setValueAtTime(det, t + dur);
        o.detune.linearRampToValueAtTime(det - fall * 100, end);
      }
      o.connect(new GainNode(ctx, { gain: 1 / (3 * notes.length) ** 0.5 / 1.6 })).connect(lp);
    }
  }
}

// Swoop: a gliding tone, optionally with vibrato.
function swoop(v, t, from, to, dur, { type = "sine", gain = 0.25, vib = 0, vibHz = 6, wet = 0.3, att = 0.03 } = {}) {
  const ctx = v.ctx;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + att);
  g.gain.setValueAtTime(gain, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(v.out);
  if (wet) g.connect(new GainNode(ctx, { gain: wet })).connect(v.wet);
  const o = osc(v, type, hz(from), t, t + dur);
  o.frequency.setValueAtTime(hz(from), t);
  o.frequency.exponentialRampToValueAtTime(hz(to), t + dur * 0.85);
  if (vib) {
    const l = osc(v, "sine", vibHz, t, t + dur);
    l.connect(new GainNode(ctx, { gain: vib * 100 })).connect(o.detune);
  }
  o.connect(g);
}

// Whoosh: band-passed noise sweeping between two frequencies.
function whoosh(v, t, dur, f0, f1, { gain = 0.25, q = 1.5, wet = 0.2, peakAt = 0.45 } = {}) {
  const ctx = v.ctx;
  const src = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx), loop: true });
  const bp = new BiquadFilterNode(ctx, { type: "bandpass", Q: q, frequency: f0 });
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * peakAt);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(v.out);
  if (wet) g.connect(new GainNode(ctx, { gain: wet })).connect(v.wet);
  src.start(t, (t * 0.37) % 1.5);
  src.stop(t + dur + 0.05);
}

// ---- Small helpers built from the timbres ---------------------------------

// A short noise burst: hand slaps, sticker thwaps, geiger clicks, crunches.
function burst(v, t, { dur = 0.04, gain = 0.4, f = 1800, q = 0.8, type = "bandpass" } = {}) {
  const ctx = v.ctx;
  const src = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx) });
  const bp = new BiquadFilterNode(ctx, { type, Q: q, frequency: f });
  const g = envGain(v, t, 0.002, gain, dur);
  src.connect(bp).connect(g);
  src.start(t, (t * 0.71 + f / 7919) % 1.5);
  src.stop(t + dur + 0.05);
}

// A soft low thump, felt more than heard (the high-pass keeps it polite).
function thump(v, t, { gain = 0.5, from = 220, to = 90, dur = 0.14 } = {}) {
  const g = envGain(v, t, 0.003, gain, dur);
  const o = osc(v, "sine", from, t, t + dur);
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  o.connect(g);
}

// Random clicks: geiger counters, cup crunches, fizz.
function crackle(v, t, dur, count, { seed = 1, gain = 0.3, f = 2500, q = 1.5 } = {}) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    burst(v, t + r() * dur, { dur: 0.006 + r() * 0.012, gain: gain * (0.5 + r() * 0.5), f: f * (0.7 + r() * 0.6), q });
  }
}

// Chalk on asphalt: rough, amplitude-chopped band noise.
function scratch(v, t, dur, { gain = 0.22, f0 = 2200, f1 = 3400 } = {}) {
  const ctx = v.ctx;
  const src = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx), loop: true });
  const bp = new BiquadFilterNode(ctx, { type: "bandpass", Q: 2.5, frequency: f0 });
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.linearRampToValueAtTime(f1, t + dur);
  const chop = new GainNode(ctx, { gain: 0.5 });
  const lfo = osc(v, "square", 23, t, t + dur);
  lfo.connect(new GainNode(ctx, { gain: 0.5 })).connect(chop.gain);
  const g = envGain(v, t, dur * 0.3, gain, dur * 0.7);
  src.connect(bp).connect(chop).connect(g);
  src.start(t, 0.3);
  src.stop(t + dur + 0.05);
}

// Black-hole swirl: two saws through a low-pass that an LFO spins round.
function swirl(v, t, note, dur, { gain = 0.28, rate0 = 3, rate1 = 7, lo = 260, hi = 1300, bend = -1 } = {}) {
  const ctx = v.ctx;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(v.out);
  g.connect(new GainNode(ctx, { gain: 0.25 })).connect(v.wet);
  const lp = new BiquadFilterNode(ctx, { type: "lowpass", Q: 5, frequency: (lo + hi) / 2 });
  lp.connect(g);
  const lfo = osc(v, "sine", rate0, t, t + dur);
  lfo.frequency.setValueAtTime(rate0, t);
  lfo.frequency.linearRampToValueAtTime(rate1, t + dur);
  lfo.connect(new GainNode(ctx, { gain: (hi - lo) / 2 })).connect(lp.frequency);
  for (const det of [-6, 6]) {
    const o = osc(v, "sawtooth", hz(note), t, t + dur);
    o.detune.setValueAtTime(det, t);
    o.detune.linearRampToValueAtTime(det + bend * 100, t + dur);
    o.connect(new GainNode(ctx, { gain: 0.5 })).connect(lp);
  }
}

// A warm pad: detuned saws swelling open (hyperspace byways, ceremonies).
function pad(v, t, notes, dur, { gain = 0.2, lo = 400, hi = 2600, att = 0.25 } = {}) {
  const ctx = v.ctx;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + att);
  g.gain.setValueAtTime(gain, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(v.out);
  g.connect(new GainNode(ctx, { gain: 0.3 })).connect(v.wet);
  const lp = new BiquadFilterNode(ctx, { type: "lowpass", Q: 2, frequency: lo });
  lp.frequency.setValueAtTime(lo, t);
  lp.frequency.exponentialRampToValueAtTime(hi, t + dur * 0.7);
  lp.connect(g);
  for (const n of notes) for (const det of [-11, 0, 10]) {
    const o = osc(v, "sawtooth", hz(n), t, t + dur);
    o.detune.value = det;
    o.connect(new GainNode(ctx, { gain: 0.6 / (3 * notes.length) ** 0.5 })).connect(lp);
  }
}

const sparkle = (v, t, notes, step = 0.06, gain = 0.12) =>
  notes.forEach((n, i) => ping(v, t + i * step, n, { dur: 0.25, gain, wet: 0.6, bend: 0 }));

// ---- The effects ------------------------------------------------------------
// dur: how long the effect sounds (the echo tail is trimmed to fit the brief:
// 1.2 s for effects, 3 s for ceremonies). voiceAt: when a voice line may start.

export const EFFECTS = {
  // Course and launch
  navi_away: { group: "Course", label: "Navi away (launch)", dur: 1.2, design: "Noise whoosh and a triangle swoop rise D4 to A5, then a Dm horn stab: lift-off.",
    play(v, t) {
      whoosh(v, t, 0.75, 250, 3200, { gain: 0.22, peakAt: 0.8 });
      swoop(v, t, "D4", "A5", 0.7, { type: "triangle", gain: 0.2, vib: 0.15, att: 0.08 });
      horn(v, t + 0.62, ["D4", "F4", "A4"], { dur: 0.1, gain: 0.24 });
      ping(v, t + 0.62 + S, "D6", { dur: 0.3, gain: 0.1 });
    } },
  course_set: { group: "Course", label: "Course set", dur: 0.7, design: "Two sonar pings up a fourth, A4 to D5, over a soft D pluck: locked in.",
    play(v, t) {
      pluck(v, t, "D4", { dur: 0.2, gain: 0.16, bright: 1400 });
      ping(v, t, "A4", { dur: 0.32, gain: 0.32 });
      ping(v, t + S * 2, "D5", { dur: 0.45, gain: 0.34 });
    } },
  reroute: { group: "Course", label: "Course corrected", dur: 0.7, design: "A quick F5-to-D5 chirp, then D5 and a quiet A5: recalculated, no fuss.",
    play(v, t) {
      swoop(v, t, "F5", "D5", 0.12, { gain: 0.16, att: 0.01, wet: 0.1 });
      ping(v, t + 0.14, "D5", { dur: 0.3, gain: 0.3 });
      ping(v, t + 0.14 + S * 1.5, "A5", { dur: 0.35, gain: 0.16 });
    } },
  arrive: { group: "Course", label: "Touchdown", dur: 1.2, design: "A swoop and whoosh fall to a soft thump, then an open D chord rings out.",
    play(v, t) {
      swoop(v, t, "D5", "D4", 0.42, { gain: 0.2, att: 0.02 });
      whoosh(v, t, 0.45, 2600, 400, { gain: 0.15, peakAt: 0.3 });
      thump(v, t + 0.42, { gain: 0.28, from: 260, to: 120 });
      for (const [n, g] of [["D4", 0.1], ["A4", 0.2], ["D5", 0.22], ["F5", 0.12], ["A5", 0.06]]) ping(v, t + 0.44, n, { dur: 0.7, gain: g, bend: 0, wet: 0.35 });
    } },

  // Chart features
  pulsar_ahead: { group: "Chart", label: "Pulsar ahead", dur: 0.7, design: "Two gold A5 blips a dotted sixteenth apart over a low D: a light, beating.",
    play(v, t) {
      pluck(v, t, "D4", { dur: 0.18, gain: 0.14, bright: 1200 });
      ping(v, t, "A5", { dur: 0.18, gain: 0.26, wet: 0.3 });
      ping(v, t + S * 1.5, "A5", { dur: 0.35, gain: 0.26 });
    } },
  pulsar_transit: { group: "Chart", label: "Pulsar transit", dur: 0.45, design: "One bright D6 ping with a tiny A6 glint: through the light.",
    play(v, t) {
      ping(v, t, "D6", { dur: 0.28, gain: 0.2, bend: 2, wet: 0.35 });
      ping(v, t + 0.05, "A6", { dur: 0.15, gain: 0.05, bend: 0, wet: 0.5 });
    } },
  black_hole_approach: { group: "Chart", label: "Black hole ahead", dur: 1.2, design: "An A3 swirl whose filter spins faster as it sinks a semitone, under a D5 sonar ping.",
    play(v, t) {
      ping(v, t, "D5", { dur: 0.6, gain: 0.22, bend: 1 });
      swirl(v, t, "A3", 1.15, { gain: 0.3, rate0: 2.5, rate1: 8, lo: 500, hi: 2400 });
      swoop(v, t + 0.2, "F4", "D4", 0.9, { gain: 0.08, vib: 0.2 });
    } },
  black_hole_exit: { group: "Chart", label: "Black hole exit", dur: 0.9, design: "The swirl slows and lets go, a swoop pops up A4 to A5, an A5 ping: free.",
    play(v, t) {
      swirl(v, t, "D3", 0.5, { gain: 0.22, rate0: 8, rate1: 2, bend: 0, lo: 450, hi: 2100 });
      swoop(v, t + 0.28, "A4", "A5", 0.3, { type: "triangle", gain: 0.2, att: 0.02 });
      ping(v, t + 0.58, "A5", { dur: 0.3, gain: 0.2 });
    } },
  wormhole_enter: { group: "Chart", label: "Wormhole enter", dur: 1.1, design: "Cyan whoosh up to 5 kHz, a vibrato swoop A4 to D6, two sparkles: into the tube.",
    play(v, t) {
      whoosh(v, t, 0.8, 400, 5000, { gain: 0.2, q: 2.5, peakAt: 0.6 });
      swoop(v, t, "A4", "D6", 0.7, { type: "triangle", gain: 0.18, vib: 0.25, vibHz: 7 });
      sparkle(v, t + 0.62, ["A5", "D6"], S * 0.75, 0.13);
    } },
  wormhole_exit: { group: "Chart", label: "Wormhole exit", dur: 0.9, design: "The same whoosh and swoop in reverse, settling on a soft D5.",
    play(v, t) {
      whoosh(v, t, 0.55, 4500, 500, { gain: 0.18, q: 2.5, peakAt: 0.3 });
      swoop(v, t, "D5", "A4", 0.45, { type: "triangle", gain: 0.18, vib: 0.2, vibHz: 7 });
      ping(v, t + 0.48, "D5", { dur: 0.35, gain: 0.22 });
    } },
  byway_enter: { group: "Chart", label: "Hyperspace byway", dur: 1.0, design: "A D-A-D pad swells open like a jump to hyperspace, with an A5 ping on top.",
    play(v, t) {
      pad(v, t, ["D4", "A4", "D5"], 0.95, { gain: 0.2 });
      whoosh(v, t, 0.9, 800, 3000, { gain: 0.06, q: 0.8, peakAt: 0.7 });
      ping(v, t + 0.38, "A5", { dur: 0.4, gain: 0.16 });
    } },

  // Regions
  system_enter: { group: "Regions", label: "Entering a system", dur: 1.2, design: "A small funk fanfare: two C-major stabs resolve to a long Dm7, sparkle on top.",
    play(v, t) {
      horn(v, t, ["C4", "E4", "G4"], { dur: 0.07, gain: 0.2 });
      horn(v, t + S, ["C4", "E4", "G4"], { dur: 0.07, gain: 0.2 });
      horn(v, t + S * 3, ["D4", "F4", "A4", "C5"], { dur: 0.42, gain: 0.25, bright: 2600 });
      pluck(v, t + S * 3, "D3", { dur: 0.3, gain: 0.2, bright: 900 });
      sparkle(v, t + S * 3 + 0.12, ["A5", "D6"], S, 0.1);
    } },
  quadrant_enter: { group: "Regions", label: "Entering a quadrant", dur: 0.6, design: "The fanfare's little sibling: a funk pluck A4 to D5 with a ping.",
    play(v, t) {
      pluck(v, t, "A4", { dur: 0.2, gain: 0.26, bright: 2000, q: 4 });
      pluck(v, t + S, "D5", { dur: 0.4, gain: 0.26, bright: 2000, q: 4 });
      ping(v, t + S, "D5", { dur: 0.4, gain: 0.16, bend: 0 });
    } },

  // G-wells
  g_well_negi: { group: "G-wells", label: "Negi g-well (uphill)", dur: 0.85, design: "Three plucks climb D5, F5, A5, each a little later than the last, over a straining glide: ▲ uphill, effort.",
    play(v, t) {
      pluck(v, t, "D5", { dur: 0.24, gain: 0.24, bright: 3000, q: 4 });
      pluck(v, t + 0.19, "F5", { dur: 0.26, gain: 0.24, bright: 3000, q: 4 });
      pluck(v, t + 0.44, "A5", { dur: 0.4, gain: 0.26, bright: 3400, q: 4 });
      swoop(v, t, "D5", "A5", 0.7, { type: "triangle", gain: 0.07, att: 0.2, wet: 0 });
      thump(v, t + 0.44, { gain: 0.2, from: 160, to: 110 });
    } },
  g_well_posi: { group: "G-wells", label: "Posi g-well (downhill)", dur: 0.85, design: "A wobbly slide-whistle falls A5 to D5, landing on a pluck: ▼ wheee.",
    play(v, t) {
      swoop(v, t, "A5", "D5", 0.55, { type: "triangle", gain: 0.2, vib: 0.4, vibHz: 6.5, att: 0.04 });
      pluck(v, t + 0.55, "D4", { dur: 0.25, gain: 0.22 });
      ping(v, t + 0.55, "D5", { dur: 0.3, gain: 0.12, bend: 0 });
    } },

  // Milestones and alerts
  ly_milestone: { group: "Milestones", label: "Light-year milestone", dur: 0.9, design: "The funk horn stab: bap, bap, BAAAH on Fmaj7 to G7 with a fall-off.",
    play(v, t) {
      horn(v, t, ["F4", "A4", "C5", "E5"], { dur: 0.06, gain: 0.22 });
      horn(v, t + S, ["F4", "A4", "C5", "E5"], { dur: 0.06, gain: 0.22 });
      horn(v, t + S * 3, ["G4", "B4", "D5", "F5"], { dur: 0.3, gain: 0.26, fall: 2, bright: 3200 });
      pluck(v, t + S * 3, "G3", { dur: 0.3, gain: 0.22, bright: 1000 });
    } },
  radiation_alert: { group: "Milestones", label: "Radiation alert", dur: 1.0, design: "A little geiger crackle, then two polite A5 square beeps and an F5: lime caution.",
    play(v, t) {
      crackle(v, t, 0.32, 9, { seed: 3, gain: 0.32, f: 3000 });
      pluck(v, t + 0.38, "A5", { dur: 0.12, gain: 0.22, type: "square", bright: 2800, q: 1.5 });
      pluck(v, t + 0.38 + S * 1.5, "A5", { dur: 0.12, gain: 0.22, type: "square", bright: 2800, q: 1.5 });
      pluck(v, t + 0.38 + S * 3, "F5", { dur: 0.3, gain: 0.22, type: "square", bright: 2600, q: 1.5 });
    } },
  daystar_set: { group: "Milestones", label: "Daystar has set", dur: 1.2, design: "A slow, warm arpeggio sinks A5, F5, D5, A4: sundown, lasers on.",
    play(v, t) {
      ["A5", "F5", "D5", "A4"].forEach((n, i) => ping(v, t + i * S * 1.5, n, { dur: 0.6, gain: 0.2 + i * 0.03, bend: 0, att: 0.02 }));
    } },

  // Tallies
  hi_five: { group: "Tallies", label: "Hi-five", dur: 0.45, design: "A palm slap (two noise bursts) and a bright D5-A5 ding.",
    play(v, t) {
      burst(v, t, { dur: 0.035, gain: 0.5, f: 1500, q: 0.7 });
      burst(v, t + 0.008, { dur: 0.05, gain: 0.25, f: 3500, q: 1 });
      ping(v, t + 0.03, "D5", { dur: 0.15, gain: 0.18, wet: 0.2 });
      ping(v, t + 0.03 + S * 0.75, "A5", { dur: 0.3, gain: 0.22 });
    } },
  cup_crush: { group: "Tallies", label: "Cup crush", dur: 0.55, design: "A crunchy crackle and thump, then a satisfied A5-to-D5 bloop. It made a cool sound.",
    play(v, t) {
      thump(v, t, { gain: 0.35, from: 260, to: 110, dur: 0.1 });
      crackle(v, t, 0.18, 22, { seed: 11, gain: 0.36, f: 1800, q: 0.9 });
      swoop(v, t + 0.22, "A5", "D5", 0.22, { gain: 0.2, att: 0.01, wet: 0.35 });
    } },
  chalk_tag: { group: "Tallies", label: "Chalk tag", dur: 0.6, design: "Two chalk scritches on asphalt and a tiny D6 ping: tagged.",
    play(v, t) {
      scratch(v, t, 0.16, { gain: 0.24 });
      scratch(v, t + 0.22, 0.16, { gain: 0.24, f0: 2600, f1: 3800 });
      ping(v, t + 0.42, "D6", { dur: 0.2, gain: 0.12 });
    } },

  // UI
  silent_running_on: { group: "UI", label: "Silent running on", dur: 0.45, design: "A hushed D5-to-A4 glide that closes like a door.",
    play(v, t) {
      swoop(v, t, "D5", "A4", 0.32, { gain: 0.18, att: 0.02, wet: 0 });
      whoosh(v, t, 0.3, 3000, 600, { gain: 0.05, wet: 0 });
    } },
  silent_running_off: { group: "UI", label: "Silent running off", dur: 0.45, design: "The same glide back up, A4 to D5.",
    play(v, t) {
      swoop(v, t, "A4", "D5", 0.32, { gain: 0.18, att: 0.02, wet: 0.2 });
      whoosh(v, t, 0.3, 600, 3000, { gain: 0.05, wet: 0 });
    } },
  ui_tap: { group: "UI", label: "Tap", dur: 0.08, design: "A 50 ms D6 blip.",
    play(v, t) { ping(v, t, "D6", { dur: 0.05, gain: 0.16, wet: 0, bend: 0.3, att: 0.002 }); } },
  ui_back: { group: "UI", label: "Back", dur: 0.12, design: "A D6-to-A5 drop, 90 ms.",
    play(v, t) {
      swoop(v, t, "D6", "A5", 0.09, { gain: 0.15, att: 0.004, wet: 0 });
    } },
  plain_cue: { group: "UI", label: "Heads-up (Plain)", dur: 0.26, design: "Two soft dry sines, A5 then D6: Plain's heads-up before a line, in place of the radio chirp and squelch.", // W65 plainlook
    play(v, t) {
      ping(v, t, "A5", { dur: 0.16, gain: 0.12, wet: 0, bend: 0, att: 0.01 });
      ping(v, t + 0.09, "D6", { dur: 0.17, gain: 0.1, wet: 0, bend: 0, att: 0.01 });
    } },

  // Ceremonies
  christening: { group: "Ceremonies", label: "Christening", dur: 2.8, ceremony: true, design: "A PBR fizz of tiny pings, a rising swoop, then the full fanfare to Dm9 with a sparkle run.",
    play(v, t) {
      burst(v, t, { dur: 0.08, gain: 0.25, f: 4000, q: 0.6 });
      crackle(v, t + 0.02, 0.55, 30, { seed: 21, gain: 0.16, f: 5000, q: 2 });
      const r = rng(5);
      for (let i = 0; i < 9; i++) ping(v, t + 0.05 + r() * 0.5, ["A5", "D6", "E6", "C6"][i % 4], { dur: 0.08, gain: 0.05, wet: 0.3, bend: 3 });
      swoop(v, t + 0.45, "D4", "D5", 0.45, { type: "triangle", gain: 0.18, vib: 0.2 });
      const t1 = t + 0.95;
      horn(v, t1, ["C4", "E4", "G4"], { dur: 0.07, gain: 0.22 });
      horn(v, t1 + S, ["C4", "E4", "G4"], { dur: 0.07, gain: 0.22 });
      horn(v, t1 + S * 3, ["D4", "F4", "A4", "C5", "E5"], { dur: 0.9, gain: 0.26, bright: 2400 });
      pad(v, t1 + S * 3, ["D3", "A3", "D4"], 1.4, { gain: 0.12, att: 0.1 });
      pluck(v, t1 + S * 3, "D3", { dur: 0.4, gain: 0.24, bright: 900 });
      sparkle(v, t1 + S * 3 + 0.15, ["D5", "F5", "A5", "C6", "D6"], S * 0.75, 0.1);
    } },
  sticker_slap: { group: "Ceremonies", label: "Sticker slap (achievement)", dur: 1.0, ceremony: true, design: "A sticker thwaps down (noise slap and thump), then a D5-A5 chime and two sparkles.",
    play(v, t) {
      burst(v, t, { dur: 0.06, gain: 0.5, f: 900, q: 0.6 });
      burst(v, t + 0.005, { dur: 0.03, gain: 0.25, f: 4000, q: 1 });
      thump(v, t, { gain: 0.4, from: 200, to: 100, dur: 0.1 });
      ping(v, t + 0.09, "D5", { dur: 0.6, gain: 0.22, bend: 0 });
      ping(v, t + 0.09, "A5", { dur: 0.6, gain: 0.18, bend: 0 });
      sparkle(v, t + 0.3, ["D6", "A6"], S, 0.08);
    } },
};

export const KEY = "D dorian (D E F G A B C), 112 bpm";
export const NAMES = Object.keys(EFFECTS);

// Longest a rendered file may be: the brief's 1.2 s, or 3 s for a ceremony.
export const maxLength = (name) => (EFFECTS[name].ceremony ? 3.0 : 1.2);

function schedule(ctx, chain, name, t) {
  const fx = EFFECTS[name];
  const out = new GainNode(ctx, { gain: db(TRIM[name] ?? 0) });
  out.connect(chain.input);
  const wet = new GainNode(ctx, { gain: 1 });
  wet.connect(chain.wet);
  // Trims scale the dry and the echo send together.
  wet.gain.value = out.gain.value;
  fx.play({ ctx, out, wet }, t);
}

// ---- Live playback ------------------------------------------------------------
let ctx = null, chain = null, silent = false;
let voiceTreatment = "lodestar";

// W73 ios: on iOS, Web Audio is "ambient" by default, which the Ring/Silent switch mutes. "playback" lets Sound decide;
// with Sound off it goes back to the default, so a silent Starchart leaves the rider's music alone (SPEC §115).
const session = () => { if (typeof navigator !== "undefined" && navigator.audioSession) navigator.audioSession.type = silent ? "auto" : "playback"; };

function live() {
  if (!ctx) {
    session(); // W73 ios
    ctx = new AudioContext({ latencyHint: "interactive" });
    chain = makeChain(ctx);
    chain.master.gain.value = silent ? 0 : 1;
  }
  if (ctx.state === "suspended" || ctx.state === "interrupted") ctx.resume().catch(() => {}); // W73 ios: iOS's "interrupted" (a call, Siri, another app's audio)
  return ctx;
}

// Before the first gesture the context is suspended, and anything scheduled
// would pile up and play all at once on the first tap. Drop it instead.
const canPlay = (c) => c.state === "running" || !!(navigator.userActivation && navigator.userActivation.isActive);

// Browsers start audio only after a gesture; wake up on the first one. W73 ios: and on every one after it, and when the
// page comes back into sight or focus, since an interruption can stop the context at any time.
if (typeof window !== "undefined") {
  const wake = () => { if (!ctx || ctx.state !== "running") live(); }; // W73 ios
  const back = () => { if (ctx && document.visibilityState !== "hidden") live(); }; // W73 ios: never makes the context
  window.addEventListener("pointerdown", wake);
  window.addEventListener("keydown", wake);
  document.addEventListener("visibilitychange", back); // W73 ios
  window.addEventListener("focus", back); // W73 ios
}

// W65 plainlook: Plain's sounds (app/lingo-mode.js, design/app-ui/SPEC.md §93). An ordinary bike map makes the course's own
// quiet sounds and nothing else: no space whooshes, swirls, fanfares or horn stabs. Its lines start with a soft heads-up
// (plain_cue) in place of the radio chirp before and the squelch after. The audio lab and the prototype stay SCUL's.
let plainSound = false;
export function setPlainSound(on) { plainSound = !!on; }
export const isPlainSound = () => plainSound;
const PLAIN_KEEP = new Set(["course_set", "reroute", "arrive", "silent_running_on", "silent_running_off", "ui_tap", "ui_back", "plain_cue"]);
/** The effect Plain plays for `name`, or null for none: the start is the course's "locked in", not a lift-off. */
export const plainEffect = (name) => (name === "navi_away" ? "course_set" : PLAIN_KEEP.has(name) ? name : null);

/** Play an effect now (or `when` seconds from now). Unknown names are ignored. W65 plainlook: in Plain, plainEffect's. */
export function play(name, when = 0) {
  if (plainSound) name = plainEffect(name); // W65 plainlook
  if (!EFFECTS[name]) return 0;
  const c = live();
  if (!canPlay(c)) return 0;
  schedule(c, chain, name, c.currentTime + 0.01 + when);
  return EFFECTS[name].dur;
}

/**
 * Silent running: mute everything at once (a 10 ms ramp avoids a click).
 * By default a whisper-quiet cue confirms the switch: "silent_running_on"
 * plays on its own path after the mute, "silent_running_off" after the unmute.
 */
let cueChain = null;
export function setSilentRunning(on, { cue = true } = {}) {
  silent = !!on;
  if (ctx) session(); // W73 ios
  if (!ctx && !cue) return;
  const c = live();
  const g = chain.master.gain, t = c.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(silent ? 0 : 1, t + 0.01);
  if (silent) for (const a of playingVoices) try { a.stop(); } catch {}
  if (cue) {
    cueChain ||= makeChain(c);
    schedule(c, silent ? cueChain : chain, silent ? "silent_running_on" : "silent_running_off", t + 0.02);
  }
}
export const isSilentRunning = () => silent;

// ---- Voice lines ----------------------------------------------------------------
const base = new URL(".", import.meta.url);
let linesPromise = null;
const voiceBuffers = new Map();
const playingVoices = new Set();
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** lines.json's lines by normalised text and by id. */
export function lineIndex(lines) {
  const index = new Map();
  for (const [text, line] of Object.entries(lines)) {
    index.set(norm(text), line);
    index.set(line.id, line);
  }
  return index;
}

/** voice/lines.json, indexed by normalised text and by id. */
export function voiceLines() {
  if (!linesPromise) {
    linesPromise = fetch(new URL("voice/lines.json", base)).then((r) => r.json()).then((j) => ({ ...j, index: lineIndex(j.lines) }))
      .catch(() => ({ lines: {}, index: new Map() }));
  }
  return linesPromise;
}

export function setVoiceTreatment(name) { voiceTreatment = name; }
export const getVoiceTreatment = () => voiceTreatment;

/** How long, in ms, a lazy line (lines.json `lazy`: a colour line or a non-canonical variant, not precached) may
 *  take to load before it is given up for this time; it keeps loading, so it is ready the next time. */
export const LAZY_WAIT = 1500;
const loading = new Map(); // file -> the promise of its decoded buffer

/**
 * The buffer to play for a line, or null. A lazy line gets `wait` ms; if it misses, a variant plays its
 * canonical line instead and a colour line plays nothing. A line that is not lazy waits as long as it takes, unless it is a picked
 * voice's clip: W114 voicefix, after `pickWait` ms Lodestar's plays, and the clip keeps loading for next time.
 * `load(file)` fetches and decodes; each file is loaded once, and a failed load may be tried again later.
 * W97 voices: a picked voice's clip that fails to load (not on this phone, and no signal) plays Lodestar's, which is precached.
 */
export const PICK_WAIT = 400; // W114 voicefix: how long a picked voice's turn clip may keep a line waiting before Lodestar's (precached) plays
export async function voiceBuffer(line, { index, load, file = (l) => l.files[voiceTreatment] || Object.values(l.files)[0],
  wait = LAZY_WAIT, pickWait = PICK_WAIT, cache = voiceBuffers, pending = loading } = {}) {
  const get = async (l) => {
    const f = l && file(l), lode = l?.files?.lodestar;
    return f ? (await one(f)) || (lode && lode !== f ? one(lode) : null) : null; // W97 voices
  };
  const one = (f) => {
    if (cache.has(f)) return Promise.resolve(cache.get(f));
    if (!pending.has(f)) {
      pending.set(f, Promise.resolve().then(() => load(f)).then((b) => { cache.set(f, b); pending.delete(f); return b; },
        () => { pending.delete(f); return null; }));
    }
    return pending.get(f);
  };
  if (!line) return null;
  if (!line.lazy) { // W114 voicefix: a picked voice's clip not here within pickWait plays Lodestar's at once, and keeps loading for next time
    const f = file(line), lode = line.files?.lodestar;
    if (!f || !lode || f === lode || cache.has(f)) return get(line);
    const LATE = {};
    let late;
    const buf = await Promise.race([get(line), new Promise((r) => { late = setTimeout(() => r(LATE), pickWait); })]);
    clearTimeout(late);
    return buf === LATE ? one(lode) : buf;
  }
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => r(null), wait); });
  const buf = await Promise.race([get(line), late]);
  clearTimeout(timer);
  if (buf) return buf;
  const twin = line.canonical && (index.get(line.canonical) || index.get(norm(line.canonical)));
  return twin ? voiceBuffer(twin, { index, load, file, wait, pickWait, cache, pending }) : null; // W177 voices3: the canonical in its own time (W114), as an all-way stop's miss plays the stop sign's
}

/**
 * W31 navvoice: a line said by joining the turn clips (lines.json `part`), as [line, gap after it in s], or null. The line is
 * cut into phrases at its commas and full stops, and each run of phrases is the longest that is a clip: "In a tenth of a
 * light year, turn to port, then starboard." -> "In a tenth of a light year," "turn to port." "Then starboard.". The cues
 * (`cue`: "pre", "post") go round the whole. Null when a phrase has no clip.
 */
export const JOIN_GAP = { ",": 0.06, ".": 0.18 };
const cueCache = new WeakMap(); // W126: an index's cue lines ("pre", "post"), the first of each in its order, as the scan found them
const cuesOf = (index) => {
  let c = cueCache.get(index);
  if (!c) { c = {}; for (const l of index.values()) if (l.cue && !(l.cue in c)) c[l.cue] = l; cueCache.set(index, c); }
  return c;
};
export function clipsFor(text, index) {
  const ph = String(text).split(/(?<=[,.])\s+/).filter(Boolean), out = [];
  for (let i = 0; i < ph.length;) {
    let j = ph.length, line = null;
    for (; j > i; j--) if ((line = index.get(norm(ph.slice(i, j).join(" "))))?.part) break;
    if (j === i && ph[i].includes("all-way stop")) { ph[i] = ph[i].replace("all-way stop", "stop sign"); continue; } // W177 mapmarks2 (SPEC §314): a voice without the all-way stop's clip says the stop sign's
    if (j === i) return null;
    out.push([line, JOIN_GAP[ph[j - 1].trim().slice(-1)] ?? JOIN_GAP[","]]);
    i = j;
  }
  const cue = (w) => cuesOf(index)[w]; // W126: found once per index, not by a scan of every line on each call
  if (!out.length || !cue("pre") || !cue("post")) return null;
  out.at(-1)[1] = 0;
  return [[cue("pre"), 0], ...out, [cue("post"), 0]];
}

/** W106 voicefix: fetch a line's lazy clips in the voice picked, so a line that comes over the network (a winter warning,
 *  app/weather.js) is in the voice cache (app/sw.js) before it is said, and offline after. */
export async function warm(text) {
  const { index } = await voiceLines(), line = index.get(norm(text));
  for (const [l] of (!line || line.part ? clipsFor(text, index) : [[line, 0]]) || [])
    if (l.lazy) fetch(new URL("voice/" + (l.files[voiceTreatment] || l.files.lodestar), base)).then((r) => r.arrayBuffer()).catch(() => {});
}

/** W147 voices2: the picker's preview (say's `preview`) playing, and its count: a newer one, or hush(), quiets an older one
 *  still loading. */
const previews = new Set();
let previewSeq = 0;
/** W147 voices2: stop the preview playing (leaving Settings), and keep one still loading quiet. */
export function hush() { previewSeq++; for (const a of previews) try { a.stop(); } catch {} previews.clear(); }

/** Play a pre-rendered voice line by its text or id. Resolves to its length, or 0 if there is none, or if
 *  `alive()` says the voice queue has moved on while it loaded. W31 navvoice: a line with no file of its own is joined from
 *  the turn clips (clipsFor), back to back. W147 voices2: `preview`, the picker's ▶: the voice alone (no cue, no Plain
 *  heads-up), and it stops the preview before it, so two never overlap. */
export async function say(textOrId, when = 0, { alive = () => true, voice = null, preview = false } = {}) { // W97 voices: `voice`, another voice's clips (the picker's ▶)
  const mine = preview ? (hush(), previewSeq) : 0; // W147 voices2
  if (silent) return 0;
  const { index } = await voiceLines();
  const line = index.get(textOrId) || index.get(norm(textOrId));
  const c = live();
  let clips = !line || line.part ? clipsFor(textOrId, index) : [[line, 0]];
  if (!clips || !canPlay(c)) return 0;
  const cued = !preview && plainSound && clips[0][0].cue === "pre"; // W65 plainlook: Plain's heads-up for the chirp and the squelch; W147 voices2: none in a preview
  if (cued || preview) clips = clips.filter(([l]) => !l.cue); // W65 plainlook; W147 voices2: a preview is the voice alone
  const load = (f) => fetch(new URL("voice/" + f, base)).then((r) => { if (!r.ok) throw new Error(f); return r.arrayBuffer(); })
    .then((d) => c.decodeAudioData(d));
  const file = voice ? (l) => l.files[voice] || Object.values(l.files)[0] : undefined; // W97 voices
  const eager = clips.some(([l]) => l.part && !l.lazy); // W157 landmarks: a lazy part joined to the turn (a landmark) holds it up PICK_WAIT at most, as a picked voice's clip does
  let bufs = await Promise.all(clips.map(([l]) => voiceBuffer(l, { index, load, file, ...(eager && l.part && l.lazy ? { wait: PICK_WAIT } : {}) }))); // W157 landmarks: let
  const miss = clips.map(([l], k) => !bufs[k] && l.part && l.lazy); // W157 landmarks (SPEC §279): a lazy landmark clip that missed is left out, and the turn is said without it
  if (miss.some(Boolean) && clips.some(([l], k) => !miss[k] && l.part)) { clips = clips.filter((_, k) => !miss[k]); bufs = bufs.filter((_, k) => !miss[k]); }
  if (bufs.some((b) => !b) || !alive() || mine !== (preview ? previewSeq : 0)) return 0; // W147 voices2: a newer preview, or hush()
  if (silent) return 0;
  let t = c.currentTime + 0.01 + when;
  const t0 = t;
  if (cued) t += play("plain_cue", when); // W65 plainlook
  for (const [k, buf] of bufs.entries()) {
    const src = new AudioBufferSourceNode(c, { buffer: buf });
    src.connect(chain.voice);
    playingVoices.add(src);
    if (preview) previews.add(src); // W147 voices2
    src.onended = () => { playingVoices.delete(src); previews.delete(src); }; // W147 voices2: previews
    src.start(t);
    t += buf.duration + clips[k][1];
  }
  return t - t0;
}

// ---- Chart events ------------------------------------------------------------------
/** Chart event kinds (chart/EVENTS.md) whose effect has another name here; null: the line only.
 *  Every other kind plays the effect of the same name, so effect names work as events too. */
export const ALIAS = {
  launch: "navi_away", constellation: null, black_hole_ahead: "black_hole_approach", negi_g_well: "g_well_negi",
  posi_g_well: "g_well_posi", light_year: "ly_milestone", touchdown: "arrive", course_turn: null, colour: null,
  radiation: "radiation_alert", steps_ahead: null, // W54 flight
  space_junk: null, tracks_ahead: null, // W67 graph3
  stop_ahead: null, // W86 stops: the line only
  bus_stop_ahead: null, // W93 busstop: the line only
  on_course: null, // W128 navcalls: the line only
  crossing_ahead: null, // W128 crashes: the line only
  card_pick: "course_set", // W86 settings: a course's card picked, a tap's "locked in" (app/calls.js TAPS)
};
/** A recorded line to fall back on when the event's own words have no file (by line id). */
export const FALLBACK = { black_hole_ahead: "black_hole_ahead", negi_g_well: "negi_g_well", touchdown: "touchdown" };
const SAFETY = new Set(["black_hole_ahead", "pulsar_ahead", "negi_g_well", "stop_ahead"]); // W86 stops: as a pulsar
/** How long, in ms, a line waits for the one before it to end instead of being dropped: a turn
 *  (navigation-4; a "prepare" is said 20 s out, a "now" 6 s out), and the system and quadrant lines
 *  that come with the launch's "you have the conn"; a bus stop for 4 s, still before it. */
const wait = (e) => e.kind === "course_turn" ? (e.stage === "prepare" ? 6000 : 3000)
  : e.kind === "system_enter" || e.kind === "quadrant_enter" || e.kind === "radiation" || e.kind === "steps_ahead" || e.kind === "space_junk" || e.kind === "tracks_ahead" ? 10000
  : e.kind === "bus_stop_ahead" || e.kind === "crossing_ahead" ? 4000 : 0; // W54 flight: the rain and the steps wait too; W67 graph3: the junk and the tracks; W93 busstop: 4 s of a 60 m lead; W128 crashes: a crossing too
const UNINTERRUPTED = new Set([...SAFETY, "course_turn", "launch"]);
/** W128 navcalls: a turn's reminder and a steady ("Still on course.") play only into silence, and any other line cuts them short. */
const soft = (e) => e.kind === "on_course" || (e.kind === "course_turn" && e.stage === "remind");

/**
 * One voice at a time. A safety line always plays at once, and stops the line playing (W21 flight: it used to play over
 * it). A course turn plays at once over any
 * other line but a safety line, another turn or the launch, and waits behind those for up to 3 s
 * ("now") or 6 s ("prepare"). System and quadrant lines wait up to 10 s. A colour line (kind "colour",
 * chart/prototype/colour.js) is the lowest: it plays only into silence, and any other line stops it. Any other line that comes
 * while one is playing is dropped, so the queue never piles up stale lines. `speak(e)` plays a line and resolves to its length in seconds.
 */
export class VoiceQueue {
  constructor(speak, { now = () => performance.now(), later = (fn, ms) => setTimeout(fn, ms), stop = () => {} } = {}) {
    Object.assign(this, { speak, now, later, stop });
    this.busyUntil = 0;
    this.playing = null; // the kind of the line playing
    this.waiting = [];
    this.seq = 0;
  }

  push(e) {
    const t = this.now();
    if (e.kind === "colour" && (t < this.busyUntil || this.waiting.length)) return Promise.resolve(0); // lowest priority: dropped, never queued
    if ((this.playing === "colour" || this.soft) && t < this.busyUntil) { // and any other line cuts it short (W128 navcalls: a soft one too)
      this.stop();
      return this.start(e);
    }
    if (soft(e) && (t < this.busyUntil || this.waiting.length)) return Promise.resolve(0); // W128 navcalls: only into silence
    if (t >= this.busyUntil) return this.start(e);
    if (SAFETY.has(e.kind)) { this.stop(); return this.start(e); } // W21 flight: never two voices at once
    if (e.kind === "course_turn" && !UNINTERRUPTED.has(this.playing)) {
      this.stop();
      return this.start(e);
    }
    if (!wait(e)) return Promise.resolve(0);
    this.waiting.push({ e, until: t + wait(e) });
    this.waiting.sort((a, b) => (b.e.kind === "course_turn") - (a.e.kind === "course_turn"));
    return Promise.resolve(0);
  }

  async start(e) {
    const id = ++this.seq;
    this.playing = e.kind;
    this.soft = soft(e); // W128 navcalls
    this.busyUntil = Infinity; // busy from the start, not only once the line has loaded
    const len = await this.speak(e, () => id === this.seq); // a line that loads after it was cut short stays quiet
    if (id === this.seq) {
      this.busyUntil = this.now() + len * 1000;
      this.later(() => this.next(id), len * 1000);
    }
    return len;
  }

  next(id) {
    if (id !== this.seq) return;
    this.playing = null; this.soft = false; // W128 navcalls: soft
    this.busyUntil = 0;
    const t = this.now();
    this.waiting = this.waiting.filter((w) => w.until > t);
    const w = this.waiting.shift();
    if (w) this.start(w.e);
  }
}

const voices = new VoiceQueue(async ({ kind, voice, when }, alive) => {
  let len = await say(voice, when, { alive });
  if (!len && FALLBACK[kind] && alive()) len = await say(FALLBACK[kind], when, { alive });
  return len ? when + len : 0;
}, { stop: () => { for (const a of playingVoices) try { a.stop(); } catch {} } });

let spoken = () => true, sounded = () => true; // W86 settings: sounded
/** Which kinds play (the app's Sound modes, app/calls.js): a kind it refuses plays neither its line nor its effect, so
 *  Directions is quiet apart from the course and the hazards (W29 polish: the chatter's chirps and chimes went on).
 *  W86 settings: `fx`, which kinds' effects play: a tap's (Launch's lift-off, a card picked) only in All. */
export function setVoiceFilter(fn, fx) { spoken = fn || (() => true); sounded = fx || (() => true); }

/** Play a chart event: its effect, then its line when the effect ends (at most 0.9 s in), through the
 *  voice queue above. Resolves to the line's length. */
export async function onChartEvent({ kind, voice, quiet, data } = {}) {
  if (quiet || !kind || !spoken(kind)) return 0; // W29 polish: and no effect
  const fx = kind in ALIAS ? ALIAS[kind] : kind;
  const dur = fx && sounded(kind) ? play(fx) : 0; // W86 settings: sounded
  if (!voice) return 0;
  return voices.push({ kind, voice, stage: data?.stage, when: Math.min(dur || 0, 0.9) });
}

// The chart prototype, the vision page's hero relay and the audio lab all fire
// `starchart:event` with { kind, voice }. Unknown kinds are quiet.
if (typeof window !== "undefined") {
  window.addEventListener("starchart:event", (e) => onChartEvent((e && e.detail) || {}));
}

// ---- Offline rendering (used by scripts/render_sfx.py) ---------------------------
/** Render one effect through the full chain; returns a mono Float32Array, faded and trimmed. */
export async function renderOffline(name, sampleRate = 48000) {
  const len = Math.min(maxLength(name), EFFECTS[name].dur + 0.35);
  const off = new OfflineAudioContext(1, Math.ceil(sampleRate * (len + 0.5)), sampleRate);
  schedule(off, makeChain(off), name, 0.005);
  const buf = await off.startRendering();
  const d = buf.getChannelData(0);
  // Cut where the sound has died away (-60 dBFS), but never past the limit.
  let end = Math.min(d.length, Math.round(len * sampleRate));
  let last = 0;
  for (let i = 0; i < end; i++) if (Math.abs(d[i]) > 0.001) last = i;
  end = Math.min(end, last + Math.round(0.03 * sampleRate));
  const outData = d.slice(0, end);
  const fade = Math.min(Math.round(0.08 * sampleRate), end);
  for (let i = 0; i < fade; i++) outData[end - 1 - i] *= i / fade;
  return outData;
}
