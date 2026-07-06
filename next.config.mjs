/** @type {import('next').NextConfig} */
const nextConfig = {
  // The export route loads Cyrillic-capable TTF fonts from src/fonts at
  // runtime via fs.readFileSync with a dynamic path, which Next's automatic
  // file tracing doesn't reliably pick up. Explicitly include them so
  // they're bundled into the deployed serverless function. PDFKit itself
  // also loads its own built-in font metrics (Helvetica.afm etc.) from
  // node_modules/pdfkit/js/data at runtime the same way — its constructor
  // sets a default font before we ever register our own — so that needs to
  // be traced in too, or PDF export fails with ENOENT in production.
  outputFileTracingIncludes: {
    "/api/export": ["./src/fonts/**", "./node_modules/pdfkit/js/data/**"],
  },
};

export default nextConfig;
