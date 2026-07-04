// Use Turso's dedicated serverless driver (plain fetch, zero native deps)
// instead of @libsql/client. On Vercel Functions, @libsql/client negotiates
// a WebSocket/hrana connection per invocation, which added several seconds
// of overhead per request in production even though the query itself is
// fast. @tursodatabase/serverless is what Turso recommends specifically for
// serverless/edge deployments, exposed here via its @libsql/client-compatible
// createClient() so the rest of this file didn't need to change.
import { createClient } from "@tursodatabase/serverless/compat";

const PAGE_SIZE = 20;
// Ranking/sorting every match before paging gets very slow for common
// words/prefixes that match thousands of articles (SQLite FTS5 has to touch
// every match before it can pick a page in relevance or "newest" order). So
// when there's no year filter narrowing the match set, we only consider the
// most recent CANDIDATE_LIMIT matches (by rowid, which tracks article id /
// recency) instead of the entire match set. This keeps common-word searches
// fast, at the cost of not ranking the very oldest matches for extremely
// broad terms. A year filter already narrows the match set enough on its
// own, so bounding is skipped whenever one is active.
const CANDIDATE_LIMIT = 2000;
const FACET_SAMPLE_LIMIT = 500;
const MIN_YEAR = 2000;
const MAX_YEAR = new Date().getFullYear();

// Turn free-text user input into an FTS5 query with prefix matching on
// every word (so "эколог" also matches "экология", "экологический", etc).
// Each word is double-quoted to avoid FTS5 syntax characters, with a
// trailing * for prefix matching. Bare tokens are ANDed by default in FTS5.
function toPrefixFtsQuery(raw) {
  const words = (raw.match(/[\p{L}\p{N}]+/gu) || []).filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(" ");
}

