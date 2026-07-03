# Info Polis Archive Search

Live site: **[info-polis](https://infpol-search.vercel.app/)**

## Run it locally

```
git clone https://github.com/phonekant/infpol-search.git
cd <your-repo>
npm install
```

Create a `.env.local` file in the project root with your database connection string:

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
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
export DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
python3 migrate_sqlite_to_pg.py --sqlite ../scraper/infpol_2024.db
```
