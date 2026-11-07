// W190 screenstate (design/app-ui/SPEC.md §330): the layout's breakpoints, named once. The 2026-10-29 audit (layout #4) found
// the side column's query pasted into 11 rules in 5 sheets, its inverse once more, and the short landscape cut at 500 px in some
// and 560 px in others, with nothing to say which was meant. The sheets now write `@media (--side)`, as CSS's custom media will
// (Media Queries 5's @custom-media, in no browser yet), and app/build.mjs writes each one out from here, so the built CSS is
// what it was. A name stands for a whole query in a list (`@media (--low), (--desktop)`); one with no comma may take more
// (`(--short) and (min-width: 640px)`). app/tests/layout.test.mjs checks that each width and height has one layout.
export const MEDIA = {
  short: "(orientation: landscape) and (max-height: 560px)", // a phone on its side: the search, the preview and the turn card a column at a side
  desktop: "(min-width: 900px) and (min-height: 561px)", // a wide screen, a laptop's or a landscape tablet's (W77 desktop): the column too
  side: "(--short), (--desktop)", // either: a side column, opposite the Buttons (W187 handside)
  bottom: "(orientation: portrait), (orientation: landscape) and (min-height: 561px) and (max-width: 899px)", // the rest: the preview at the bottom
  low: "(orientation: landscape) and (max-height: 500px)", // a low landscape, 375 px and so (W122 homerow): the round column's gaps close up
};

/** W191 appleft (SPEC §334; the layout audit's #3): the room the chrome's `boxes` take at each side of a screen `width` wide, each box at
 *  the side its centre is on and reaching from that edge to its far one: { left, right }, the widest at each, 0 where none (a null box is
 *  none). Measured, so no
 *  caller says again which side the turn card, a side sheet or Layers' column is on (app/home.css does, by Settings › Buttons): Overview's
 *  fit and the rest-in-view check (app/main.js clearOf), a preview's fit (app/course.js clearOf), the course's snackbar and the share menu. */
export function chromeClear(boxes, width) {
  const room = { left: 0, right: 0 };
  for (const b of boxes) if (b) {
    const at = b.left + b.width / 2 > width / 2 ? "right" : "left";
    room[at] = Math.max(room[at], at === "right" ? width - b.left : b.left + b.width);
  }
  return room;
}

/** `css` with each `(--name)` of MEDIA written out (app/build.mjs). An unknown name throws, so a typo never ships as "not all". */
export function expandMedia(css, media = MEDIA) {
  const one = (name, seen = []) => {
    if (!(name in media)) throw new Error(`no custom media --${name} (app/layout.js MEDIA)`);
    if (seen.includes(name)) throw new Error(`custom media --${name} names itself`);
    return media[name].replace(/\(--([\w-]+)\)/g, (_, n) => one(n, [...seen, name]));
  };
  return css.replace(/@media ([^{]*\(--[\w-]+\)[^{]*)\{/g, (_, q) => `@media ${q.split(",").map((item) => item.replace(/\(--([\w-]+)\)/g, (ref, n) => {
    const v = one(n);
    if (v.includes(",") && item.trim() !== ref) throw new Error(`@media ${q}: --${n} is a list, so it stands alone in its item`);
    return v;
  })).join(",")}{`);
}
