import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { BrandLogo } from "@/components/brand-logo";
import {
  SiteHeaderAsync,
  SiteHeaderFallback,
} from "@/components/site-header-async";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Supplier Portal",
    template: "%s · Supplier Portal",
  },
  description:
    "Supplier procurement portal. Authentication is Auth0; authorization is resolved from the internal database.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <a
          href="#main-content"
          className="absolute left-4 top-4 z-50 -translate-y-20 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground ring-2 ring-ring focus:translate-y-0"
        >
          Skip to content
        </a>
        <Suspense fallback={<SiteHeaderFallback />}>
          <SiteHeaderAsync />
        </Suspense>
        <main
          id="main-content"
          className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8"
        >
          {children}
        </main>
        <footer className="border-t border-border bg-background">
          <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-4">
            <BrandLogo
              variant="mark"
              size="sm"
              decorative
              className="shrink-0 opacity-90"
            />
            <p className="text-sm text-muted-foreground">
              Supplier Portal · company and supplier workspace
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