function parseYear(raw, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < MIN_YEAR || n > MAX_YEAR) return fallback;
  return n;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const page = Math.max(parseInt(searchParams.get("page") || "1", 10), 1);
  const sort = ["relevance", "newest", "oldest"].includes(searchParams.get("sort"))
    ? searchParams.get("sort")
    : "relevance";
  const tags = (searchParams.get("tags") || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const yearFromRaw = searchParams.get("yearFrom");
  const yearToRaw = searchParams.get("yearTo");
  const yearFrom = yearFromRaw ? parseYear(yearFromRaw, null) : null;
  const yearTo = yearToRaw ? parseYear(yearToRaw, null) : null;
  const hasYearFilter = yearFrom != null || yearTo != null;
  const effectiveYearFrom = yearFrom ?? MIN_YEAR;
  const effectiveYearTo = yearTo ?? MAX_YEAR;

  const ftsQuery = q ? toPrefixFtsQuery(q) : null;
  if (!ftsQuery) {
    return Response.json({ total: 0, page, totalPages: 0, results: [], facets: { tags: [] } });
  }

  const offset = (page - 1) * PAGE_SIZE;

  // A year filter already narrows the candidate set down (at most a few
  // thousand rows for any single year), so bounding on top of that would
  // only lose relevant results for no speed benefit. Bounding is only
  // needed when searching the unrestricted, potentially huge, full archive.
  const useBounding = !hasYearFilter;
  const boundDirection = sort === "oldest" ? "ASC" : "DESC";
  const orderExpr =
    sort === "relevance" ? "rank ASC" : sort === "newest" ? "a.id DESC" : "a.id ASC";

  const tagFilterSql = tags.map(() => `AND instr(',' || a.tags || ',', ',' || ? || ',') > 0`).join(" ");
  const yearFilterSql = hasYearFilter
    ? `AND CAST(substr(a.published,1,4) AS INTEGER) BETWEEN ? AND ?`
    : "";

  try {
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      throw new Error(
        "TURSO_DATABASE_URL / TURSO_AUTH_TOKEN not set in this environment (check Vercel Project Settings > Environment Variables)"
      );
    }
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    const countArgs = [ftsQuery, ...tags, ...(hasYearFilter ? [effectiveYearFrom, effectiveYearTo] : [])];
    const countRes = await client.execute({
      sql: `
        SELECT count(*) AS total
        FROM articles_fts
        JOIN articles a ON a.id = articles_fts.rowid
        WHERE articles_fts MATCH ?
        ${tagFilterSql}
        ${yearFilterSql}
      `,
      args: countArgs,
    });
    const total = Number(countRes.rows[0]?.total || 0);

    let resultsRes;
    if (useBounding) {
      const rankSelect = sort === "relevance" ? ", bm25(articles_fts, 10.0, 3.0, 1.0) AS rank" : "";
      resultsRes = await client.execute({
        sql: `
          SELECT a.id, a.url, a.title, a.snippet, a.tags, a.published AS date${sort === "relevance" ? ", c.rank" : ""}
          FROM (
            SELECT rowid${rankSelect}
            FROM articles_fts
            WHERE articles_fts MATCH ?
            ORDER BY rowid ${boundDirection}
            LIMIT ?
          ) c
          JOIN articles a ON a.id = c.rowid
          WHERE 1=1 ${tagFilterSql}
          ORDER BY ${orderExpr}
          LIMIT ? OFFSET ?
        `,
        args: [ftsQuery, CANDIDATE_LIMIT, ...tags, PAGE_SIZE, offset],
      });
    } else {
      const rankSelect = sort === "relevance" ? ", bm25(articles_fts, 10.0, 3.0, 1.0) AS rank" : "";
      resultsRes = await client.execute({
        sql: `
          SELECT a.id, a.url, a.title, a.snippet, a.tags, a.published AS date${rankSelect}
          FROM articles_fts
          JOIN articles a ON a.id = articles_fts.rowid
          WHERE articles_fts MATCH ?
          ${tagFilterSql}
          ${yearFilterSql}
          ORDER BY ${orderExpr}
          LIMIT ? OFFSET ?
        `,
        args: [ftsQuery, ...tags, effectiveYearFrom, effectiveYearTo, PAGE_SIZE, offset],
      });
    }

    const results = resultsRes.rows.map((r) => ({
      id: r.id,
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      tags: r.tags ? String(r.tags).split(",").filter(Boolean) : [],
      date: r.date,
    }));

    // Pagination is bounded by how many matches we actually consider, not
    // the full (possibly huge) match count, so users can't page past what's
    // servable. When a year filter is active there's no bounding, so the
    // real total applies.
    const rankedTotal = useBounding ? Math.min(total, CANDIDATE_LIMIT) : total;

    // Facets: sample a bounded window of matches (respecting the year
    // filter but not the tag filter, so all applicable tags stay choosable
    // for multi-select) and tally tag frequency in JS. This is an
    // approximation over a sample, not an exact count over the full match
    // set, which keeps it fast even for very broad searches.
    const facetArgs = hasYearFilter
      ? [ftsQuery, effectiveYearFrom, effectiveYearTo, FACET_SAMPLE_LIMIT]
      : [ftsQuery, FACET_SAMPLE_LIMIT];
    const facetRes = await client.execute({
      sql: hasYearFilter
        ? `
          SELECT a.tags
          FROM articles_fts
          JOIN articles a ON a.id = articles_fts.rowid
          WHERE articles_fts MATCH ? ${yearFilterSql}
          ORDER BY a.id DESC
          LIMIT ?
        `
        : `
          SELECT a.tags
          FROM (
            SELECT rowid FROM articles_fts WHERE articles_fts MATCH ? ORDER BY rowid DESC LIMIT ?
          ) c
          JOIN articles a ON a.id = c.rowid
        `,
      args: facetArgs,
    });
    const tagCounts = new Map();
    for (const row of facetRes.rows) {
      const rowTags = (row.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
      for (const t of rowTags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([tag, count]) => ({ tag, count }));

    return Response.json({
      total,
      page,
      totalPages: Math.max(1, Math.ceil(rankedTotal / PAGE_SIZE)),
      results,
      facets: { tags: topTags },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
