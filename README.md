# Infpol Archive Search — Next.js + Tailwind (static site)

## What's in the zip

`infpol-nextjs-site.zip` is the full Next.js project source (no `node_modules`,
no `.next` build output — those get generated on install/build).
`infpol-static-export.zip` is the already-built static site (`out/` folder) —
use this if you just want to drop it somewhere without running a build.

## Deploying to Vercel (recommended path)

1. Unzip `infpol-nextjs-site.zip`, `cd infpol-site`.
2. Push it to a new GitHub repo (`git init && git add . && git commit -m "init" && git push`).
3. At vercel.com, create a free account, **New Project** → import that repo.
   Vercel auto-detects Next.js — no config needed. Click Deploy.
4. You'll get a live URL like `https://infpol-site.vercel.app`.

No Vercel CLI needed, but if you prefer it: `npm i -g vercel`, then from the
project folder just run `vercel`.

## Running locally first (optional)

```
cd infpol-site
npm install
npm run dev
```
Open http://localhost:3000.

## Notes on the current build

- This is a **fully static site** — no backend, no database to host. All
  5,413 articles from the 2025 pilot are in `public/data/articles.json`
  (~23MB uncompressed, ~5-6MB gzipped — Vercel compresses this automatically),
  and search runs entirely in the browser.
- Styling: JetBrains Mono via Google Fonts, Tailwind class-based dark mode
  (toggle button top-right, remembers your choice), and the exact
  colors/typography you specified.
- This approach comfortably handles the current ~5,400-article pilot. Once we
  scale to the full 2000–2026 archive (hundreds of thousands of articles),
  shipping one giant JSON file to the browser stops making sense — at that
  point we'd want to move search to a small hosted database/API instead of
  static files. Flagging that now so it's not a surprise later.
