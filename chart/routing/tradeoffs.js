// W199 prefs (design/app-ui/SPEC.md §353): Settings › Routing › Trade-offs, three beams, each a step from -2 (its left side)
// to +2 (its right side); 0, level, is today's planning exactly. One factor a step, each × or ÷ √2 on the price of the side
// leaned to, read by the router (router.js route()'s `lean`), the bike cards' limits (app/course-logic.js foldStyles()), the
// walker's ranges (walktransit.js leaned()) and the lines under the beams (app/tradeoffs.js), so the words can't drift.
//   protect  Quicker ⟷ Bike paths: Wormholes' NOT_FREE = 1 + 0.35 × lean, BARE_WORM = 1 + 0.1 × lean; its card's detour limit × lean
//   hills    Quicker ⟷ Fewer hills: Fewest hills' uphill 300 × lean, Wormholes' 100 × lean; Fewest hills' card's limit × lean
//   walk     T and bus ⟷ Walking: walkcards' RANGES.out (low, hers, high) ÷ lean (the sky's shift adds after it); W211 walkmore:
//            ÷ WALK_LEAN on the Walking side (1.6, 2.6), and walktransit.js FAR's longer walks there
//   weather  T and bus ⟷ Rain gear (W201 weather2, SPEC §360): how much bad weather tips you to the T, riding and walking alike:
//            walkcards' RANGES.sky wet, cold and hot shifts ÷ lean (a fine day's as it is); the bike + T rain rule (transit.js
//            earn()): its cap (the most a drier plan may cost) ÷ lean, the wet riding it must save (rain.s) × lean
// W203 tradeoffs2 (SPEC §365): two tabs, By bike and On foot, so the weather beam is two, one a tab, and On foot has a new beam:
//   bikeWeather  Train ⟷ Rain gear: the bike + T rain rule, as `weather` was (rainRules())
//   footWeather  T and bus ⟷ Rain gear: walkcards' bad skies' shifts, as `weather` was (walktransit.js leaned())
//   changes      Quicker ⟷ Fewer changes: walkcards' RANGES.change (each change's own minutes, her HER.penalty_s the middle) × lean
// No imports: the router's worker, the app and the tests read it.

/** Steps -2 … +2. */
export const LEAN = [0.5, 0.7, 1, 1.4, 2];
/** The beams, in the page's order. */
export const BEAMS = ["protect", "hills", "bikeWeather", "walk", "changes", "footWeather"]; // W201 weather2: weather; W203 tradeoffs2: a weather beam a tab, and changes: By bike's three, then On foot's
/** Step `k`'s factor: 1 for level, or for anything that isn't a step. */
export const lean = (k) => LEAN[step(k) + 2];
/** W211 walkmore: step `k` itself, -2 … 2: 0 for anything that isn't one. */
export const step = (k) => (Number.isInteger(+k) && Math.abs(+k) <= 2 ? +k : 0); // W211 walkmore
/** W211 walkmore (SPEC §395, her row 23: "allow for much more walking to be selected"): the walker's beam leans harder on its Walking
 *  side than LEAN (1.4, 2), LEAN's on the T's side: a minute outside ÷ this (walktransit.js leaned()); her reach there is FAR's. */
export const WALK_LEAN = [0.5, 0.7, 1, 1.6, 2.6]; // W211 walkmore: the sweep's (SPEC §395)
export const walkLean = (k) => WALK_LEAN[step(k) + 2]; // W211 walkmore
/** W212 walkfirst (SPEC §399, her row 7.4: "You'd never take the bus or train if walking is faster"; no new setting, UX rules 7 and 42):
 *  the walker's beam's Walking side. Beside the walk the whole way's card, in a dry sky or one not known, a plan by T is a card only when
 *  it has her at the door `card` s sooner than walking, and comes first only when `first` s sooner (walktransit.js pickCards()); level
 *  and the T's side null, her weights alone. The sweep's numbers (SPEC §399): 3 and 5 min a step to walking, 5 and 10 min at its end. */
