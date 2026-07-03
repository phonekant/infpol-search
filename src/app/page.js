"use client";

import { useEffect, useRef, useState } from "react";

export default function Home() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    if (!query.trim()) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}&page=${page}`)
        .then((r) => r.json())
        .then((json) => {
          if (json.error) throw new Error(json.error);
          setData(json);
        })
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, page]);

  const results = data?.results || [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;

  return (
    <div className="flex-1 w-full">
      <div className="max-w-3xl mx-auto p-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold leading-relaxed">
            Info Polis Archive Search
          </h1>
          <p className="text-lg leading-relaxed text-neutral-400">
            Full-text search over the Info Polis news archive
          </p>
        </div>

        <div className="rounded-lg border border-neutral-400/30 bg-white/[0.03] focus-within:border-blue-500/60 mb-6">
          <textarea
            rows={1}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="shaman, buddhism, Tengeri, doctors, environment..."
            className="w-full h-full bg-transparent outline-none resize-none p-4 text-lg leading-relaxed text-gray-100 caret-blue-400 placeholder:text-neutral-400"
          />
        </div>

        {query && loading && (
          <p className="text-lg leading-relaxed text-neutral-400 mb-4">Searching…</p>
        )}

        {query && error && (
          <p className="text-lg leading-relaxed text-red-400 mb-4">{error}</p>
        )}

        {query && !loading && !error && data && (
          <p className="text-lg leading-relaxed text-neutral-400 mb-4">
            Found: {total}
            {totalPages > 1 ? ` (page ${page} of ${totalPages})` : ""}
          </p>
        )}

        {query && !loading && !error && data && total === 0 && (
          <p className="text-lg leading-relaxed text-neutral-400">
            No results for “{query}”.
          </p>
        )}

        <div className="flex flex-col gap-4">
          {results.map((a) => (
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
                {a.tags && a.tags.length > 0 ? ` · ${a.tags.join(", ")}` : ""}
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
