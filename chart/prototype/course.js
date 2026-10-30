// Course mode, as pure functions: which manoeuvre is next, how far it is in light years, and the
// words on the manoeuvre card. Arrow first, then words (brief §6.5).

const LY = 1609.344;

/** The next instruction more than 5 m ahead of s, or null. */
export function nextManeuver(instructions, s) {
  for (const i of instructions || []) if (i.along_m > s + 5) return i;
  return null;
}

/** "In a quarter light year", in SCUL; "In 400 ft" in meatspace. */
export function distanceWords(m, mode = "scul") {
  if (mode === "meatspace") {
    const ft = m * 3.28084;
    if (ft < 120) return "Now";
    if (ft < 1000) return `In ${Math.round(ft / 50) * 50} ft`;
    return `In ${(m / LY).toFixed(1)} mi`;
  }
  const ly = m / LY;
  if (ly < 0.04) return "Now";
  if (ly < 0.15) return "In a tenth of a light year";
  if (ly < 0.35) return "In a quarter light year";
  if (ly < 0.62) return "In half a light year";
  if (ly < 0.88) return "In three quarters of a light year";
  if (ly < 1.15) return "In one light year";
  return `In ${ly.toFixed(1)} light years`;
}
/** W42 leftovers: the distance as Lodestar says it, in the words of a turn clip: past one light year the banner's "In 2.3 light
 *  years" is said to the nearest whole one, "In two light years", from one and a half up to "In more than five light years".
 *  W60 d: Plain says feet to the nearest hundred under 1000 ft ("In 400 feet"), then quarters of a mile and whole miles. */
export function spokenDistance(m, mode = "scul") {
  if (mode === "meatspace") return plainDistance(m);
  const ly = m / LY;
  if (ly < 1.15) return distanceWords(m);
  if (ly < 1.75) return "In one and a half light years";
  return ly < 5.5 ? `In ${["two", "three", "four", "five"][Math.round(ly) - 2]} light years` : "In more than five light years";
}

function plainDistance(m) { // W60 d
  const ft = m * 3.28084, mi = m / LY;
  if (ft < 120) return "Now";
  if (ft < 950) return `In ${Math.max(200, Math.round(ft / 100) * 100)} feet`; // a prepare is 64 m out or more: the clips start at 200
  if (ft < 1000 || mi < 0.19) return "In 1000 feet";
  const q = ["a quarter mile", "half a mile", "three quarters of a mile", "one mile"].find((w, i) => mi < [0.35, 0.62, 0.88, 1.15][i]);
  if (q) return `In ${q}`;
  if (mi < 1.75) return "In one and a half miles";
  return mi < 5.5 ? `In ${["two", "three", "four", "five"][Math.round(mi) - 2]} miles` : "In more than five miles";
}

const ARROWS = {
  left: "left", right: "right", slight_left: "slight_left", slight_right: "slight_right",
  sharp_left: "sharp_left", sharp_right: "sharp_right", keep_left: "slight_left", keep_right: "slight_right",
  straight: "straight", beeline: "straight", u_turn: "come_about", arrive: "arrive",
};

/** The manoeuvre glyph's file name in design/glyphs/maneuver/. */
export function arrowFile(ins) {
  if (!ins) return "arrive";
  if (ins.turn === "black_hole") return `black_hole_exit_${Math.max(1, Math.min(5, ins.exit || 1))}`;
  return ARROWS[ins.turn] || "straight";
}

// W31 navvoice: port is left and starboard is right (arclight, 2026-10-17), on the banners and in the voice; the arrows
// stay. Lodestar says the move and stops; the road's name is on the banner and the card. Every spoken turn is joined from
// a small set of clips (design/sound/voice/lines.json, group "Turn clips"): a distance, a move, a chain.
const MOVES = {
  left: "Turn to port", right: "Turn to starboard", slight_left: "Bear to port", slight_right: "Bear to starboard",
  sharp_left: "Hard to port", sharp_right: "Hard to starboard", keep_left: "Keep to port", keep_right: "Keep to starboard",
  straight: "Straight on", beeline: "Straight on", u_turn: "Hard about",
};
// W60 d: Plain (mode "meatspace") says the same moves in everyday words, from clips of their own (design/sound/voice/lines.json,
// group "Plain clips").
const PLAIN_MOVES = {
  left: "Turn left", right: "Turn right", slight_left: "Bear left", slight_right: "Bear right",
  sharp_left: "Sharp left", sharp_right: "Sharp right", keep_left: "Keep left", keep_right: "Keep right",
  straight: "Straight on", beeline: "Straight on", u_turn: "Make a U-turn",
};
const plain = (mode) => mode === "meatspace";
export const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
const lc = (w) => w.charAt(0).toLowerCase() + w.slice(1);
const uc = (w) => w.charAt(0).toUpperCase() + w.slice(1);
/** The move alone: "Turn to port", "Orbit the black hole. Take the third exit"; Plain: "Turn left", "At the rotary, take the
 *  third exit". */
