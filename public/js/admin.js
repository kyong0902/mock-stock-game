let adminPassword = sessionStorage.getItem('adminPassword') || '';
const socket = io();

function fmtWon(n) {
  return Math.round(n).toLocaleString('ko-KR') + '원';
}

async function adminFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword, ...(opts.headers || {}) },
  });
  return res;
}

async function tryLogin(password) {
  adminPassword = password;
  const res = await adminFetch('/api/admin/login', { method: 'POST' });
  if (!res.ok) {
    adminPassword = '';
    return false;
  }
  sessionStorage.setItem('adminPassword', password);
  return true;
}

function showAdminScreen() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminScreen').style.display = 'block';
  loadState();
  loadStudents();
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const pw = document.getElementById('passwordInput').value;
  const ok = await tryLogin(pw);
  if (ok) {
    showAdminScreen();
  } else {
    document.getElementById('loginError').textContent = '비밀번호가 올바르지 않습니다.';
  }
});
document.getElementById('passwordInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});

async function loadState() {
  const res = await fetch('/api/state');
  const data = await res.json();
  renderGameState(data.gameState);
  renderStockOptions(data.stocks);
}

function renderGameState(state) {
  const el = document.getElementById('tradingStatus');
  el.textContent = state.is_trading_active ? '거래 중' : '중지됨';
  el.className = state.is_trading_active ? 'status-active' : 'status-paused';
  document.getElementById('tickInterval').value = state.tick_interval_sec;
  document.getElementById('eventInterval').value = state.event_interval_sec;
}

function renderStockOptions(stocks) {
  const select = document.getElementById('eventStock');
  select.innerHTML = '<option value="">종목 무작위 선택</option>';
  stocks.filter((s) => !s.isDelisted).forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name} (${s.sector})`;
    select.appendChild(opt);
  });
}

async function loadStudents() {
  const res = await adminFetch('/api/admin/students');
  if (!res.ok) return;
  const students = await res.json();
  document.getElementById('studentCount').textContent = students.length;
  const list = document.getElementById('studentList');
  list.innerHTML = '';
  students.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span><span class="rank">${i + 1}</span> ${p.nickname}${p.status === 'bankrupt' ? '<span class="badge-bankrupt">파산</span>' : ''}</span>
      <span>${fmtWon(p.totalAssets)}</span>
    `;
    list.appendChild(li);
  });
}

document.getElementById('toggleTradingBtn').addEventListener('click', async () => {
  const res = await adminFetch('/api/admin/toggle-trading', { method: 'POST' });
  const state = await res.json();
  renderGameState(state);
});

document.getElementById('applySpeedBtn').addEventListener('click', async () => {
  const tickIntervalSec = Number(document.getElementById('tickInterval').value);
  const eventIntervalSec = Number(document.getElementById('eventInterval').value);
  const res = await adminFetch('/api/admin/set-speed', {
    method: 'POST',
    body: JSON.stringify({ tickIntervalSec, eventIntervalSec }),
  });
  const state = await res.json();
  renderGameState(state);
});

document.querySelectorAll('[data-kind]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const kind = btn.dataset.kind;
    const stockId = document.getElementById('eventStock').value || undefined;
    await adminFetch('/api/admin/trigger-event', {
      method: 'POST',
      body: JSON.stringify({ kind, stockId: stockId ? Number(stockId) : undefined }),
    });
  });
});

document.getElementById('endGameBtn').addEventListener('click', async () => {
  if (!confirm('게임을 종료하고 최종 순위를 확정할까요? 이후 모든 학생의 거래가 잠깁니다.')) return;
  await adminFetch('/api/admin/end-game', { method: 'POST' });
  window.open('/results.html', '_blank');
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('전체 데이터를 초기화할까요? 모든 학생의 자산과 기록이 삭제됩니다.')) return;
  await adminFetch('/api/admin/reset', { method: 'POST' });
  loadState();
  loadStudents();
});

socket.on('marketUpdate', (data) => {
  renderStockOptions(data.stocks);
  const list = document.getElementById('studentList');
  if (list) loadStudents();
});
socket.on('gameStateUpdate', (state) => renderGameState(state));

if (adminPassword) {
  tryLogin(adminPassword).then((ok) => {
    if (ok) showAdminScreen();
  });
}
