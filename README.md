# Info Polis Archive Search

Live site: **[info-polis](https://infpol-search.vercel.app/)**

## Run it locally

```
git clone https://github.com/phonekant/infpol-search.git
cd <your-repo>
npm install
```

Create a `.env.local` file in the project root with your Turso database credentials:

```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-auth-token
```

Then start it:

```
npm run dev
```

Open http://localhost:3000.

## Scraping more articles yourself

```
cd scraper
pip install -r requirements.txt
python3 scrape.py --year 2024 --db infpol_2024.db --workers 40 --time-budget 35
```

It only works in short timed bursts and saves progress as it goes, so just
re-run the same command until it prints `ALL DONE`. Change `--year` for
whichever year you want. Once a year is finished, load it into the database:

```
cd ../db
export TURSO_DATABASE_URL=libsql://your-db.turso.io
export TURSO_AUTH_TOKEN=your-auth-token
node migrate_sqlite_to_turso.mjs --sqlite ../scraper/infpol_2024.db
```
