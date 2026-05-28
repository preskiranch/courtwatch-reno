import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"]
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"]
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.WEB_BASE_URL ??
  "https://courtwatch-reno-web.onrender.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Court Watch AAU",
  description:
    "Independent AAU tournament tracker for schedules, records, brackets, alerts, and final placements.",
  manifest: "/manifest.webmanifest",
  alternates: {
    canonical: "/"
  },
  openGraph: {
    title: "Court Watch AAU",
    description:
      "Follow AAU tournament teams by device with schedules, records, brackets, alerts, and final placements.",
    url: "/",
    siteName: "Court Watch AAU",
    type: "website"
  },
  appleWebApp: {
    capable: true,
    title: "Court Watch AAU",
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  themeColor: "#f97316",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
