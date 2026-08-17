const studentId = localStorage.getItem('studentId');
const nickname = localStorage.getItem('nickname') || '';

if (!studentId) {
  location.href = '/';
}

document.getElementById('nicknameLabel').textContent = nickname;

const socket = io();

let stocks = [];
let referencePrices = {}; // stockId -> 최초 접속 시 가격 (등락률 기준)
let selectedStockId = null;
let selectedSector = '전체';
let portfolio = null;
let gameState = { is_trading_active: true };
let roundEndsAt = null;

function updateRemainingTime() {
  const pill = document.getElementById('timerPill');
  const val = document.getElementById('remainingTimeValue');
  if (!roundEndsAt) {
    pill.style.display = 'none';
    return;
  }
  pill.style.display = 'flex';
  const remainMs = roundEndsAt - Date.now();
  if (remainMs <= 0) {
    val.textContent = '00:00';
    return;
  }
  const totalSec = Math.floor(remainMs / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  val.textContent = `${mm}:${ss}`;
}
setInterval(updateRemainingTime, 1000);

function fmtWon(n) {
  return Math.round(n).toLocaleString('ko-KR') + '원';
}

function changePercent(stock) {
  const ref = referencePrices[stock.id];
  if (!ref) return 0;
  return ((stock.price - ref) / ref) * 100;
}

function renderSectorTabs() {
  const sectors = ['전체', ...new Set(stocks.map((s) => s.sector))];
  const wrap = document.getElementById('sectorTabs');
  wrap.innerHTML = '';
  sectors.forEach((sector) => {
    const btn = document.createElement('button');
    btn.textContent = sector;
    if (sector === selectedSector) btn.classList.add('active');
    btn.addEventListener('click', () => {
      selectedSector = sector;
      renderSectorTabs();
      renderStockList();
    });
    wrap.appendChild(btn);
  });
}

function renderStockList() {
  const list = document.getElementById('stockList');
  list.innerHTML = '';
  const filtered = selectedSector === '전체' ? stocks : stocks.filter((s) => s.sector === selectedSector);
  filtered.forEach((stock) => {
    const change = changePercent(stock);
    const changeClass = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '-';
    const card = document.createElement('div');
    card.className = 'stock-card' + (stock.id === selectedStockId ? ' selected' : '') + (stock.isDelisted ? ' delisted' : '');
    card.innerHTML = `
      <div class="info">
        <div class="name">${stock.name}${stock.riskTier === 'penny' ? '<span class="penny-badge">동전주</span>' : ''}${stock.isDelisted ? '<span class="badge-bankrupt">상장폐지</span>' : ''}</div>
        <div class="sector">${stock.sector} · ${stock.symbol}</div>
      </div>
      <div class="price-box">
        <div class="price">${fmtWon(stock.price)}</div>
        <div class="change ${changeClass}">${arrow} ${Math.abs(change).toFixed(1)}%</div>
      </div>
    `;
    if (!stock.isDelisted) {
      card.addEventListener('click', () => {
        selectedStockId = stock.id;
        renderStockList();
        renderTradeBox();
      });
    }
    list.appendChild(card);
  });
}

function myHoldingQty(stockId) {
  if (!portfolio) return 0;
  const h = portfolio.holdings.find((x) => x.stock_id === stockId);
  return h ? h.quantity : 0;
}

function renderTradeBox() {
  const stock = stocks.find((s) => s.id === selectedStockId);
  const buyBtn = document.getElementById('buyBtn');
  const sellBtn = document.getElementById('sellBtn');
  const tradingLocked = !gameState.is_trading_active || (portfolio && portfolio.status === 'bankrupt');

  if (!stock) {
    document.getElementById('selectedStockName').textContent = '종목을 선택하세요';
    document.getElementById('selectedStockInfo').textContent = '';
    buyBtn.disabled = true;
    sellBtn.disabled = true;
    return;
  }

  document.getElementById('selectedStockName').textContent = `${stock.name} (${stock.symbol})`;
  document.getElementById('selectedStockInfo').textContent =
    `현재가 ${fmtWon(stock.price)} · 보유 ${myHoldingQty(stock.id)}주 · 현금 ${portfolio ? fmtWon(portfolio.cash) : '-'}`;

  buyBtn.disabled = tradingLocked || stock.isDelisted;
  sellBtn.disabled = tradingLocked || stock.isDelisted || myHoldingQty(stock.id) === 0;
}

function renderHeader() {
  if (!portfolio) return;
  document.getElementById('cashValue').textContent = fmtWon(portfolio.cash);
  document.getElementById('totalAssetsValue').textContent = fmtWon(portfolio.totalAssets);
  const pill = document.getElementById('tradingStatusPill');
  const val = document.getElementById('tradingStatusValue');
  val.textContent = gameState.is_trading_active ? '거래 중' : '거래 중지';
  pill.style.background = gameState.is_trading_active ? '#1e3a2a' : '#3a1e1e';
}

function renderHoldings() {
  const tbody = document.querySelector('#holdingsTable tbody');
  tbody.innerHTML = '';
  if (!portfolio || portfolio.holdings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#9aa4b8">보유 종목 없음</td></tr>';
    return;
  }
  portfolio.holdings.forEach((h) => {
    const tr = document.createElement('tr');
    const value = h.is_delisted ? 0 : h.quantity * h.price;
    tr.innerHTML = `<td>${h.name}${h.is_delisted ? '<span class="badge-bankrupt">상폐</span>' : ''}</td><td>${h.quantity}</td><td>${fmtWon(value)}</td>`;
    tbody.appendChild(tr);
  });
}

function renderLeaderboard(leaderboard) {
  const list = document.getElementById('leaderboardList');
  list.innerHTML = '';
  leaderboard.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.nickname === nickname) li.classList.add('me');
    li.innerHTML = `
      <span><span class="rank">${i + 1}</span> ${p.nickname}${p.status === 'bankrupt' ? '<span class="badge-bankrupt">파산</span>' : ''}</span>
      <span>${fmtWon(p.totalAssets)}</span>
    `;
    list.appendChild(li);
  });
}

