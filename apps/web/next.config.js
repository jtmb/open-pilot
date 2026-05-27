/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  experimental: {
    // Required in Next.js 14 to activate instrumentation.ts (auto-backup timer)
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
