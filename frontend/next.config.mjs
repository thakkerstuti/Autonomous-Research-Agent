/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app always opens on the Dashboard. A real HTTP redirect (not a
  // client-side one) so there is no flash of another page first.
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
};
export default nextConfig;
