// Use Turso's dedicated serverless driver (plain fetch, zero native deps)
// instead of @libsql/client. On Vercel Functions, @libsql/client negotiates
// a WebSocket/hrana connection per invocation, which added several seconds
// of overhead per request in production even though the query itself is
// fast. @tursodatabase/serverless is what Turso recommends specifically for
// serverless/edge deployments, exposed here via its @libsql/client-compatible
// createClient() so the rest of this file didn't need to change.
import { createClient } from "@tursodatabase/serverless/compat";
import { CANDIDATE_LIMIT, parseSearchRequest, buildResultsQuery, buildCountQuery } from "@/lib/searchQuery";

const PAGE_SIZE = 20;
const FACET_SAMPLE_LIMIT = 500;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(parseInt(searchParams.get("page") || "1", 10), 1);
  const parsed = parseSearchRequest(searchParams);
  const { ftsQuery, hasYearFilter, effectiveYearFrom, effectiveYearTo, useBounding, yearFilterSql } = parsed;

  if (!ftsQuery) {
    return Response.json({ total: 0, page, totalPages: 0, results: [], facets: { tags: [] } });
  }

  const offset = (page - 1) * PAGE_SIZE;

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

    const countQuery = buildCountQuery(parsed);
    const countRes = await client.execute(countQuery);
    const total = Number(countRes.rows[0]?.total || 0);

    const columnsSql = "a.id, a.url, a.title, a.snippet, a.tags, a.published AS date";
    const { sql, args } = buildResultsQuery(parsed, columnsSql);
    const resultsRes = await client.execute({
      sql: `${sql} LIMIT ? OFFSET ?`,
      args: [...args, PAGE_SIZE, offset],
    });

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
