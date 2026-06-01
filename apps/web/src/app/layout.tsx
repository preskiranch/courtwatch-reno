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
const isCourtVision = process.env.NEXT_PUBLIC_APP_TARGET === "courtvision";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: isCourtVision ? "CourtVision Scorekeeper" : "Court Watch AAU",
  description: isCourtVision
    ? "Mobile AI camera basketball scorekeeper MVP with court calibration, debug scoring, and manual correction."
    : "Independent AAU tournament tracker for schedules, records, brackets, alerts, and final placements.",
  manifest: "/manifest.webmanifest",
  alternates: {
    canonical: "/"
  },
  openGraph: {
    title: isCourtVision ? "CourtVision Scorekeeper" : "Court Watch AAU",
    description: isCourtVision
      ? "Track basketball scores from calibrated 2PT and 3PT zones with camera-ready architecture."
      : "Follow AAU tournament teams by device with schedules, records, brackets, alerts, and final placements.",
    url: "/",
    siteName: isCourtVision ? "CourtVision Scorekeeper" : "Court Watch AAU",
    type: "website"
  },
  appleWebApp: {
    capable: true,
    title: isCourtVision ? "CourtVision" : "Court Watch AAU",
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
