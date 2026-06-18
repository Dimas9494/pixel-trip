# PIXEL TRIP — Landing

English landing page with 6 animated previews.

## 1. Copy preview GIFs (required once)

```powershell
cd "D:\Promt\Пиксель\website"
powershell -ExecutionPolicy Bypass -File .\setup-images.ps1
```

This copies 6 GIFs into `public/images/` so Netlify can serve them.

## 2. Local preview

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`

## 3. Deploy to GitHub + Netlify

```powershell
cd "D:\Promt\Пиксель"
git add website/
git commit -m "English landing with preview images"
git push
```

Netlify settings:

| Field | Value |
|-------|-------|
| Base directory | `website` |
| Build command | `npm run build` |
| Publish directory | `dist` |

After push: Netlify → **Deploys** → wait for green check → **Ctrl+F5** on the site.

## Change preview NFTs

Edit `public/data/config.json` and `index.html`, then run `setup-images.ps1` again with new edition numbers.