export function moveWords(ins, mode = "scul") {
  const exit = ORDINALS[ins.exit] || ORDINALS[1];
  if (ins.turn === "black_hole") return plain(mode) ? `At the rotary, take the ${exit} exit` : `Orbit the black hole. Take the ${exit} exit`;
  const moves = plain(mode) ? PLAIN_MOVES : MOVES;
  return moves[ins.turn] || moves.straight;
}
/** A turn as the second of two: "starboard", "bear to port", "orbit the black hole"; Plain: "right", "bear left", "enter the
 *  rotary". */
export const thenWords = (turn, mode = "scul") => (turn === "black_hole" ? (plain(mode) ? "enter the rotary" : "orbit the black hole")
  : lc(moveWords({ turn }, mode).replace(/^Turn (to )?/, "")));
/** W31 navvoice: the turn card's word before the road: "Starboard", "Bear to port", "Third exit", "Straight"; Plain: "Right",
 *  "Bear left", "Make a U-turn". */
export const cardMove = (ins, mode = "scul") => (ins.turn === "black_hole" ? `${uc(ORDINALS[ins.exit] || ORDINALS[1])} exit`
  : ins.turn === "straight" || ins.turn === "beeline" ? "Straight" : uc(thenWords(ins.turn, mode)));
/** The name of the road a turn takes, from its words: "Starpath Beacon", "the Minuteman Wormhole", or ""; Plain, from its plain
 *  words: "Beacon Street", "the bike path". */
const onto = (ins, mode = "scul") => /\bonto (.+?)\.?$/.exec((plain(mode) ? ins.plain : ins.text) || "")?.[1] || "";
const VERB_TURN = { "turn left": "left", "turn right": "right", "bear left": "slight_left", "bear right": "slight_right", "sharp left": "sharp_left",
  "sharp right": "sharp_right", "keep left": "keep_left", "keep right": "keep_right", continue: "straight", "hard about": "u_turn" };
/** The second turn of a jog folded into one instruction (instructions.js `then`; a demo course's words say it). */
const jog = (ins) => ins.then ?? VERB_TURN[/, then ([a-z]+(?: [a-z]+)?)(?= onto|\.|$)/.exec(ins.text || "")?.[1]] ?? null;
const wormhole = (ins) => /wormhole/i.test(ins.road?.kind || "") || /wormhole/i.test(onto(ins));
/** What Lodestar says of a turn: "Turn to port", "Turn to port onto a wormhole", "Bear to port, then starboard"; Plain: "Turn
 *  left", "Turn left onto a bike path", "Continue onto a bike path", "Bear left, then right". */
export function spokenMove(ins, mode = "scul") {
  const then = jog(ins);
  if (then) return `${moveWords(ins, mode)}, then ${thenWords(then, mode)}`;
  if (ins.turn === "black_hole" || ins.turn === "u_turn" || !wormhole(ins)) return moveWords(ins, mode);
  const straight = ins.turn === "straight" || ins.turn === "beeline";
  if (plain(mode)) return straight ? "Continue onto a bike path" : `${moveWords(ins, mode)} onto a bike path`; // W60 d
  return `${moveWords(ins)} ${straight ? "into" : "onto"} a wormhole`;
}
/** A turn on the banner: "Turn to port onto Starpath Beacon", "Orbit the black hole. Take the third exit, onto Starpath X". */
function shownMove(ins, mode = "scul") {
  const then = jog(ins), road = onto(ins, mode);
  const move = road && !then && (ins.turn === "straight" || ins.turn === "beeline") ? "Straight" : moveWords(ins, mode); // "Straight onto …"
  return `${move}${then ? `, then ${thenWords(then, mode)}` : ""}${road ? `${ins.turn === "black_hole" ? "," : ""} onto ${road}` : ""}`;
}

