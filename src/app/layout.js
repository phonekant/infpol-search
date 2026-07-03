import "./globals.css";

export const metadata = {
  title: "Информ Полис — поиск по архиву",
  description: "Полнотекстовый поиск по архиву газеты «Информ Полис»",
};

// Runs before paint to avoid a light/dark flash: honors a saved preference,
// otherwise falls back to the OS-level color scheme.
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = stored ? stored === "dark" : prefersDark;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="ru" className="h-full font-mono" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="h-full min-h-full flex flex-col font-mono text-lg leading-relaxed bg-gray-50 text-gray-900 dark:bg-[#191919] dark:text-gray-100 selection:bg-blue-200/50 dark:selection:bg-blue-800/50">
        {children}
      </body>
    </html>
  );
}
