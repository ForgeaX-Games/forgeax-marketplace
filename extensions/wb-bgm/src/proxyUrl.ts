/**
 * 把外部 URL 转成可在浏览器中访问的 URL：走 /api/wb/bgm/cos-proxy 避免 CORS
 * （host 侧仅保留这一条通用流代理路由)。blob:/data: 与非 http(s) 原样返回。
 */
export function proxyUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return url;
  return `/api/wb/bgm/cos-proxy?url=${encodeURIComponent(url)}`;
}
