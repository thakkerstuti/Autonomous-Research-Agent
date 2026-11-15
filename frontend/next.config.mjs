/** @type {import('next').NextConfig} */
const apiTarget = process.env.NEXT_PUBLIC_API_URL;
const isDev = process.env.NODE_ENV === "development";

const nextConfig = {
  async rewrites() {
    if (!apiTarget) return [];
    const api = apiTarget.replace(/\/$/, "");
    // Local development: relay every API call through the dev server so the
    // deployed backend's CORS allow-list doesn't block localhost.
    if (isDev) return [{ source: "/backend/:path*", destination: `${api}/:path*` }];
    // Production: only the auth endpoints go through this site, so the
    // refresh-token cookie is first-party here (no third-party cookies).
    // Other API calls go straight to the backend with a bearer token.
    return [{ source: "/backend/auth/:path*", destination: `${api}/auth/:path*` }];
  },

  // Full research reports can take a few minutes; don't cut the relay off early.
  experimental: { proxyTimeout: 600_000 },
};
export default nextConfig;
