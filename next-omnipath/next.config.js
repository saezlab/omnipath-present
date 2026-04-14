/** @type {import('next').NextConfig} */
const { config } = require('dotenv');
const path = require('path');

// Load parent directory .env file
config({ path: path.resolve(__dirname, '../.env') });

const API_SERVICE_URL = process.env.API_SERVICE_URL || (process.env.DOCKERIZED === 'true' ? 'http://api-service:8081' : 'http://localhost:8081');

const nextConfig = {
  output: 'standalone',
  
  // Disable telemetry in production
  env: {
    NEXT_TELEMETRY_DISABLED: '1',
  },

  // Local/dev fallback proxy so `/api/*` hits FastAPI even without Traefik.
  // In production Dokploy/Traefik should route `/api/*` directly to api-service.
  async rewrites() {
    return {
      fallback: [
        {
          source: '/api/:path*',
          destination: `${API_SERVICE_URL}/:path*`,
        },
      ],
    };
  },

  // Headers for security
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin'
          }
        ]
      }
    ]
  },

  // Production optimizations
  poweredByHeader: false,
  compress: true,
  
  // Image optimization
  images: {
    domains: ['localhost'],
    unoptimized: process.env.NODE_ENV === 'development',
  },

  // Experimental features for better performance
  experimental: {
    optimizeCss: true,
  }
}

module.exports = nextConfig