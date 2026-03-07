/**
 * GitHub Actions에서 실행되는 정적 뉴스레터 생성 스크립트
 * 결과물을 public/data/ 에 JSON 파일로 저장
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetcher = require('./fetcher');
const { buildNewsletter } = require('./generator');

const DATA_DIR = path.join(__dirname, '../public/data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const LATEST_FILE = path.join(DATA_DIR, 'latest.json');

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // 현재 이력에서 호 번호 계산
  const index = fs.existsSync(INDEX_FILE)
    ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'))
    : [];
  const issueNumber = index.length + 1;

  console.log(`[정적 생성] 제${issueNumber}호 생성 시작...`);

  console.log('[정적 생성] RSS 수집 중...');
  const rawData = await fetcher.fetchAll();

  const newsletter = await buildNewsletter(rawData, issueNumber);

  // 개별 뉴스레터 파일 저장
  fs.writeFileSync(
    path.join(DATA_DIR, `${newsletter.id}.json`),
    JSON.stringify(newsletter, null, 2)
  );

  // latest.json 업데이트
  fs.writeFileSync(LATEST_FILE, JSON.stringify(newsletter, null, 2));

  // index.json 업데이트 (최신 순)
  index.unshift({
    id: newsletter.id,
    date: newsletter.date,
    issue: newsletter.issue,
    title: newsletter.title
  });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));

  console.log(`[정적 생성] 완료: "${newsletter.title}"`);
  console.log(`[정적 생성] 파일 저장: public/data/${newsletter.id}.json`);
}

main().catch(err => {
  console.error('[정적 생성 오류]', err.message);
  process.exit(1);
});
