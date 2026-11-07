// W39 ship (design/app-ui/SPEC.md §50): the ship can't go missing silently. arclight, in 0.1.10: "the app definitly knows
// where I am ... but the bike is not drawing". Its cause was a lost WebGL context, which MapLibre restores without the
// custom layers (keepLayer() in chart/prototype/gl-layer.js now adds them again). This is the net under it: while the
// ship should show (a pose, the ship on, and no flight's page over the chart), once the chart has drawn a few frames over
// a second with the ship's spot on the screen and the ship not among them, its layer is added again, with new GL
// objects, where it was. Each such recovery is counted, for About › Developer, so a phone can tell us.
// Nothing runs per frame but a few comparisons, and a still chart draws no frames, so it never asks for one.

import { note } from "./trail-log.js"; // W48 feedback

export const STALE_MS = 1000, FRAMES = 3;

/** ship: the ship's layer (app/ship-model-layer.js). Call check(t, wanted) from the frame loop; wanted: it should show. */
export function mountShipGuard(map, ship) {
  const order = map.getLayersOrder(), next = order[order.indexOf(ship.id) + 1]; // where it goes back
  const stats = { readded: 0 };
  let frames = 0, drawn = ship.drawn, since = performance.now();
  map.on("render", () => { frames++; });
  const reset = (t) => { frames = 0; drawn = ship.drawn; since = t; };
  function onScreen() {
    const c = map.getCanvas(), q = map.project(ship.lngLat);
    return q.x >= 0 && q.y >= 0 && q.x <= c.clientWidth && q.y <= c.clientHeight;
  }
  function check(t, wanted) {
    if (!wanted || ship.gl?.isContextLost() || !map.isStyleLoaded()) return reset(t); // a lost context: keepLayer() brings it back with the restore
    const there = !!map.getLayer(ship.id);
    if (there && (ship.drawn !== drawn || !onScreen())) return reset(t); // drawing, or nothing of it to draw
    if (t - since < STALE_MS || (there && frames < FRAMES)) return;
    if (there) map.removeLayer(ship.id);
    map.addLayer(ship, map.getLayer(next) ? next : undefined);
    stats.readded++;
    note("ship", "put back on the chart"); // W48 feedback
    map.triggerRepaint();
    reset(t);
  }
  return { stats, check };
}
