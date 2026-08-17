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
        <div class="name">${stock.name}${stock.isDelisted ? '<span class="badge-bankrupt">상장폐지</span>' : ''}</div>
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
  const wrap = document.getElementById('holdingsChips');
  wrap.innerHTML = '';
  const holdings = portfolio ? portfolio.holdings.filter((h) => h.quantity > 0) : [];
  if (holdings.length === 0) {
    wrap.innerHTML = '<span class="holding-empty">보유 종목 없음</span>';
    return;
  }
  holdings.forEach((h) => {
    const value = h.is_delisted ? 0 : h.quantity * h.price;
    const chip = document.createElement('div');
    chip.className = 'holding-chip' + (h.stock_id === selectedStockId ? ' selected' : '');
    chip.innerHTML = `<span class="chip-name">${h.name}${h.is_delisted ? '<span class="badge-bankrupt">상폐</span>' : ''}</span> · ${h.quantity}주 · <span class="chip-value">${fmtWon(value)}</span>`;
    if (!h.is_delisted) {
      chip.addEventListener('click', () => {
        selectedStockId = h.stock_id;
        renderStockList();
        renderTradeBox();
        renderHoldings();
      });
    }
    wrap.appendChild(chip);
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

const NEWS_TAG_CLASS = {
  '호재': 'tag-good', '악재': 'tag-bad', '거시경제': 'tag-macro',
  '실적발표': 'tag-earn', '상장폐지': 'tag-delist',
};

// 뉴스가 학생이 보유 중인 종목(또는 그 종목의 섹터)과 관련 있는지 판단
function getRelevantHoldings(item) {
  if (!portfolio || portfolio.holdings.length === 0) return [];
  return portfolio.holdings.filter((h) => {
    if (h.quantity <= 0 || h.is_delisted) return false;
    if (item.stockId) return h.stock_id === item.stockId;
    if (item.type === '거시경제') {
      const stock = stocks.find((s) => s.id === h.stock_id);
      if (!stock) return false;
      if (item.marketWide) return true;
      return Array.isArray(item.affectedSectors) && item.affectedSectors.includes(stock.sector);
    }
    return false;
  });
}

let popupQueue = [];
let popupShowing = false;
let popupAutoTimer = null;
let pendingSelectStockId = null;

function enqueuePopup(item, relevantHoldings) {
  popupQueue.push({ item, relevantHoldings });
  if (!popupShowing) showNextPopup();
}

function showNextPopup() {
  if (popupAutoTimer) {
    clearTimeout(popupAutoTimer);
    popupAutoTimer = null;
  }
  if (popupQueue.length === 0) {
    popupShowing = false;
    document.getElementById('holdingModal').style.display = 'none';
    return;
  }
  popupShowing = true;
  const { item, relevantHoldings } = popupQueue.shift();
  const isRelevant = relevantHoldings.length > 0;

  const box = document.getElementById('modalBox');
  box.classList.toggle('modal-relevant', isRelevant);

  const tagClass = NEWS_TAG_CLASS[item.type] || 'tag-macro';
  const tagEl = document.getElementById('modalTag');
  tagEl.textContent = item.type;
  tagEl.className = 'modal-tag ' + tagClass;

  document.getElementById('modalTitle').textContent = isRelevant ? '📢 내 보유 종목 관련 뉴스!' : '📰 시장 뉴스 속보';
  document.getElementById('modalMessage').textContent = item.message;

  const detailEl = document.getElementById('modalDetail');
  if (isRelevant) {
    const detailLines = relevantHoldings.map((h) => {
      const stock = stocks.find((s) => s.id === h.stock_id);
      const price = stock ? stock.price : h.price;
      return `<strong>${h.name}</strong> · 보유 ${h.quantity}주 · 현재가 ${fmtWon(price)} · 평가액 ${fmtWon(h.quantity * price)}`;
    });
    detailEl.innerHTML = detailLines.join('<br>');
    detailEl.style.display = 'block';
  } else {
    detailEl.style.display = 'none';
  }

  document.getElementById('modalCloseBtn').textContent = isRelevant ? '확인하고 매매 결정하기' : '확인';
  pendingSelectStockId = isRelevant ? relevantHoldings[0].stock_id : null;

  document.getElementById('holdingModal').style.display = 'flex';

  if (!isRelevant) {
    popupAutoTimer = setTimeout(() => closeCurrentPopup(), 4500);
  }
}

function closeCurrentPopup() {
  if (pendingSelectStockId) {
    selectedStockId = pendingSelectStockId;
    renderStockList();
    renderTradeBox();
    renderHoldings();
  }
  showNextPopup();
}

document.getElementById('modalCloseBtn').addEventListener('click', closeCurrentPopup);

// 보유 종목과 무관한 일반 뉴스는 배경을 탭해도 바로 닫을 수 있게 함
document.getElementById('holdingModal').addEventListener('click', (e) => {
  if (e.target.id === 'holdingModal' && !pendingSelectStockId) {
    closeCurrentPopup();
  }
});

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
  enqueuePopup(item, getRelevantHoldings(item));
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
