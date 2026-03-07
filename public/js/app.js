/* AI 뉴스레터 - 프론트엔드 SPA */
const App = (() => {
  let currentNewsletterId = null;
  let chatOpen = false;
  let pollTimer = null;

  const CAT_META = {
    기술:    { label: '기술 트렌드',    emoji: '⚙️' },
    빅테크:  { label: '빅테크 동향',    emoji: '🏢' },
    시장투자: { label: '시장·투자 동향', emoji: '📈' },
    이슈:    { label: '주요 이슈',      emoji: '🔥' }
  };

  // ── HTML 이스케이프 (XSS 방지) ──
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── API 유틸 ──
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
    // XSS 방지: 제목·날짜 모두 esc() 적용
    meta.innerHTML = `
      <div class="meta-issue">제${esc(String(data.issue))}호</div>
      <h2 class="meta-title">${esc(data.title)}</h2>
      <div class="meta-info">
        발행일: ${formatDate(data.date)}
        ${data.inputTokens ? `<span class="meta-tokens">· AI 토큰 ${data.inputTokens + data.outputTokens}개 사용</span>` : ''}
      </div>
    `;

    const body = document.getElementById('newsletter-body');
    const categories = data.categories || {};
    const keys = Object.keys(CAT_META).filter(k => categories[k]?.length);

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
            <span class="category-badge badge-${esc(key)}">${(categories[key] || []).length}건</span>
          </div>
          ${(categories[key] || []).map(renderArticle).join('')}
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
    if (!list.length) {
      ul.innerHTML = emptyState('아직 발행된 뉴스레터가 없습니다.');
      return;
    }
    ul.innerHTML = list.map(item => `
      <li class="history-item" data-id="${esc(item.id)}">
        <div>
          <div class="history-item-title">${esc(item.title)}</div>
          <div class="history-item-date">${formatDate(item.date)}</div>
        </div>
        <span class="history-item-issue">제${esc(String(item.issue))}호</span>
      </li>`).join('');

    // 이벤트 위임 (XSS 방지: onclick 인라인 제거)
    ul.querySelectorAll('.history-item').forEach(li => {
      li.addEventListener('click', () => loadNewsletter(li.dataset.id));
    });
  }

  function emptyState(msg) {
    return `<div class="empty-state"><div class="icon">📭</div><p>${esc(msg)}</p></div>`;
  }

  // ── 스켈레톤 로딩 ──
  function showSkeleton(targetId) {
    document.getElementById(targetId).innerHTML = `
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
      const data = await api('/api/newsletters/latest');
      renderNewsletter(data);
    } catch {
      document.getElementById('newsletter-body').innerHTML = `
        <div class="empty-state">
          <div class="icon">📭</div>
          <p>아직 발행된 뉴스레터가 없습니다.</p>
          <button class="btn-go-admin" onclick="App.toggleAdmin()">관리자 패널에서 첫 번째 생성하기 →</button>
        </div>`;
    }
  }

  // ── 공개: 이력 ──
  async function showHistory() {
    switchView('history');
    document.getElementById('history-list').innerHTML = `
      <div class="skeleton-wrapper">
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text short"></div>
      </div>`;
    try {
      renderHistory(await api('/api/newsletters'));
    } catch (err) {
      showToast('이력 로딩 실패: ' + err.message);
    }
  }

  // ── 공개: 관리자 패널 토글 ──
  function toggleAdmin() {
    const hidden = document.getElementById('view-admin').classList.contains('hidden');
    switchView(hidden ? 'admin' : 'latest');
  }

  // ── 공개: 특정 뉴스레터 로드 ──
  async function loadNewsletter(id) {
    switchView('latest');
    document.getElementById('newsletter-meta').classList.add('hidden');
    showSkeleton('newsletter-body');
    try {
      renderNewsletter(await api(`/api/newsletters/${id}`));
    } catch (err) {
      showToast('로딩 실패: ' + err.message);
      showLatest();
    }
  }

  // ── 공개: 뉴스레터 생성 ──
  async function generateNow() {
    const key = document.getElementById('admin-key-input').value.trim();
    if (!key) { showToast('Admin Key를 입력하세요.'); return; }

    const btn = document.getElementById('btn-generate');
    const msgEl = document.getElementById('admin-msg');

    setGeneratingUI(true, btn, msgEl);

    try {
      await api('/api/newsletters/generate', {
        method: 'POST',
        body: JSON.stringify({ adminKey: key })
      });
      msgEl.innerHTML = '<span class="spinner"></span> RSS 수집 및 AI 요약 생성 중... (약 1-2분)';
      msgEl.className = 'admin-msg info';
      startPolling(btn, msgEl);
    } catch (err) {
      msgEl.textContent = '오류: ' + err.message;
      msgEl.className = 'admin-msg error';
      setGeneratingUI(false, btn, msgEl);
    }
  }

  function setGeneratingUI(isGenerating, btn, msgEl) {
    btn.disabled = isGenerating;
    btn.innerHTML = isGenerating ? '<span class="spinner"></span> 생성 중...' : '지금 생성';
    if (!isGenerating) msgEl.textContent = '';
  }

  // ── 폴링: 생성 완료 감지 ──
  function startPolling(btn, msgEl) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const status = await api('/api/status');
        if (!status.running) {
          clearInterval(pollTimer);
          setGeneratingUI(false, btn, msgEl);
          if (status.error) {
            msgEl.textContent = '생성 실패: ' + status.error;
            msgEl.className = 'admin-msg error';
          } else {
            msgEl.textContent = '생성 완료! 최신호가 업데이트되었습니다.';
            msgEl.className = 'admin-msg success';
            showToast('뉴스레터가 새로 발행되었습니다!');
            setTimeout(() => showLatest(), 1500);
          }
        }
      } catch {
        // 네트워크 오류 시 무시하고 계속 폴링
      }
    }, 5000);
  }

  // ── 챗봇 ──
  function toggleChat() {
    chatOpen = !chatOpen;
    document.getElementById('chat-panel').classList.toggle('hidden', !chatOpen);
    document.getElementById('chat-icon').textContent = chatOpen ? '✕' : '💬';
    if (chatOpen) document.getElementById('chat-input').focus();
  }

  async function sendChat() {
    const input = document.getElementById('chat-input');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    input.disabled = true;

    appendBubble(question, 'user');
    const loadingId = appendBubble('', 'assistant loading');

    try {
      const res = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ question, newsletterId: currentNewsletterId })
      });
      updateBubble(loadingId, res.answer, 'assistant');
    } catch (err) {
      updateBubble(loadingId, '오류: ' + err.message, 'assistant error-bubble');
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  function appendBubble(text, cls) {
    const container = document.getElementById('chat-messages');
    const id = 'bubble-' + Date.now();
    const div = document.createElement('div');
    div.id = id;
    div.className = `chat-bubble ${cls}`;
    if (cls.includes('loading')) {
      div.innerHTML = '<span class="dot-pulse"></span>';
    } else {
      div.textContent = text;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
  }

  function updateBubble(id, text, cls) {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.className = `chat-bubble ${cls}`; }
    document.getElementById('chat-messages').scrollTop = 9999;
  }

  // ── 토스트 알림 ──
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3500);
  }

  // ── 초기화 ──
  document.addEventListener('DOMContentLoaded', () => {
    showLatest();
    // 챗봇 Enter 키 바인딩
    document.getElementById('chat-input')
      .addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) sendChat(); });
  });

  return { showLatest, showHistory, toggleAdmin, loadNewsletter, generateNow, toggleChat, sendChat };
})();
