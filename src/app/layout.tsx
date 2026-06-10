import type { Metadata, Viewport } from "next";
import { Outfit, M_PLUS_Rounded_1c } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeContext";

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
    <html lang="en" className={`${outfit.variable} ${mPlusRounded.variable}`}>
      <body className="antialiased">
        {/* テーマをReact hydration前に適用してFOUC防止 */}
        <script dangerouslySetInnerHTML={{ __html: `try{var id=localStorage.getItem('lily-memo-theme');if(!id){var l=localStorage.getItem('theme');if(l==='dark')id='night';}var dark=(id==='night'||id==='starry'||id==='fireworks'||id==='library');document.body.setAttribute('data-theme',dark?'dark':'light');if(id)document.body.setAttribute('data-theme-id',id);if(id==='starry')document.body.setAttribute('data-starfield','true');if(id==='fireworks')document.body.setAttribute('data-fireworks','true');}catch(e){}` }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
