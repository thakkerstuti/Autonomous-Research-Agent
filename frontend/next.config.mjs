/** @type {import('next').NextConfig} */
const apiTarget = process.env.NEXT_PUBLIC_API_URL;
const isDev = process.env.NODE_ENV === "development";

const nextConfig = {
  // Local development only: relay API calls through the dev server so the
  // deployed backend's CORS allow-list (production origin) doesn't block
  // localhost. Production builds call the backend directly, unchanged.
  async rewrites() {
    if (!isDev || !apiTarget) return [];
    return [{ source: "/backend/:path*", destination: `${apiTarget.replace(/\/$/, "")}/:path*` }];
  },

  // Full research reports can take a few minutes; don't cut the relay off early.
  experimental: { proxyTimeout: 600_000 },
};
export default nextConfig;
