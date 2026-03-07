const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/newsletters.json');

function load() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// 뉴스레터 저장
function saveNewsletter(newsletter) {
  const all = load();
  all.unshift(newsletter); // 최신 순 정렬
  save(all);
}

// 전체 목록 (메타데이터만, id/date/issue/title)
function listNewsletters() {
  return load().map(({ id, date, issue, title }) => ({ id, date, issue, title }));
}

// 특정 뉴스레터
function getNewsletter(id) {
  return load().find(n => n.id === id) || null;
}

// 최신 뉴스레터
function getLatestNewsletter() {
  const all = load();
  return all.length > 0 ? all[0] : null;
}

module.exports = { saveNewsletter, listNewsletters, getNewsletter, getLatestNewsletter };
