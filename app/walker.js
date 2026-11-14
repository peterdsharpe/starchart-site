// W228 icons6 (SPEC §478), her row 2 of 2026-11-13, "One walking icon, used everywhere": her walker (round 9, D3), as she drew it, 24 units
// square, a 2.2 stroke with round caps and joins and a filled head, in the colour it is put in. The app's one drawing of a walker: the
// From/To bar's switch and the Log's walk mark (app/fromto.js), a row's walk (app/ride-rows.js), Trade-offs' Walking end (app/tradeoffs.js);
// and, through design/glyphs/build.py, which reads it here, the mask the CSS draws (design/glyphs/ui/walker.svg: the turn bubble's walker,
// the turn list's park row, Settings' Walking pace) and the turn card's Cross. app/tests/walk.test.mjs finds no other drawing of a walker.
export const WALKER = '<circle cx="12.7" cy="4.3" r="3" fill="currentColor" stroke="none"/><path d="M12.6 7 11.8 13.6M11.8 13.6 9.9 17.3 8.4 21M11.8 13.6l3.2 3.1 1 4.3M12.4 8.3 15.23 10.54 17.92 11.39M12.4 8.3 9.80 10.36 7.20 12.07"/>';

/** Her walker as an inline <svg>, `px` square: the stroke is scaled with it. */
export const walkerSvg = (px = 24) => `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WALKER}</svg>`;
