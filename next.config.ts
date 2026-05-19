import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['pdfjs-dist'],
  serverExternalPackages: ['@libsql/client'],
  webpack: (config, { webpack }) => {
    // pdfjs-dist optionally imports 'canvas' for server-side rendering; not needed in browser
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    // pptxgenjs's ESM build references node:* core modules (only used for
    // server-side remote image fetching, which we never do). Strip the
    // `node:` scheme and stub the Node-only modules out for the browser.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
        resource.request = resource.request.replace(/^node:/, '');
      }),
    );
    config.resolve.fallback = {
      ...config.resolve.fallback,
      https: false,
      http: false,
      fs: false,
      os: false,
      path: false,
    };
    return config;
  },
};

export default nextConfig;
