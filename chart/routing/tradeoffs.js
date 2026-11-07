// W199 prefs (design/app-ui/SPEC.md §353): Settings › Routing › Trade-offs, three beams, each a step from -2 (its left side)
// to +2 (its right side); 0, level, is today's planning exactly. One factor a step, each × or ÷ √2 on the price of the side
// leaned to, read by the router (router.js route()'s `lean`), the bike cards' limits (app/course-logic.js foldStyles()), the
// walker's ranges (walktransit.js leaned()) and the lines under the beams (app/tradeoffs.js), so the words can't drift.
//   protect  Quicker ⟷ Bike paths: Wormholes' NOT_FREE = 1 + 0.35 × lean, BARE_WORM = 1 + 0.1 × lean; its card's detour limit × lean
//   hills    Quicker ⟷ Fewer hills: Fewest hills' uphill 300 × lean, Wormholes' 100 × lean; Fewest hills' card's limit × lean
//   walk     T and bus ⟷ Walking: walkcards' RANGES.out (low, hers, high) ÷ lean (the sky's shift adds after it)
// No imports: the router's worker, the app and the tests read it.

/** Steps -2 … +2. */
export const LEAN = [0.5, 0.7, 1, 1.4, 2];
/** The beams, in the page's order. */
export const BEAMS = ["protect", "hills", "walk"];
/** Step `k`'s factor: 1 for level, or for anything that isn't a step. */
export const lean = (k) => LEAN[(Number.isInteger(+k) && Math.abs(+k) <= 2 ? +k : 0) + 2];
/** Every beam level: no plan or card changes. */
export const level = (leans) => !leans || BEAMS.every((b) => lean(leans[b]) === 1);
/** What the line under each beam says, as a rider reads it: the most farther a Bike paths card rides (its detour limit, 30 % ×
 *  the lean: on a trip over 10 min it binds before the price, 35 % × the lean), in 5 %; the feet Fewest hills rides to climb a
 *  foot less (its uphill price, 300 × the lean), in 50 ft; the minutes under cover 10 min outside counts as (10 ÷ the lean). */
export const PRICE = {
  protect: (k) => Math.round((30 * lean(k)) / 5) * 5,
  hills: (k) => Math.round((300 * lean(k)) / 50) * 50,
  walk: (k) => Math.round(10 / lean(k)),
};
