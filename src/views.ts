// Top-level sections that don't need the map: apartment search, favourites, compare.
// Rendering only — state and navigation are owned by main.ts and passed in via `ViewCtx`.
import { esc, fmtTg, fmtMln, fmtDate } from './data';
import { matchesApt, sortApts, compareRows, isFilterEmpty, emptyAptFilter, COMPARE_MAX, COMPARE_MIN, type AptFilter, type AptSort, type IndexedApartment, type ShortList } from './apartments';

export interface ViewCtx {
  favs: ShortList;
  cmp: ShortList;
  filter: AptFilter;
  sort: AptSort;
  projects: { slug: string; name: string }[];
  onFilter(f: AptFilter, s: AptSort): void;
  openApartment(a: IndexedApartment): void;
  toggleFav(id: string): void;
  toggleCmp(id: string): void;
  goView(v: 'search' | 'fav' | 'compare'): void;
}

const ROOMS = [1, 2, 3, 4];
const SORTS: { v: string; l: string }[] = [
  { v: 'price-asc', l: 'Сначала дешёвые' }, { v: 'price-desc', l: 'Сначала дорогие' },
  { v: 'area-desc', l: 'Площадь: больше' }, { v: 'area-asc', l: 'Площадь: меньше' },
  { v: 'priceM2-asc', l: 'Цена за м²: ниже' }, { v: 'priceM2-desc', l: 'Цена за м²: выше' },
  { v: 'floor-desc', l: 'Этаж: выше' }, { v: 'floor-asc', l: 'Этаж: ниже' },
];

/** One apartment row, shared by search, favourites and the project list. */
export function aptRow(a: IndexedApartment, ctx: Pick<ViewCtx, 'favs' | 'cmp'>, opts: { showProject?: boolean } = {}) {
  const fav = ctx.favs.has(a.apartmentId), cmp = ctx.cmp.has(a.apartmentId);
  const label = `№${a.number ?? '—'}, ${a.rooms ?? '—'}-комн., ${a.area ?? '—'} м², этаж ${a.floor ?? '—'}${opts.showProject ? `, ЖК ${a.projectName}` : ''}, ${fmtTg(a.price)}`;
  return `<li class="arow" data-row="${esc(a.apartmentId)}">
    <button type="button" class="arow__main" data-open="${esc(a.apartmentId)}" aria-label="Открыть: ${esc(label)}">
      <span class="arow__title"><b>${a.rooms ? `${a.rooms}-комн.` : '—'}, ${a.area ?? '—'} м²</b> · №${esc(a.number)}</span>
      <span class="arow__meta">${opts.showProject ? `ЖК ${esc(a.projectName)} · ` : ''}этаж ${a.floor ?? '—'}${a.floorsMax ? ` из ${a.floorsMax}` : ''} · ${esc(a.status)}</span>
      <span class="arow__price"><b>${fmtMln(a.price)} ₸</b><span class="muted">${fmtTg(a.priceM2)}/м²</span></span>
    </button>
    <button type="button" class="ibtn ${fav ? 'is-on' : ''}" data-fav="${esc(a.apartmentId)}" aria-pressed="${fav}" aria-label="${fav ? 'Убрать из избранного' : 'В избранное'}: №${esc(a.number)}">${fav ? '♥' : '♡'}</button>
    <button type="button" class="ibtn ${cmp ? 'is-on' : ''}" data-cmp="${esc(a.apartmentId)}" aria-pressed="${cmp}" aria-label="${cmp ? 'Убрать из сравнения' : 'Сравнить'}: №${esc(a.number)}">⇄</button>
  </li>`;
}

function bindRows(root: HTMLElement, byId: Map<string, IndexedApartment>, ctx: ViewCtx) {
  root.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => (b.onclick = () => { const a = byId.get(b.dataset.open!); if (a) ctx.openApartment(a); }));
  root.querySelectorAll<HTMLButtonElement>('[data-fav]').forEach((b) => (b.onclick = () => ctx.toggleFav(b.dataset.fav!)));
  root.querySelectorAll<HTMLButtonElement>('[data-cmp]').forEach((b) => (b.onclick = () => ctx.toggleCmp(b.dataset.cmp!)));
}

