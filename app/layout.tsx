import type { Metadata } from "next";
import { Fraunces, Public_Sans, JetBrains_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Family First Medical Clinic",
  description: "General checkups, walk-ins, and follow-ups — book, queue, and consult, paperless.",
};

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
