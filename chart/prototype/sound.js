// Sound for flight mode: chart events -> design/sound/sfx.js effects and Lodestar's lines.
//
// sfx.js listens for `starchart:event` itself. Its ALIAS table maps the chart's kinds to its
// effects, and it falls back to a generic recorded line for a black hole or a negi g-well, so the
// prototype and the vision page's hero relay sound the same.

let sfx = null;

export async function initSound({ muted = false } = {}) {
  sfx = await import("../../design/sound/sfx.js");
  if (muted) sfx.setSilentRunning(true, { cue: false });
  return sfx;
}

export const setSilent = (on) => sfx && sfx.setSilentRunning(on);
export const isSilent = () => !!sfx && sfx.isSilentRunning();
