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
  reloadOnOnline: true,
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
