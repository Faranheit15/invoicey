import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import Header from "@/components/ui/header";
import Footer from "@/components/ui/footer";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Invoicey",
  description: "Create invoices fast and easily",
  // favicon.svg adapts to the OS light/dark preference on its own. The Apple
  // touch icon is a PNG, not the SVG it used to be: iOS silently ignores an
  // SVG apple-touch-icon and screenshots the page instead, which is how a
  // home-screen icon ends up being a blurry crop of the header.
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  // Standalone on iOS, where there is no manifest support: Safari reads these
  // meta tags instead. `app/manifest.ts` covers every other browser.
  appleWebApp: {
    capable: true,
    title: "Invoicey",
    statusBarStyle: "default",
  },
};

// viewport-fit=cover lets the page reach the physical screen edges on notched
// phones; globals.css then pays the safe-area insets back where content would
// otherwise sit under the notch or the home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The installed app's title bar. A pair, because the theme is per-user and
  // persisted: a single navy value would leave a dark bar over a white app for
  // every light-mode user. Browsers pick by media query, so this tracks the OS
  // preference — the same default `lib/theme.ts` resolves to before a stored
  // choice exists.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="invoicey-theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
      </head>
      <body className="antialiased">
        <Header />
        {children}
        <Footer />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
