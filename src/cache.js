/**
 * 파일 기반 LLM 응답 캐시
 * - 동일 입력(기사 집합)에 대해 LLM 재호출 방지
 * - data/cache/ 디렉토리에 JSON 파일로 저장
 * - 기본 TTL: 6시간 (뉴스 신선도 고려)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, '../data/cache');
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6시간

function ensureDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * 데이터를 MD5 해시하여 캐시 키 생성
 */
function makeKey(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * 캐시에서 값 조회. 없거나 만료됐으면 null 반환
 */
function get(key) {
  ensureDir();
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const { value, expiresAt } = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (Date.now() > expiresAt) {
      fs.unlinkSync(file);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * 캐시에 값 저장
 * @param {string} key
 * @param {*} value
 * @param {number} ttlMs - 만료 시간 (밀리초)
 */
function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  ensureDir();
  const file = path.join(CACHE_DIR, `${key}.json`);
  fs.writeFileSync(file, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
}

/**
 * 만료된 캐시 파일 모두 삭제
 */
function purgeExpired() {
  ensureDir();
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  let removed = 0;
  for (const f of files) {
    try {
      const { expiresAt } = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf-8'));
      if (Date.now() > expiresAt) {
        fs.unlinkSync(path.join(CACHE_DIR, f));
        removed++;
      }
    } catch {
      // 손상된 파일 삭제
      fs.unlinkSync(path.join(CACHE_DIR, f));
      removed++;
    }
  }
  if (removed > 0) console.log(`[캐시] 만료 파일 ${removed}개 삭제`);
}

module.exports = { get, set, makeKey, purgeExpired };
