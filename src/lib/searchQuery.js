// Shared query-building logic for both /api/search (paginated results) and
// /api/export (bulk download of the same filtered/sorted match set). Keeping
// this in one place means the export always matches exactly what a search
// would page through.

export const CANDIDATE_LIMIT = 2000;
export const MIN_YEAR = 2000;
export const MAX_YEAR = new Date().getFullYear();

// Turn free-text user input into an FTS5 query with prefix matching on
// every word (so "эколог" also matches "экология", "экологический", etc).
// Each word is double-quoted to avoid FTS5 syntax characters, with a
// trailing * for prefix matching. Bare tokens are ANDed by default in FTS5.
export function toPrefixFtsQuery(raw) {
  const words = (raw.match(/[\p{L}\p{N}]+/gu) || []).filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(" ");
}

function parseYear(raw, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < MIN_YEAR || n > MAX_YEAR) return fallback;
  return n;
}

// Parses the shared set of search params (q, sort, tags, yearFrom, yearTo)
// used by both routes, and precomputes the SQL fragments/flags needed to
// build a query: whether to bound to the CANDIDATE_LIMIT recency window,
// which direction that bound should scan, the final ORDER BY expression,
// and the tag/year WHERE clause fragments (with their positional args kept
// separate so callers can assemble the full args array themselves).
export function parseSearchRequest(searchParams) {
  const q = (searchParams.get("q") || "").trim();
  // Which language's text actually gets matched against, not just displayed.
  // "en" searches title_en/snippet_en/body_en via a separate FTS index built
  // over the translated columns; "ru" (default) searches the original
  // Russian columns. Each language has its own index because a single FTS5
  // table can't usefully rank/tokenize two languages' text as one field.
  const lang = searchParams.get("lang") === "en" ? "en" : "ru";
  const ftsTable = lang === "en" ? "articles_fts_en" : "articles_fts";
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

  // A year filter already narrows the candidate set down (at most a few
  // thousand rows for any single year), so bounding on top of that would
  // only lose relevant results for no speed benefit. Bounding is only
  // needed when searching the unrestricted, potentially huge, full archive.
  const useBounding = !hasYearFilter;
  const boundDirection = sort === "oldest" ? "ASC" : "DESC";
  const orderExpr =
    sort === "relevance" ? "rank ASC" : sort === "newest" ? "a.id DESC" : "a.id ASC";

  const tagFilterSql = tags
    .map(() => `AND instr(',' || a.tags || ',', ',' || ? || ',') > 0`)
    .join(" ");
  const yearFilterSql = hasYearFilter
    ? `AND CAST(substr(a.published,1,4) AS INTEGER) BETWEEN ? AND ?`
    : "";

  return {
    q,
    ftsQuery,
    lang,
    ftsTable,
    sort,
    tags,
    hasYearFilter,
    effectiveYearFrom,
    effectiveYearTo,
    useBounding,
    boundDirection,
    orderExpr,
    tagFilterSql,
    yearFilterSql,
  };
}

// Builds the SELECT/FROM/WHERE/ORDER BY portion (everything except the
// trailing LIMIT/OFFSET) for fetching matching rows, given the parsed
// request and which columns to select. Returns { sql, args } where args
// still needs LIMIT (and OFFSET, if paginating) appended by the caller.
export function buildResultsQuery(parsed, columnsSql) {
  const { ftsQuery, ftsTable, sort, tags, useBounding, boundDirection, orderExpr, tagFilterSql, yearFilterSql, effectiveYearFrom, effectiveYearTo } = parsed;
  const rankSelect = sort === "relevance" ? `, bm25(${ftsTable}, 10.0, 3.0, 1.0) AS rank` : "";

  if (useBounding) {
    return {
      sql: `
        SELECT ${columnsSql}${sort === "relevance" ? ", c.rank" : ""}
        FROM (
          SELECT rowid${rankSelect}
          FROM ${ftsTable}
          WHERE ${ftsTable} MATCH ?
          ORDER BY rowid ${boundDirection}
          LIMIT ?
        ) c
        JOIN articles a ON a.id = c.rowid
        WHERE 1=1 ${tagFilterSql}
        ORDER BY ${orderExpr}
      `,
      args: [ftsQuery, CANDIDATE_LIMIT, ...tags],
    };
  }

  return {
    sql: `
      SELECT ${columnsSql}${rankSelect}
      FROM ${ftsTable}
      JOIN articles a ON a.id = ${ftsTable}.rowid
      WHERE ${ftsTable} MATCH ?
      ${tagFilterSql}
      ${yearFilterSql}
      ORDER BY ${orderExpr}
    `,
    args: [ftsQuery, ...tags, effectiveYearFrom, effectiveYearTo],
  };
}

export function buildCountQuery(parsed) {
  const { ftsQuery, ftsTable, tags, tagFilterSql, yearFilterSql, hasYearFilter, effectiveYearFrom, effectiveYearTo } = parsed;

  // Joining every matched row to the articles table just to count them is
  // what made common-word searches slow (SQLite/Turso has to materialize
  // and touch every match through the join instead of using the FTS5
  // index's own count). Skip the join entirely when there's no tag/year
  // filter that actually needs a column from `a` — this is the common
  // case for every plain search.
  if (tags.length === 0 && !hasYearFilter) {
    return {
      sql: `SELECT count(*) AS total FROM ${ftsTable} WHERE ${ftsTable} MATCH ?`,
      args: [ftsQuery],
    };
  }

  return {
    sql: `
      SELECT count(*) AS total
      FROM ${ftsTable}
      JOIN articles a ON a.id = ${ftsTable}.rowid
      WHERE ${ftsTable} MATCH ?
      ${tagFilterSql}
      ${yearFilterSql}
    `,
    args: [ftsQuery, ...tags, ...(hasYearFilter ? [effectiveYearFrom, effectiveYearTo] : [])],
  };
}
