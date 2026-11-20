# Performance Audit

## Подтверждённые измерения

Production build успешен.

| Asset | Raw | gzip |
|---|---:|---:|
| MapLibre/geo JS chunk | 807.32 КБ | 219.92 КБ |
| Main app JS | 26.99 КБ | 10.08 КБ |
| CSS | 77.25 КБ | 12.34 КБ |
| Editor JS | 6.30 КБ | 2.82 КБ |

Lighthouse Mobile/Desktop, полевые LCP/INP/CLS, memory и FPS на слабом устройстве не измерены; статус — **N/A**, не «пройдено».

## Риски

1. MapLibre chunk загружается до любой полезной альтернативы; на медленной сети пользователь видит только shell.
2. 81 ЖК допустимы, кластеризация уже включена, но `hideOsmInsideZhk()` перебирает source features и все rings после moveend (`src/main.ts:157-175`). Нужен profiling на слабых устройствах.
3. Для каждого этажа каждого здания выполняются отдельные `setFeatureState` при focus/hover (`src/main.ts:328-345`). На больших проектах это может стать INP bottleneck.
4. Hero/plan/gallery используют внешние изображения; только gallery имеет `loading="lazy"`, hero и plan — нет явных размеров/decoding policy.
5. Fonts идут с Google Fonts; нет self-host/fallback metrics и offline control.

## План оптимизации

- Отделить list-first shell от карты: lazy import MapLibre после первого meaningful paint или при открытии «Карта».
- Preload только critical CSS; self-host subset fonts или использовать system font.
- Кэшировать spatial index OSM buildings; вычислять hide set в worker/idle callback.
- Обновлять feature state батчем/через data-driven expression; не обходить все этажи на hover.
- Виртуализировать шахматку >200 ячеек.
- Для изображений: width/height, responsive `srcset`, WebP/AVIF, `loading=lazy` вне viewport, abort при смене ЖК.
- В production: собственные tiles/кэш, timeout/retry/error UI.

## Бюджеты и приёмка

- LCP ≤2.5 с, INP ≤200 мс, CLS ≤0.1 на 75-м процентиле.
- Initial JS gzip ≤170 КБ без карты; карта загружается отдельно.
- 3D interaction ≥45 FPS на согласованном Android mid-tier.
- Открытие карточки/шахматки p75 ≤500 мс после данных.
- Performance CI: Lighthouse budgets + bundle size gate; результаты хранить по commit.
