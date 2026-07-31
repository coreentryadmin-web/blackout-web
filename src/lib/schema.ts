const BASE = 'https://blackouttrades.com'

export const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'BlackOut Trades',
  url: BASE,
  logo: `${BASE}/images/blackout-emblem.webp`,
  description: 'BlackOut gives options traders live dealer gamma, 0DTE SPX options flow, and A–F graded setups. See what the desks see.',
  sameAs: [
    'https://x.com/blackouttrades',
    'https://www.instagram.com/blackouttrades',
    'https://discord.gg/xM7gVcrZc',
  ],
}

export const productSchema = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'BlackOut Trades',
  description: 'Options trading intelligence platform: live dealer gamma heatmaps, 0DTE SPX desk, institutional options flow, and A–F graded setups.',
  brand: { '@type': 'Brand', name: 'BlackOut Trades' },
  offers: [
    { '@type': 'Offer', name: 'SPX Slayer', price: '49.00', priceCurrency: 'USD', description: 'Core 0DTE SPX trading desk access.', url: `${BASE}/pricing`, availability: 'https://schema.org/InStock' },
    { '@type': 'Offer', name: 'BlackOut Premium (Monthly)', price: '199.00', priceCurrency: 'USD', description: 'All six modules plus Discord community.', url: `${BASE}/pricing`, availability: 'https://schema.org/InStock' },
    { '@type': 'Offer', name: 'BlackOut Premium (Yearly)', price: '1999.00', priceCurrency: 'USD', description: 'All six modules, billed yearly (~$167/mo).', url: `${BASE}/pricing`, availability: 'https://schema.org/InStock' },
  ],
}

export const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    { q: 'What is BlackOut Trades?', a: 'BlackOut is an options trading intelligence platform for SPX, 0DTE, and swing traders. It maps live dealer gamma positioning, tracks institutional options flow, and grades every setup A–F so you only act on the ones that survive screening.' },
    { q: 'Is BlackOut financial or investment advice?', a: 'No. BlackOut provides educational tools and market analysis only and does not provide investment advice. Options and equities trading involve substantial risk and are not suitable for every investor.' },
    { q: 'What is dealer gamma exposure?', a: 'Dealer gamma exposure measures how much market makers must buy or sell the underlying as price moves, in order to hedge the options they hold. It is a major driver of intraday SPX movement, and BlackOut maps it live.' },
    { q: 'What is 0DTE trading?', a: '0DTE means zero-days-to-expiration options — contracts that expire the same day. They carry large, fast-decaying gamma, which makes real-time dealer positioning especially important. BlackOut\'s SPX Slayer desk is built for exactly this.' },
    { q: 'How is BlackOut different from SpotGamma or Unusual Whales?', a: 'BlackOut combines dealer gamma positioning, institutional flow, and an A–F grading engine in one desk, and logs its trades publicly. Only about 3% of scanned setups pass screening, so you see signal instead of noise.' },
    { q: 'What tools are included?', a: 'Six integrated modules: SPX Slayer (0DTE desk), HELIX (institutional flow), BlackOut Thermal (dealer gamma heatmap), Largo (AI desk analyst), Night Hawk (swing setups), and Vector (cross-ticker radar).' },
    { q: 'How much does BlackOut cost?', a: 'SPX Slayer is $49/month. BlackOut Premium is $199/month or $1,999/year (about $167/month) and includes all six modules plus Discord.' },
    { q: 'Can I cancel anytime?', a: 'Yes. Both monthly plans can be cancelled anytime with no long-term contracts.' },
    { q: 'Do you offer a refund?', a: 'Refunds are handled per our refund policy — see the Refund Policy page for full details.' },
    { q: 'What data does BlackOut use?', a: 'Live, tick-by-tick options data with no delay. The engine scans 12,400+ contracts daily and grades each setup A–F.' },
    { q: 'Do you route or place trades for me?', a: 'No. BlackOut provides intelligence and alerts only — there is no broker lock-in and no order routing. You execute trades yourself in your own brokerage.' },
    { q: 'Do you log your trades publicly?', a: 'Yes. Every setup is logged publicly with full transparency, including the ones that do not work — no hindsight, no deleted losers.' },
    { q: 'Is BlackOut good for beginners?', a: 'BlackOut is most useful once you understand basic options concepts, but the Learn/Academy section teaches dealer gamma, 0DTE, and flow from the ground up so newer traders can grow into it.' },
    { q: 'How do I get access?', a: 'Choose a plan on the Pricing page and sign up. You can start with SPX Slayer at $49/month and upgrade to Premium anytime.' },
  ].map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
}
