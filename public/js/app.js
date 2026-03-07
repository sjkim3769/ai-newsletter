/* AI 뉴스레터 - 프론트엔드 SPA (서버 모드 + 정적 모드 지원) */
const App = (() => {
  let currentNewsletterId = null;
  let chatOpen = false;
  let pollTimer = null;
  let IS_STATIC = false; // API 서버 없는 환경 (GitHub Pages 등)

  const CAT_META = {
    기술:    { label: '기술 트렌드',    emoji: '⚙️' },
    빅테크:  { label: '빅테크 동향',    emoji: '🏢' },
    시장투자: { label: '시장·투자 동향', emoji: '📈' },
    이슈:    { label: '주요 이슈',      emoji: '🔥' }
  };

  // ── HTML 이스케이프 ──
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── 모드 감지: API 서버 존재 여부 확인 ──
  async function detectMode() {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch('/api/health', { signal: ctrl.signal });
      IS_STATIC = !res.ok;
    } catch {
      IS_STATIC = true;
    }
    // 정적 모드에서 챗봇·관리자 패널 숨기기
    if (IS_STATIC) {
      document.getElementById('chatbot')?.classList.add('hidden');
      document.querySelector('.admin-btn')?.classList.add('hidden');
    }
  }

  // ── 데이터 로딩 (서버/정적 모드 통합) ──
  async function loadData(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchLatest() {
    return IS_STATIC
      ? loadData('./data/latest.json')
      : loadData('/api/newsletters/latest');
  }

  async function fetchList() {
    return IS_STATIC
      ? loadData('./data/index.json')
      : loadData('/api/newsletters');
  }

  async function fetchNewsletter(id) {
    return IS_STATIC
      ? loadData(`./data/${id}.json`)
      : loadData(`/api/newsletters/${id}`);
  }

  // ── API 유틸 (서버 전용) ──
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

  // ── 날짜 포맷 ──
  function formatDate(iso) {
    return new Date(iso).toLocaleString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric',
      weekday: 'short', hour: '2-digit', minute: '2-digit'
    });
  }

  // ── 뷰 전환 ──
  function switchView(name) {
    ['latest', 'history', 'admin'].forEach(v =>
      document.getElementById(`view-${v}`).classList.toggle('hidden', v !== name)
    );
    document.getElementById('btn-latest')?.classList.toggle('active', name === 'latest');
    document.getElementById('btn-history')?.classList.toggle('active', name === 'history');
  }

  // ── 뉴스레터 렌더링 ──
  function renderNewsletter(data) {
    currentNewsletterId = data.id;
    const meta = document.getElementById('newsletter-meta');
    meta.classList.remove('hidden');
    meta.innerHTML = `
      <div class="meta-issue">제${esc(String(data.issue))}호</div>
      <h2 class="meta-title">${esc(data.title)}</h2>
      <div class="meta-info">
        발행일: ${formatDate(data.date)}
        ${data.inputTokens ? `<span class="meta-tokens">· AI 토큰 ${data.inputTokens + data.outputTokens}개 사용</span>` : ''}
        ${IS_STATIC ? '<span class="meta-tokens">· GitHub Pages</span>' : ''}
      </div>`;

    const body = document.getElementById('newsletter-body');
    const keys = Object.keys(CAT_META).filter(k => (data.categories || {})[k]?.length);

    if (!keys.length) {
      body.innerHTML = emptyState('카테고리 데이터가 없습니다.');
      return;
    }

    body.innerHTML = keys.map(key => {
      const m = CAT_META[key] || { label: key, emoji: '📌' };
      return `
        <section class="category-section">
          <div class="category-header">
            <span class="category-emoji">${m.emoji}</span>
            <span class="category-label">${m.label}</span>
            <span class="category-badge badge-${esc(key)}">${(data.categories[key] || []).length}건</span>
          </div>
          ${(data.categories[key] || []).map(renderArticle).join('')}
        </section>`;
    }).join('');
  }

  function renderArticle(a) {
    return `
      <div class="article-card">
        <div class="article-title">
          <a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>
        </div>
        <div class="article-summary">${esc(a.summary)}</div>
        ${a.insight ? `<div class="article-insight">💡 ${esc(a.insight)}</div>` : ''}
        <div class="article-footer">
          <span class="article-source">${esc(a.source)}</span>
          <a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" class="article-link">원본 기사 →</a>
        </div>
      </div>`;
  }

  // ── 이력 렌더링 ──
  function renderHistory(list) {
    const ul = document.getElementById('history-list');
    if (!list.length) { ul.innerHTML = emptyState('아직 발행된 뉴스레터가 없습니다.'); return; }
    ul.innerHTML = list.map(item => `
      <li class="history-item" data-id="${esc(item.id)}">
        <div>
          <div class="history-item-title">${esc(item.title)}</div>
          <div class="history-item-date">${formatDate(item.date)}</div>
        </div>
        <span class="history-item-issue">제${esc(String(item.issue))}호</span>
      </li>`).join('');
    ul.querySelectorAll('.history-item').forEach(li =>
      li.addEventListener('click', () => loadNewsletter(li.dataset.id))
    );
  }

  function emptyState(msg) {
    return `<div class="empty-state"><div class="icon">📭</div><p>${esc(msg)}</p>
      ${!IS_STATIC ? '<button class="btn-go-admin" onclick="App.toggleAdmin()">관리자 패널에서 생성하기 →</button>' : ''}</div>`;
  }

  function showSkeleton(id) {
    document.getElementById(id).innerHTML = `
      <div class="skeleton-wrapper">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text short"></div>
      </div>`;
  }

  // ── 공개: 최신호 ──
  async function showLatest() {
    switchView('latest');
    showSkeleton('newsletter-body');
    document.getElementById('newsletter-meta').classList.add('hidden');
    try {
      renderNewsletter(await fetchLatest());
    } catch {
      document.getElementById('newsletter-body').innerHTML = `
        <div class="empty-state">
          <div class="icon">📭</div>
          <p>아직 발행된 뉴스레터가 없습니다.</p>
          ${IS_STATIC
            ? '<p><small>GitHub Actions에서 뉴스레터를 생성하면 자동으로 표시됩니다.</small></p>'
            : '<button class="btn-go-admin" onclick="App.toggleAdmin()">관리자 패널에서 첫 번째 생성하기 →</button>'}
        </div>`;
    }
  }

  // ── 공개: 이력 ──
  async function showHistory() {
    switchView('history');
    showSkeleton('history-list');
    try { renderHistory(await fetchList()); }
    catch (err) { showToast('이력 로딩 실패: ' + err.message); }
  }

  // ── 공개: 관리자 토글 (서버 모드만) ──
  function toggleAdmin() {
    if (IS_STATIC) return;
    const hidden = document.getElementById('view-admin').classList.contains('hidden');
    switchView(hidden ? 'admin' : 'latest');
  }

  // ── 공개: 특정 뉴스레터 로드 ──
  async function loadNewsletter(id) {
    switchView('latest');
    document.getElementById('newsletter-meta').classList.add('hidden');
    showSkeleton('newsletter-body');
    try { renderNewsletter(await fetchNewsletter(id)); }
    catch (err) { showToast('로딩 실패: ' + err.message); showLatest(); }
  }

  // ── 공개: 뉴스레터 생성 (서버 모드만) ──
  async function generateNow() {
    if (IS_STATIC) return;
    const key = document.getElementById('admin-key-input').value.trim();
    if (!key) { showToast('Admin Key를 입력하세요.'); return; }
    const btn = document.getElementById('btn-generate');
    const msgEl = document.getElementById('admin-msg');
    setGeneratingUI(true, btn, msgEl);
    try {
      await api('/api/newsletters/generate', { method: 'POST', body: JSON.stringify({ adminKey: key }) });
      msgEl.innerHTML = '<span class="spinner"></span> RSS 수집 및 AI 요약 생성 중... (약 1-2분)';
      msgEl.className = 'admin-msg info';
      startPolling(btn, msgEl);
    } catch (err) {
      msgEl.textContent = '오류: ' + err.message;
      msgEl.className = 'admin-msg error';
      setGeneratingUI(false, btn, msgEl);
    }
  }

  function setGeneratingUI(on, btn, msgEl) {
    btn.disabled = on;
    btn.innerHTML = on ? '<span class="spinner"></span> 생성 중...' : '지금 생성';
    if (!on) msgEl.textContent = '';
  }

  function startPolling(btn, msgEl) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const s = await api('/api/status');
        if (!s.running) {
          clearInterval(pollTimer);
          setGeneratingUI(false, btn, msgEl);
          if (s.error) { msgEl.textContent = '생성 실패: ' + s.error; msgEl.className = 'admin-msg error'; }
          else { msgEl.textContent = '생성 완료!'; msgEl.className = 'admin-msg success'; showToast('뉴스레터가 발행되었습니다!'); setTimeout(() => showLatest(), 1500); }
        }
      } catch { /* 네트워크 오류 무시 */ }
    }, 5000);
  }

  // ── 챗봇 (서버 모드만) ──
  function toggleChat() {
    if (IS_STATIC) return;
    chatOpen = !chatOpen;
    document.getElementById('chat-panel').classList.toggle('hidden', !chatOpen);
    document.getElementById('chat-icon').textContent = chatOpen ? '✕' : '💬';
    if (chatOpen) document.getElementById('chat-input').focus();
  }

  async function sendChat() {
    if (IS_STATIC) return;
    const input = document.getElementById('chat-input');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    input.disabled = true;
    appendBubble(question, 'user');
    const lid = appendBubble('', 'assistant loading');
    try {
      const res = await api('/api/chat', { method: 'POST', body: JSON.stringify({ question, newsletterId: currentNewsletterId }) });
      updateBubble(lid, res.answer, 'assistant');
    } catch (err) {
      updateBubble(lid, '오류: ' + err.message, 'assistant error-bubble');
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  function appendBubble(text, cls) {
    const c = document.getElementById('chat-messages');
    const id = 'b-' + Date.now();
    const d = document.createElement('div');
    d.id = id; d.className = `chat-bubble ${cls}`;
    d.innerHTML = cls.includes('loading') ? '<span class="dot-pulse"></span>' : '';
    if (!cls.includes('loading')) d.textContent = text;
    c.appendChild(d); c.scrollTop = c.scrollHeight;
    return id;
  }

  function updateBubble(id, text, cls) {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.className = `chat-bubble ${cls}`; }
    document.getElementById('chat-messages').scrollTop = 9999;
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3500);
  }

  // ── 초기화 ──
  document.addEventListener('DOMContentLoaded', async () => {
    await detectMode();
    showLatest();
    document.getElementById('chat-input')
      ?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) sendChat(); });
  });

  return { showLatest, showHistory, toggleAdmin, loadNewsletter, generateNow, toggleChat, sendChat };
})();
