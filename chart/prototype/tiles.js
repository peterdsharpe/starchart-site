// The chart's tile handler (W21 tiles): past the archive's detailed coverage, the chart shows the best
// lower-resolution tile it has, enlarged, and never the bare background.
//
// The archive has z13 to z15 only inside planetiler's --bounds, but its z8 to z12 tiles spread past them,
// as far as Hudson and Clinton (chart/SCHEMA.md). The stock pmtiles protocol hid them in two ways:
//   - its TileJSON passed the header's bounds on, so MapLibre asked for no tile past them, at any zoom;
//   - a tile the archive lacks came back empty, which MapLibre takes as a tile loaded with nothing in it,
//     so it dropped the parent it was showing.
// Here an archive's TileJSON goes without bounds (W51 edge: the hills' too), and a missing tile is an error (MISSING, from the
// protocol's errorOnMissingTile). For an errored tile MapLibre keeps the nearest loaded parent, and asks
// for the next one up, as far as 10 zooms up (_updateRetainedTiles, maplibre-gl 6.14); a "404" would not
// do, since its vector source turns that into an empty tile too. makeMap (chart.js) quiets these errors.
// A stored tile file (app/main.js) is added to the same protocol, so it goes through here too.

export const MISSING = "Tile not found."; // what pmtiles throws for a missing tile with errorOnMissingTile

/** MapLibre's handler for `pmtiles://`, from a pmtiles Protocol made with { errorOnMissingTile: true }. */
export function tileHandler(protocol) {
  return async (params, abort) => {
    const r = await protocol.tilev4(params, abort);
    if (params.type === "json") {
      const header = await protocol.get(params.url.slice("pmtiles://".length))?.getHeader();
      // W51 edge: the hills' DEM too, so past its own detail (z11 to -71.54 in the west) the tint and the steep ground draw
      // their parents, enlarged, as far as z8's tiles (-71.72), at every zoom, and end under the chart's fade (build_style.py)
      if (header) delete r.data.bounds;
    }
    return r;
  };
}
