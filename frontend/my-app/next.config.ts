import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Force la racine du projet Next sur ce dossier (frontend/my-app)
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;

