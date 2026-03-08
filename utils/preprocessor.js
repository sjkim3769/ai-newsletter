/**
 * 뉴스 기사 텍스트 전처리 유틸리티
 * - HTML 태그 제거
 * - 광고·작성자 정보 등 불필요 문구 제거
 * - 핵심 문장 추출 (앞 N문장 + 뒤 M문장)
 */

// 제거할 광고·잡음 패턴
const NOISE_PATTERNS = [
  /read more[^\n.]*/gi,
  /click here[^\n.]*/gi,
  /subscribe\s+(to|now)[^\n.]*/gi,
  /sign up[^\n.]*/gi,
  /follow us\s+on[^\n.]*/gi,
  /©[^\n.]*/g,
  /all rights reserved[^\n.]*/gi,
  /\[.*?\]/g,               // [AD], [Photo by ...]
  /\d+\s*(min|minute|hour)s?\s+read/gi,
  /advertisement/gi,
  /sponsored\s+content?/gi,
  /related articles?:?[^\n.]*/gi,
  /see also:?[^\n.]*/gi,
  /image credit:?[^\n.]*/gi,
  /photo by[^\n.]*/gi,
  /via\s+\w+(\s+\w+)?[^\n.]*/gi,
];

function stripHtml(str) {
  return str
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeNoise(text) {
  let clean = text;
  for (const pattern of NOISE_PATTERNS) {
    clean = clean.replace(pattern, ' ');
  }
  return clean.replace(/\s+/g, ' ').trim();
}

/**
 * 텍스트에서 핵심 문장만 추출
 * @param {string} text
 * @param {number} firstN - 앞에서 N문장
 * @param {number} lastN  - 뒤에서 N문장
 */
function extractKeyContent(text, firstN = 2, lastN = 1) {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (!sentences || sentences.length <= firstN + lastN) return text;

  const first = sentences.slice(0, firstN);
  const last = sentences.slice(-lastN);
  return [...first, ...last].join(' ').trim();
}

/**
 * 전체 전처리 파이프라인
 * @param {string} text    - 원본 텍스트 (HTML 포함 가능)
 * @param {number} maxLen  - 최대 길이 (기본 120자)
 */
function preprocess(text, maxLen = 120) {
  if (!text) return '';
  let result = stripHtml(text);
  result = removeNoise(result);
  result = extractKeyContent(result, 2, 1);
  return result.slice(0, maxLen).trim();
}

module.exports = { preprocess, stripHtml, removeNoise, extractKeyContent };
