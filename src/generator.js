const Groq = require('groq-sdk');
const config = require('../config.json');
const fetcher = require('./fetcher');
const db = require('./database');
const cache = require('./cache');

// 시스템 프롬프트: 역할·규칙 전용 (매 호출 동일, 기사 데이터 없음)
const SYSTEM_PROMPT = `당신은 AI 기술 뉴스레터 편집자입니다.
역할: 영문 기사를 한국어 뉴스레터 JSON으로 변환.
규칙:
- 각 카테고리 [key:N건] 에서 N개만 선별
- summary: 80자 이내 한국어 요약
- insight: 40자 이내 한국어 시사점
- 반드시 아래 JSON 형식만 출력 (다른 텍스트 없음)
{"title":"날짜포함제목","categories":{"key":[{"title":"한글제목","source":"출처","url":"원본URL","summary":"요약","insight":"시사점"}]}}`;

function getClient() {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY가 설정되지 않았습니다.');
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

// 핵심 생성 로직 (서버/GitHub Actions 공용)
async function buildNewsletter(rawData, issueNumber) {
  const categoryKeys = Object.keys(config.categories);
  const articlesPerCategory = {};
  let inputBlock = '';

  for (const key of categoryKeys) {
    const cat = config.categories[key];
    const articles = rawData[key] || [];
    articlesPerCategory[key] = articles;
    if (articles.length === 0) continue;
    inputBlock += `\n[${key}:${cat.count}건]\n`;
    articles.forEach((a, i) => {
      inputBlock += `${i + 1}.${a.source}|${a.title}|${a.description}|${a.url}\n`;
    });
  }

  if (!inputBlock.trim()) throw new Error('수집된 기사가 없습니다.');

  // 캐시 조회: 동일 기사 집합이면 LLM 재호출 생략
  const cacheKey = cache.makeKey(inputBlock);
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('[뉴스레터] 캐시 히트 - LLM 호출 생략');
    return {
      ...cached,
      id: `newsletter-${new Date().toISOString().slice(0, 10)}-${Date.now()}`,
      issue: issueNumber
    };
  }

  // User 메시지: 기사 데이터만 포함 (역할 설명은 system에서 처리)
  const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const userContent = `오늘 날짜(KST): ${todayKST}\n기사 목록(출처|제목|설명|URL):\n${inputBlock}`;

  console.log('[뉴스레터] Groq API 호출 중...');
  const client = getClient();
  const TIMEOUT_MS = 60000; // 60초 타임아웃
  const response = await Promise.race([
    client.chat.completions.create({
      model: config.ai.model,
      max_tokens: config.ai.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ]
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Groq API 타임아웃 (${TIMEOUT_MS / 1000}초 초과)`)), TIMEOUT_MS)
    )
  ]);

  const raw = response.choices[0].message.content;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`JSON 파싱 실패: ${err.message}\n원본: ${raw.slice(0, 200)}`);
  }

  // 원본 URL 및 publishedAt 보강
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

  const usage = response.usage;
  const now = new Date();
  // KST(UTC+9) 기준 날짜 문자열 (YYYY-MM-DD)
  const kstDateStr = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const newsletter = {
    id: `newsletter-${kstDateStr}-${Date.now()}`,
    title: parsed.title,
    date: now.toISOString(),
    issue: issueNumber,
    categories: parsed.categories,
    generatedAt: now.toISOString(),
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens
  };

  // 캐시 저장 (6시간) + 만료 파일 정리
  cache.set(cacheKey, newsletter);
  cache.purgeExpired();

  console.log(`[뉴스레터] 생성 완료 - "${newsletter.title}" (입력: ${newsletter.inputTokens}T, 출력: ${newsletter.outputTokens}T)`);
  return newsletter;
}

// 서버 모드: RSS 수집 → 중복 제거 → 생성 → DB 저장
async function generate() {
  console.log('[뉴스레터] RSS 수집 시작...');
  const rawData = await fetcher.fetchAll();

  // 직전 뉴스레터 기사 URL 수집 (동일 기사 재발행 방지)
  const latest = db.getLatestNewsletter();
  const publishedUrls = new Set(
    Object.values(latest?.categories || {}).flat().map(a => a.url)
  );
  if (publishedUrls.size > 0) {
    for (const key of Object.keys(rawData)) {
      rawData[key] = rawData[key].filter(a => !publishedUrls.has(a.url));
    }
    console.log(`[뉴스레터] 직전호 중복 ${publishedUrls.size}건 URL 제외`);
  }

  const issue = db.listNewsletters().length + 1;
  const newsletter = await buildNewsletter(rawData, issue);
  db.saveNewsletter(newsletter);
  return newsletter;
}

// 챗봇 답변 (뉴스레터 컨텍스트 기반, 단일 턴 — 히스토리 누적 없음)
async function chat(question, newsletter) {
  const client = getClient();

  // 컨텍스트: 제목 + 요약 40자 이내로 압축 (토큰 절감)
  const context = Object.entries(newsletter.categories || {})
    .map(([key, articles]) => {
      const cat = config.categories[key];
      const list = articles
        .map(a => `- ${a.title}${a.summary ? ': ' + a.summary.slice(0, 40) : ''}`)
        .join('\n');
      return `[${cat?.label || key}]\n${list}`;
    })
    .join('\n\n');

  const response = await client.chat.completions.create({
    model: config.ai.chatModel || config.ai.model,
    max_tokens: config.ai.chatMaxTokens,
    messages: [
      {
        role: 'system',
        content: `뉴스레터 어시스턴트. 아래 내용만 참고해 한국어로 2문장 이내로 답변. 없는 내용은 "이번 뉴스레터에 없는 내용입니다" 답변.\n\n${context}`
      },
      { role: 'user', content: question.slice(0, 200) } // 질문 길이도 제한
    ]
  });

  return response.choices[0].message.content;
}

module.exports = { generate, buildNewsletter, chat };
