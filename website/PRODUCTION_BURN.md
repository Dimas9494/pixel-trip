# PIXEL TRIP — Evolution Lab (Burn-to-Evolve)

**Статус: LIVE** — Evolution Lab доступен на основном сайте:

- Главная: https://pixeltripnft.website/
- Evolution Lab: https://pixeltripnft.website/burn.html
- Mint: https://opensea.io/collection/pixeltripnft

---

## Как работает система

Коллекция состоит из **двух контрактов**:

| Роль | Адрес | Что делает |
|------|--------|------------|
| **Stage 1 (SeaDrop)** | `0xadf9c3c2d2946b3c80913b9e022dc2ce9e93afd9` | NFT коллекция на OpenSea. Token ID **не меняется** при эволюции. |
| **EvolvePixelTrip v3** | `0x1B174b30A0ABA50bd73aF305caDB01e23bfda0EC` | Хранит `stage1Character[tokenId]` и `evolvedStage[tokenId]`. Принимает `evolve(keepId, burnId)`. |

```text
Кошелёк владельца
       │
       ▼
burn.html (Evolution Lab)
  · читает ownerOf из SeaDrop
  · читает charId + stage из Evolve
  · показывает картинки с сервера
       │
       ▼
evolve(keepId, burnId)  →  burnId уничтожен, keepId повышен
       │
       ▼
update-metadata.php  →  перезаписывает metadata/keepId
       │
       ▼
OpenSea читает metadata → новая картинка Stage 2 или 3
```

### Правила эволюции

| Тип персонажа | Путь |
|---------------|------|
| Обычный (≥3 копий в коллекции) | Stage 1 + Stage 1 → **Stage 2**, затем Stage 2 + Stage 2 → **Stage 3** |
| Редкий (2 копии, напр. Antler_Skull) | Stage 1 + Stage 1 → **Stage 3** напрямую |
| 1-of-1 | Сжигание заблокировано |

Оба сжигаемых токена должны иметь **одинаковый character** и **одинаковую стадию**.
Первый выбранный токен = **KEEP** (он эволюционирует), второй = **BURN** (уничтожается).

---

## Структура файлов на сервере (`public_html/`)

```text
public_html/
├── index.html, burn.html, preview.html
├── assets/                          ← JS/CSS из website/dist/assets/
│
├── images/                          ← Stage 1 GIF (основная коллекция)
│   ├── 1.gif
│   ├── 6.gif
│   └── … 4444.gif
│
├── metadata/                        ← Stage 1 JSON (файлы БЕЗ расширения)
│   ├── 1
│   ├── 6
│   └── …
│
├── stage2/
│   └── images/                      ← Stage 2 GIF (по slug варианта)
│       ├── Blue_Cap_Boy_Zombie.gif
│       ├── Neon_Diva.gif
│       └── …
│
├── stage3/
│   └── images/                      ← Stage 3 GIF (по slug)
│       ├── Full_Blue_Cap_Boy_Zombie.gif
│       └── …
│
├── images/burn/                     ← Декоративные картинки на странице burn (не NFT)
│   ├── 1.gif, 2.gif, 3.gif, 4.gif
│
├── update-metadata.php              ← Обновление metadata после evolve
├── metadata.php                     ← Динамический endpoint (если tokenURI указывает сюда)
├── char-map.json                    ← имя персонажа → charId (290 шт.)
├── stage2-variants.json             ← список Stage 2 вариантов по character
├── stage3-variants.json             ← маппинг Stage 2 slug → Stage 3 slug
├── token-assignments.json           ← создаётся автоматически (кто какой вариант получил)
└── variant-map.json                 ← опционально, фиксированные назначения
```

> **Важно:** папка `Test/` — это **старый тестовый минт**. Для main-коллекции используйте только `images/` и `metadata/` в корне. Не копируйте `Test/images/` в `images/` — tokenId там привязаны к другим персонажам.

---

## Куда класть картинки — с примерами

### Stage 1 (до сжигания)

| Что | Куда | Пример |
|-----|------|--------|
| GIF токена #6 | `public_html/images/6.gif` | Grumpy_Cat |
| Metadata токена #6 | `public_html/metadata/6` | JSON без расширения |

Пример фрагмента `metadata/6`:

