import type { LngLat, BuildingGeom, Apartment } from './data';

const M = 111320;
export const distM = (a: LngLat, b: LngLat) => Math.hypot((b[0] - a[0]) * M * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * M);

export function pointInRing([x, y]: LngLat, ring: LngLat[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function circle(center: LngLat, radiusM: number, steps = 72): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push([center[0] + (Math.cos(a) * radiusM) / (M * Math.cos((center[1] * Math.PI) / 180)), center[1] + (Math.sin(a) * radiusM) / M]);
  }
  return out;
}

export const bbox = (rings: LngLat[][]): [LngLat, LngLat] => {
  const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
};

export const FLOOR_H = 3.1;
export const GROUND_H = 4.2; // ground floor with lobby/commercial

export const floorBase = (f: number) => (f <= 1 ? 0 : GROUND_H + (f - 2) * FLOOR_H);
export const floorTop = (f: number) => (f <= 1 ? GROUND_H : GROUND_H + (f - 1) * FLOOR_H) - 0.25;

/** One extruded slab per building per floor. Apartment→building is unknown in source data,
 *  so availability is counted per floor of the whole ZhK and shown on every building. */
export type FloorAvailability = 'free' | 'none' | 'unknown';
/** 'free' — has available units; 'none' — catalogue is complete and nothing is available;
 *  'unknown' — catalogue incomplete, so an empty floor proves nothing. */
export function floorAvailability(free: number, catalogComplete: boolean): FloorAvailability {
  return free > 0 ? 'free' : catalogComplete ? 'none' : 'unknown';
}

export function floorsGeoJSON(buildings: BuildingGeom[], apts: Apartment[], catalogComplete: boolean) {
  const perFloor = new Map<number, number>();
  for (const a of apts) if (a.floor != null && a.status === 'свободна') perFloor.set(a.floor, (perFloor.get(a.floor) || 0) + 1);
  const features: GeoJSON.Feature[] = [];
  buildings.forEach((b, bi) => {
    for (let f = 1; f <= b.floors; f++) {
      const free = perFloor.get(f) || 0;
      features.push({
        type: 'Feature',
        id: bi * 1000 + f,
        properties: { building: bi, buildingId: b.buildingId, floor: f, free, availability: floorAvailability(free, catalogComplete), base: floorBase(f), top: floorTop(f) },
        geometry: { type: 'Polygon', coordinates: [b.ring] },
      });
    }
  });
  return { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection;
}

export const buildingHeight = (floors: number) => floorTop(floors) + 0.25;
