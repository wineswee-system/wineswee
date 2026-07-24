/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // 商品圖 / banner / logo 皆連 wineswee 官網 CDN,交給 next/image 最佳化
    remotePatterns: [
      { protocol: 'https', hostname: 'www.wineswee.com' },
      { protocol: 'https', hostname: 'wineswee.com' },
    ],
  },
}
export default nextConfig
