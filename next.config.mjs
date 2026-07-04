/** @type {import('next').NextConfig} */
const nextConfig = {
  // The export route loads Cyrillic-capable TTF fonts from src/fonts at
  // runtime via fs.readFileSync with a dynamic path, which Next's automatic
  // file tracing doesn't reliably pick up. Explicitly include them so
  // they're bundled into the deployed serverless function.
  outputFileTracingIncludes: {
    "/api/export": ["./src/fonts/**"],
  },
};

export default nextConfig;