function pushNews(item) {
  const ticker = document.getElementById('newsTicker');
  const tagClass = {
    '호재': 'tag-good', '악재': 'tag-bad', '거시경제': 'tag-macro',
    '실적발표': 'tag-earn', '상장폐지': 'tag-delist',
  }[item.type] || 'tag-macro';
  const span = document.createElement('span');
  span.className = 'item';
  span.innerHTML = `<span class="tag ${tagClass}">${item.type}</span>${item.message}`;
  ticker.prepend(span);
  while (ticker.children.length > 8) ticker.removeChild(ticker.lastChild);
}

function applyGameState(state) {
  gameState = state;
  roundEndsAt = state.round_ends_at ? new Date(state.round_ends_at).getTime() : null;
  updateRemainingTime();
}

async function loadInitialState() {
  const res = await fetch('/api/state');
  const data = await res.json();
  stocks = data.stocks;
  applyGameState(data.gameState);
  stocks.forEach((s) => { referencePrices[s.id] = s.price; });
  renderSectorTabs();
  renderStockList();
  renderLeaderboard(data.leaderboard);
  renderHeader();

  const newsRes = await fetch('/api/news');
  const news = await newsRes.json();
  news.slice(0, 8).reverse().forEach((n) => pushNews({ type: n.type, message: n.message }));
}

document.getElementById('buyBtn').addEventListener('click', () => trade('buy'));
document.getElementById('sellBtn').addEventListener('click', () => trade('sell'));

function trade(type) {
  const qty = Math.max(1, Math.floor(Number(document.getElementById('qtyInput').value) || 0));
  document.getElementById('tradeError').textContent = '';
  socket.emit('trade', { type, stockId: selectedStockId, quantity: qty });
}

socket.on('connect', () => {
  socket.emit('join', Number(studentId));
});

socket.on('portfolioUpdate', (p) => {
  portfolio = p;
  renderHeader();
  renderHoldings();
  renderTradeBox();
  if (p.status === 'bankrupt') {
    location.href = '/bankrupt.html';
  }
});

socket.on('marketUpdate', (data) => {
  stocks = data.stocks;
  renderSectorTabs();
  renderStockList();
  renderTradeBox();
  renderLeaderboard(data.leaderboard);
});

socket.on('leaderboardData', (leaderboard) => {
  renderLeaderboard(leaderboard);
});

socket.on('newsEvent', (item) => {
  pushNews(item);
});

socket.on('gameStateUpdate', (state) => {
  applyGameState(state);
  renderHeader();
  renderTradeBox();
});

socket.on('tradeError', (err) => {
  document.getElementById('tradeError').textContent = err.message;
});

socket.on('bankrupt', () => {
  location.href = '/bankrupt.html';
});

socket.on('gameEnded', () => {
  location.href = '/results.html';
});

socket.on('gameReset', () => {
  localStorage.removeItem('studentId');
  localStorage.removeItem('nickname');
  location.href = '/';
});

loadInitialState();
