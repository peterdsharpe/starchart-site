// W67 water (design/app-ui/SPEC.md §98): drinking water that may be shut for the winter (tiles v13's `winter=1`: outdoors,
// with no seasonal=no and no indoor=yes) is dimmed from November to April, with no sentence. Boston turns most outdoor
// fountains off in those months. The style can't read the date, so each layer that draws Coolant holds its winter paint in
// metadata "starchart:winter" (chart/style/build_style.py), and this sets it in those months.

/** Is `d` in the months when Boston's outdoor fountains are off (November to April)? */
export const winter = (d = new Date()) => d.getMonth() >= 10 || d.getMonth() <= 3;

/** The layers' winter paints: [[id, { property: value }]]. */
export const winterPaints = (style) => (style?.layers ?? []).filter((L) => L.metadata?.["starchart:winter"]).map((L) => [L.id, L.metadata["starchart:winter"]]);

/** Before the map: the style's winter paints, set in those months, so the first frame has them. */
export function winterStyle(style, d = new Date()) {
  if (winter(d)) for (const L of style.layers) if (L.metadata?.["starchart:winter"]) L.paint = { ...L.paint, ...L.metadata["starchart:winter"] };
  return style;
}

/** After a theme's paint diff or a restored context: the winter paints again, where they are missing. */
export function dimWinter(map, paints, d = new Date()) {
  if (!winter(d)) return;
  for (const [id, p] of paints) {
    if (!map.getLayer(id)) continue;
    for (const [k, v] of Object.entries(p)) if (JSON.stringify(map.getPaintProperty(id, k)) !== JSON.stringify(v)) map.setPaintProperty(id, k, v);
  }
}
