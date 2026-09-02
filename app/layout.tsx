import type { Metadata } from "next";
import { Fraunces, Public_Sans, JetBrains_Mono } from "next/font/google";
import { getAppName } from "@/lib/branding";
import "./globals.css";

/**
 * Variables are named for the role, not the typeface, so swapping a family
 * later is one line here rather than a rename across globals.css.
 */

// Display. Fraunces is variable on an optical-size axis, so headings hold
// their character at 14px in a table header and at 60px on the waiting-room
// display without needing two separate cuts.
const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
});

const body = Public_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

// Every number in this product — queue numbers, pesos, stock counts, vitals —
// renders in this face with tabular figures, so columns line up and a queue
// number never reflows as it ticks from 9 to 10.
// Named --font-figures, not --font-mono: the latter is Tailwind's own theme
// key in globals.css, and pointing it at itself resolves to nothing.
const mono = JetBrains_Mono({
  variable: "--font-figures",
  subsets: ["latin"],
});

// The title is a holding-admin setting rather than a constant, so this has
// to be generateMetadata rather than a static `metadata` object. It costs
// one indexed row read per document request — `getAppName` is request-cached
// and falls back to the built-in name if the query fails, so a database
// blip degrades the tab title rather than the page. Every route in this app
// is already server-rendered on demand, so nothing loses static rendering
// by depending on it.
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: await getAppName(),
    description: "General checkups, walk-ins, and follow-ups — book, queue, and consult, paperless.",
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
