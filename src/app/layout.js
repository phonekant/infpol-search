import "./globals.css";

export const metadata = {
  title: "Info Polis Archive Search",
  description: "Full-text search over the Info Polis (Buryatia) news archive",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full font-mono">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full min-h-full flex flex-col font-mono text-lg leading-relaxed bg-[#191919] text-gray-100 selection:bg-blue-800/50">
        {children}
      </body>
    </html>
  );
}
