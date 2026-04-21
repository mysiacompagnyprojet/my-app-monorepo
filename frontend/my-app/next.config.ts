import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

let supabaseHostname: string | null = null;

try {
  supabaseHostname = supabaseUrl ? new URL(supabaseUrl).hostname : null;
} catch {
  supabaseHostname = null;
}

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  images: {
    remotePatterns: supabaseHostname
      ? [
          {
            protocol: "https",
            hostname: supabaseHostname,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
};

export default nextConfig;