/** The card's words: "turn to port onto Starpath Beacon"; Plain: "turn left onto Beacon Street" (W60 d: the moves in Plain's own
 *  words, and the road's plain name). */
export function turnWords(ins, mode = "scul") {
  return lc(shownMove(ins, mode));
}

/** The whole line on the banner: "In a quarter light year, turn to port onto Starpath Beacon." */
export function turnLine(ins, s, mode = "scul") {
  const d = distanceWords(ins.along_m - s, mode);
  return d === "Now" ? `${uc(turnWords(ins, mode))}.` : `${d}, ${turnWords(ins, mode)}.`;
}

const MPH = 0.44704;

/**
 * Course mode's spoken turns, in two stages by time (navigation-1): "prepare" about 20 s out (at least
 * 120 m), and "now" about 6 s out (at least 30 m). Only the next turn is ever prompted, so a prompt never
 * comes while an earlier turn is still ahead. A turn within 10 s (at least 60 m) of the one before it
 * is chained onto that one's "now" ("Turn left onto X, then turn right onto Y."). Whatever is already
 * inside its distance when the course starts or the page resumes is said at once (events-7), and each
 * stage is said once. The landing pad gets a prepare only: the engine's touchdown is its "now".
 * W128 navcalls (SPEC §237): with the fixes' times, a long stretch hears its turn again ("remind", the prepare's words) every
 * `every.remind` ms after the last turn call, while moving and never in the `every.before` ms before the prepare; and a long steady one,
 * moving for `every.still` ms with no turn call due within `every.gap` ms either way, a "steady" ("Still on course.", said in
 * Detailed only, app/calls.js) at most every `every.steady` ms.
 */
export const EVERY = { remind: 120000, before: 30000, steady: 150000, gap: 45000, still: 30000, moving_mps: 2 }; // W128 navcalls
export class TurnPrompter {
  constructor(instructions, length, min = { prep: 120, now: 30, chain: 60 }) { // W79 walkgo: min, the calls' nearest distances (course-logic.js FOOT's on foot)
    this.min = min; // W79 walkgo
    const pad = (instructions || []).find((i) => i.turn === "arrive");
    this.list = (instructions || []).filter((i) => i.turn !== "arrive")
      .concat([{ turn: "arrive", along_m: length, text: "Landing pad ahead.", plain: "Arriving.", side: pad?.side ?? null, // W31 navvoice: side
        walk: /Walk across/.test(pad?.text || "") }]); // and W32 routing's walk across the street (instructions.js WALK_SAY_M)
    this.said = new Map(); // instruction -> "prepare" | "now"
    this.s = 0;
    this.back = 0; // W31 navvoice: fixes in a row more than 50 m back
    this.nowAt = new Map(); // W31 navvoice: instruction -> when its "now" was said, on the caller's clock
    this.chained = new Map(); // W31 navvoice: a turn chained onto the one before it -> where that call was
    this.every = { ...EVERY }; // W128 navcalls: the tests' shorter clock
    this.callT = this.stillT = null; this.steadyT = -Infinity; // W128 navcalls: the last turn call, stop and steady, on the caller's clock
  }

  /** The prompts due at s metres at `mph`, as turns() below; W128 navcalls: with `t`, then a reminder or a steady, unless `back`
   *  (riding the course backwards, app/course-logic.js CourseFlight: its "Turn around." counts as a call). */
  update(s, mph = 11, t = null, back = false) {
    const out = this.turns(s, mph, t);
    if (t === null) return out;
    if (out.length || back) { this.callT = t; return out; }
    return this.again(s, mph, t);
  }

