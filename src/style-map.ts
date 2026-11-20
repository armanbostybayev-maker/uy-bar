import type { StyleSpecification } from 'maplibre-gl';

// Own light "clear day" style over OpenFreeMap vector tiles (OpenMapTiles schema, © OpenStreetMap).
export const C = {
  bg: '#f2f0eb',
  water: '#b9d3e3',
  park: '#d6e6cc',
  road: '#ffffff',
  roadCase: '#e2ded5',
  major: '#fdfbf6',
  building: '#e7e3da',
  label: '#6b6f76',
};

const font = ['Noto Sans Regular'];
export const mapStyle: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>' } },
  light: { anchor: 'viewport', color: '#ffffff', intensity: 0.32, position: [1.4, 210, 35] },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': C.bg } },
    { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'farmland']]], paint: { 'fill-color': C.park, 'fill-opacity': 0.55 } },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': C.park, 'fill-opacity': 0.8 } },
    { id: 'landuse-res', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['==', ['get', 'class'], 'residential'], paint: { 'fill-color': '#ece9e2', 'fill-opacity': 0.6 } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': C.water } },
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': C.water, 'line-width': 1.2 } },
    {
      id: 'road-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12,
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.roadCase, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 3.6, 18, 40.8] },
    },
    {
      id: 'road', type: 'line', source: 'omt', 'source-layer': 'transportation',
      filter: ['!', ['in', ['get', 'class'], ['literal', ['rail', 'transit', 'path', 'track']]]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], C.major, C.road],
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 1.68, 0.48], 18, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], 33.6, 14.4]],
      },
    },
    {
      id: 'osm-buildings', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 12.5,
      paint: {
        'fill-extrusion-color': C.building,
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.5, ['coalesce', ['get', 'render_height'], 8]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.82,
        'fill-extrusion-vertical-gradient': true,
      },
    },
    {
      id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14,
      layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:ru'], ['get', 'name']], 'text-font': font, 'text-size': 11 },
      paint: { 'text-color': C.label, 'text-halo-color': '#fff', 'text-halo-width': 1.4 },
    },
    {
      id: 'place-label', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 14,
      filter: ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood', 'quarter']]],
      layout: { 'text-field': ['coalesce', ['get', 'name:ru'], ['get', 'name']], 'text-font': font, 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08 },
      paint: { 'text-color': '#9a9ca1', 'text-halo-color': '#fff', 'text-halo-width': 1.2 },
    },
  ],
};
