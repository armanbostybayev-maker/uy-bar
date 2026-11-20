// Pure mortgage maths — no DOM. All money is handled in whole tenge for the schedule;
// the monthly payment is computed in floating point and the last instalment closes the balance to exactly 0.

export interface MortgageInput {
  /** apartment price, ₸ */
  price: number;
  /** down payment, % of price (0–100) */
  downPct: number;
  /** nominal annual rate, % (0–100) */
  ratePct: number;
  /** term in months (integer ≥ 1) */
  months: number;
}

export type Field = keyof MortgageInput;
export interface ValidationError { field: Field; message: string }

export interface Breakdown {
  price: number;
  down: number;
  loan: number;
  months: number;
  /** regular monthly payment, rounded to ₸ (0 when the loan is 0) */
  monthly: number;
  /** last payment, may differ from `monthly` by rounding */
  lastPayment: number;
  /** sum of all payments */
  total: number;
  /** total − loan */
  overpayment: number;
}

export type MortgageResult = { ok: true; value: Breakdown } | { ok: false; errors: ValidationError[] };

export const LIMITS = { maxPrice: 10_000_000_000, maxRatePct: 100, maxMonths: 600 } as const;

/** Parse a user-typed number: accepts "7,5", spaces as thousand separators; returns NaN for anything else. */
export function parseNumber(raw: string): number {
  const s = raw.replace(/\s| /g, '').replace(',', '.');
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

export function validate(input: MortgageInput): ValidationError[] {
  const e: ValidationError[] = [];
  const { price, downPct, ratePct, months } = input;
  if (!Number.isFinite(price)) e.push({ field: 'price', message: 'Цена должна быть числом' });
  else if (price <= 0) e.push({ field: 'price', message: 'Цена должна быть больше 0' });
  else if (price > LIMITS.maxPrice) e.push({ field: 'price', message: 'Слишком большая цена' });

  if (!Number.isFinite(downPct)) e.push({ field: 'downPct', message: 'Введите число от 0 до 100' });
  else if (downPct < 0 || downPct > 100) e.push({ field: 'downPct', message: 'Взнос — от 0 до 100 %' });

  if (!Number.isFinite(ratePct)) e.push({ field: 'ratePct', message: 'Введите число, например 7 или 18,5' });
  else if (ratePct < 0) e.push({ field: 'ratePct', message: 'Ставка не может быть отрицательной' });
  else if (ratePct > LIMITS.maxRatePct) e.push({ field: 'ratePct', message: `Ставка — не больше ${LIMITS.maxRatePct} %` });

  if (!Number.isFinite(months)) e.push({ field: 'months', message: 'Введите срок числом' });
  else if (!Number.isInteger(months)) e.push({ field: 'months', message: 'Срок — целое число месяцев' });
  else if (months < 1) e.push({ field: 'months', message: 'Срок — не меньше 1 месяца' });
  else if (months > LIMITS.maxMonths) e.push({ field: 'months', message: `Срок — не больше ${LIMITS.maxMonths / 12} лет` });
  return e;
}

/** Annuity payment (unrounded). r = 0 → straight division. */
export function annuity(loan: number, ratePct: number, months: number): number {
  if (loan <= 0) return 0;
  const r = ratePct / 100 / 12;
  return r === 0 ? loan / months : (loan * r) / (1 - Math.pow(1 + r, -months));
}

/** Amortisation schedule in whole tenge; the last row brings the balance to exactly 0. */
export function schedule(loan: number, ratePct: number, months: number) {
  const r = ratePct / 100 / 12;
  const pay = Math.round(annuity(loan, ratePct, months));
  const rows: { n: number; payment: number; interest: number; principal: number; balance: number }[] = [];
  let balance = Math.round(loan);
  for (let n = 1; n <= months && balance > 0; n++) {
    const interest = Math.round(balance * r);
    let payment = n === months ? balance + interest : pay;
    if (payment - interest > balance) payment = balance + interest; // early close by rounding
    const principal = payment - interest;
    balance -= principal;
    rows.push({ n, payment, interest, principal, balance });
  }
  return rows;
}

export function calculateMortgage(input: MortgageInput): MortgageResult {
  const errors = validate(input);
  if (errors.length) return { ok: false, errors };
  const price = Math.round(input.price);
  const down = Math.round((price * input.downPct) / 100);
  const loan = price - down;
  if (loan === 0) return { ok: true, value: { price, down, loan, months: input.months, monthly: 0, lastPayment: 0, total: 0, overpayment: 0 } };
  const rows = schedule(loan, input.ratePct, input.months);
  const total = rows.reduce((s, x) => s + x.payment, 0);
  return {
    ok: true,
    value: { price, down, loan, months: input.months, monthly: rows[0].payment, lastPayment: rows[rows.length - 1].payment, total, overpayment: total - loan },
  };
}
