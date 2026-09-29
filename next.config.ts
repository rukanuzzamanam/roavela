import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Keep the Postgres driver out of the bundler.
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  images: {
    remotePatterns: [
      // Image storage provider (Cloudinary) — enabled for later phases.
      { protocol: "https", hostname: "res.cloudinary.com" },
    ],
  },
  experimental: {
    // Photo and document uploads go through Server Actions (one file per request, 10 MB max).
    serverActions: { bodySizeLimit: "11mb" },
    // Enables forbidden() / unauthorized() for role-based 403 responses.
    authInterrupts: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
