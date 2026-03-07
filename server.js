require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config.json');
const db = require('./src/database');
const generator = require('./src/generator');
const scheduler = require('./src/scheduler');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 간단한 IP 기반 요청 횟수 제한 (메모리)
const rateLimitMap = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > config.rateLimit.windowMs) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return next();
  }
  if (entry.count >= config.rateLimit.chatRequestsPerHour) {
    return res.status(429).json({ error: '시간당 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.' });
  }
  entry.count++;
  rateLimitMap.set(ip, entry);
  next();
}

// ── 뉴스레터 목록 (이력 조회, 로그인 불필요) ──
app.get('/api/newsletters', (req, res) => {
  const list = db.listNewsletters();
  res.json(list);
});

// ── 최신 뉴스레터 ──
app.get('/api/newsletters/latest', (req, res) => {
  const newsletter = db.getLatestNewsletter();
  if (!newsletter) return res.status(404).json({ error: '발행된 뉴스레터가 없습니다.' });
  res.json(newsletter);
});

// ── 특정 뉴스레터 ──
app.get('/api/newsletters/:id', (req, res) => {
  const newsletter = db.getNewsletter(req.params.id);
  if (!newsletter) return res.status(404).json({ error: '뉴스레터를 찾을 수 없습니다.' });
  res.json(newsletter);
});

// ── 수동 생성 (Admin Key 필요) ──
app.post('/api/newsletters/generate', async (req, res) => {
  if (!req.body.adminKey || req.body.adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: '관리자 키가 올바르지 않습니다.' });
  }
  res.json({ message: '뉴스레터 생성을 시작합니다. 약 1-2분 후 완료됩니다.' });
  try {
    await generator.generate();
  } catch (err) {
    console.error('[수동 생성 오류]', err.message);
  }
});

// ── 챗봇 (로그인 불필요, 서버 API 키 사용) ──
app.post('/api/chat', rateLimit, async (req, res) => {
  const { question, newsletterId } = req.body;
  if (!question || !question.trim()) {
    return res.status(400).json({ error: '질문을 입력해주세요.' });
  }
  const newsletter = newsletterId
    ? db.getNewsletter(newsletterId)
    : db.getLatestNewsletter();
  if (!newsletter) return res.status(404).json({ error: '뉴스레터가 없습니다.' });
  try {
    const answer = await generator.chat(question.trim(), newsletter);
    res.json({ answer });
  } catch (err) {
    console.error('[챗봇 오류]', err.message);
    res.status(500).json({ error: '답변 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' });
  }
});

// ── 서버 상태 확인 ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const PORT = process.env.PORT || config.server.port;
app.listen(PORT, () => {
  console.log(`[AI 뉴스레터] 서버 시작 → http://localhost:${PORT}`);
  scheduler.start();
});
