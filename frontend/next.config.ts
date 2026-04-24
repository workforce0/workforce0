import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:3000";

// NEXT_PUBLIC_HOSTED_MODE=1 produces a static export for the marketing
// landing page on Cloudflare Pages. In that mode the rewrites below are
// unused (no backend to proxy to), and all routes must be static.
const hostedMode = process.env.NEXT_PUBLIC_HOSTED_MODE === "1";

const nextConfig: NextConfig = hostedMode
  ? {
      output: "export",
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {
      output: "standalone",
      async rewrites() {
        return [
          { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
          { source: "/webhooks/:path*", destination: `${backendUrl}/webhooks/:path*` },
        ];
      },
    };

export default nextConfig;