  /** W128 navcalls: a reminder of the turn ahead, or a steady, when one is due (the class's note). */
  again(s, mph, t) {
    const e = this.every, v = Math.max(1, mph) * MPH;
    this.callT ??= t; this.stillT ??= t;
    if (mph * MPH < e.moving_mps) { this.stillT = t; return []; } // never at a stop
    const ins = this.list.find((i) => i.along_m > s + 5);
    if (!ins || this.said.has(ins)) return []; // its prepare is said: it is near
    const ahead = ((ins.along_m - s - Math.max(this.min.prep, 20 * v)) / v) * 1000, since = t - this.callT; // ms to its prepare, and since the last call
    if (ins.turn !== "arrive" && since >= e.remind && ahead >= e.before) { this.callT = t; return [{ ins, stage: "remind", then: null }]; }
    if (t - this.stillT < e.still || since < e.gap || since > e.remind - e.gap || ahead < e.gap || t - this.steadyT < e.steady) return [];
    this.steadyT = t;
    return [{ ins, stage: "steady", then: null }];
  }

  /** The turns' prompts due at s metres at `mph`: [{ins, stage, then}], where `then` is a chained turn or null. W31 navvoice: `t`,
   *  the fix's time in ms, if the caller has one: the same "now" is never said twice within 20 s. */
  turns(s, mph = 11, t = null) { // W128 navcalls: was update
    if (s < this.s - 50) { // flown again from further back; W31 navvoice: two fixes in a row, not one rough one
      if (++this.back < 2) return [];
      this.said.clear();
    }
    this.back = 0;
    this.s = s;
    const v = Math.max(1, mph) * MPH;
    const prep = Math.max(this.min.prep, 20 * v), now = Math.max(this.min.now, 6 * v), floor = Math.max(now + 4 * v, 0.04 * LY); // W79 walkgo: this.min, was 120, 30, 60
    const chain = Math.max(this.min.chain, 10 * v, floor + 5); // W128 navcalls: a turn too near for its own prepare is chained, so it is said twice
    const k = this.list.findIndex((i) => i.along_m > s + 5);
    const ins = this.list[k];
    if (!ins || this.said.get(ins) === "now") return [];
    const d = ins.along_m - s, next = this.list[k + 1];
    const then = next && next.turn !== "arrive" && next.along_m - ins.along_m < chain ? next : null;
    if (ins.turn === "arrive") {
      if (!this.said.has(ins)) {
        if (d > prep) return [];
        this.said.set(ins, ins.walk ? "prepare" : "now");
        return [{ ins, stage: "prepare", then: null }];
      }
      // W31 navvoice: a course that stops across the street says "Walk across." at least 8 s (45 m) before its end, so it is
      // over before "Touchdown." 30 m out
      if (ins.walk && d <= Math.max(45, 8 * v)) { this.said.set(ins, "now"); return [{ ins, stage: "now", then: null }]; }
      return [];
    }
    if (d <= now) {
      this.said.set(ins, "now");
      const recent = t !== null && t - (this.nowAt.get(ins) ?? -Infinity) < 20000;
      // W31 navvoice: a chained turn gets its own short "now" when that comes 3 s or more after the call it was chained onto
      const soon = this.chained.has(ins) && s - this.chained.get(ins) < 3 * v;
      if (recent || soon) return [];
      if (t !== null) this.nowAt.set(ins, t);
      if (then) { this.said.set(then, "prepare"); this.chained.set(then, s); }
      return [{ ins, stage: "now", then }];
    }
    if (d <= prep && !this.said.has(ins) && d > floor) { // not when it would read "Now"
      this.said.set(ins, "prepare");
      return [{ ins, stage: "prepare", then: null }];
    }
    return [];
  }
}

/** W53 lanes: a turn's lane count as the prepare call says it, " Two lanes to cross." (a turn clip, for 1 to 4), or "". The
 *  count only, never advice, and never the bike box (SPEC §68). */
const LANE_COUNT = ["", "One lane", "Two lanes", "Three lanes", "Four lanes"];
export const laneWords = (ins) => (LANE_COUNT[ins?.lanes?.cross] ? ` ${LANE_COUNT[ins.lanes.cross]} to cross.` : "");

/** The spoken line of a prompt: "In a tenth of a light year, turn to port.", "Turn to port, then starboard." W31 navvoice: no
 *  road names (they are on the banner, promptText), so that every line is joined from the turn clips. W60 d: Plain, the same in
 *  its own words and clips: "In 500 feet, turn left.", "At the rotary, take the third exit." W157 landmarks: `mark`, Detailed's
 *  landmark as its words start the call ("After the bus stop, ", app/landmarks.js markWords; "" for none), in place of the pulsar
 *  or the stop sign at the turn. */
