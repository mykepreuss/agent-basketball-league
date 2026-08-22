/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  ...(process.env.ABL_ARENA_BUILD_ID === undefined
    ? {}
    : { generateBuildId: async () => process.env.ABL_ARENA_BUILD_ID }),
};

export default nextConfig;
