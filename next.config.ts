import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` and `next build` both write the build directory, and on Windows they
  // do not fail cleanly when they collide — the build stalls indefinitely with no
  // output. Letting a second process point somewhere else removes the collision
  // instead of scheduling around it. Unset (the normal case) this is exactly '.next',
  // so the developer's workflow and every deployment are unaffected.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Pin server-action requests to the deployment that served the page, so open
  // tabs from an older build don't 404 with "Failed to find Server Action"
  // after a new deploy. On Vercel this pairs with Skew Protection; the env var
  // is injected automatically and is simply undefined elsewhere (dev/self-host).
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
  // Required for ffmpeg.wasm — enables SharedArrayBuffer via COOP/COEP headers.
  // Using 'credentialless' for COEP to avoid breaking external resources (fonts, images)
  // that lack Cross-Origin-Resource-Policy headers.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    // Cover artwork is immutable once published and served from stable paths,
    // so re-optimising it on the default short TTL is pure waste — and the
    // optimiser shares the server's event loop, so that waste shows up as slow
    // page responses and "upstream image response timed out" errors.
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/**',
      },
      {
        protocol: 'https',
        hostname: 'media-stage.kissago.cc',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'media.kissago.cc',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.r2.cloudflarestorage.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
    // Renamed in Next 16 alongside middleware -> proxy; the old key is deprecated.
    proxyClientMaxBodySize: '20mb',
  },
  output: 'standalone',
  // Ensure the admin manual markdown is traced into the standalone server
  // bundle so /admin/help can fs.readFile it at runtime.
  outputFileTracingIncludes: {
    '/admin/help': ['./docs/admin-settings-manual.md'],
  },
  transpilePackages: ['motion'],
};

export default nextConfig;
