/** @type {import('next').NextConfig} */
const nextConfig = {
  // ← clé supportée par Next 15+
  turbopack: {
    root: __dirname, // force la racine à 'frontend/my-app'
  },
};

module.exports = nextConfig;

