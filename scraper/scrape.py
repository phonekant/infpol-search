#!/usr/bin/env python3
"""
Resumable, time-boxed scraper for infpol.ru archive -> SQLite with full-text search.

Because this runs in an environment with no persistent background processes,
each invocation only works for --time-budget seconds and checkpoints its
progress to disk (state.json + the sqlite db itself), so it can simply be
re-run repeatedly until done.

Usage (repeat this same command until it prints "ALL DONE"):
    python3 scrape.py --year 2025 --db infpol_2025.db --state state_2025.json \
        --workers 10 --time-budget 35
"""
import argparse
import calendar
import json
import os
import re
import sqlite3
import sys
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

import requests
from bs4 import BeautifulSoup

BASE = "https://www.infpol.ru"
UA = "Mozilla/5.0 (compatible; InfpolArchiveResearchBot/1.0; contact: phonekant10@gmail.com)"
ARTICLE_HREF_RE = re.compile(r'^/(\d+)-[a-z0-9-]+/$')

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.FileHandler("scrape.log"), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("scrape")

session = requests.Session()
session.headers.update({"User-Agent": UA})
_adapter = requests.adapters.HTTPAdapter(pool_connections=128, pool_maxsize=128)
session.mount("https://", _adapter)
session.mount("http://", _adapter)


def fetch(url, retries=2, timeout=8):
    for attempt in range(retries):
        try:
            r = session.get(url, timeout=timeout)
            if r.status_code == 200:
                return r.text
            if r.status_code == 404:
                return None
        except requests.RequestException:
            pass
        time.sleep(0.5)
    return None


def get_day_article_urls(year, month, day):
    url = f"{BASE}/archive/{year:04d}/{month:02d}/{day:02d}/"
    html = fetch(url)
    if not html:
        return []
    soup = BeautifulSoup(html, "lxml")
    found = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        m = ARTICLE_HREF_RE.match(href)
        if m:
            found[m.group(1)] = BASE + href
    return found


def parse_article(url):
    html = fetch(url)
    if not html:
        return None
    soup = BeautifulSoup(html, "lxml")

    h1 = soup.find("h1", itemprop="name headline") or soup.find("h1")
    title = h1.get_text(strip=True) if h1 else None

    time_tag = soup.find("time", itemprop="datePublished")
    published = time_tag["datetime"] if time_tag and time_tag.has_attr("datetime") else None

    body_div = soup.find("div", itemprop="articleBody")
    body = ""
    if body_div:
        for bad in body_div.find_all(["script", "style"]):
            bad.decompose()
        paras = [p.get_text(" ", strip=True) for p in body_div.find_all("p")]
        paras = [p for p in paras if p]
        body = "\n".join(paras)

    tags = []
    tags_div = soup.find("div", class_="tags")
    if tags_div:
        tags = [a.get_text(strip=True) for a in tags_div.find_all("a")]

    subtitle_tag = soup.find(class_=re.compile("subtitle|lead|anons"))
    subtitle = subtitle_tag.get_text(strip=True) if subtitle_tag else None

    m = ARTICLE_HREF_RE.match(url.replace(BASE, ""))
    article_id = int(m.group(1)) if m else None

    if not title or not body:
        return None

    return {
        "id": article_id,
        "url": url,
        "title": title,
        "subtitle": subtitle,
        "published": published,
        "tags": ", ".join(tags),
        "body": body,
    }


