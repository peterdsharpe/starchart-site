// W21 entry: only rough positions, every one too rough to fly by (app/fixnote.js's roughM). The parked chart centres on
// the best of them once, unless the pilot has moved it, with a big faint ring in --you the size of its accuracy; main.js
// puts the ship there, dimmed. The search and the place sheet measure from it. All of it goes with the first good fix.
import { roughM } from "./fixnote.js";

const none = { type: "FeatureCollection", features: [] };

/** `core` is the pose's PoseCore (its .log and .fix); `shown()` is true once the ship shows; `free()` once the pilot moved the chart. */
export function mountRough({ map, core, shown, free, every = 1000 }) {
  const you = () => getComputedStyle(document.documentElement).getPropertyValue("--you").trim();
  map.addSource("rough", { type: "geojson", data: none });
  map.addLayer({ id: "rough", type: "circle", source: "rough",
    paint: { "circle-radius": 0, "circle-color": you(), "circle-opacity": 0.1, "circle-stroke-color": you(), "circle-stroke-opacity": 0.5,
      "circle-stroke-width": 1.5, "circle-pitch-alignment": "map" } }, map.getLayer("ship-space") ? "ship-space" : undefined);
  addEventListener("starchart:theme", () => { for (const k of ["circle-color", "circle-stroke-color"]) map.setPaintProperty("rough", k, you()); });
  let spot = null, centred = false;
  function update() {
    const r = shown() ? null : roughM(core.log, core.fix);
    const best = r === null ? null : core.log.reduce((a, f) => (f.accuracy < a.accuracy ? f : a));
    if (!best) { if (spot) { spot = null; map.getSource("rough")?.setData(none); } return; }
    if (spot && spot[0] === best.lonlat[0] && spot[1] === best.lonlat[1]) return;
    spot = best.lonlat.slice();
    // the ring's radius: the accuracy in metres, as pixels at every zoom (a pixel is 156543 m at z0, halving each zoom)
    const px0 = best.accuracy / (156543.03 * Math.cos((spot[1] * Math.PI) / 180));
    map.setPaintProperty("rough", "circle-radius", ["interpolate", ["exponential", 2], ["zoom"], 0, px0, 22, px0 * 2 ** 22]);
    map.getSource("rough")?.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: spot } }] });
    if (!centred && !free()) map.jumpTo({ center: spot });
    centred = true;
  }
  const timer = setInterval(update, every);
  update();
  return { spot: () => spot, stop: () => clearInterval(timer) };
}