```json
{
  "name": "PIXEL TRIP #6",
  "image": "https://pixeltripnft.website/images/6.gif",
  "attributes": [
    { "trait_type": "Character", "value": "Grumpy_Cat" },
    { "trait_type": "Stage_1", "value": "1" }
  ]
}
```

Источник для заливки: `collection/build/images/` и `collection/build/metadata/`.

---

### Stage 2 (после первого сжигания)

Имя файла = **slug варианта** из `stage2-variants.json`, **не** tokenId.

**Пример:** сожгли два `Blue_Cap_Boy` Stage 1 → keep token **#827** стал Stage 2 `Blue_Cap_Boy_Zombie`.

| Что | Куда |
|-----|------|
| GIF | `public_html/stage2/images/Blue_Cap_Boy_Zombie.gif` |
| Metadata (создаёт PHP) | `public_html/metadata/827` |

После evolve файл `metadata/827` будет содержать:

```json
{
  "name": "PIXEL TRIP — Blue Cap Boy Zombie #827",
  "image": "https://pixeltripnft.website/stage2/images/Blue_Cap_Boy_Zombie.gif",
  "attributes": [
    { "trait_type": "Character", "value": "Blue_Cap_Boy_Zombie" },
    { "trait_type": "Stage", "value": "2" }
  ]
}
```

Проверка в браузере — URL **должен открывать GIF**, не 404/500:

```text
https://pixeltripnft.website/stage2/images/Blue_Cap_Boy_Zombie.gif
```

---

### Stage 3 (после второго сжигания)

Имя файла = slug из `stage3-variants.json` (обычно `Full_*`).

**Пример:** два Stage 2 `Blue_Cap_Boy_Zombie` → keep token получает `Full_Blue_Cap_Boy_Zombie`.

| Что | Куда |
|-----|------|
| GIF | `public_html/stage3/images/Full_Blue_Cap_Boy_Zombie.gif` |
| Metadata | `public_html/metadata/TOKEN_ID` (перезаписывается PHP) |

---

### Декоративные картинки на странице burn

Это **не** NFT, а иллюстрации механики на `burn.html`:

```text
public_html/images/burn/1.gif   ← Genesis (пара для сжигания)
public_html/images/burn/2.gif   ← Awakened (результат S1→S2)
public_html/images/burn/3.gif   ← Ascended (результат S2→S3)
public_html/images/burn/4.gif   ← второй персонаж в примере S2→S3
```

---

## JSON-конфиги на сервере (обязательны)

| Файл | Назначение | Откуда взять |
|------|------------|--------------|
| `char-map.json` | `"Grumpy_Cat": 171` — charId on-chain | `char-map.json` в корне репо |
| `stage2-variants.json` | Какие Stage 2 slug доступны для каждого character | `website/src/burn/stage2-variants.json` |
| `stage3-variants.json` | Какой Stage 3 slug соответствует Stage 2 slug | `website/src/burn/stage3-variants.json` |

Если добавляете **нового** Stage 2 персонажа:

1. Положите GIF в `stage2/images/Slug_Name.gif`
2. Добавьте slug в `stage2-variants.json` под ключом character (напр. `"Blue_Cap_Boy"`)
3. Залейте обновлённый JSON на сервер
4. Пересоберите сайт (`npm run build`) и залейте `assets/` — иначе burn.html не покажет character как burnable

---

## Что обновляется после сжигания

### Автоматически (on-chain, сразу после tx)

- `burnId` — NFT **уничтожен** (исчезает из кошелька и OpenSea)
- `keepId` — `evolvedStage` в EvolvePixelTrip: `0→2`, `2→3`, или `0→3` для DirectToS3
- `keepId` — `stage1Character` **не меняется** (персонаж-линия та же)

### Автоматически (сервер, если evolve прошёл через burn.html)

После успешной транзакции dApp вызывает `update-metadata.php`:

```json
POST { "tokenId": 827, "sync": true, "burnTokenId": 1234 }
```

PHP:

1. Читает stage и character из Evolve-контракта
2. Выбирает свободный вариант из `stage2-variants.json` / `stage3-variants.json`
3. **Перезаписывает** `metadata/827`
4. Обновляет `token-assignments.json` (чтобы один slug не выпал двум токенам)

### Вручную / если auto-sync не сработал

На странице burn.html кнопка **「Sync metadata to server (OpenSea)」** — синхронизирует все evolved токены в кошельке.

