import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  distDir: 'dist',
  turbopack: {
    root: './',
  },
};

export default nextConfig;
