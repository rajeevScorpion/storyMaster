import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
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
    middlewareClientMaxBodySize: '20mb',
  },
  output: 'standalone',
  // Ensure the admin manual markdown is traced into the standalone server
  // bundle so /admin/help can fs.readFile it at runtime.
  outputFileTracingIncludes: {
    '/admin/help': ['./docs/admin-settings-manual.md'],
  },
  transpilePackages: ['motion'],
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