Или POST вручную:

```bash
curl -X POST https://pixeltripnft.website/update-metadata.php \
  -H "Content-Type: application/json" \
  -d '{"tokenId":827,"sync":true}'
```

### OpenSea (кэш, 5–30 минут)

Metadata на сервере может быть уже правильной, но OpenSea показывает старое:

1. Страница NFT → **⋯** → **Refresh metadata**
2. Или: `python collection/refresh_opensea.py --token 827`
3. Подождать 5–15 мин, Ctrl+F5

OpenSea **не обновится**, если GIF по URL из metadata отдаёт 404/500 — сначала проверьте прямую ссылку на картинку.

---

## Пошаговый сценарий для владельца

1. Открыть https://pixeltripnft.website/burn.html
2. **Connect Wallet** → Ethereum Mainnet
3. Approve коллекцию для Evolve-контракта (один раз)
4. Выбрать **KEEP** (первый клик) и **BURN** (второй) — оба с одинаковым character
5. **Evolve (burn 2 → mint 1)** → подтвердить tx в MetaMask
6. Дождаться подтверждения — metadata обновится автоматически
7. На OpenSea: Refresh metadata для keep token
8. Проверить: https://pixeltripnft.website/metadata/TOKEN_ID

---

## Пошаговый сценарий для админа (заливка арта)

### Перед запуском коллекции (один раз)

```text
collection/build/images/*     →  public_html/images/
collection/build/metadata/*   →  public_html/metadata/
stage2/images/*.gif           →  public_html/stage2/images/
stage3/images/*.gif           →  public_html/stage3/images/
char-map.json, stage2-variants.json, stage3-variants.json  →  public_html/
update-metadata.php           →  public_html/
website/dist/*                →  public_html/ (index, burn, assets)
```

On-chain (owner Evolve):

```powershell
$env:EVOLVE_CONTRACT = "0x1B174b30A0ABA50bd73aF305caDB01e23bfda0EC"
$env:PRIVATE_KEY = "..."
node set-characters.mjs
node set-character-paths.mjs
```

### После каждого нового Stage 2 / Stage 3 арта

1. Залить GIF в `stage2/images/` или `stage3/images/`
2. Убедиться, что slug есть в `stage2-variants.json` / `stage3-variants.json`
3. Залить обновлённые JSON на сервер
4. Пересобрать и залить `website/dist/assets/` если менялся burnable-список

---

## Чеклист после evolve

| # | Проверка | Ожидание |
|---|----------|----------|
| 1 | `metadata/KEEP_ID` на сервере | `"Stage": "2"` или `"3"`, новый Character slug |
| 2 | URL картинки из metadata | GIF открывается в браузере |
| 3 | burn.html | KEEP token показывает Stage 2/3 art |
| 4 | OpenSea | Refresh metadata → новое имя и картинка |
| 5 | BURN token | Исчез из кошелька |

---

## Частые проблемы

| Симптом | Причина | Решение |
|---------|---------|---------|
| Имя верное, картинка от test-minта | В `images/` раньше лежали Test GIF, браузер закэшировал | Залить правильные GIF из `collection/build/images/`, Ctrl+Shift+R; новый build добавляет `?v=DNA` |
| OpenSea не обновляется | Кэш или GIF 404/500 | Проверить URL картинки, Refresh metadata |
| Character «Mantis» у #1–#3 | On-chain charId = 0 | Remix: `setStage1Characters([1,2,3],[138,176,236])` |
| Evolve кнопка серая | Character не в `stage2-variants.json` | Добавить арт + JSON, пересобрать сайт |
| Connect Wallet 404 | Старый `assets/burn-*.js` | Залить `burn.html` + **всю** папку `assets/` из одного build |

---

## Контракты (справка)

| | Адрес |
|---|--------|
| Stage 1 collection | `0xadf9c3c2d2946b3c80913b9e022dc2ce9e93afd9` |
| EvolvePixelTrip v3 (uint16) | `0x1B174b30A0ABA50bd73aF305caDB01e23bfda0EC` |
| ~~Старый Evolve (uint8)~~ | `0x3BdE20C434e43f17EE5D6F627834BDaE04A7655F` — не использовать |

EVOLVE_CONTRACT в `update-metadata.php` (или env на хостинге) должен быть `0x1B17…`.
