// Shared between the /api/news-feed route (which fetches + parses the RSS
// feeds server-side) and NewsScreen (which renders the result) so both sides
// agree on the article shape and category list.

export interface NewsCategoryDef {
  id: string;
  label: string;
}

// 日本語がソース言語という規約に合わせ、カテゴリ表示名は日本語。フィード自体は
// 英語の技術ニュース（英語学習を兼ねる）なので中身は英語のまま。
export const NEWS_CATEGORIES: NewsCategoryDef[] = [
  { id: 'all', label: 'すべて' },
  { id: 'ai', label: 'AI' },
  { id: 'web', label: 'Web' },
  { id: 'cloud', label: 'クラウド' },
  { id: 'devops', label: 'DevOps' },
  { id: 'security', label: 'セキュリティ' },
  { id: 'career', label: 'キャリア' },
];

export interface NewsFeedDef {
  category: string;
  url: string;
  source: string;
}

export const NEWS_FEEDS: NewsFeedDef[] = [
  { category: 'ai', url: 'https://dev.to/feed/tag/ai', source: 'DEV AI Community' },
  { category: 'web', url: 'https://dev.to/feed/tag/react', source: 'React & Web Weekly' },
  { category: 'cloud', url: 'https://dev.to/feed/tag/cloud', source: 'Cloud Architecture Hub' },
  { category: 'devops', url: 'https://dev.to/feed/tag/devops', source: 'DevOps & SRE Pulse' },
  { category: 'security', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', source: 'Cyber & Tech News' },
  { category: 'career', url: 'https://dev.to/feed/tag/career', source: 'Engineering Growth' },
];

export interface NewsArticle {
  id: string;
  category: string;
  title: string;
  link: string;
  source: string;
  imageUrl: string;
  snippet: string;
  pubDate: string;
}
