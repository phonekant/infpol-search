// Exports the current search's matching articles (same query/sort/filters
// as /api/search) as CSV, TSV, XLSX, or PDF. Unlike the search results
// endpoint, this includes the full scraped article body, not just the
// snippet, and reuses the same CANDIDATE_LIMIT cap (2000) that already
// bounds ranked results, so an export never tries to serialize an entire
// 50,000+ match archive-wide search in one request (which would time out
// the serverless function generating it).
import { createClient } from "@tursodatabase/serverless/compat";
import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";
import path from "node:path";
import { CANDIDATE_LIMIT, parseSearchRequest, buildResultsQuery } from "@/lib/searchQuery";

// PDF generation for a full 2000-article export takes several seconds
// (~5-7s observed), on top of the DB fetch. Vercel's default serverless
// function timeout can be as low as 10s, so extend it explicitly.
export const maxDuration = 60;

const FONT_REGULAR = path.join(process.cwd(), "src/fonts/DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "src/fonts/DejaVuSans-Bold.ttf");

function csvEscape(value, delimiter) {
  const s = value == null ? "" : String(value);
  if (s.includes(delimiter) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toDelimited(rows, delimiter) {
  const header = ["Title", "Date", "Tags", "URL", "Full text"];
  const lines = [header.map((h) => csvEscape(h, delimiter)).join(delimiter)];
  for (const r of rows) {
    lines.push(
      [r.title, r.date, r.tags, r.url, r.body].map((v) => csvEscape(v, delimiter)).join(delimiter)
    );
  }
  // A UTF-8 BOM so Excel opens Cyrillic text correctly instead of guessing
  // a Windows codepage and garbling it.
  return "﻿" + lines.join("\r\n");
}

// Excel's own hard limit is 32767 characters per cell; a handful of the
// longest archive articles exceed that, which would otherwise crash
// XLSX.utils.json_to_sheet entirely. Truncate just for this format — CSV,
// TSV, and PDF exports still carry the complete, untruncated body.
const XLSX_MAX_CELL = 32000;

function toXlsxBuffer(rows) {
  const sheetRows = rows.map((r) => {
    const body =
      r.body && r.body.length > XLSX_MAX_CELL
        ? r.body.slice(0, XLSX_MAX_CELL) + "… [truncated — use CSV, TSV, or PDF export for the full text]"
        : r.body;
    return {
      Title: r.title,
      Date: r.date,
      Tags: r.tags,
      URL: r.url,
      "Full text": body,
    };
  });
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  ws["!cols"] = [{ wch: 40 }, { wch: 12 }, { wch: 30 }, { wch: 40 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Articles");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function toPdfBuffer(rows, queryLabel) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("body", FONT_REGULAR);
    doc.registerFont("bold", FONT_BOLD);

    doc.font("bold").fontSize(16).text(`Info Polis Archive Search — "${queryLabel}"`);
    doc.font("body").fontSize(10).fillColor("#555").text(`${rows.length} articles`);
    doc.moveDown();

    rows.forEach((r, i) => {
      if (i > 0) doc.moveDown().moveTo(doc.x, doc.y).lineTo(545, doc.y).strokeColor("#ccc").stroke();
      doc.moveDown(0.5);
      doc.font("bold").fontSize(13).fillColor("#000").text(r.title);
      doc
        .font("body")
        .fontSize(9)
        .fillColor("#555")
        .text(`${r.date}${r.tags ? " · " + r.tags : ""}`);
      doc.font("body").fontSize(9).fillColor("#3355cc").text(r.url, { link: r.url, underline: true });
      doc.moveDown(0.3);
      doc.font("body").fontSize(11).fillColor("#000").text(r.body || "");
    });

    doc.end();
  });
}

const FORMATS = {
  csv: { mime: "text/csv; charset=utf-8", ext: "csv" },
  tsv: { mime: "text/tab-separated-values; charset=utf-8", ext: "tsv" },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  },
  pdf: { mime: "application/pdf", ext: "pdf" },
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const format = FORMATS[searchParams.get("format")] ? searchParams.get("format") : "csv";
  const parsed = parseSearchRequest(searchParams);
  const { ftsQuery, q } = parsed;

  if (!ftsQuery) {
    return Response.json({ error: "No search query provided." }, { status: 400 });
  }

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

    const columnsSql = "a.id, a.url, a.title, a.tags, a.published AS date, a.body";
    const { sql, args } = buildResultsQuery(parsed, columnsSql);
    const resultsRes = await client.execute({
      sql: `${sql} LIMIT ?`,
      args: [...args, CANDIDATE_LIMIT],
    });

    const rows = resultsRes.rows.map((r) => ({
      title: r.title,
      date: r.date,
      tags: r.tags ? String(r.tags).split(",").filter(Boolean).join(", ") : "",
      url: r.url,
      body: r.body || "",
    }));

    // HTTP header values must be Latin-1/ByteString — a Cyrillic query (the
    // normal case here, since all article content is Russian) would throw
    // when set directly as the filename. Keep an ASCII-only fallback name
    // for the plain `filename=` param, and carry the real, human-readable
    // name via the RFC 5987 `filename*=UTF-8''...` param that every modern
    // browser already prefers.
    const asciiQuery =
      q
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "search";
    const asciiFilename = `infpol-export-${asciiQuery}.${FORMATS[format].ext}`;
    const utf8Filename = `infpol-export-${(q.trim() || "search")}.${FORMATS[format].ext}`;

    let body;
    if (format === "csv") body = toDelimited(rows, ",");
    else if (format === "tsv") body = toDelimited(rows, "\t");
    else if (format === "xlsx") body = toXlsxBuffer(rows);
    else body = await toPdfBuffer(rows, q);

    return new Response(body, {
      headers: {
        "Content-Type": FORMATS[format].mime,
        "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(utf8Filename)}`,
      },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
