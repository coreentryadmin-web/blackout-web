import type { MetadataRoute } from 'next'

const BASE = 'https://blackouttrades.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard', '/flows', '/heatmap', '/terminal', '/nighthawk', '/vector', '/sign-in', '/sign-up', '/upgrade'],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  }
}
