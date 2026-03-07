const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config.json');
const fetcher = require('./fetcher');
const db = require('./database');

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// 뉴스레터 생성 (단일 API 호출로 크레딧 최소화)
async function generate() {
  console.log('[뉴스레터] RSS 수집 시작...');
  const rawData = await fetcher.fetchAll();

  const categoryKeys = Object.keys(config.categories);
  const articlesPerCategory = {};
  let inputBlock = '';

  for (const key of categoryKeys) {
    const cat = config.categories[key];
    const articles = rawData[key] || [];
    articlesPerCategory[key] = articles;
    if (articles.length === 0) continue;

    inputBlock += `\n### 카테고리: ${key} (${cat.label}) - ${cat.count}개 선별\n`;
    articles.forEach((a, i) => {
      inputBlock += `[${i + 1}] 출처: ${a.source}\n제목: ${a.title}\n요약: ${a.description}\nURL: ${a.url}\n\n`;
    });
  }

  if (!inputBlock.trim()) throw new Error('수집된 기사가 없습니다.');

  const prompt = `당신은 AI 기술 뉴스레터 에디터입니다. 아래 RSS에서 수집한 영문 기사들을 한국어 뉴스레터로 변환해주세요.

각 카테고리에서 지정된 수만큼 가장 중요한 기사를 선별하고, 다음 JSON 형식으로만 응답하세요 (마크다운 코드블록 없이 순수 JSON):

{
  "title": "뉴스레터 제목 (날짜 포함, 예: 2024년 3월 AI 기술 뉴스레터)",
  "categories": {
    "<categoryKey>": [
      {
        "title": "한국어 기사 제목",
        "source": "출처명",
        "url": "원본 URL (그대로 유지)",
        "summary": "핵심 내용 2-3문장 한국어 요약",
        "insight": "국내 시사점 또는 주목 이유 1문장"
      }
    ]
  }
}

규칙:
- 각 카테고리 설정 수에 맞춰 선별 (기사가 부족하면 있는 만큼)
- summary는 80자 이내
- insight는 40자 이내
- URL은 원본 그대로 유지
- JSON 외 다른 텍스트 출력 금지

수집된 기사:
${inputBlock}`;

  console.log('[뉴스레터] Claude API 호출 중...');
  const client = getClient();
  const response = await client.messages.create({
    model: config.ai.model,
    max_tokens: config.ai.maxTokens,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = response.content[0].text.trim();
  let parsed;
  try {
    // JSON 파싱 (혹시 코드블록이 포함된 경우 제거)
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`JSON 파싱 실패: ${err.message}\n원본: ${raw.slice(0, 200)}`);
  }

  // 원본 URL 및 publishedAt 보강 (generator가 URL을 바꿀 경우 방지)
  for (const key of categoryKeys) {
    if (!parsed.categories[key]) continue;
    parsed.categories[key] = parsed.categories[key].map(article => {
      const original = articlesPerCategory[key]?.find(a =>
        a.url === article.url || a.title.toLowerCase().includes(article.title.slice(0, 10).toLowerCase())
      );
      return {
        ...article,
        url: original?.url || article.url,
        publishedAt: original?.publishedAt || new Date().toISOString()
      };
    });
  }

  const now = new Date();
  const newsletter = {
    id: `newsletter-${now.toISOString().slice(0, 10)}-${Date.now()}`,
    title: parsed.title,
    date: now.toISOString(),
    issue: db.listNewsletters().length + 1,
    categories: parsed.categories,
    generatedAt: now.toISOString(),
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens
  };

  db.saveNewsletter(newsletter);
  console.log(`[뉴스레터] 생성 완료 - "${newsletter.title}" (입력: ${newsletter.inputTokens}T, 출력: ${newsletter.outputTokens}T)`);
  return newsletter;
}

// 챗봇 답변 (뉴스레터 컨텍스트 기반, 짧은 토큰 사용)
async function chat(question, newsletter) {
  const client = getClient();

  // 뉴스레터 내용을 압축하여 컨텍스트 구성
  const context = Object.entries(newsletter.categories || {})
    .map(([key, articles]) => {
      const cat = config.categories[key];
      const list = articles.map(a => `- ${a.title}: ${a.summary}`).join('\n');
      return `[${cat?.label || key}]\n${list}`;
    })
    .join('\n\n');

  const response = await client.messages.create({
    model: config.ai.model,
    max_tokens: config.ai.chatMaxTokens,
    system: `당신은 AI 기술 뉴스레터 어시스턴트입니다. 아래 뉴스레터 내용을 바탕으로 사용자 질문에 한국어로 간결하게 답변하세요. 뉴스레터에 없는 내용은 "이번 뉴스레터에 포함되지 않은 내용입니다"라고 답하세요.\n\n뉴스레터: ${newsletter.title}\n\n${context}`,
    messages: [{ role: 'user', content: question }]
  });

  return response.content[0].text;
}

module.exports = { generate, chat };
