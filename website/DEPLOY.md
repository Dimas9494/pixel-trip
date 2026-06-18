# Деплой PIXEL TRIP на GitHub + Netlify

## Структура репозитория

Загружайте на GitHub **весь каталог** `D:\Promt\Пиксель` как monorepo:

```
Пиксель/
├── website/                 ← сайт (Netlify base directory)
├── collection/
│   ├── config.json
│   └── build/
│       └── metadata/        ← обязательно в Git (лёгкие JSON)
│       └── images/          ← НЕ в Git (слишком большие GIF)
└── .gitignore
```

GIF-файлы (~4444 шт.) в GitHub не кладём — они слишком тяжёлые. Их нужно отдавать через CDN или отдельную загрузку (см. ниже).

---

## Шаг 1 — GitHub

```powershell
cd "D:\Promt\Пиксель"
git init
git add .
git commit -m "Add Pixel Trip website"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/pixel-trip.git
git push -u origin main
```

Замените `YOUR_USERNAME/pixel-trip` на свой репозиторий.

---

## Шаг 2 — Netlify

1. Откройте [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**
2. Подключите GitHub и выберите репозиторий `pixel-trip`
3. Настройки сборки:

| Поле | Значение |
|------|----------|
| **Base directory** | `website` |
| **Build command** | `npm run build` |
| **Publish directory** | `dist` |

`netlify.toml` уже лежит в `website/` — Netlify подхватит его автоматически.

4. **Deploy site**

После деплоя сайт откроется, галерея и фильтры будут работать. GIF-ы появятся после настройки картинок (шаг 3).

---

## Шаг 3 — GIF-изображения (выберите один вариант)

### Вариант A — CDN (рекомендуется)

1. Залейте `collection/build/images/*.gif` на CDN (Cloudflare R2, Bunny, IPFS и т.д.)
2. В Netlify: **Site configuration → Environment variables**
3. Добавьте:

```
VITE_IMAGE_BASE_URL = https://your-cdn.com/images
```

4. **Trigger deploy** (пересборка)

### Вариант B — GIF на том же Netlify

1. Локально один раз:

```powershell
cd "D:\Promt\Пиксель\website"
$env:COPY_IMAGES="1"
npm run build
```

2. Загрузите папку `dist/images` через Netlify CLI:

```powershell
npm install -g netlify-cli
netlify login
netlify deploy --prod --dir=dist/images --site=YOUR_SITE_ID
```

Или используйте Git LFS для `collection/build/images/` и переменную `COPY_IMAGES=1` в Netlify (сборка будет долгой).

### Вариант C — GIF в том же деплое (только для теста)

```powershell
$env:COPY_IMAGES="1"
npm run build
```

Netlify-деплой с `COPY_IMAGES=1` в env — работает, но push 4444 GIF через Git почти нереален без LFS.

---

## Локальная проверка перед деплоем

```powershell
cd "D:\Promt\Пиксель\website"
npm install
npm run dev
```

Для прод-сборки:

```powershell
npm run build
npm run preview
```

---

## Переменные окружения Netlify

| Переменная | Назначение |
|------------|------------|
| `VITE_IMAGE_BASE_URL` | URL CDN с GIF (без `/` в конце) |
| `COPY_IMAGES` | `1` — копировать GIF из `collection/build/images` в билд |
| `COLLECTION_BUILD_PATH` | Путь к metadata (по умолчанию `../collection/build`) |

---

## Кастомный домен

Netlify → **Domain management** → добавьте свой домен и настройте DNS.

После этого обновите `imageBaseUrl` в `collection/config.json` для OpenSea на тот же домен/CDN.
