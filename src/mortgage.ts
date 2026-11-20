import { fmtTg } from './data';
import { calculateMortgage, parseNumber, type Field, type MortgageInput } from './mortgage-core';

// Example presets only — not an eligibility check. Real programme limits, borrower and property
// requirements must come from a bank/programme catalogue with source and validity dates.
export const PROGRAMS = {
  example72025: { label: 'Пример 7/20/25', rate: 7, down: 20, years: 25 },
  market: { label: 'Рыночная (пример)', rate: 18.5, down: 20, years: 20 },
} as const;
type Key = keyof typeof PROGRAMS;

let uid = 0;

export function mortgageWidget(root: HTMLElement, price: number) {
  const id = `m${++uid}`;
  let prog: Key | null = 'example72025';
  // raw text values as typed, so invalid input is shown back with an error instead of being coerced
  const raw = { downPct: '20', ratePct: '7', term: '25' };
  let termUnit: 'years' | 'months' = 'years';

  const setPreset = (k: Key) => {
    prog = k;
    const p = PROGRAMS[k];
    raw.downPct = String(p.down); raw.ratePct = String(p.rate); raw.term = String(p.years); termUnit = 'years';
  };

  const input = (): MortgageInput => {
    const term = parseNumber(raw.term);
    return { price, downPct: parseNumber(raw.downPct), ratePct: parseNumber(raw.ratePct), months: termUnit === 'years' ? Math.round(term * 12 * 1e6) / 1e6 : term };
  };

  root.innerHTML = `
    <div class="mort">
      <div class="seg" role="group" aria-label="Пример условий">${(Object.keys(PROGRAMS) as Key[]).map((k) => `<button type="button" class="seg__b" data-prog="${k}">${PROGRAMS[k].label}</button>`).join('')}</div>
      <div class="mort__grid">
        <div class="mfield" data-field="downPct"><label for="${id}-down">Взнос, %</label><input id="${id}-down" inputmode="decimal" data-k="downPct" aria-describedby="${id}-down-err ${id}-down-tg"><small id="${id}-down-tg" class="muted"></small><span class="mfield__err" id="${id}-down-err" role="alert"></span></div>
        <div class="mfield" data-field="ratePct"><label for="${id}-rate">Ставка, % годовых</label><input id="${id}-rate" inputmode="decimal" data-k="ratePct" aria-describedby="${id}-rate-err"><span class="mfield__err" id="${id}-rate-err" role="alert"></span></div>
        <div class="mfield" data-field="months"><label for="${id}-term">Срок</label>
          <div class="mfield__row"><input id="${id}-term" inputmode="decimal" data-k="term" aria-describedby="${id}-term-err">
          <select data-k="unit" aria-label="Единица срока"><option value="years">лет</option><option value="months">мес.</option></select></div>
          <span class="mfield__err" id="${id}-term-err" role="alert"></span></div>
      </div>
      <div class="mort__res" aria-live="polite"></div>
      <button type="button" class="btn btn--ghost btn--sm" data-reset>Сбросить к примеру</button>
      <p class="note">Ориентировочный расчёт аннуитета. Пресеты — примеры, а не проверка участия в программе: лимиты цены, требования к объекту и заёмщику, ГЭСВ и комиссии уточняйте у банка. Не оферта.</p>
    </div>`;

  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const inputs = { downPct: q<HTMLInputElement>('[data-k=downPct]'), ratePct: q<HTMLInputElement>('[data-k=ratePct]'), term: q<HTMLInputElement>('[data-k=term]') };
  const unit = q<HTMLSelectElement>('[data-k=unit]');
  const res = q<HTMLElement>('.mort__res');

  const syncPreset = () =>
    root.querySelectorAll<HTMLButtonElement>('[data-prog]').forEach((b) => { const on = b.dataset.prog === prog; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
  const syncInputs = () => {
    inputs.downPct.value = raw.downPct; inputs.ratePct.value = raw.ratePct; inputs.term.value = raw.term; unit.value = termUnit;
    syncPreset();
  };

  const render = () => {
    const r = calculateMortgage(input());
    const errs = new Map<Field, string>(r.ok ? [] : r.errors.map((e) => [e.field, e.message]));
    for (const f of ['downPct', 'ratePct', 'months'] as Field[]) {
      const box = q<HTMLElement>(`[data-field=${f}]`);
      const msg = errs.get(f) || '';
      box.classList.toggle('is-invalid', !!msg);
      box.querySelector('input')!.setAttribute('aria-invalid', String(!!msg));
      box.querySelector('.mfield__err')!.textContent = msg;
    }
    const downPct = parseNumber(raw.downPct);
    q<HTMLElement>(`#${id}-down-tg`).textContent = Number.isFinite(downPct) && downPct >= 0 && downPct <= 100 ? `= ${fmtTg((price * downPct) / 100)}` : '';
    if (!r.ok) { res.innerHTML = `<p class="mort__invalid">Исправьте поля, отмеченные красным, — расчёт не выполняется.</p>`; return; }
    const v = r.value;
    const row = (k: string, val: string, cls = '') => `<div class="${cls}"><span>${k}</span><b>${val}</b></div>`;
    res.innerHTML = v.loan === 0
      ? row('Кредит не нужен', 'взнос 100 %', 'is-main') + row('Первый взнос', fmtTg(v.down))
      : row('Платёж в месяц', fmtTg(v.monthly), 'is-main')
        + (v.lastPayment !== v.monthly ? row('Последний платёж', fmtTg(v.lastPayment)) : '')
        + row('Цена квартиры', fmtTg(v.price))
        + row('Первый взнос', fmtTg(v.down))
        + row('Сумма кредита', fmtTg(v.loan))
        + row('Переплата (проценты)', fmtTg(v.overpayment))
        + row(`Всего выплат за ${v.months} мес.`, fmtTg(v.total));
  };

  root.querySelectorAll<HTMLButtonElement>('[data-prog]').forEach((b) => (b.onclick = () => { setPreset(b.dataset.prog as Key); syncInputs(); render(); }));
  for (const [k, el] of Object.entries(inputs)) el.addEventListener('input', () => { (raw as Record<string, string>)[k] = el.value; prog = null; syncPreset(); render(); });
  unit.onchange = () => { termUnit = unit.value as typeof termUnit; prog = null; syncPreset(); render(); };
  q<HTMLButtonElement>('[data-reset]').onclick = () => { setPreset('example72025'); syncInputs(); render(); };

  setPreset('example72025');
  syncInputs();
  render();
}
