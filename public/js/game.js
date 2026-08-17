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
let sessionStartedAt = null;

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
  sessionStartedAt = data.gameState.session_started_at;
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

  if (tutorialPracticePhase === 'buy' && type === 'buy') {
    tutorialPracticePhase = 'sell';
    showGuide('👍 매수 완료! 이번엔 방금 산 종목을 "매도" 버튼으로 팔아보세요!');
  } else if (tutorialPracticePhase === 'sell' && type === 'sell') {
    tutorialPracticePhase = 'done';
    showPracticeDone();
  }
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

const TUTORIAL_STEPS = [
  {
    title: '📈 모의주식투자에 오신 걸 환영해요!',
    body: '가상의 돈 1,000,000원으로 주식 투자를 연습해볼 거예요. 진짜 돈이 아니니까 마음껏 도전해보세요!',
  },
  {
    title: '🛒 사고파는 방법',
    body: '화면 아래쪽에 매수/매도 칸이 있어요. 종목을 고르고 수량을 입력한 뒤 "매수"나 "매도" 버튼을 누르면 돼요. "내 보유 종목"을 탭하면 그 종목을 바로 매매할 수 있어요.',
  },
  {
    title: '📰 뉴스를 잘 보세요',
    body: '화면에 뉴스 속보가 떠요. 좋은 소식(호재)이 뜨면 가격이 오르고, 나쁜 소식(악재)이 뜨면 가격이 떨어져요. 내가 가진 종목 소식은 더 크게 강조돼서 알려줘요.',
  },
  {
    title: '⚠️ 꼭 기억하세요!',
    body: '가진 돈을 다 잃으면 "파산"해서 게임이 끝나요. 소문만 믿고 무리하게 투자하면 정말 위험해요. 신중하게 생각하고 투자하세요.',
  },
  {
    title: '🚀 이제 실전 연습을 해볼까요?',
    body: '설명은 다 끝났어요! 이제 실제로 매수와 매도를 한 번씩 직접 눌러보는 연습을 해볼게요.',
  },
];

let tutorialStep = 0;
let tutorialPracticePhase = null; // null | 'buy' | 'sell' | 'done'

function renderTutorialStep() {
  const step = TUTORIAL_STEPS[tutorialStep];
  document.getElementById('tutorialStepLabel').textContent = `${tutorialStep + 1} / ${TUTORIAL_STEPS.length}`;
  document.getElementById('tutorialBody').innerHTML = `<h3>${step.title}</h3><p>${step.body}</p>`;
  document.getElementById('tutorialPrevBtn').style.visibility = tutorialStep === 0 ? 'hidden' : 'visible';
  document.getElementById('tutorialNextBtn').textContent =
    tutorialStep === TUTORIAL_STEPS.length - 1 ? '연습 시작' : '다음';
}

function closeTutorial() {
  document.getElementById('tutorialOverlay').style.display = 'none';
  document.getElementById('tutorialGuideBanner').style.display = 'none';
  tutorialPracticePhase = null;
  // 세션(전체 초기화) 단위로 기억 - 교사가 "전체 초기화"를 누를 때마다 다음 접속 시 다시 뜸
  localStorage.setItem('tutorialSeenSession', sessionStartedAt || '');
}

function maybeShowTutorial() {
  if (sessionStartedAt && localStorage.getItem('tutorialSeenSession') === sessionStartedAt) return;
  tutorialStep = 0;
  renderTutorialStep();
  document.getElementById('tutorialOverlay').style.display = 'flex';
}

function showGuide(text) {
  document.getElementById('tutorialGuideText').textContent = text;
  document.getElementById('tutorialGuideBanner').style.display = 'block';
}

// 튜토리얼 안내창을 닫고, 실제 화면에서 매수 -> 매도를 한 번씩 직접 해보게 함
function startPracticeMode() {
  document.getElementById('tutorialOverlay').style.display = 'none';
  tutorialPracticePhase = 'buy';
  showGuide('👉 아래 종목 목록에서 회사 하나를 골라 탭한 다음, 매수 버튼을 눌러보세요!');
}

function showPracticeDone() {
  document.getElementById('tutorialGuideBanner').style.display = 'none';
  document.getElementById('tutorialStepLabel').textContent = '연습 완료!';
  document.getElementById('tutorialBody').innerHTML =
    '<h3>🎉 잘하셨어요!</h3><p>매수와 매도를 모두 직접 해봤어요. 이제 진짜 게임을 시작해볼까요?</p>';
  document.getElementById('tutorialPrevBtn').style.visibility = 'hidden';
  document.getElementById('tutorialNextBtn').textContent = '시작하기';
  document.getElementById('tutorialOverlay').style.display = 'flex';
}

document.getElementById('tutorialNextBtn').addEventListener('click', () => {
  if (tutorialPracticePhase === 'done') {
    closeTutorial();
  } else if (tutorialStep === TUTORIAL_STEPS.length - 1) {
    startPracticeMode();
  } else {
    tutorialStep++;
    renderTutorialStep();
  }
});

document.getElementById('tutorialPrevBtn').addEventListener('click', () => {
  if (tutorialStep > 0) {
    tutorialStep--;
    renderTutorialStep();
  }
});

loadInitialState().then(() => {
  maybeShowTutorial();
});