export const SOONER = { card: [null, null, null, 180, 300], first: [null, null, null, 300, 600] }; // W212 walkfirst
/** Every beam level: no plan or card changes. */
export const level = (leans) => !leans || BEAMS.every((b) => lean(leans[b]) === 1);
/** What the line under each beam says, as a rider reads it. W203 tradeoffs2 (SPEC §365, her row 7: "10 minutes outside count as
 *  10 minutes undercover" didn't read; W199's were % farther, ft for 1 ft and % slower): each what the lean does to a choice she'd
 *  see, in whole minutes or tenths of a mile. protect: the minutes a Bike paths card may add to a 20-min route (its detour limit,
 *  30 % × the lean, past its 3 min × the lean there); hills: the miles Fewest hills rides to skip a 10-ft climb (its uphill price,
 *  300 × the lean, × 10 ft); bikeWeather: the minutes a drier plan by train may add to a 20-min route (the rain rule's cap, 30 % ÷
 *  the lean, under its 10 min ÷ the lean); walk: the minutes riding she'd give for 10 min less walking (10 ÷ the lean, as W199's;
 *  W212 walkfirst: the minutes of walking a 10 min ride must save to come first, 10 × the lean, and on the Walking side SOONER's two in min;
 *  0.1.99's words review: on the T's side and at level said door to door as SOONER's are, the minutes walking all the way may be quicker
 *  with a 10 min ride still first, 10 − those, so the line reads one way along the beam: 5, 3, about as quick, then 3 and 5, 5 and 10);
 *  changes: the minutes longer she'd go to skip a change (CHANGE_S × the lean); footWeather: walk's in the rain, 10 × (her minute
 *  outside ÷ the walker's lean + the rain's WET ÷ this lean), walktransit.js leaned()'s, so it moves with walk's too. */
export const PRICE = {
  protect: (k) => Math.round(6 * lean(k)), // W203 tradeoffs2: min more on a 20-min route (was % farther)
  hills: (k) => Math.round((3000 * lean(k)) / 5280 * 10) / 10, // W203 tradeoffs2: mi farther to skip a 10-ft climb (was ft for 1 ft)
  walk: (k) => (step(k) > 0 ? [SOONER.card[step(k) + 2] / 60, SOONER.first[step(k) + 2] / 60] : 10 - Math.round(10 * walkLean(k))), // W211 walkmore: walkLean; W212 walkfirst (SPEC §399, her row 7.4): in her terms (was the riding she'd give for walking), and SOONER's on the Walking side; 0.1.99's words review: door to door there too, the minutes walking may be quicker (was the walking a ride must save, 5 7 10, whose 10 at level read as more than +1's 5)
  bikeWeather: (k) => Math.round(6 / lean(k)), // W203 tradeoffs2: min more on a 20-min route to stay dry
  changes: (k) => Math.round((CHANGE_S * lean(k)) / 60), // W203 tradeoffs2
  footWeather: (k, walk = 0) => Math.round(10 * (1 / walkLean(walk) + WET / lean(k))), // W203 tradeoffs2; W211 walkmore: walkLean
};
/** W203 tradeoffs2 (SPEC §365, her row 11d): what a change costs a walker on its own, beside its walk, its wait and a missed
 *  change's risk (the transport literature's transfer penalty): walktransit.js HER.penalty_s and RANGES.change's middle, × the
 *  Fewer changes lean. WET: walktransit.js RANGES.sky.wet, the rain's shift of a minute outside (app/tests/settings.test.mjs checks). */
export const CHANGE_S = 300, WET = 0.5; // W203 tradeoffs2
/** W201 weather2 (SPEC §360): the bike + T earn rule (transit.js EARN) under the weather beam's step `k`: the rain rule's own
 *  cap (the comfort rules keep `cap`) ÷ the lean, and the wet riding it must save × the lean; `rules` itself at level, so
 *  level is today's object, byte for byte. */
export function rainRules(rules, k) { // W201 weather2
  const f = lean(k);
  if (f === 1) return rules;
  return { ...rules, rain: { ...rules.rain, s: rules.rain.s * f }, wetCap: { s: rules.cap.s / f, frac: rules.cap.frac / f } };
} // W201 weather2
