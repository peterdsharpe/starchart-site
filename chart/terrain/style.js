// The ways to show hills on the Saturnight chart: the sources and layers for each, in both themes, as plain
// style JSON. design/app-ui/w18-terrain/ shows each option alone and together (wave 18); the app (wave 19,
// app/terrain.js) drew a, c and b, and draws e when tilted. It draws no contours: they read as roads.
// W231 sculclimbs (design/app-ui/SPEC.md §486): the app draws Climbs (below) in both word modes, so b. the tint by height and
// c. the lime steep ground went from here and from the app; the W18 page keeps its own copy of them (design/app-ui/w18-terrain/terrain.js).
//
//   hillshade  a. light from the top left of the screen (as the glyphs are lit), lit slopes a faint glow
//   contours   d. faint lines every 5 m or 10 m, an index line every 25 m or 50 m, with its height
//   terrain    e. 3D terrain when tilted (map.setTerrain), exaggerated; see terrainSpec()
//
// Colours are the tokens' (design/tokens.json "color" and "color-light"); no new hues.

import { COLOURS } from "../../app/colours.js"; // W185 colours (SPEC §321): the light's white and the shade's black
const { white: WHITE, black: BLACK } = COLOURS["color-fixed"]; // W185 colours
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** The sources, given absolute URLs for the DEM PMTiles and the contours GeoJSON (optional). W231 sculclimbs: no slope (the steep ground went). */
export function terrainSources({ dem, contours }) {
  // the zooms come from the file (the app ships z8 to z11, and MapLibre overzooms)
  const raster = (url) => ({ type: "raster-dem", url: "pmtiles://" + url, tileSize: 512, encoding: "mapbox",
    attribution: "Elevation: SRTM (NASA/USGS)" });
  return {
    "terrain-dem": raster(dem),
    // MapLibre wants 3D terrain on its own source, not the one the hillshade reads
    "terrain-dem-3d": raster(dem),
    ...(contours && { "terrain-contours": { type: "geojson", data: contours, maxzoom: 14, tolerance: 0.5 } }),
  };
}

/**
 * The layers for the options that are on, each with the id of the chart layer it goes under.
 * opts: { hillshade, contours: 0 | 5 | 10 }; color: the theme's token colours; light: Daystar.
 */
export function terrainLayers(opts, color, light) {
  const out = [];
  const under = "system-area"; // the shading goes over the ground, the water and the buildings, under every line and label
  if (opts.hillshade) {
    out.push([{ id: "terrain-hillshade", type: "hillshade", source: "terrain-dem",
      paint: light
        ? { "hillshade-method": "standard", "hillshade-exaggeration": 1, "hillshade-illumination-direction": 315, "hillshade-illumination-anchor": "viewport",
          "hillshade-shadow-color": rgba(color.stardust, 0.7), "hillshade-highlight-color": rgba(WHITE, 0.8), "hillshade-accent-color": rgba(color.stardust, 0.2) }
        : { "hillshade-method": "standard", "hillshade-exaggeration": 1, "hillshade-illumination-direction": 315, "hillshade-illumination-anchor": "viewport",
          "hillshade-shadow-color": rgba(BLACK, 0.55), "hillshade-highlight-color": rgba(color.stardust, 0.6), "hillshade-accent-color": rgba(color["space-3"], 0.2) } }, under]);
  }
  if (opts.contours) {
    const every = opts.contours, index = every * 5;
    const isIndex = ["==", ["%", ["get", "ele"], index], 0];
    const c = color.stardust;
    out.push([{ id: "terrain-contour", type: "line", source: "terrain-contours", minzoom: 13,
      filter: ["==", ["%", ["get", "ele"], every], 0],
      layout: { "line-join": "round" },
      paint: { "line-color": c, "line-width": ["case", isIndex, 1.5, 0.9],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 13, ["case", isIndex, 0.35, 0.2], 16, ["case", isIndex, 0.65, 0.4]] } }, "comet-trail"]);
    out.push([{ id: "terrain-contour-label", type: "symbol", source: "terrain-contours", minzoom: 14.5,
      filter: isIndex,
      layout: { "symbol-placement": "line", "symbol-spacing": 420, "text-field": ["concat", ["to-string", ["get", "ele"]], " m"],
        "text-font": ["Antonio SemiBold", "Noto Sans Condensed SemiBold"], "text-size": 12, "text-letter-spacing": 0.06, "text-max-angle": 30,
        "text-padding": 8 },
      paint: { "text-color": c, "text-opacity": light ? 0.75 : 0.6, "text-halo-color": color.void, "text-halo-width": 1.4 } }, "asteroid-belt-label"]);
  }
  return out;
}

/**
 * W229 climbs (design/app-ui/SPEC.md §482), pancake's design: how steep the ground is, in three levels (4 to 7 %, 7 to 10 %, over
 * 10 %), opaque, over the ground detail and under the map's information. The source is build_climbs.py's field (README.md, "Climbs"):
 * the grade in 0.1 %, exact at each level's edge, which a color-relief layer reads through MapLibre's custom DEM encoding and samples
 * linearly, so the edges are smooth at every zoom and lie on raised hills as the rest of the ground. Each colour starts 0.1 % under
 * its level (the stops must be whole tenths: MapLibre stores a stop in the tile's own encoding), so an edge blends over 0.1 % of grade.
 * Water and everything after it draw over the climbs (`CLIMBS_UNDER`); the buildings, which the style draws over the water, move under
 * them (`CLIMBS_OVER`): on a climb no park green and no building shows through. They show from z12, fading in over half a zoom.
 */
export const CLIMBS_UNDER = "nebula-glow-rim", CLIMBS_OVER = ["hulls"], CLIMBS_FROM = 12, CLIMBS_FADE = 0.5;
export const CLIMB_SOURCE = "climbs", CLIMB_LAYER_IDS = ["climbs"];
/** The climbs' source, given the absolute URL of its PMTiles: R × 0.1 is the grade in percent. USGS 3DEP is public domain: its credit
 *  is in About's credits, as SRTM's, so the chart's credit stays OpenStreetMap's alone (W58 clean). */
export const climbsSource = (url) => ({ type: "raster-dem", url: "pmtiles://" + url, tileSize: 512, encoding: "custom", redFactor: 0.1, greenFactor: 0, blueFactor: 0, baseShift: 0 });
/** The climbs' layer and the id it goes under, in a theme's colours (`ramp`: { gentle, medium, steep }, design/tokens.json climbs). */
export function climbsLayers(ramp) {
  return [[{ id: "climbs", type: "color-relief", source: CLIMB_SOURCE, minzoom: CLIMBS_FROM,
    paint: { "color-relief-opacity": ["interpolate", ["linear"], ["zoom"], CLIMBS_FROM, 0, CLIMBS_FROM + CLIMBS_FADE, 1],
      "color-relief-color": ["interpolate", ["linear"], ["elevation"], 3.9, rgba(ramp.gentle, 0), 4, ramp.gentle, 6.9, ramp.gentle, 7, ramp.medium,
        9.9, ramp.medium, 10, ramp.steep] } }, CLIMBS_UNDER]];
}

/** The terrain spec for map.setTerrain() at an exaggeration (2, 4 or 6), or null for a flat chart. */
export const terrainSpec = (exaggeration) => (exaggeration ? { source: "terrain-dem-3d", exaggeration } : null);

/** Every layer id this module can add, to take them out again. */
export const TERRAIN_LAYER_IDS = ["terrain-hillshade", "terrain-contour", "terrain-contour-label"]; // W231 sculclimbs: no tint, no steep ground
