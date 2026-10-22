import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Don't let `next dev` write an AGENTS.md into the repo.
  agentRules: false,
}

export default nextConfig