def init_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY,
            url TEXT UNIQUE,
            title TEXT,
            subtitle TEXT,
            published TEXT,
            tags TEXT,
            body TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
            title, subtitle, tags, body, content='articles', content_rowid='id'
        )
        """
    )
    conn.executescript(
        """
        CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
          INSERT INTO articles_fts(rowid, title, subtitle, tags, body)
          VALUES (new.id, new.title, new.subtitle, new.tags, new.body);
        END;
        CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
          INSERT INTO articles_fts(articles_fts, rowid, title, subtitle, tags, body)
          VALUES ('delete', old.id, old.title, old.subtitle, old.tags, old.body);
        END;
        CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
          INSERT INTO articles_fts(articles_fts, rowid, title, subtitle, tags, body)
          VALUES ('delete', old.id, old.title, old.subtitle, old.tags, old.body);
          INSERT INTO articles_fts(rowid, title, subtitle, tags, body)
          VALUES (new.id, new.title, new.subtitle, new.tags, new.body);
        END;
        """
    )
    conn.commit()
    return conn


def all_days(year):
    today = date.today()
    for m in range(1, 13):
        ndays = calendar.monthrange(year, m)[1]
        for d in range(1, ndays + 1):
            day_date = date(year, m, d)
            if day_date > today:
                continue
            yield f"{year:04d}-{m:02d}-{d:02d}"


def load_state(path):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {"scanned_days": [], "urls": {}}


def save_state(path, state):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--db", default="infpol.db")
    ap.add_argument("--state", default=None)
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--time-budget", type=float, default=35.0)
    args = ap.parse_args()
    state_path = args.state or f"state_{args.year}.json"

    deadline = time.time() + args.time_budget
    state = load_state(state_path)
    scanned = set(state["scanned_days"])
    urls = state["urls"]  # id(str) -> url

    days_todo = [d for d in all_days(args.year) if d not in scanned]

    if days_todo:
        log.info("PHASE 1 (day-index scan): %d/%d days remaining", len(days_todo), len(scanned) + len(days_todo))
        batch = days_todo  # submit all remaining; we'll stop consuming results at deadline
        ex = ThreadPoolExecutor(max_workers=args.workers)
        futures = {}
        for dstr in batch:
            y, m, d = map(int, dstr.split("-"))
            futures[ex.submit(get_day_article_urls, y, m, d)] = dstr
        n_done = 0
        for fut in as_completed(futures):
            dstr = futures[fut]
            try:
                found = fut.result()
                urls.update(found)
                scanned.add(dstr)
            except Exception as e:
                log.warning("day scan failed %s: %s", dstr, e)
            n_done += 1
            if time.time() > deadline:
                log.info("Time budget hit mid-scan (%d/%d this run)", n_done, len(batch))
                break
        ex.shutdown(wait=False, cancel_futures=True)
        state["scanned_days"] = sorted(scanned)
        state["urls"] = urls
        save_state(state_path, state)
        log.info(
            "Day-index scan progress: %d/%d days scanned, %d unique article URLs found so far",
            len(scanned), len(scanned) + len(days_todo) - n_done if days_todo else len(scanned),
            len(urls),
        )
        remaining = time.time() < deadline
        if not remaining:
            log.info("Run out of time this call. Re-run the same command to continue.")
            logging.shutdown()
            os._exit(0)
        # fall through to phase 2 with whatever time is left

    total_days = len(list(all_days(args.year)))
    if len(scanned) < total_days:
        log.info("Day-index scan not complete yet (%d/%d). Re-run to continue.", len(scanned), total_days)
        logging.shutdown()
        os._exit(0)

    log.info("PHASE 1 complete: %d days scanned, %d unique article URLs total", len(scanned), len(urls))

    conn = init_db(args.db)
    cur = conn.cursor()
    existing_ids = {str(row[0]) for row in cur.execute("SELECT id FROM articles")}
    todo_ids = [aid for aid in urls if aid not in existing_ids]
    log.info("PHASE 2 (article fetch): %d already stored, %d remaining", len(existing_ids), len(todo_ids))

    if not todo_ids:
        conn.close()
        log.info("ALL DONE. Total articles in DB: %d", len(existing_ids))
        logging.shutdown()
        os._exit(0)

    fetched = 0
    ex = ThreadPoolExecutor(max_workers=args.workers)
    futures = {ex.submit(parse_article, urls[aid]): aid for aid in todo_ids}
    for fut in as_completed(futures):
        aid = futures[fut]
        try:
            article = fut.result()
        except Exception:
            article = None
        if article:
            try:
                cur.execute(
                    """INSERT OR REPLACE INTO articles (id, url, title, subtitle, published, tags, body)
                       VALUES (:id, :url, :title, :subtitle, :published, :tags, :body)""",
                    article,
                )
            except Exception as e:
                log.warning("DB insert failed for %s: %s", aid, e)
        fetched += 1
        if fetched % 25 == 0:
            conn.commit()
        if time.time() > deadline:
            break
    ex.shutdown(wait=False, cancel_futures=True)

    conn.commit()
    total = cur.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
    conn.close()
    log.info("This run fetched %d articles. Total in DB now: %d / %d target", fetched, total, len(urls))
    if total >= len(urls):
        log.info("ALL DONE.")
    else:
        log.info("Re-run the same command to continue.")
    logging.shutdown()
    os._exit(0)


if __name__ == "__main__":
    main()
