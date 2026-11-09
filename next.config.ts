import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolated local UI/acceptance instances must not contend with the user's running dev server.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Stop `next dev` from writing AGENTS.md / CLAUDE.md into the repo root.
  agentRules: false,
};

export default nextConfig;
