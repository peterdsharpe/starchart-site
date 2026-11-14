// W205 symbols (SPEC §376): MapLibre cuts a tile of every GeoJSON source for every tile of a view while one of its layers is in range,
// an empty source's too, on the one worker the chart's tiles wait for: at rest 14 of the app's sources held nothing and asked for 56
// of a jump's 77 tiles (scratch/perf-2026-11-09/contention.md). So a GeoJSON source's layers are out of the zoom range (PAST, past the
// map's maxZoom) while it holds nothing, and back in their own range as it fills. The zoom range, not visibility: showing and hiding a
// layer (Layers, the preview's look, a route's names) stays its module's. Every setData ends in MapLibre's "metadata" sourcedata event,
// and a context's restored style fires it again, so no module calls this.

const PAST = 24; // the style spec's highest zoom: hidden at every zoom the map can reach (maxZoom 19.5)

/** True for GeoJSON that draws nothing: no data, an empty FeatureCollection, or a Feature with no geometry. A URL is not known yet. */
export function holdsNothing(data) {
  if (data == null) return true;
  if (typeof data !== "object") return false;
  if (data.type === "FeatureCollection") return !data.features?.length;
  if (data.type === "Feature") return !data.geometry;
  return false;
}

/** Keep the layers of `map`'s empty GeoJSON sources out of range until they hold data. Returns { held }: the held layers' own ranges. */
export function restWhileEmpty(map) {
  const held = new Map(); // a held layer's id -> [its own minzoom, maxzoom]
  const hold = (source, empty) => {
    for (const id of map.getLayersOrder()) {
      const L = map.getLayer(id);
      if (L?.source !== source) continue;
      if (empty && L.minzoom !== PAST) {
        held.set(id, [L.minzoom ?? 0, L.maxzoom ?? PAST]);
        map.setLayerZoomRange(id, PAST, PAST);
      } else if (!empty && held.has(id)) {
        if (L.minzoom === PAST) map.setLayerZoomRange(id, ...held.get(id)); // still held: a layer added again since keeps its own
        held.delete(id);
      }
    }
  };
  map.on("sourcedata", (e) => { if (e.sourceDataType === "metadata" && e.source?.type === "geojson") hold(e.sourceId, holdsNothing(e.source.data)); });
  const seen = new Set(); // the sources already in the style (its own: the course, the chevrons, the ghosts), whose events have passed
  for (const id of map.getLayersOrder()) {
    const s = map.getLayer(id)?.source;
    if (!s || seen.has(s)) continue;
    seen.add(s);
    const src = map.getSource(s)?.serialize?.();
    if (src?.type === "geojson") hold(s, holdsNothing(src.data));
  }
  return { held };
}
