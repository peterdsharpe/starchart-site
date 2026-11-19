// W205 workers (design/app-ui/SPEC.md §375): loaded into MapLibre's workers (maplibregl.importScriptInWorkers, chart.js). Once the
// chart is stored, its tile requests are opfs://<paths>/z/x/y (tiles.js storedRequest), and the worker that parses a tile reads
// it here, from the stored files, so a tile no longer makes two trips through the main thread. Its TileJSON still does.
import { PMTiles } from "../vendor/pmtiles.mjs";
import { STORED, storedHandler } from "./tiles.js";

self.addProtocol(STORED, storedHandler(PMTiles));
