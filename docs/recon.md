# Разведка svoydom.kz — 2026-11-20

Сделано 8 GET-запросов с паузой ≥2 с, User-Agent `SvoyDom3D-concept-recon/0.1`. Всё сохранено в `data/raw/recon/`.

## robots.txt
- Раздел `User-agent: *`: закрыты `/bitrix/`, `/local/ajax/`, **`/apartments/ajax.php`**, `/search/`, `/personal/`, `/auth/` и служебные параметры.
- Страницы `/projects/`, `/apartments/`, `/lp/`, `/comfort_projects/` и пагинация через `PAGEN_` открыты.
- Задержки обхода (Crawl-delay) нет. Под собственные правила попадают только SEO-краулеры, AI-ботов отдельно не ограничивают.

## Источники данных
| # | Где | Что внутри | Можно по robots? |
|---|-----|------------|------------------|
| A | `/apartments/astana/` → `window.__APTS_DATA__` (JSON в HTML) | `zhkList` (29 записей, вместе с «коммерцией»): id, name, district, classSlug, url, deadline, year, crmId; `filterData` по каждому ЖК (диапазоны комнат, этажей, цен, площадей); первые 12 из **1281** квартир | ✅ да |
| B | `/apartments/ajax.php` — пагинация того же списка | все 1281 квартира | ❌ **нет, Disallow** |
| C | `/lp/astana/{slug}/` → `<apartments-filter :items=… ajax-url=…>` | первые 12 квартир этого ЖК (например, Aibat: 12 из 257) + filter-data | ✅ да |
| D | `/local/components/custom/apartments.filter/ajax.php` — пагинация внутри ЖК | все квартиры ЖК | ⚠️ в Disallow этого пути нет, но это ajax, а по комментарию в robots ajax закрыт намеренно. Пока **не запрашивал** |
| E | `/comfort_projects/{slug}/` → `ymaps.Placemark([lat,lon], {header, body: адрес})` | 86 меток с координатами и адресами: проекты SVOYDOM, офисы продаж, инфраструктура | ✅ да. Координаты указаны самим SVOYDOM, это не данные Яндекса |
| F | `/projects/astana/` → JSON-LD `ItemList` + 15 ссылок на карточки | названия ЖК, URL (включая `/business_projects/`) | ✅ да |
| G | Лендинги ссылаются на `3d.svoydom.kz/?media-name=Aibat` | ссылка на 3D-тур | — |

### Уточнение по D (2026-11-20)
Компонент формирует запрос `GET /local/components/custom/apartments.filter/ajax.php?action=getApartments&iblock_id=141&page_size=12&mode=apartments&page=N` (плюс фильтры `rooms[]`, `price_min/max`, `area_min/max`, `floor_min/max`) с заголовком `X-Requested-With: XMLHttpRequest`.
В robots.txt есть правило **`Disallow: /*action=`**, под которое этот URL попадает. Значит, **D закрыт robots**. Эндпоинт не вызывался.

## Пример квартиры (из A и C)
```json
{"id":"69546","xmlId":"13871811","name":"№403","url":"/lp/astana/aibat/",
 "picture":"/upload/svdom_webp/mx2i…-eb1a3b931a8e.webp","pictureFull":"/upload/svdom_webp/mx2i…-ada8d98bc066.webp",
 "rooms":1,"type":"1K","price":18433800,"area":37.24,"priceSqm":495000,"floor":6,"status":"0",
 "zhkName":"ЖК Aibat","iblockId":141}
```
Пример ЖК из `zhkList`:
```json
{"id":141,"name":"ЖК Aibat","district":"Район Сарыарка","districtSlug":"saryarka","classSlug":"komfort",
 "url":"/lp/astana/aibat/","deadline":"II квартал 2027 года","year":2027,"hasFlat":true}
```

## Каких полей нет
- **Корпуса, секции и позиции на этаже нет.** Есть только `floor` и номер `name` («№403»). Настоящую шахматку «этаж × позиция» собрать нельзя. Можно показать «этаж × список квартир» (честный вариант) или попробовать вывести позицию из номера квартиры, но это будет догадка.
- `status` всегда `"0"`: судя по всему, в выдачу попадают только свободные квартиры. Проданных и забронированных квартир нет.
- Ссылки на конкретную квартиру нет: `url` ведёт на страницу ЖК.
- Статус проекта («строится» или «сдан») явно не указан. Его придётся выводить из `deadline` и раздела сайта (`/sdannye/`).
