/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fully static export — the dashboard is client-rendered and talks to the API
  // over HTTP/WS, so it ships as static files (Render Static Site, CDN, always-on).
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
