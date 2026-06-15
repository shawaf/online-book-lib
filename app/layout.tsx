import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "المكتبة الإسلامية — Islamic Library",
  description: "A virtual Islamic library — walk through shelves of Quran, Hadith, Fiqh, Seerah and more",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full h-full bg-black">{children}</body>
    </html>
  );
}
