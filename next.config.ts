import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  // Activate new service worker immediately on deploy so PWA users
  // pick up sync/UI fixes without having to reinstall the app.
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
  },
  // Mobile networks bounce between offline/online frequently
  // (lock screen, WiFi handoff, tunnels). Auto-reloading on every
  // online event causes reload storms that Safari surfaces as
  // "This page couldn't load". Keep state instead.
  reloadOnOnline: false,
});

const nextConfig: NextConfig = {
  transpilePackages: ['pdfjs-dist'],
  serverExternalPackages: ['@libsql/client'],
  webpack: (config) => {
    // pdfjs-dist optionally imports 'canvas' for server-side rendering; not needed in browser
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
};

export default withPWA(nextConfig);
