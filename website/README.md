# PIXEL TRIP — Landing

Лёгкий лендинг коллекции: hero + 6 превью + описание слоёв.

## Локально

```powershell
cd "D:\Promt\Пиксель\website"
npm install
npm run dev
```

Перед запуском скрипт копирует **6 GIF** из `../collection/build/images/` в `public/images/`.

## GitHub + Netlify

- Base directory: `website`
- Build: `npm run build`
- Publish: `dist`
- **COPY_IMAGES не нужен** — копируются только featured GIF

После изменений:

```powershell
cd "D:\Promt\Пиксель"
git add website/
git commit -m "Redesign site as landing with featured previews"
git push
```

Netlify пересоберёт сайт автоматически.

## Сменить превью

Отредактируйте `public/data/config.json` → `featured` и пути в `index.html`.
