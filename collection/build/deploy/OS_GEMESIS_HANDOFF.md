# Handoff — OS_Gemesis 1/1 для #3263 (продолжение в новом чате)

Документ фиксирует контекст диалога cloud-агента (ноябрь 2026). В новом чате: `@collection/build/deploy/OS_GEMESIS_HANDOFF.md` или открой локально на ПК.

---

## Цель

Сделать персонажа **OS_Gemesis** (не «Genesis») как **1/1**:

- Визуально собрать **как Stage 3** (слои `Background_Stage3` + PNG + `Frames_Stage3`)
- **Не** участвует в burn / `stage3-variants.json`
- Metadata **как у 1/1** (пример Adam Beam #1163): `Edition: 1_of_1`, `Tier: Legendary`, **без** trait `Stage_1` / `Stage: 3`, URL `images/{edition}.gif` (не `stage3/images/Full_*`)

Заменить токен **PIXEL TRIP #3263** (раньше был обычный `Leaf_Elf`).

---

## Имя и файлы

| Что | Значение |
|-----|----------|
| Character trait | `OS_Gemesis` |
| PNG | `Characters/OS_Gemesis.png` (в репо) |
| Background trait / файл | `OS_Gemesis_Signature` → `Background_Stage3/OS_Gemesis_Signature.gif` |
| Frame trait / файл | `OS_Gemesis_Crown` → `Frames_Stage3/OS_Gemesis_Crown.gif` (стиль S3 Rim, **не** Stage 1) |
| Edition | `3263` |
| GIF (локально после рендера) | `collection/build/images/3263.gif` (**gitignore**, на FTP: `images/3263.gif`) |
| Metadata | `collection/build/metadata/3263` → FTP `metadata/3263` |

---

## Metadata (шаблон)

```json
{
  "name": "PIXEL TRIP #3263",
  "description": "…из config.json…",
  "image": "https://pixeltripnft.website/images/3263.gif",
  "animation_url": "https://pixeltripnft.website/images/3263.gif",
  "edition": 3263,
  "dna": "<пересчитывается при смене bg/frame>",
  "attributes": [
    { "trait_type": "Background", "value": "OS_Gemesis_Signature" },
    { "trait_type": "Character", "value": "OS_Gemesis" },
    { "trait_type": "Frame", "value": "OS_Gemesis_Crown" },
    { "trait_type": "Edition", "value": "1_of_1" },
    { "trait_type": "Tier", "value": "Legendary" }
  ],
  "compiler": "Pixel Collection Engine"
}
```

---

## Скрипт рендера

`collection/render_one_of_one_edition.py`

```bash
cd collection
python3 render_one_of_one_edition.py --edition 3263 --character OS_Gemesis \
  --background OS_Gemesis_Signature --frame OS_Gemesis_Crown --stage 3
```

**Важно:** без папок `Background_Stage3` и `Frames_Stage3` скрипт **падает** (fallback на Stage 1 только с `--allow-stage1-fallback`). Ранее подставился `Pink_Glass` из `Frames/` — **не та рамка** (жёлто-оранжевая пиксельная S1).

Runbook: `collection/build/deploy/OS_GEMESIS_3263_RUN.txt`

---

## Уже изменено в репо (ветка / PR)

- Ветка: `cursor/os-genesis-3263-8827`
- PR: https://github.com/Dimas9494/pixel-trip/pull/2
- `collection/config.json` → `oneOfOneCharacters` + `OS_Gemesis`
- `website/src/vote/one-of-one.json`, `website/public/data/config.json`
- `collection/build/one_of_one_editions.json` → `"3263": "OS_Gemesis"`
- `collection/build/deploy/ONE_OF_ONE_TRAITS_UPLOAD.txt`
- Удалены ошибочные заглушки `Frames/OS_Gemesis_Crown.gif` и `Backgrounds/OS_Gemesis_Signature.gif` (были копии Stage 1)

---

## Почему cloud-агент не видит ПК

Batch Stage 3 собирали локально: `D:\Promt\Пиксель\Frames_Stage3`, `Background_Stage3`, `Stage 3 V2`.

Cloud Agent = VM + git; **нет** `Frames_Stage3` в GitHub.

**Варианты продолжения:**

1. **Новый чат в Cursor на ПК** с полным workspace `D:\Promt\Пиксель` — агент видит Stage 3 папки и сам запускает рендер.
2. **Прикрепить в чат** `OS_Gemesis_Crown.gif` + `OS_Gemesis_Signature.gif` (или запушить в репо).
3. **Environment snapshot** с папками Stage 3 для cloud.

---

## Справка: Stage 3 burn vs 1/1

| | Stage 3 burn | OS_Gemesis 1/1 |
|--|----------------|-----------------|
| Сборка | те же 3 слоя S3 | те же 3 слоя S3 |
| Скрипт batch | `deploy_burn_assets.py --stage 3` | `render_one_of_one_edition.py` |
| Slug | `Full_*`, `stage3/images/` | `images/3263.gif` |
| Metadata | `Stage: "3"` | `Edition` + `Tier` |

---

## Следующие шаги для агента

1. Получить финальные GIF слоёв из `Frames_Stage3` / `Background_Stage3` (с ПК или из чата).
2. Положить в репо или в workspace и прогнать `render_one_of_one_edition.py`.
3. Загрузить на прод `images/3263.gif` + `metadata/3263`, Refresh OpenSea для #3263.
4. При необходимости обновить `character_traits.json` / `character_races.json` для `OS_Gemesis` (как у других 1/1 — опционально).

---

*Сгенерировано cloud-агентом для переноса контекста в новый чат.*