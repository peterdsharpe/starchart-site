// The ways to show hills on the Saturnight chart: the sources and layers for each, in both themes, as plain
// style JSON. design/app-ui/w18-terrain/ shows each option alone and together (wave 18); the app (wave 19,
// app/terrain.js) draws a, c and b as Settings › Hills asks, and e when tilted. It draws no contours: they
// read as roads.
//
//   hillshade  a. light from the top left of the screen (as the glyphs are lit), lit slopes a faint glow
//   tint       b. an elevation tint: the higher, the lighter (Dark) or the inkier (Daystar), very faint
//   grade      c. steep ground tinted in caution lime, in three steps: 6 %, 9 % and 12 % grade and up
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

/** The sources, given absolute URLs for the DEM and slope PMTiles and the contours GeoJSON (each but the DEM optional). */
export function terrainSources({ dem, slope, contours }) {
  // the zooms come from the file (the app ships z8 to z11, and MapLibre overzooms)
  const raster = (url) => ({ type: "raster-dem", url: "pmtiles://" + url, tileSize: 512, encoding: "mapbox",
    attribution: "Elevation: SRTM (NASA/USGS)" });
  return {
    "terrain-dem": raster(dem),
    // MapLibre wants 3D terrain on its own source, not the one the hillshade reads
    "terrain-dem-3d": raster(dem),
    ...(slope && { "terrain-slope": raster(slope) }),
    ...(contours && { "terrain-contours": { type: "geojson", data: contours, maxzoom: 14, tolerance: 0.5 } }),
  };
}

/**
 * The layers for the options that are on, each with the id of the chart layer it goes under.
 * opts: { hillshade, tint, grade, contours: 0 | 5 | 10 }; color: the theme's token colours; light: Daystar.
 */
export function terrainLayers(opts, color, light) {
  const out = [];
  const under = "system-area"; // the shading goes over the ground, the water and the buildings, under every line and label
  if (opts.tint) {
    // Dark: starlight rising from nothing at 5 m to 25 % at 110 m. Daystar: stardust ink, twice as strong (W112 palette, her
    // note of 2026-10-24: "terrain ... barely visible"; was 1.25).
    const c = light ? color.stardust : color.starlight, k = light ? 2 : 1;
    out.push([{ id: "terrain-tint", type: "color-relief", source: "terrain-dem",
      paint: { "color-relief-opacity": 1, "color-relief-color": ["interpolate", ["linear"], ["elevation"],
        5, rgba(c, 0), 20, rgba(c, 0.07 * k), 40, rgba(c, 0.13 * k), 70, rgba(c, 0.19 * k), 110, rgba(c, 0.25 * k)] } }, under]);
  }
  if (opts.grade) {
    // color-relief takes only an interpolate ramp. W20 terrain3d: each step rises over 1 % of grade, centred
    // on 6, 9 and 12 %, and the slope comes in 0.5 % steps (v3). Steps 0.1 % wide on whole-percent data drew
    // the edges along the z11 tiles' 28 m pixels, as blocks and stairs when magnified.
    const c = color.caution, a = light ? [0.12, 0.21, 0.34] : [0.05, 0.1, 0.18]; // W112 palette: stronger by day, was 0.08, 0.15, 0.26
    out.push([{ id: "terrain-grade", type: "color-relief", source: "terrain-slope",
      paint: { "color-relief-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 14, 1],
        "color-relief-color": ["interpolate", ["linear"], ["elevation"], 5.5, rgba(c, 0), 6.5, rgba(c, a[0]), 8.5, rgba(c, a[0]), 9.5, rgba(c, a[1]),
          11.5, rgba(c, a[1]), 12.5, rgba(c, a[2])] } }, under]);
  }
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

/** The terrain spec for map.setTerrain() at an exaggeration (2, 4 or 6), or null for a flat chart. */
export const terrainSpec = (exaggeration) => (exaggeration ? { source: "terrain-dem-3d", exaggeration } : null);

/** Every layer id this module can add, to take them out again. */
export const TERRAIN_LAYER_IDS = ["terrain-tint", "terrain-grade", "terrain-hillshade", "terrain-contour", "terrain-contour-label"];
