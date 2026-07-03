#!/usr/bin/env node
/**
 * One-time (or repeatable) loader: copies scraped articles from a local
 * SQLite file (produced by scraper/scrape.py) into the Turso database.
 *
 * Usage:
 *   export TURSO_DATABASE_URL="libsql://your-db.turso.io"
 *   export TURSO_AUTH_TOKEN="your-auth-token"
 *   node migrate_sqlite_to_turso.mjs --sqlite infpol_2024.db
 */
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";

function clean(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function parseArgs() {
  const args = { batchSize: 200 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sqlite") args.sqlite = argv[++i];
    if (argv[i] === "--batch-size") args.batchSize = parseInt(argv[++i], 10);
  }
  if (!args.sqlite) {
    console.error("Usage: node migrate_sqlite_to_turso.mjs --sqlite path/to.db");
    process.exit(1);
  }
  return args;
}

async function main() {
  const args = parseArgs();
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN first.");
    process.exit(1);
  }

  const sdb = new DatabaseSync(args.sqlite, { readOnly: true });
  const rows = sdb
    .prepare("SELECT id, url, title, subtitle, published, tags, body FROM articles")
    .all();
  console.log(`Loaded ${rows.length} rows from ${args.sqlite}`);

  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  let inserted = 0;
  for (let i = 0; i < rows.length; i += args.batchSize) {
    const chunk = rows.slice(i, i + args.batchSize);
    const batch = chunk.map((r) => {
      const body = clean(r.body);
      let snippet = body.slice(0, 220);
      if (body.length > 220) snippet += "…";
      const tags = (r.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .join(",");
      return {
        sql: `INSERT INTO articles (id, url, title, subtitle, published, tags, body, snippet)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                url=excluded.url, title=excluded.title, subtitle=excluded.subtitle,
                published=excluded.published, tags=excluded.tags,
                body=excluded.body, snippet=excluded.snippet`,
        args: [r.id, r.url, clean(r.title), clean(r.subtitle), r.published, tags, body, snippet],
      };
    });
    await turso.batch(batch, "write");
    inserted += chunk.length;
    console.log(`  inserted ${inserted}/${rows.length}`);
  }

  console.log(`Done. ${inserted} rows upserted.`);
  const countRes = await turso.execute("SELECT count(*) AS c FROM articles");
  console.log(`Total rows in Turso now: ${countRes.rows[0].c}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
