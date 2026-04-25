import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  // metadataBase makes relative paths in `icons`/`openGraph.images`
  // resolve to absolute URLs for crawlers (LinkedIn, Twitter, Slack
  // unfurls). Without it, Next falls back to localhost:3000 in
  // production builds and OG images break on every share. Override at
  // build time with NEXT_PUBLIC_SITE_URL when deploying behind a
  // different origin.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://workforce0.com'),
  title: "Workforce0 — AI workforce for product teams",
  description: "Open-source, self-hosted AI workforce. Meetings in, shipped work out.",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
  openGraph: {
    title: "Workforce0",
    description: "Open-source, self-hosted AI workforce. Meetings in, shipped work out.",
    images: [{ url: "/logo-full.png", width: 1610, height: 1440, alt: "Workforce0" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${jakarta.variable} font-[family-name:var(--font-jakarta)] min-h-screen bg-canvas antialiased`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-ink focus:text-ink-inverse focus:rounded-lg focus:text-sm focus:font-medium focus:shadow-lg"
        >
          Skip to main content
        </a>
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
