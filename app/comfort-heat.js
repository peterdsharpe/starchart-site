// W23 comfort: the debug heat view, ?comfort=1. Every piece of path in the tiles with a `comfort` (0-7,
// chart/SCHEMA.md) is drawn in a ramp from negi red (0) through caution lime to phosphor green (7), over the chart's
// own lines and under the course, with its level written along it from z16. A tool for tuning
// chart/pipeline/comfort.json, not a theme: it breaks the one-hue-per-concept rule on purpose.

export const HEAT_IDS = ["comfort-heat", "comfort-heat-level"];

/** The heat view's layers, coloured from the tokens' colours (TOK.color). */
export function heatLayers(C) {
  const has = ["has", "comfort"];
  return [
    {
      id: "comfort-heat", type: "line", source: "chart", "source-layer": "roads", filter: has, minzoom: 11,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["interpolate", ["linear"], ["get", "comfort"], 0, C.negi, 3.5, C.caution, 7, C.phosphor],
        "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 11, 1, 14, 3, 18, 9],
        "line-opacity": 0.9,
      },
    },
    {
      id: "comfort-heat-level", type: "symbol", source: "chart", "source-layer": "roads", filter: has, minzoom: 16,
      layout: {
        "symbol-placement": "line", "symbol-spacing": 120, "text-field": ["to-string", ["get", "comfort"]],
        "text-font": ["Antonio Bold", "Noto Sans Condensed Bold"], "text-size": 13,
      },
      paint: { "text-color": C.starlight, "text-halo-color": C.void, "text-halo-width": 1.5 },
    },
  ];
}

/** Adds the heat view under the course, when the page asks for it (the map is made with its style, as for ChartMotion). */
export function mountComfortHeat(map, C, { on = false } = {}) {
  if (!on) return false;
  const before = map.getLayer("course-glow") ? "course-glow" : undefined;
  for (const L of heatLayers(C)) if (!map.getLayer(L.id)) map.addLayer(L, L.type === "symbol" ? undefined : before);
  return true;
}
