import { describe, it, expect } from 'vitest';
import { calculateMortgage, schedule, annuity, parseNumber, validate } from './mortgage-core';

const ok = (r: ReturnType<typeof calculateMortgage>) => {
  if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r.errors));
  return r.value;
};
const fieldsOf = (r: ReturnType<typeof calculateMortgage>) => (r.ok ? [] : r.errors.map((e) => e.field));

describe('calculateMortgage — golden cases', () => {
  it('7 %, 20 %, 25 years on 38 236 000 ₸ ≈ 216 195 ₸/month (audit reference)', () => {
    const v = ok(calculateMortgage({ price: 38_236_000, downPct: 20, ratePct: 7, months: 300 }));
    expect(v.loan).toBe(30_588_800);
    expect(v.monthly).toBe(216_195);
    expect(v.total - v.loan).toBe(v.overpayment);
  });
  it('0 % rate: payments sum exactly to the loan', () => {
    const v = ok(calculateMortgage({ price: 12_000_001, downPct: 0, ratePct: 0, months: 7 }));
    expect(v.total).toBe(12_000_001);
    expect(v.overpayment).toBe(0);
  });
  it('1 month term: one payment = loan + one month of interest', () => {
    const v = ok(calculateMortgage({ price: 10_000_000, downPct: 0, ratePct: 12, months: 1 }));
    expect(v.total).toBe(10_100_000);
    expect(v.monthly).toBe(v.lastPayment);
  });
  it('18.5 %, 360 months', () => {
    const v = ok(calculateMortgage({ price: 30_000_000, downPct: 20, ratePct: 18.5, months: 360 }));
    expect(v.monthly).toBe(Math.round(annuity(24_000_000, 18.5, 360)));
    expect(v.overpayment).toBeGreaterThan(v.loan); // long, expensive loan
  });
  it('100 % down: no loan, no payments, no interest', () => {
    const v = ok(calculateMortgage({ price: 25_000_000, downPct: 100, ratePct: 7, months: 300 }));
    expect(v).toMatchObject({ down: 25_000_000, loan: 0, monthly: 0, total: 0, overpayment: 0 });
  });
});

describe('schedule', () => {
  it.each([[1], [12], [360]])('closes the balance to exactly 0 (%i months)', (n) => {
    const rows = schedule(17_777_777, 7.3, n);
    expect(rows).toHaveLength(n);
    expect(rows[rows.length - 1].balance).toBe(0);
    expect(rows.every((r) => r.payment >= 0 && r.interest >= 0)).toBe(true);
  });
});

describe('properties', () => {
  it('a bigger down payment never increases the monthly payment', () => {
    let prev = Infinity;
    for (let d = 0; d <= 100; d += 5) {
      const m = ok(calculateMortgage({ price: 40_000_000, downPct: d, ratePct: 9, months: 240 })).monthly;
      expect(m).toBeLessThanOrEqual(prev);
      prev = m;
    }
  });
  it('payment is non-negative across rates', () => {
    for (const r of [0, 0.1, 7, 18.5, 40, 100]) expect(ok(calculateMortgage({ price: 1_000_000, downPct: 10, ratePct: r, months: 12 })).monthly).toBeGreaterThanOrEqual(0);
  });
});

describe('validation', () => {
  it('rejects bad input with field-specific errors instead of silently using 0', () => {
    expect(fieldsOf(calculateMortgage({ price: 0, downPct: 20, ratePct: 7, months: 12 }))).toEqual(['price']);
    expect(fieldsOf(calculateMortgage({ price: -1, downPct: 20, ratePct: 7, months: 12 }))).toEqual(['price']);
    expect(fieldsOf(calculateMortgage({ price: 1e6, downPct: 101, ratePct: 7, months: 12 }))).toEqual(['downPct']);
    expect(fieldsOf(calculateMortgage({ price: 1e6, downPct: -1, ratePct: 7, months: 12 }))).toEqual(['downPct']);
    expect(fieldsOf(calculateMortgage({ price: 1e6, downPct: 20, ratePct: -0.1, months: 12 }))).toEqual(['ratePct']);
    expect(fieldsOf(calculateMortgage({ price: 1e6, downPct: 20, ratePct: 7, months: 0 }))).toEqual(['months']);
    expect(fieldsOf(calculateMortgage({ price: 1e6, downPct: 20, ratePct: 7, months: 1.5 }))).toEqual(['months']);
    expect(fieldsOf(calculateMortgage({ price: 1e6, downPct: NaN, ratePct: NaN, months: NaN }))).toEqual(['downPct', 'ratePct', 'months']);
  });
  it('0 years (0 months) at 0 % no longer divides by zero', () => {
    expect(validate({ price: 1e6, downPct: 0, ratePct: 0, months: 0 }).map((e) => e.field)).toEqual(['months']);
  });
});

describe('parseNumber', () => {
  it('accepts comma decimals and spaces, rejects text', () => {
    expect(parseNumber('18,5')).toBe(18.5);
    expect(parseNumber('25 000 000')).toBe(25_000_000);
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('1e5')).toBeNaN();
  });
});
