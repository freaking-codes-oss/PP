/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const api = process.env.CAS_API_URL ?? 'http://127.0.0.1:8787';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${api}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
