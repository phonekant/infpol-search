#!/usr/bin/env python3
"""
Translate archived articles (title, snippet, body) from Russian to English
using a Qwen model behind a LiteLLM proxy, and write the results back to
Turso via its HTTP (v2/pipeline) API.

Usage:
  python3 translate_articles.py --limit 200          # test batch
  python3 translate_articles.py                       # full run, all untranslated rows
  python3 translate_articles.py --workers 16 --limit 500

Resumable: only picks rows where title_en IS NULL, so re-running after a
partial/failed run just picks up where it left off. Ctrl-C is safe -- each
article's translation is written to Turso the moment it finishes.

Requires: pip install openai requests tqdm
Env vars: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, LITELLM_API_KEY (or pass --api-key)
"""

import argparse
import os
import re
import sys
import time
import json
import threading
import concurrent.futures
import requests
from openai import OpenAI
from tqdm import tqdm

BASE_URL = "https://tyrosine.wesleyan.edu:4000/v1"
MODEL = "qwen3.6-27b-hpc"

DELIM_TITLE = "===TITLE==="
DELIM_SNIPPET = "===SNIPPET==="
DELIM_BODY = "===BODY==="

PROMPT_TEMPLATE = """Translate the following Russian news article fields into natural, fluent English. Preserve meaning and tone; do not summarize or omit content. Output ONLY in this exact format, with each section header on its own line:

{delim_title}
<translated title>
{delim_snippet}
<translated snippet>
{delim_body}
<translated full body>

--- RUSSIAN SOURCE ---
TITLE: {title}
SNIPPET: {snippet}
BODY: {body}
"""


def turso_execute(db_url, token, sql, args=None):
    """Run one SQL statement against Turso's HTTP pipeline API. args is a
    list of {"type": "text"/"integer", "value": ...} positional params."""
    http_url = db_url.replace("libsql://", "https://") + "/v2/pipeline"
    stmt = {"sql": sql}
    if args:
        stmt["args"] = args
    payload = {"requests": [{"type": "execute", "stmt": stmt}, {"type": "close"}]}
    resp = requests.post(
        http_url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    result = data["results"][0]
    if result["type"] != "ok":
        raise RuntimeError(f"Turso error: {result}")
    return result["response"]["result"]


def count_remaining(db_url, token):
    r = turso_execute(db_url, token, "SELECT count(*) AS n FROM articles WHERE title_en IS NULL")
    return int(r["rows"][0][0]["value"])


def fetch_batch(db_url, token, limit, offset=0):
    r = turso_execute(
        db_url,
        token,
        "SELECT id, title, snippet, body FROM articles WHERE title_en IS NULL ORDER BY id LIMIT ? OFFSET ?",
        args=[
            {"type": "integer", "value": str(limit)},
            {"type": "integer", "value": str(offset)},
        ],
    )
    cols = [c["name"] for c in r["cols"]]
    rows = []
    for row in r["rows"]:
        d = {}
        for c, cell in zip(cols, row):
            d[c] = cell.get("value")
        rows.append(d)
    return rows


def write_translation(db_url, token, article_id, title_en, snippet_en, body_en):
    turso_execute(
        db_url,
        token,
        "UPDATE articles SET title_en = ?, snippet_en = ?, body_en = ? WHERE id = ?",
        args=[
            {"type": "text", "value": title_en},
            {"type": "text", "value": snippet_en},
            {"type": "text", "value": body_en},
            {"type": "integer", "value": str(article_id)},
        ],
    )


def parse_translation(raw_text):
    pattern = re.compile(
        rf"{re.escape(DELIM_TITLE)}\s*(.*?)\s*{re.escape(DELIM_SNIPPET)}\s*(.*?)\s*{re.escape(DELIM_BODY)}\s*(.*)",
        re.DOTALL,
    )
    m = pattern.search(raw_text)
    if not m:
        raise ValueError(f"Could not parse model output (first 200 chars): {raw_text[:200]!r}")
    title_en, snippet_en, body_en = (g.strip() for g in m.groups())
    return title_en, snippet_en, body_en


def translate_one(client, article):
    prompt = PROMPT_TEMPLATE.format(
        delim_title=DELIM_TITLE,
        delim_snippet=DELIM_SNIPPET,
        delim_body=DELIM_BODY,
        title=article["title"] or "",
        snippet=article["snippet"] or "",
        body=article["body"] or "",
    )
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    )
    raw = resp.choices[0].message.content
    usage = getattr(resp, "usage", None)
    tokens = (usage.total_tokens if usage else 0) or 0
    title_en, snippet_en, body_en = parse_translation(raw)
    return title_en, snippet_en, body_en, tokens


def process_article(client, db_url, token, article, retries=3):
    last_err = None
    for attempt in range(retries):
        try:
            title_en, snippet_en, body_en, tokens = translate_one(client, article)
            write_translation(db_url, token, article["id"], title_en, snippet_en, body_en)
            return article["id"], tokens, None
        except Exception as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    return article["id"], 0, str(last_err)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="Max number of articles to translate (default: all untranslated)")
    ap.add_argument("--workers", type=int, default=8, help="Concurrent translation workers")
    ap.add_argument("--batch-size", type=int, default=200, help="How many rows to fetch from DB per round")
    ap.add_argument("--api-key", default=os.environ.get("LITELLM_API_KEY"))
    ap.add_argument("--db-url", default=os.environ.get("TURSO_DATABASE_URL"))
    ap.add_argument("--db-token", default=os.environ.get("TURSO_AUTH_TOKEN"))
    args = ap.parse_args()

    if not args.api_key:
        sys.exit("Missing LiteLLM API key (--api-key or LITELLM_API_KEY env var)")
    if not args.db_url or not args.db_token:
        sys.exit("Missing Turso creds (--db-url/--db-token or TURSO_DATABASE_URL/TURSO_AUTH_TOKEN env vars)")

    client = OpenAI(base_url=BASE_URL, api_key=args.api_key)

    remaining_in_db = count_remaining(args.db_url, args.db_token)
    total = min(args.limit, remaining_in_db) if args.limit is not None else remaining_in_db

    total_done = 0
    total_failed = 0
    total_tokens = 0
    remaining = args.limit
    bar = tqdm(total=total, unit="article", desc="translating")

    try:
        while True:
            fetch_n = args.batch_size if remaining is None else min(args.batch_size, remaining)
            if fetch_n <= 0:
                break
            batch = fetch_batch(args.db_url, args.db_token, fetch_n)
            if not batch:
                break

            with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
                futures = [ex.submit(process_article, client, args.db_url, args.db_token, a) for a in batch]
                for fut in concurrent.futures.as_completed(futures):
                    article_id, tokens, err = fut.result()
                    if err:
                        total_failed += 1
                        tqdm.write(f"  FAILED id={article_id}: {err}")
                    else:
                        total_done += 1
                        total_tokens += tokens
                    bar.update(1)
                    bar.set_postfix(done=total_done, failed=total_failed, tokens=total_tokens)

            if remaining is not None:
                remaining -= len(batch)
                if remaining <= 0:
                    break
    except KeyboardInterrupt:
        bar.close()
        print(f"\nInterrupted. done={total_done} failed={total_failed} total_tokens={total_tokens}")
        print("Already-translated rows are saved. Rerun the same command to resume.")
        sys.exit(130)

    bar.close()
    print(f"\nFinished. done={total_done} failed={total_failed} total_tokens={total_tokens}")


if __name__ == "__main__":
    main()
