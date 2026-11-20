# Improvement Roadmap

## Этап 1 — Critical Fixes (4–8 недель)

| Задача | Трудоёмкость | Зависимости/риски | Критерий приёмки |
|---|---:|---|---|
| Официальный apartment feed + schema/provenance | XL | CRM/выгрузка SVOYDOM | Полный coverage, version/date/source, уникальные ID |
| Корпус/секция/этаж mapping | XL | Планы/CRM | Ни одна квартира не без building/section |
| Честный schematic mode | S | Нет | UI нигде не называет этаж точной квартирой |
| Доменная валидация ипотеки + unit tests | M | Согласованные правила | Все edge cases зелёные, ошибки inline |
| Production lead form | L | Backend/CRM, legal, anti-spam | Consent, phone validation, idempotency, audit trail |
| URL/state/back model | M | Router/store | Back восстанавливает фильтры, этаж, квартиру и camera |
| List fallback для карты | L | UX/API | Полный сценарий доступен клавиатурой без 3D |

## Этап 2 — UX/UI Excellence (6–10 недель)

| Задача | Трудоёмкость | Зависимости/риски | Критерий приёмки |
|---|---:|---|---|
| Шахматка building/section + virtualization | L | Полные данные | 1 000 ячеек без long task >200 мс |
| Мобильная навигация и 3 snap states | M | UX design | 44px targets, Back/keyboard/safe-area tests |
| Поиск, сортировка, квартирные фильтры | L | Индекс/данные | Комбинации, zero state, shareable URL |
| Избранное и сравнение 2–4 квартир | L | Account/local persistence | Таблица различий, устойчивое сохранение |
| Полная карточка квартиры | M | Content fields | Все подтверждённые поля + timestamps |
| Accessibility WCAG 2.2 AA | L | Design system | Keyboard, SR, 200% zoom, reduced motion |
| Performance budgets | M | CI/analytics | CWV targets p75, bundle gate |

## Этап 3 — Advanced PropTech (8–16+ недель)

| Задача | Трудоёмкость | Зависимости/риски | Критерий приёмки |
|---|---:|---|---|
| BIM/GLTF pipeline и LOD | XL | Лицензии, модели | Проверенная геопривязка, mobile FPS ≥45 |
| Apartment mesh + section cut | XL | Floor polygons | Grid↔3D двусторонний единый ID |
| Фасады/окна/стороны света | XL | Окна и north axis | Никаких inferred claims без source |
| Вид из окна | XL | City model/terrain, legal | Accuracy label/date/source, fallback |
| Банковские программы | L | Bank feeds/legal review | Актуальность, ГЭСВ, limits, eligibility |

## Последовательность

Сначала получить и валидировать данные. Затем исправить ипотеку, навигационное состояние и accessibility fallback. Только после этого инвестировать в apartment-level 3D: без топологии красивый 3D повышает риск ложного обещания, а не конверсию.

## Автоматизация

- Unit: mortgage, filters, formatters, geometry/source validation.
- Contract/data: uniqueness, referential integrity, coverage, freshness, price/status invariants.
- Playwright E2E: карта/list → ЖК → секция → квартира → ипотека → форма; mobile Back; empty/error/offline.
- Visual regression: 320, 390, 768, 1024, 1440; bottom-sheet snap points; шахматка statuses.
- Performance: Lighthouse budgets and interaction trace for map/chess.

Исправления в код не вносились: аудит завершает этап анализа, как требует мастер-промпт.
