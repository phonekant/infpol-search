"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const PAGE_SIZE = 20;

function useTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch (e) {}
  };

  return [dark, toggle];
}

export default function Home() {
  const [dark, toggleDark] = useTheme();
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
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-lg font-semibold leading-relaxed">
              Поиск по архиву «Информ Полис»
            </h1>
            <p className="text-lg leading-relaxed text-neutral-500 dark:text-neutral-400">
              {articles
                ? `${articles.length.toLocaleString("ru-RU")} статей за 2025 год`
                : loadError
                ? "Не удалось загрузить индекс статей"
                : "Загрузка индекса…"}
            </p>
          </div>
          <button
            onClick={toggleDark}
            className="shrink-0 text-lg leading-relaxed px-3 py-1 rounded border border-neutral-400/40 hover:bg-black/5 dark:hover:bg-white/5"
            aria-label="Переключить тему"
          >
            {dark ? "☀︎" : "☾"}
          </button>
        </div>

        <div className="rounded-lg border border-neutral-400/30 bg-white/40 dark:bg-white/[0.03] focus-within:border-blue-500/60 mb-6">
          <textarea
            ref={inputRef}
            rows={1}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="шаман, буддизм, Тэнгэри, врачи, экология..."
            className="w-full h-full bg-transparent outline-none resize-none p-4 text-lg leading-relaxed text-gray-900 dark:text-gray-100 caret-blue-600 dark:caret-blue-400 placeholder:text-neutral-500 dark:placeholder:text-neutral-400"
          />
        </div>

        {query && articles && (
          <p className="text-lg leading-relaxed text-neutral-500 dark:text-neutral-400 mb-4">
            Найдено: {results.length}
            {totalPages > 1 ? ` (стр. ${page} из ${totalPages})` : ""}
          </p>
        )}

        {query && articles && results.length === 0 && (
          <p className="text-lg leading-relaxed text-neutral-500 dark:text-neutral-400">
            Ничего не найдено по запросу «{query}».
          </p>
        )}

        <div className="flex flex-col gap-4">
          {shown.map((a) => (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-neutral-400/20 p-4 hover:border-blue-500/50 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
            >
              <div className="font-semibold">{a.title}</div>
              <div className="text-neutral-500 dark:text-neutral-400 text-base">
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
                className="px-3 py-1 rounded border border-neutral-400/40 hover:bg-black/5 dark:hover:bg-white/5"
              >
                ← Назад
              </button>
            )}
            {page < totalPages && (
              <button
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 rounded border border-neutral-400/40 hover:bg-black/5 dark:hover:bg-white/5"
              >
                Вперёд →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
