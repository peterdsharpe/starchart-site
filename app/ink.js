// The course's ink, from the theme's tokens (--course in design/tokens.css), for the line-gradients that colour it.
// A theme switch is a paint diff (app/theme.js) that leaves the style's metadata as the first theme had it, so the
// course kept the first theme's orange after a switch (found by W23 polish). The tokens follow the theme.
const FALLBACK = "#ff8a1f";

/** { flown, ahead }: the course ahead in the theme's --course, and the part flown in the same at 32 %. */
export function courseInk(root = globalThis.document?.documentElement) {
  const c = (root ? getComputedStyle(root).getPropertyValue("--course") : "").trim() || FALLBACK;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return { flown: m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},0.32)` : c, ahead: c };
}
