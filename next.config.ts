import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/campaigns/workflow": ["./workflows/production/*.json", "./workflows/release/*.json"],
  },
};
export default nextConfig;
