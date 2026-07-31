import type { MetadataRoute } from 'next'

const BASE = 'https://blackouttrades.com'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const routes: { path: string; priority: number; freq: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
    { path: '/',                      priority: 1.0, freq: 'weekly' },
    { path: '/pricing',               priority: 0.9, freq: 'weekly' },
    { path: '/faq',                   priority: 0.7, freq: 'monthly' },
    { path: '/contact',               priority: 0.5, freq: 'yearly' },
    { path: '/learn',                 priority: 0.8, freq: 'weekly' },
    { path: '/learn/getting-started', priority: 0.7, freq: 'monthly' },
    { path: '/learn/spx-slayer',      priority: 0.7, freq: 'monthly' },
    { path: '/learn/helix-flows',     priority: 0.7, freq: 'monthly' },
    { path: '/learn/largo-ai',        priority: 0.7, freq: 'monthly' },
    { path: '/learn/night-hawk',      priority: 0.7, freq: 'monthly' },
    { path: '/learn/heat-maps',       priority: 0.7, freq: 'monthly' },
    { path: '/learn/glossary',        priority: 0.7, freq: 'monthly' },
    { path: '/terms',                 priority: 0.3, freq: 'yearly' },
    { path: '/privacy',               priority: 0.3, freq: 'yearly' },
    { path: '/disclaimer',            priority: 0.3, freq: 'yearly' },
    { path: '/refund-policy',         priority: 0.3, freq: 'yearly' },
    { path: '/cookie-policy',         priority: 0.3, freq: 'yearly' },
  ]
  return routes.map(({ path, priority, freq }) => ({
    url: `${BASE}${path}`, lastModified: now, changeFrequency: freq, priority,
  }))
}
