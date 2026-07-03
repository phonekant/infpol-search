-- SQLite / Turso (libSQL) schema for the Info Polis archive search.
--
-- Design note: `body` holds the full scraped article text and exists ONLY to
-- power full-text search server-side. The API layer must never return this
-- column to the client — only title/date/tags/snippet/url ever go out, plus
-- a link back to the original article on infpol.ru.

CREATE TABLE IF NOT EXISTS articles (
  id          INTEGER PRIMARY KEY,
  url         TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  subtitle    TEXT,
  published   TEXT,              -- ISO date string, e.g. 2016-01-01
  tags        TEXT NOT NULL DEFAULT '',   -- comma-separated
  body        TEXT NOT NULL,     -- indexing only, never returned by the API
  snippet     TEXT NOT NULL      -- short excerpt, safe to display
);

CREATE INDEX IF NOT EXISTS articles_published_idx ON articles (published DESC);

-- FTS5 virtual table for full-text search. `content='articles'` makes this an
-- external-content table so we don't duplicate the text — it's indexed
-- straight out of the articles table via triggers below. Weighting isn't
-- native to FTS5 like Postgres tsvector ranks, but the bm25() ranking
-- function combined with column weights via bm25(articles_fts, 3.0, 1.0, 1.0)
-- gives comparable "title matters most" behavior at query time.
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title,
  tags,
  body,
  content='articles',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

-- Keep the FTS index in sync with the articles table.
CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, tags, body)
  VALUES (new.id, new.title, new.tags, new.body);
END;

CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, tags, body)
  VALUES ('delete', old.id, old.title, old.tags, old.body);
END;

CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, tags, body)
  VALUES ('delete', old.id, old.title, old.tags, old.body);
  INSERT INTO articles_fts(rowid, title, tags, body)
  VALUES (new.id, new.title, new.tags, new.body);
END;
