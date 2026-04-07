import type { Metadata, Viewport } from "next";
import { Outfit, M_PLUS_Rounded_1c } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const mPlusRounded = M_PLUS_Rounded_1c({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-m-plus-rounded",
});

export const metadata: Metadata = {
  title: "Lily Memo",
  description: "A cute and simple memo app",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Lily Memo",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffb6c1",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${outfit.variable} ${mPlusRounded.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
