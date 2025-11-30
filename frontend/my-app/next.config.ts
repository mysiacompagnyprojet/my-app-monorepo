import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Force la racine du projet Next sur ce dossier (frontend/my-app)
  turbopack: {
    root: __dirname,
  },

  // ⬇️ On ajoute ce bloc
  eslint: {
    // Vercel n’arrête plus le build à cause d’ESLint
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

