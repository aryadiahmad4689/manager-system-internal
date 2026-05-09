/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['10.168.91.160'],
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'bcrypt', 'ssh2'],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.node = {
        ...config.node,
        __dirname: true,
      };

      // Prevent webpack from bundling native modules in API routes
      config.externals = config.externals || [];
      config.externals.push({
        'ssh2': 'commonjs ssh2',
        'better-sqlite3': 'commonjs better-sqlite3',
        'bcrypt': 'commonjs bcrypt',
      });
    }
    return config;
  },
};

export default nextConfig;
