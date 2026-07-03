-- Postgres schema for the Info Polis archive search.
--
-- Design note: `body` holds the full scraped article text and exists ONLY to
-- power full-text search server-side. The API layer must never return this
-- column to the client — only title/date/tags/snippet/url ever go out, plus
-- a link back to the original article on infpol.ru. This keeps us aligned
-- with how legitimate search engines index copyrighted news content: index
-- privately, surface a short snippet + link, never republish the full piece.

CREATE TABLE IF NOT EXISTS articles (
  id          BIGINT PRIMARY KEY,
  url         TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  subtitle    TEXT,
  published   TIMESTAMPTZ,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  body        TEXT NOT NULL,          -- indexing only, never returned by the API
  snippet     TEXT NOT NULL,          -- short excerpt, safe to display
  search_tsv  TSVECTOR
);

CREATE INDEX IF NOT EXISTS articles_search_idx ON articles USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS articles_published_idx ON articles (published DESC);

-- Keep search_tsv in sync automatically. Russian text search config gives us
-- stemming (шаман / шаманы / шаманизм all match) for free.
CREATE OR REPLACE FUNCTION articles_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('russian', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('russian', array_to_string(NEW.tags, ' ')), 'B') ||
    setweight(to_tsvector('russian', coalesce(NEW.body, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS articles_tsv_trigger ON articles;
CREATE TRIGGER articles_tsv_trigger
  BEFORE INSERT OR UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION articles_tsv_update();
