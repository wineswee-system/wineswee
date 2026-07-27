/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // 商品圖/banner/logo 直連 wineswee 官網 CDN。此環境 next/image 代理不到外部 CDN,
    // 故關閉最佳化(unoptimized)→ 瀏覽器直接向 CDN 取圖,確保圖片一定載得出來。
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'www.wineswee.com' },
      { protocol: 'https', hostname: 'wineswee.com' },
    ],
  },
}
export default nextConfig
