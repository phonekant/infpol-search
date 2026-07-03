import { createClient } from "@libsql/client";

const PAGE_SIZE = 20;

// Turn free-text user input into an FTS5 query with prefix matching on
// every word (so "эколог" also matches "экология", "экологический", etc).
// Each word is double-quoted to avoid FTS5 syntax characters, with a
// trailing * for prefix matching. Bare tokens are ANDed by default in FTS5.
function toPrefixFtsQuery(raw) {
  const words = (raw.match(/[\p{L}\p{N}]+/gu) || []).filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(" ");
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const page = Math.max(parseInt(searchParams.get("page") || "1", 10), 1);

  const ftsQuery = q ? toPrefixFtsQuery(q) : null;
  if (!ftsQuery) {
    return Response.json({ total: 0, page, totalPages: 0, results: [] });
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

    const countRes = await client.execute({
      sql: `SELECT count(*) AS total FROM articles_fts WHERE articles_fts MATCH ?`,
      args: [ftsQuery],
    });
    const total = Number(countRes.rows[0]?.total || 0);

    const resultsRes = await client.execute({
      sql: `
        SELECT
          a.id, a.url, a.title, a.snippet, a.tags, a.published AS date,
          bm25(articles_fts, 10.0, 3.0, 1.0) AS rank
        FROM articles_fts
        JOIN articles a ON a.id = articles_fts.rowid
        WHERE articles_fts MATCH ?
        ORDER BY rank
        LIMIT ? OFFSET ?
      `,
      args: [ftsQuery, PAGE_SIZE, offset],
    });

    const results = resultsRes.rows.map((r) => ({
      id: r.id,
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      tags: r.tags ? String(r.tags).split(",").filter(Boolean) : [],
      date: r.date,
    }));

    return Response.json({
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      results,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
