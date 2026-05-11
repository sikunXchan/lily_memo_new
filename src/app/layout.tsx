import type { Metadata, Viewport } from "next";
import { Outfit, M_PLUS_Rounded_1c } from "next/font/google";
import Providers from "@/components/Providers";
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
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
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
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${outfit.variable} ${mPlusRounded.variable}`}>
      <body className="antialiased">
        {/* テーマをReact hydration前に適用してFOUC防止 */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme');if(t)document.body.setAttribute('data-theme',t);}catch(e){}` }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
