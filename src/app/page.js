"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const PAGE_SIZE = 20;

export default function Home() {
  const [articles, setArticles] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const inputRef = useRef(null);

  useEffect(() => {
    fetch("/data/articles.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setArticles)
      .catch((e) => setLoadError(String(e)));
  }, []);

  const tokens = useMemo(
    () =>
      query
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean),
    [query]
  );

  const results = useMemo(() => {
    if (!articles || tokens.length === 0) return [];
    return articles.filter((a) => tokens.every((t) => a.text.includes(t)));
  }, [articles, tokens]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const shown = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="flex-1 w-full">
      <div className="max-w-3xl mx-auto p-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold leading-relaxed">
            Info Polis Archive Search
          </h1>
          <p className="text-lg leading-relaxed text-neutral-400">
            {articles
              ? `${articles.length.toLocaleString("en-US")} articles from 2025`
              : loadError
              ? "Couldn't load the article index"
              : "Loading index…"}
          </p>
        </div>

        <div className="rounded-lg border border-neutral-400/30 bg-white/[0.03] focus-within:border-blue-500/60 mb-6">
          <textarea
            ref={inputRef}
            rows={1}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="shaman, buddhism, Tengeri, doctors, environment..."
            className="w-full h-full bg-transparent outline-none resize-none p-4 text-lg leading-relaxed text-gray-100 caret-blue-400 placeholder:text-neutral-400"
          />
        </div>

        {query && articles && (
          <p className="text-lg leading-relaxed text-neutral-400 mb-4">
            Found: {results.length}
            {totalPages > 1 ? ` (page ${page} of ${totalPages})` : ""}
          </p>
        )}

        {query && articles && results.length === 0 && (
          <p className="text-lg leading-relaxed text-neutral-400">
            No results for “{query}”.
          </p>
        )}

        <div className="flex flex-col gap-4">
          {shown.map((a) => (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-neutral-400/20 p-4 hover:border-blue-500/50 hover:bg-white/[0.03]"
            >
              <div className="font-semibold">{a.title}</div>
              <div className="text-neutral-400 text-base">
                {a.date}
                {a.tags.length > 0 ? ` · ${a.tags.join(", ")}` : ""}
              </div>
              <div className="mt-1">{a.snippet}</div>
            </a>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="flex gap-4 justify-center mt-8">
            {page > 1 && (
              <button
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 rounded border border-neutral-400/40 hover:bg-white/5"
              >
                ← Previous
              </button>
            )}
            {page < totalPages && (
              <button
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 rounded border border-neutral-400/40 hover:bg-white/5"
              >
                Next →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