export function promptLine({ ins, stage, then, pulsar = false, stop = false, mark = null }, s, mode = "scul") { // W86 stops: stop; W157 landmarks: mark
  if (ins.turn === "arrive") return stage === "now" ? "Walk across." : padLine(ins, mode) + ".";
  const d = stage === "prepare" || stage === "remind" ? spokenDistance(ins.along_m - s, mode) : "Now"; // W42 leftovers: spokenDistance; W128 navcalls: a reminder's too
  const at = mark ?? (pulsar ? (plain(mode) ? "At the traffic light, " : "At the pulsar, ") : stop ? "At the stop sign, " : ""); // W60 d: Plain's words, joined from its clips; W86 stops: one clip for both
  const w = `${at}${at ? lc(spokenMove(ins, mode)) : spokenMove(ins, mode)}${then ? `, then ${thenWords(then.turn, mode)}` : ""}`;
  return d === "Now" ? `${w}.` : `${d}, ${lc(w)}.${stage === "prepare" ? laneWords(ins) : ""}`; // W53 lanes: the count, at the prepare call only (W128 navcalls: not a reminder)
}
/** W31 navvoice: "Landing pad ahead, to port", by the side the pin is on (`side`, from app/course-logic.js padSide). W60 d:
 *  Plain: "Destination ahead, on the left". */
const padLine = (ins, mode = "scul") => (plain(mode) ? `Destination ahead${ins.side ? `, on the ${ins.side === "port" ? "left" : "right"}` : ""}`
  : ins.side ? `Landing pad ahead, to ${ins.side}` : (ins.text || "Landing pad ahead.").replace(/\.$/, ""));

/** W31 navvoice: a prompt's banner, with the roads' names and no full stop: "In a tenth of a light year, turn to port onto
 *  Starpath Beacon", "Turn to port onto Starpath Beacon, then starboard onto Starpath Brattle". */
export function promptText({ ins, stage, then, pulsar = false, stop = false, mark = null }, s, mode = "scul") { // W86 stops: stop; W157 landmarks: mark
  if (ins.turn === "arrive") return stage === "now" ? "Walk across" : padLine(ins, mode);
  const at = mark != null ? lc(mark) : pulsar ? (plain(mode) ? "at the traffic light, " : "at the pulsar, ") : stop ? "at the stop sign, " : ""; // W31 navvoice: a pulsar at the turn; W60 d; W86 stops
  if (stage === "prepare" || stage === "remind") { // W128 navcalls: remind
    const d = distanceWords(ins.along_m - s, mode);
    if (d !== "Now") return `${d}, ${at}${turnWords(ins, mode)}${laneWords(ins).replace(/\.$/, "").replace(/^ /, ". ")}`; // W53 lanes
  }
  const next = then ? `, then ${turnWords(then, mode).replace(/^turn (to )?/, "")}` : ""; // W60 d: "then right onto Brattle Street"
  return uc(at + turnWords(ins, mode)) + next;
}

/** W60 d: the course's own calls (app/course.js), as [SCUL, Plain]: each one a clip in lines.json. */
export const CALLS = {
  off_course: ["Off course.", "Off route."], new_course: ["New course.", "New route."], turn_around: ["Turn around.", "Turn around."],
  touchdown: ["Touchdown.", "You have arrived."], steps_ahead: ["Steps ahead.", "Steps ahead."], negi_g_well: ["Negi g-well ahead.", "Steep climb ahead."],
  space_junk: ["Space junk ahead.", "Barrier ahead."], tracks_ahead: ["Comet tracks ahead.", "Tracks ahead."], // W67 graph3
  on_course: ["Still on course.", "Still on track."], // W128 navcalls: a steady, in Detailed
};
export const callLine = (key, mode = "scul") => CALLS[key][plain(mode) ? 1 : 0];

/**
 * Light years left to the landing pad, and the ETA in earth minutes from the average speed so far,
 * stops included (navigation-3): `elapsed` seconds for `s` metres. For the first two minutes, 11 mph.
 */
export function landing(length, s, elapsed = 0) {
  const left = Math.max(0, length - s);
  const v = elapsed >= 120 && s > 0 ? s / elapsed : 11 * MPH;
  return { ly: left / LY, minutes: Math.ceil(left / v / 60) };
}
