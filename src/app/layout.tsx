import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { connection } from "next/server";
import { ClipMark } from "@/components/Marks";
import "./globals.css";

const displayFont = localFont({
  src: "./fonts/schibsted-grotesk-latin-wght-normal.woff2",
  variable: "--font-display",
  weight: "400 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Passclip",
  description: "Turn any ticket into an Apple Wallet pass.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every document needs its own CSP nonce, supplied by src/proxy.ts.
  await connection();

  return (
    <html lang="en" className={displayFont.variable}>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="site-header page-shell">
          <Link className="brand" href="/" aria-label="Passclip home">
            <span className="brand-mark" aria-hidden="true"><ClipMark /></span>
            Passclip
          </Link>
          <Link className="text-link" href="/privacy">Privacy</Link>
        </header>
        {children}
        <footer className="footer page-shell">
          <p>Your tickets stay in your browser.</p>
          <Link className="text-link" href="/privacy">How we handle your data</Link>
        </footer>
      </body>
    </html>
  );
}
