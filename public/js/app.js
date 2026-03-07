/* AI 뉴스레터 - 프론트엔드 SPA */
const App = (() => {
  let currentNewsletterId = null;
  let chatOpen = false;

  // ── 카테고리 메타 (config.json 미러 - 표시용만) ──
  const CAT_META = {
    기술:    { label: '기술 트렌드',   emoji: '⚙️' },
    빅테크:  { label: '빅테크 동향',   emoji: '🏢' },
    시장투자: { label: '시장·투자 동향', emoji: '📈' },
    이슈:    { label: '주요 이슈',     emoji: '🔥' }
  };

  // ── API 호출 유틸 ──
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ── 뷰 전환 ──
  function switchView(name) {
    ['latest', 'history', 'admin'].forEach(v => {
      document.getElementById(`view-${v}`).classList.toggle('hidden', v !== name);
    });
    ['btn-latest', 'btn-history'].forEach(id => {
      document.getElementById(id)?.classList.remove('active');
    });
    if (name === 'latest') document.getElementById('btn-latest')?.classList.add('active');
    if (name === 'history') document.getElementById('btn-history')?.classList.add('active');
  }

  // ── 날짜 포맷 ──
  function formatDate(iso) {
    return new Date(iso).toLocaleString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  // ── 뉴스레터 렌더링 ──
  function renderNewsletter(data) {
    currentNewsletterId = data.id;

    const meta = document.getElementById('newsletter-meta');
    meta.classList.remove('hidden');
    meta.innerHTML = `
      <h2>${data.title}</h2>
      <div class="meta-info">제${data.issue}호 &nbsp;·&nbsp; 발행: ${formatDate(data.date)}</div>
    `;

    const body = document.getElementById('newsletter-body');
    const categories = data.categories || {};
    const keys = Object.keys(CAT_META).filter(k => categories[k]?.length);

    if (keys.length === 0) {
      body.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>카테고리 데이터가 없습니다.</p></div>`;
      return;
    }

    body.innerHTML = keys.map(key => {
      const meta = CAT_META[key] || { label: key, emoji: '📌' };
      const articles = categories[key] || [];
      return `
        <section class="category-section">
          <div class="category-header">
            <span class="category-emoji">${meta.emoji}</span>
            <span class="category-label">${meta.label}</span>
            <span class="category-badge badge-${key}">${articles.length}건</span>
          </div>
          ${articles.map(a => renderArticle(a)).join('')}
        </section>
      `;
    }).join('');
  }

  function renderArticle(a) {
    return `
      <div class="article-card">
        <div class="article-title">
          <a href="${escHtml(a.url)}" target="_blank" rel="noopener">${escHtml(a.title)}</a>
        </div>
        <div class="article-summary">${escHtml(a.summary)}</div>
        ${a.insight ? `<div class="article-insight">💡 ${escHtml(a.insight)}</div>` : ''}
        <div class="article-footer">
          <span class="article-source">${escHtml(a.source)}</span>
          <a href="${escHtml(a.url)}" target="_blank" rel="noopener" class="article-link">원본 기사 보기 →</a>
        </div>
      </div>
    `;
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── 이력 렌더링 ──
  function renderHistory(list) {
    const ul = document.getElementById('history-list');
    if (!list.length) {
      ul.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>아직 발행된 뉴스레터가 없습니다.</p></div>`;
      return;
    }
    ul.innerHTML = list.map(item => `
      <li class="history-item" onclick="App.loadNewsletter('${item.id}')">
        <div>
          <div class="history-item-title">${escHtml(item.title)}</div>
          <div class="history-item-date">${formatDate(item.date)}</div>
        </div>
        <span class="history-item-issue">제${item.issue}호</span>
      </li>
    `).join('');
  }

  // ── 공개 메서드 ──
  async function showLatest() {
    switchView('latest');
    document.getElementById('newsletter-body').innerHTML = `
      <div class="skeleton-wrapper">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text short"></div>
      </div>`;
    document.getElementById('newsletter-meta').classList.add('hidden');
    try {
      const data = await api('/api/newsletters/latest');
      renderNewsletter(data);
    } catch (err) {
      document.getElementById('newsletter-body').innerHTML = `
        <div class="empty-state">
          <div class="icon">📭</div>
          <p>아직 발행된 뉴스레터가 없습니다.<br><small>관리자 패널에서 첫 번째 뉴스레터를 생성해보세요.</small></p>
        </div>`;
    }
  }

  async function showHistory() {
    switchView('history');
    try {
      const list = await api('/api/newsletters');
      renderHistory(list);
    } catch (err) {
      showToast('이력 로딩 실패: ' + err.message);
    }
  }

  function toggleAdmin() {
    const el = document.getElementById('view-admin');
    if (el.classList.contains('hidden')) {
      switchView('admin');
    } else {
      switchView('latest');
    }
  }

  async function loadNewsletter(id) {
    switchView('latest');
    document.getElementById('newsletter-meta').classList.add('hidden');
    document.getElementById('newsletter-body').innerHTML = `
      <div class="skeleton-wrapper">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-text"></div>
      </div>`;
    try {
      const data = await api(`/api/newsletters/${id}`);
      renderNewsletter(data);
    } catch (err) {
      showToast('뉴스레터 로딩 실패: ' + err.message);
    }
  }

  async function generateNow() {
    const key = document.getElementById('admin-key-input').value.trim();
    const btn = document.querySelector('#view-admin .btn-primary');
    const msg = document.getElementById('admin-msg');
    if (!key) { showToast('Admin Key를 입력하세요.'); return; }
    btn.disabled = true;
    btn.textContent = '생성 중...';
    msg.textContent = '';
    msg.className = 'admin-msg';
    try {
      const res = await api('/api/newsletters/generate', {
        method: 'POST',
        body: JSON.stringify({ adminKey: key })
      });
      msg.textContent = res.message;
      msg.classList.add('success');
      showToast('뉴스레터 생성 시작됨 (1-2분 후 확인)');
      setTimeout(() => showLatest(), 90000); // 90초 후 자동 새로고침
    } catch (err) {
      msg.textContent = '오류: ' + err.message;
      msg.classList.add('error');
    } finally {
      btn.disabled = false;
      btn.textContent = '지금 생성';
    }
  }

  // ── 챗봇 ──
  function toggleChat() {
    chatOpen = !chatOpen;
    document.getElementById('chat-panel').classList.toggle('hidden', !chatOpen);
    document.getElementById('chat-icon').textContent = chatOpen ? '✕' : '💬';
  }

  async function sendChat() {
    const input = document.getElementById('chat-input');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';

    appendBubble(question, 'user');
    const loadingId = appendBubble('답변 작성 중...', 'assistant loading');

    try {
      const res = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ question, newsletterId: currentNewsletterId })
      });
      updateBubble(loadingId, res.answer);
    } catch (err) {
      updateBubble(loadingId, '오류: ' + err.message);
    }
  }

  function appendBubble(text, cls) {
    const container = document.getElementById('chat-messages');
    const id = 'bubble-' + Date.now();
    const div = document.createElement('div');
    div.id = id;
    div.className = `chat-bubble ${cls}`;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
  }

  function updateBubble(id, text) {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.className = 'chat-bubble assistant'; }
  }

  // ── 토스트 ──
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  // ── 초기화 ──
  document.addEventListener('DOMContentLoaded', () => showLatest());

  return { showLatest, showHistory, toggleAdmin, loadNewsletter, generateNow, toggleChat, sendChat };
})();
