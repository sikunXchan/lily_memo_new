import type { NextConfig } from "next";

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

export default nextConfig;
