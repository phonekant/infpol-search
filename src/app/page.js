"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 2000 + 1 }, (_, i) => CURRENT_YEAR - i);

export default function Home() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("relevance");
  const [selectedTags, setSelectedTags] = useState([]);
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const resultsTopRef = useRef(null);
  const filterKeyRef = useRef("");
  const exportRef = useRef(null);

  // Only the raw typing is debounced. Sort/filter/page changes fetch
  // immediately below — piling them onto the same timer is what made
  // pagination feel laggy (a flat 300ms delay on every click).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const tagsKey = selectedTags.join(",");

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setData(null);
      return;
    }

    // If the search itself, sort, or filters changed (not just the page),
    // jump back to page 1 rather than staying on whatever page the user
    // was previously viewing.
    const filterKey = JSON.stringify([debouncedQuery, sortBy, tagsKey, yearFrom, yearTo]);
    const filtersChanged = filterKey !== filterKeyRef.current;
    filterKeyRef.current = filterKey;
    const effectivePage = filtersChanged ? 1 : page;
    if (filtersChanged && page !== 1) setPage(1);

    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      q: debouncedQuery,
      page: String(effectivePage),
      sort: sortBy,
    });
    if (selectedTags.length) params.set("tags", tagsKey);
    if (yearFrom) params.set("yearFrom", yearFrom);
    if (yearTo) params.set("yearTo", yearTo);

    fetch(`/api/search?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json);
        resultsTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, page, sortBy, tagsKey, yearFrom, yearTo]);

  const results = data?.results || [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const facetTags = useMemo(() => data?.facets?.tags || [], [data]);

  function toggleTag(tag) {
    setSelectedTags((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));
  }

  // Close the export dropdown when clicking outside it.
  useEffect(() => {
    if (!exportOpen) return;
    function onClick(e) {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [exportOpen]);

  async function handleExport(format) {
    setExportOpen(false);
    setExporting(true);
    setExportError(null);
    try {
      const params = new URLSearchParams({ q: debouncedQuery, sort: sortBy, format });
      if (selectedTags.length) params.set("tags", tagsKey);
      if (yearFrom) params.set("yearFrom", yearFrom);
      if (yearTo) params.set("yearTo", yearTo);

      const res = await fetch(`/api/export?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `infpol-export.${format}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex-1 w-full">
      <div className="max-w-3xl mx-auto p-8">
        <div className="mb-6" ref={resultsTopRef}>
          <h1 className="text-lg font-semibold leading-relaxed">
            Info Polis Archive Search
          </h1>
          <p className="text-lg leading-relaxed text-neutral-400">
            Full-text search over the Info Polis news archive
          </p>
        </div>

        <div className="rounded-lg border border-neutral-400/30 bg-white/[0.03] focus-within:border-blue-500/60 mb-4">
          <textarea
            rows={1}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="shaman, buddhism, Tengeri, doctors, environment..."
            className="w-full h-full bg-transparent outline-none resize-none p-4 text-lg leading-relaxed text-gray-100 caret-blue-400 placeholder:text-neutral-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4 text-base">
          <label className="flex items-center gap-2 text-neutral-400">
            Sort:
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-[#191919] border border-neutral-400/30 rounded px-2 py-1 text-gray-100 focus:outline-none focus:border-blue-500/60"
            >
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-neutral-400">
            From:
            <select
              value={yearFrom}
              onChange={(e) => setYearFrom(e.target.value)}
              className="bg-[#191919] border border-neutral-400/30 rounded px-2 py-1 text-gray-100 focus:outline-none focus:border-blue-500/60"
            >
              <option value="">Any</option>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-neutral-400">
            To:
            <select
              value={yearTo}
              onChange={(e) => setYearTo(e.target.value)}
              className="bg-[#191919] border border-neutral-400/30 rounded px-2 py-1 text-gray-100 focus:outline-none focus:border-blue-500/60"
            >
              <option value="">Any</option>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>

          {selectedTags.length > 0 && (
            <button
              onClick={() => setSelectedTags([])}
              className="text-neutral-400 hover:text-gray-100 underline underline-offset-2"
            >
              Clear tags
            </button>
          )}
        </div>

        {facetTags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {facetTags.map(({ tag, count }) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-2 py-1 rounded-full text-base border ${
                    active
                      ? "border-blue-500/70 bg-blue-500/10 text-blue-300"
                      : "border-neutral-400/30 text-neutral-400 hover:border-blue-500/40 hover:text-gray-100"
                  }`}
                >
                  {tag} <span className="opacity-60">({count})</span>
                </button>
              );
            })}
          </div>
        )}

        {query && loading && (
          <p className="text-lg leading-relaxed text-neutral-400 mb-4">Searching…</p>
        )}

        {query && error && (
          <p className="text-lg leading-relaxed text-red-400 mb-4">{error}</p>
        )}

        {query && !loading && !error && data && (
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <p className="text-lg leading-relaxed text-neutral-400">
              Found: {total}
              {totalPages > 1 ? ` (page ${page} of ${totalPages})` : ""}
            </p>

            {total > 0 && (
              <div className="relative" ref={exportRef}>
                <button
                  onClick={() => setExportOpen((o) => !o)}
                  disabled={exporting}
                  className="px-3 py-1 rounded border border-neutral-400/40 hover:bg-white/5 text-base disabled:opacity-50"
                >
                  {exporting ? "Exporting…" : "Export as ▾"}
                </button>
                {exportOpen && (
                  <div className="absolute right-0 mt-1 w-36 rounded border border-neutral-400/30 bg-[#191919] shadow-lg z-10">
                    {[
                      { format: "csv", label: "CSV" },
                      { format: "tsv", label: "TSV" },
                      { format: "xlsx", label: "Excel (.xlsx)" },
                      { format: "pdf", label: "PDF" },
                    ].map(({ format, label }) => (
                      <button
                        key={format}
                        onClick={() => handleExport(format)}
                        className="block w-full text-left px-3 py-2 text-base hover:bg-white/5"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {exportError && (
          <p className="text-base leading-relaxed text-red-400 mb-4">{exportError}</p>
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
