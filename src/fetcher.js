const Parser = require('rss-parser');
const config = require('../config.json');

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'AI-Newsletter-Bot/1.0' }
});

// 단일 피드 가져오기 (실패 시 빈 배열 반환)
async function fetchFeed(feed) {
  try {
    const data = await parser.parseURL(feed.url);
    return (data.items || []).slice(0, 10).map(item => ({
      title: item.title || '',
      description: stripHtml(item.contentSnippet || item.content || item.summary || '').slice(0, 100),
      url: item.link || item.guid || '',
      source: feed.name,
      publishedAt: item.pubDate || item.isoDate || new Date().toISOString()
    }));
  } catch (err) {
    console.warn(`[RSS 경고] ${feed.name} 피드 실패: ${err.message}`);
    return [];
  }
}

// 카테고리별 피드 수집 후 필요한 수만 추출
async function fetchCategory(categoryKey) {
  const cat = config.categories[categoryKey];
  const results = await Promise.all(cat.feeds.map(fetchFeed));
  const merged = results.flat();
  // 최신 기사 우선, 중복 URL 제거
  const seen = new Set();
  return merged
    .filter(a => a.url && !seen.has(a.url) && seen.add(a.url))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, cat.count + 1); // count+1개만 전달해 AI 선택 여지 최소 확보
}

// 전체 카테고리 수집
async function fetchAll() {
  const categoryKeys = Object.keys(config.categories);
  const results = await Promise.all(
    categoryKeys.map(async key => ({
      key,
      articles: await fetchCategory(key)
    }))
  );
  return Object.fromEntries(results.map(r => [r.key, r.articles]));
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = { fetchAll };