export function aptFilterForm(f: AptFilter, s: AptSort, projects: { slug: string; name: string }[] | null, idp: string) {
  return `<form class="afilter" data-afilter onsubmit="return false" aria-label="Фильтры квартир">
    <fieldset class="afilter__rooms"><legend>Комнат</legend>${ROOMS.map((r) => `<button type="button" class="chip ${f.rooms.includes(r) ? 'is-on' : ''}" data-room="${r}" aria-pressed="${f.rooms.includes(r)}">${r === 4 ? '4+' : r}</button>`).join('')}</fieldset>
    <label>Цена до, млн ₸<input type="number" inputmode="decimal" min="0" step="1" name="priceMax" value="${f.priceMax || ''}" placeholder="любая"></label>
    <label>Площадь от, м²<input type="number" inputmode="decimal" min="0" step="1" name="areaMin" value="${f.areaMin || ''}" placeholder="любая"></label>
    <label>Этаж от<input type="number" inputmode="numeric" min="0" step="1" name="floorMin" value="${f.floorMin || ''}" placeholder="любой"></label>
    ${projects ? `<label>ЖК<select name="project"><option value="">Все ЖК</option>${projects.map((p) => `<option value="${esc(p.slug)}" ${f.project === p.slug ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
    <label class="check"><input type="checkbox" name="notFirst" ${f.notFirst ? 'checked' : ''}> Не первый этаж</label>
    <label class="check"><input type="checkbox" name="notLast" ${f.notLast ? 'checked' : ''}> Не последний этаж</label>
    <label>Сортировка<select name="sort" id="${idp}-sort">${SORTS.map((o) => `<option value="${o.v}" ${`${s.key}-${s.dir}` === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select></label>
    <button type="button" class="btn btn--ghost btn--sm" data-afilter-reset ${isFilterEmpty(f) ? 'disabled' : ''}>Сбросить фильтры</button>
  </form>`;
}

/** Wires a filter form; calls back with the new filter/sort on every change. */
export function bindAptFilter(root: HTMLElement, f: AptFilter, s: AptSort, cb: (f: AptFilter, s: AptSort) => void) {
  const form = root.querySelector<HTMLFormElement>('[data-afilter]');
  if (!form) return;
  const read = (): [AptFilter, AptSort] => {
    const n = (k: string) => { const v = Number((form.elements.namedItem(k) as HTMLInputElement | null)?.value || 0); return Number.isFinite(v) && v > 0 ? v : 0; };
    const nf: AptFilter = {
      rooms: [...form.querySelectorAll<HTMLButtonElement>('[data-room][aria-pressed="true"]')].map((b) => Number(b.dataset.room)),
      priceMax: n('priceMax'), areaMin: n('areaMin'), floorMin: Math.floor(n('floorMin')),
      notFirst: (form.elements.namedItem('notFirst') as HTMLInputElement).checked,
      notLast: (form.elements.namedItem('notLast') as HTMLInputElement).checked,
      project: ((form.elements.namedItem('project') as HTMLSelectElement | null)?.value) ?? f.project,
    };
    const [key, dir] = ((form.elements.namedItem('sort') as HTMLSelectElement).value).split('-') as [AptSort['key'], AptSort['dir']];
    return [nf, { key, dir }];
  };
  form.querySelectorAll<HTMLButtonElement>('[data-room]').forEach((b) => (b.onclick = () => { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); b.classList.toggle('is-on'); cb(...read()); }));
  form.addEventListener('change', () => cb(...read()));
  let t = 0;
  form.addEventListener('input', (e) => { if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'number') { clearTimeout(t); t = window.setTimeout(() => cb(...read()), 300); } });
  form.querySelector<HTMLButtonElement>('[data-afilter-reset]')!.onclick = () => cb({ ...emptyAptFilter(), project: '' }, s);
}

const coverageNote = (all: IndexedApartment[], updatedAt: string) => {
  const incomplete = new Set(all.filter((a) => !a.catalogComplete).map((a) => a.projectSlug)).size;
  return `<p class="note note--warn">Поиск идёт по ${all.length} квартирам, опубликованным на открытых страницах svoydom.kz (данные на ${fmtDate(updatedAt)}). У ${incomplete} ЖК каталог неполный — часть квартир здесь не видна.</p>`;
};

export function renderSearch(root: HTMLElement, all: IndexedApartment[], updatedAt: string, ctx: ViewCtx) {
  const found = sortApts(all.filter((a) => matchesApt(a, ctx.filter)), ctx.sort);
  const byId = new Map(all.map((a) => [a.apartmentId, a]));
  root.innerHTML = `<div class="view__head"><h2 tabindex="-1" data-view-heading>Поиск квартир</h2><span class="muted" role="status">${found.length} из ${all.length}</span></div>
    ${aptFilterForm(ctx.filter, ctx.sort, ctx.projects, 'search')}
    ${coverageNote(all, updatedAt)}
    ${found.length ? `<ul class="alist" aria-label="Найденные квартиры">${found.map((a) => aptRow(a, ctx, { showProject: true })).join('')}</ul>`
      : `<div class="empty" role="status"><b>Ничего не найдено.</b><p>Попробуйте убрать часть фильтров.</p><button type="button" class="btn btn--primary btn--sm" data-empty-reset>Сбросить фильтры</button></div>`}`;
  bindAptFilter(root, ctx.filter, ctx.sort, ctx.onFilter);
  root.querySelector<HTMLButtonElement>('[data-empty-reset]')?.addEventListener('click', () => ctx.onFilter(emptyAptFilter(), ctx.sort));
  bindRows(root, byId, ctx);
}

export function renderFavs(root: HTMLElement, all: IndexedApartment[], ctx: ViewCtx) {
  const byId = new Map(all.map((a) => [a.apartmentId, a]));
  const list = ctx.favs.list().map((id) => byId.get(id)).filter(Boolean) as IndexedApartment[];
  root.innerHTML = `<div class="view__head"><h2 tabindex="-1" data-view-heading>Избранное</h2><span class="muted" role="status">${list.length}</span></div>
    ${list.length ? `<ul class="alist" aria-label="Избранные квартиры">${list.map((a) => aptRow(a, ctx, { showProject: true })).join('')}</ul>
      <div class="actions"><button type="button" class="btn btn--ghost btn--sm" data-fav-clear>Очистить избранное</button></div>
      <p class="note">Избранное хранится только в этом браузере. Цены и наличие — на дату данных; проверяйте на svoydom.kz.</p>`
      : `<div class="empty"><b>Пока пусто.</b><p>Нажмите ♡ в карточке квартиры или в результатах поиска.</p><button type="button" class="btn btn--primary btn--sm" data-go-search>Перейти к поиску</button></div>`}`;
  bindRows(root, byId, ctx);
  root.querySelector<HTMLButtonElement>('[data-fav-clear]')?.addEventListener('click', () => { if (confirm('Удалить все квартиры из избранного?')) ctx.favs.clear(); });
  root.querySelector<HTMLButtonElement>('[data-go-search]')?.addEventListener('click', () => ctx.goView('search'));
}

let onlyDiff = false;
export function renderCompare(root: HTMLElement, all: IndexedApartment[], ctx: ViewCtx) {
  const byId = new Map(all.map((a) => [a.apartmentId, a]));
  const list = ctx.cmp.list().map((id) => byId.get(id)).filter(Boolean) as IndexedApartment[];
  const head = `<div class="view__head"><h2 tabindex="-1" data-view-heading>Сравнение</h2><span class="muted" role="status">${list.length} из ${COMPARE_MAX}</span></div>`;
  if (list.length < COMPARE_MIN) {
    root.innerHTML = `${head}<div class="empty"><b>${list.length ? 'Добавьте ещё одну квартиру.' : 'Нечего сравнивать.'}</b><p>Сравнить можно от ${COMPARE_MIN} до ${COMPARE_MAX} квартир — нажмите ⇄ в карточке или в поиске.</p><button type="button" class="btn btn--primary btn--sm" data-go-search>Перейти к поиску</button></div>
      ${list.length ? `<ul class="alist">${list.map((a) => aptRow(a, ctx, { showProject: true })).join('')}</ul>` : ''}`;
    bindRows(root, byId, ctx);
    root.querySelector<HTMLButtonElement>('[data-go-search]')?.addEventListener('click', () => ctx.goView('search'));
    return;
  }
  const rows = compareRows(list).filter((r) => !onlyDiff || r.diff || r.label === 'ЖК' || r.label === 'Квартира');
  root.innerHTML = `${head}
    <label class="check"><input type="checkbox" data-only-diff ${onlyDiff ? 'checked' : ''}> Только различия</label>
    <div class="cmp-wrap" tabindex="0" role="region" aria-label="Таблица сравнения, прокручивается по горизонтали">
    <table class="cmp">
      <caption class="sr-only">Сравнение ${list.length} квартир</caption>
      <thead><tr><th scope="col"><span class="sr-only">Параметр</span></th>${list.map((a) => `<th scope="col">
        ${a.planImageUrl ? `<img src="${esc(a.planImageUrl)}" alt="Планировка №${esc(a.number)}" loading="lazy">` : ''}
        <button type="button" class="btn btn--ghost btn--sm" data-open="${esc(a.apartmentId)}">Открыть</button>
        <button type="button" class="ibtn" data-cmp="${esc(a.apartmentId)}" aria-pressed="true" aria-label="Убрать №${esc(a.number)} из сравнения">✕</button></th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.diff ? 'is-diff' : ''}"><th scope="row">${r.label}</th>${r.values.map((v, i) => `<td class="${r.best === i ? 'is-best' : ''}">${esc(r.label === 'Данные на' ? fmtDate(v) : v)}${r.best === i ? '<span class="sr-only"> — лучшее значение</span>' : ''}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="note">Зелёным — лучшее значение строки (меньше цена, больше площадь). Строки с различиями выделены. Корпус и секция в открытых данных не опубликованы.</p>
    <div class="actions"><button type="button" class="btn btn--ghost btn--sm" data-cmp-clear>Очистить сравнение</button></div>`;
  bindRows(root, byId, ctx);
  root.querySelector<HTMLInputElement>('[data-only-diff]')!.onchange = (e) => { onlyDiff = (e.target as HTMLInputElement).checked; renderCompare(root, all, ctx); };
  root.querySelector<HTMLButtonElement>('[data-cmp-clear]')!.onclick = () => ctx.cmp.clear();
}

export function renderViewError(root: HTMLElement, title: string, retry: () => void) {
  root.innerHTML = `<div class="view__head"><h2 tabindex="-1" data-view-heading>${esc(title)}</h2></div>
    <div class="state-error" role="alert"><b>Не удалось загрузить квартиры.</b><p>Проверьте соединение и попробуйте ещё раз.</p><button type="button" class="btn btn--primary" data-retry>Повторить</button></div>`;
  root.querySelector<HTMLButtonElement>('[data-retry]')!.onclick = retry;
}
