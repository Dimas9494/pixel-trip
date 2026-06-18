# PIXEL TRIP — Website

Сайт коллекции NFT **PIXEL TRIP** (4444 animated pixel portraits).

## Локально

```powershell
cd "D:\Promt\Пиксель\website"
npm install
npm run dev
```

Откройте `http://localhost:5173`. GIF берутся из `../collection/build/images/`.

## GitHub + Netlify

Пошаговая инструкция: **[DEPLOY.md](./DEPLOY.md)**

Кратко:
- GitHub: monorepo из `D:\Promt\Пиксель`
- Netlify base directory: `website`
- GIF: через `VITE_IMAGE_BASE_URL` или `COPY_IMAGES=1`

## Сборка

```powershell
npm run build
npm run preview
```

## Настройка

- Ссылки Twitter / Discord / OpenSea — в `index.html`
- Hero-превью — `public/data/config.json` → `heroEditions`
