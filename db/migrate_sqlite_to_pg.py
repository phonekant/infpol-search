#!/usr/bin/env python3
"""
One-time (or repeatable) loader: copies scraped articles from a local SQLite
file (produced by scraper/scrape.py) into the Postgres database.

Usage:
    export DATABASE_URL="postgresql://user:pass@host/dbname?sslmode=require"
    python3 migrate_sqlite_to_pg.py --sqlite infpol_2025.db
"""
import argparse
import os
import re
import sqlite3
import sys

import psycopg


def clean(text):
    return re.sub(r"\s+", " ", (text or "")).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", required=True)
    ap.add_argument("--batch-size", type=int, default=200)
    args = ap.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("Set DATABASE_URL first, e.g. export DATABASE_URL=postgresql://...")

    sconn = sqlite3.connect(args.sqlite)
    rows = sconn.execute(
        "SELECT id, url, title, subtitle, published, tags, body FROM articles"
    ).fetchall()
    print(f"Loaded {len(rows)} rows from {args.sqlite}")

    with psycopg.connect(dsn) as pconn:
        with pconn.cursor() as cur:
            with open(os.path.join(os.path.dirname(__file__), "schema.sql")) as f:
                cur.execute(f.read())
            pconn.commit()

            inserted = 0
            batch = []
            for aid, url, title, subtitle, published, tags, body in rows:
                body = clean(body)
                snippet = body[:220]
                if len(body) > 220:
                    snippet += "…"
                tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()]
                batch.append((aid, url, clean(title), clean(subtitle), published, tag_list, body, snippet))
                if len(batch) >= args.batch_size:
                    cur.executemany(
                        """
                        INSERT INTO articles (id, url, title, subtitle, published, tags, body, snippet)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                          title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
                          published = EXCLUDED.published, tags = EXCLUDED.tags,
                          body = EXCLUDED.body, snippet = EXCLUDED.snippet
                        """,
                        batch,
                    )
                    pconn.commit()
                    inserted += len(batch)
                    print(f"  inserted {inserted}/{len(rows)}")
                    batch = []
            if batch:
                cur.executemany(
                    """
                    INSERT INTO articles (id, url, title, subtitle, published, tags, body, snippet)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                      title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
                      published = EXCLUDED.published, tags = EXCLUDED.tags,
                      body = EXCLUDED.body, snippet = EXCLUDED.snippet
                    """,
                    batch,
                )
                pconn.commit()
                inserted += len(batch)

            print(f"Done. {inserted} rows upserted.")
            count = cur.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
            print(f"Total rows in Postgres now: {count}")


if __name__ == "__main__":
    main()
