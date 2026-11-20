import { describe, it, expect } from 'vitest';
import { encodeState, decodeState, emptyState } from './nav-state';

describe('nav-state', () => {
  it('default state encodes to an empty query', () => {
    expect(encodeState(emptyState())).toBe('');
  });

  it('round-trips filters, project level, apartment and camera', () => {
    const s = {
      ...emptyState(),
      statuses: ['строится', 'сдан'], classes: ['Комфорт+'], rooms: [2, 1], year: 2027, budget: 35, district: 'Нура',
      project: 'elaman', building: 'elaman:b1', section: null, floor: 5, apartment: '68760', tab: 'district' as const,
      view: 'list' as const, camera: { lng: 71.524965, lat: 51.109129, zoom: 16.3456, bearing: -28.04, pitch: 62.01 },
    };
    const back = decodeState(encodeState(s));
    expect(back).toMatchObject({ ...s, rooms: [1, 2], camera: { lat: 51.10913, zoom: 16.35, bearing: -28, pitch: 62 } });
    expect(back.camera!.lng).toBeCloseTo(71.52497, 4);
  });

  it('default shows all statuses; a single status round-trips', () => {
    expect(decodeState('').statuses).toEqual([]);
    expect(encodeState({ ...emptyState(), statuses: [] })).toBe('');
    expect(encodeState({ ...emptyState(), statuses: ['строится'] })).toBe('?st=b');
    expect(decodeState('?st=b').statuses).toEqual(['строится']);
    expect(decodeState('?st=-').statuses).toEqual([]); // old links with explicit "none" still work
  });

  it('project-level keys are ignored without a project', () => {
    const s = decodeState('?f=3&a=1&t=about');
    expect(s).toMatchObject({ project: null, floor: null, apartment: null, tab: 'apts' });
  });

  it('rejects junk and out-of-range values', () => {
    const s = decodeState('?r=0,2,9,x&y=1999&bmax=-5&p=<script>&cam=1,2,99,0,0&f=0');
    expect(s.rooms).toEqual([2]);
    expect(s.year).toBe(0);
    expect(s.budget).toBe(0);
    expect(s.project).toBeNull();
    expect(s.camera).toBeNull();
  });

  it('round-trips search view, apartment filters and sort', () => {
    const s = { ...emptyState(), view: 'search' as const, aptFilter: { rooms: [2, 4], priceMax: 30, areaMin: 45, floorMin: 2, notFirst: true, notLast: false, project: 'qadam' }, sort: { key: 'priceM2' as const, dir: 'desc' as const }, projectView: 'list' as const };
    expect(decodeState(encodeState(s))).toMatchObject({ view: 'search', aptFilter: s.aptFilter, sort: s.sort, projectView: 'list' });
    expect(decodeState('?v=hack&so=evil-x').view).toBe('map');
    expect(decodeState('?so=evil-x').sort).toEqual({ key: 'price', dir: 'asc' });
  });

  it('accepts the legacy #slug deep link', () => {
    expect(decodeState('', '#aibat').project).toBe('aibat');
  });
});
