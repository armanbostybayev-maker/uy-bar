import { describe, it, expect } from 'vitest';
import { matchesApt, sortApts, ShortList, compareRows, emptyAptFilter, isFilterEmpty, type IndexedApartment, type Storage } from './apartments';

const apt = (o: Partial<IndexedApartment>): IndexedApartment => ({
  apartmentId: 'p:1', sourceId: '1', projectSlug: 'p', projectName: 'P', projectStatus: 'строится', projectClass: 'Комфорт', deadline: null, district: null,
  url: '', catalogComplete: false, number: '1', rooms: 1, area: 40, price: 20e6, priceM2: 500_000, floor: 3, floorsMax: 12, status: 'свободна',
  planImageUrl: null, buildingId: null, sectionId: null, updatedAt: '2026-11-20', ...o,
});
const mem = (): Storage => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };

describe('matchesApt', () => {
  it('empty filter matches everything', () => {
    expect(isFilterEmpty(emptyAptFilter())).toBe(true);
    expect(matchesApt(apt({}), emptyAptFilter())).toBe(true);
  });
  it('rooms 4 means 4+', () => {
    const f = { ...emptyAptFilter(), rooms: [4] };
    expect(matchesApt(apt({ rooms: 5 }), f)).toBe(true);
    expect(matchesApt(apt({ rooms: 3 }), f)).toBe(false);
  });
  it('price, area, floor bounds and not-first/not-last', () => {
    const f = { ...emptyAptFilter(), priceMax: 25, areaMin: 40, floorMin: 2, notLast: true };
    expect(matchesApt(apt({}), f)).toBe(true);
    expect(matchesApt(apt({ price: 25_000_001 }), f)).toBe(false);
    expect(matchesApt(apt({ area: 39.9 }), f)).toBe(false);
    expect(matchesApt(apt({ floor: 1 }), f)).toBe(false);
    expect(matchesApt(apt({ floor: 12 }), f)).toBe(false);
    expect(matchesApt(apt({ floor: 1 }), { ...emptyAptFilter(), notFirst: true })).toBe(false);
  });
  it('unknown values never pass an active bound', () => {
    expect(matchesApt(apt({ price: null }), { ...emptyAptFilter(), priceMax: 100 })).toBe(false);
  });
});

describe('sortApts', () => {
  const list = [apt({ apartmentId: 'a', price: 30e6 }), apt({ apartmentId: 'b', price: null }), apt({ apartmentId: 'c', price: 10e6 }), apt({ apartmentId: 'd', price: 30e6 })];
  it('asc / desc with nulls last and stable ties', () => {
    expect(sortApts(list, { key: 'price', dir: 'asc' }).map((a) => a.apartmentId)).toEqual(['c', 'a', 'd', 'b']);
    expect(sortApts(list, { key: 'price', dir: 'desc' }).map((a) => a.apartmentId)).toEqual(['a', 'd', 'c', 'b']);
  });
  it('does not mutate the input', () => {
    const before = list.map((a) => a.apartmentId);
    sortApts(list, { key: 'price', dir: 'asc' });
    expect(list.map((a) => a.apartmentId)).toEqual(before);
  });
});

describe('ShortList (favourites / compare)', () => {
  it('persists across instances and caps at max', () => {
    const s = mem();
    const c = new ShortList('cmp', 4, s);
    for (const id of ['a', 'b', 'c', 'd']) expect(c.add(id)).toBe(true);
    expect(c.add('e')).toBe(false);
    expect(c.full).toBe(true);
    expect(new ShortList('cmp', 4, s).list()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('toggle, prune and corrupt storage', () => {
    const s = mem();
    const f = new ShortList('fav', Infinity, s);
    f.toggle('x'); f.toggle('y'); f.toggle('x');
    expect(f.list()).toEqual(['y']);
    f.prune(new Set(['z']));
    expect(f.size).toBe(0);
    s.setItem('bad', '{not json');
    expect(new ShortList('bad', Infinity, s).list()).toEqual([]);
    s.setItem('mixed', JSON.stringify(['ok', 3, null]));
    expect(new ShortList('mixed', Infinity, s).list()).toEqual(['ok']);
  });
  it('notifies listeners', () => {
    const f = new ShortList('n', Infinity, mem());
    let calls = 0;
    f.onChange(() => calls++);
    f.add('a'); f.add('a'); f.remove('zz'); f.remove('a');
    expect(calls).toBe(2);
  });
});

describe('compareRows', () => {
  it('marks differing rows and a unique best value', () => {
    const rows = compareRows([apt({ apartmentId: 'a', price: 20e6, area: 40 }), apt({ apartmentId: 'b', price: 25e6, area: 40 })]);
    const price = rows.find((r) => r.label === 'Цена')!;
    const area = rows.find((r) => r.label === 'Площадь')!;
    expect(price.diff).toBe(true);
    expect(price.best).toBe(0);
    expect(area.diff).toBe(false);
    expect(area.best).toBeUndefined();
  });
});
