import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sift — what buyers really think",
  description:
    "Structured review summaries and grounded Q&A over real customer reviews.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-4">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-xl font-semibold tracking-tight">Sift</span>
              <span className="hidden text-sm text-zinc-500 sm:inline">
                what buyers really think
              </span>
            </Link>
            <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
              Research Preview
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
        <footer className="border-t border-zinc-200 bg-white">
          <div className="mx-auto max-w-5xl px-6 py-4 text-xs text-zinc-500">
            Summaries are pre-generated; answers are grounded in real reviews and may
            still contain model errors. See the README for known limitations.
          </div>
        </footer>
      </body>
    </html>
  );
}
