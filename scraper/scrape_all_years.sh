#!/usr/bin/env bash
# Scrapes every year of the archive, one year at a time, loading each into
# Turso as soon as it finishes, then moves to the next year. Safe to
# leave running unattended (overnight) and safe to re-run/resume if
# interrupted — both the scraper and this loop pick up where they left off.
set -uo pipefail

cd "$(dirname "$0")"
: "${TURSO_DATABASE_URL:?Set TURSO_DATABASE_URL first, e.g. export TURSO_DATABASE_URL=libsql://...}"
: "${TURSO_AUTH_TOKEN:?Set TURSO_AUTH_TOKEN first}"

START_YEAR=2000
END_YEAR=$(date +%Y)

for YEAR in $(seq "$START_YEAR" "$END_YEAR"); do
  echo "=== [$(date +%H:%M:%S)] Scraping $YEAR ==="
  until python3 scrape.py \
      --year "$YEAR" \
      --db "infpol_$YEAR.db" \
      --state "state_$YEAR.json" \
      --workers 40 \
      --time-budget 35 2>&1 | tee -a "scrape_$YEAR.log" | grep -q "ALL DONE"
  do
    echo "--- $YEAR not finished yet, re-running ---"
  done

  echo "=== [$(date +%H:%M:%S)] $YEAR done scraping, loading into Turso ==="
  node ../db/migrate_sqlite_to_turso.mjs --sqlite "infpol_$YEAR.db"
done

echo "=== ALL YEARS DONE ($START_YEAR-$END_YEAR) ==="
