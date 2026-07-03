import { neon } from "@neondatabase/serverless";

const PAGE_SIZE = 20;

// Turn free-text user input into a Postgres tsquery with prefix matching on
// every word (so "эколог" also matches "экология", "экологический", etc,
// mirroring how the original SQLite FTS prefix search behaved).
function toPrefixTsQuery(raw) {
  const words = (raw.match(/[\p{L}\p{N}]+/gu) || []).filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => `${w}:*`).join(" & ");
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const page = Math.max(parseInt(searchParams.get("page") || "1", 10), 1);

  const tsq = q ? toPrefixTsQuery(q) : null;
  if (!tsq) {
    return Response.json({ total: 0, page, totalPages: 0, results: [] });
  }

  const sql = neon(process.env.DATABASE_URL);
  const offset = (page - 1) * PAGE_SIZE;

  try {
    const countRows = await sql`
      SELECT COUNT(*)::int AS total
      FROM articles
      WHERE search_tsv @@ to_tsquery('russian', ${tsq})
    `;
    const total = countRows[0]?.total || 0;

    const results = await sql`
      SELECT
        id, url, title, snippet, tags,
        to_char(published, 'YYYY-MM-DD') AS date,
        ts_rank(search_tsv, to_tsquery('russian', ${tsq})) AS rank
      FROM articles
      WHERE search_tsv @@ to_tsquery('russian', ${tsq})
      ORDER BY rank DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `;

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
