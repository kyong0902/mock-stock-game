const db = require('./db');
const { computeTotalAssets, getStocks, getLeaderboard } = require('./queries');

function broadcastMarketUpdate(io) {
  io.emit('marketUpdate', { stocks: getStocks(), leaderboard: getLeaderboard() });
}

const GOOD_TEMPLATES = [
  '{name}, 신제품 흥행으로 주가 급등',
  '{name}, 대규모 해외 수출 계약 체결',
  '{name}, 업계 예상 뛰어넘는 신기술 공개',
  '{name}, 유명 투자자 대량 매수 소식',
  '{name}, 정부 지원 정책 수혜 기대',
];

const BAD_TEMPLATES = [
  '{name}, 공장 화재 사고 발생',
  '{name}, 제품 리콜 사태로 신뢰도 하락',
  '{name}, 경쟁사와의 소송에서 패소',
  '{name}, 핵심 임원 비리 의혹 제기',
  '{name}, 주력 제품 판매 부진 지속',
];

const EARNINGS_SURPRISE = ['{name}, 어닝서프라이즈! 시장 예상치 크게 상회'];
const EARNINGS_SHOCK = ['{name}, 어닝쇼크! 실적 시장 기대치 하회'];

const PENNY_RUMOR_TEMPLATES = [
  '{name}, SNS에서 "대박 테마주" 입소문 확산',
  '{name}, 정체불명 세력 매수설 확산',
  '{name}, 근거 없는 "신사업 진출설" 루머 확산',
];

const PENNY_CRASH_TEMPLATES = [
  '{name}, 허위공시 적발 조사 착수',
  '{name}, 감자(자본금 감소) 결정 공시',
  '{name}, 거래정지 임박설 확산',
];

const MACRO_SCENARIOS = [
  {
    message: '한국은행, 기준금리 인상 발표',
    impacts: { 금융: 0.04, DEFAULT: -0.015 },
  },
  {
    message: '한국은행, 기준금리 인하 발표',
    impacts: { 금융: -0.03, DEFAULT: 0.015 },
  },
  {
    message: '국제 유가 급등, 산유국 감산 합의',
    impacts: { '에너지/화학': 0.05, '항공/조선': -0.04 },
  },
  {
    message: '국제 유가 급락, 공급 과잉 우려',
    impacts: { '에너지/화학': -0.05, '항공/조선': 0.04 },
  },
  {
    message: '원달러 환율 급등 (원화 약세)',
    impacts: { 반도체: 0.03, 자동차: 0.03, 배터리: 0.03, '항공/조선': 0.02 },
  },
  {
    message: '원달러 환율 급락 (원화 강세)',
    impacts: { 반도체: -0.03, 자동차: -0.03, 배터리: -0.03, '항공/조선': -0.02, '인터넷/플랫폼': 0.01 },
  },
  {
    message: '글로벌 경기 훈풍, 전 세계 증시 동반 상승',
    impacts: { DEFAULT: 0.025 },
  },
  {
    message: '글로벌 경기 침체 우려 확산',
    impacts: { DEFAULT: -0.025 },
  },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fmt(template, name) {
  return template.replace('{name}', name);
}

function clampPrice(stock, price) {
  return Math.max(price, 1);
}

// 동전주/작전주 펌프-덤프 상태 (서버 인메모리, 재시작 시 초기화)
const pennyState = new Map(); // stockId -> { phase: 'pump'|'dump', ticksLeft }

function getPennyPhase(stockId) {
  let state = pennyState.get(stockId);
  if (!state) {
    state = { phase: 'pump', ticksLeft: 3 + Math.floor(Math.random() * 4) };
    pennyState.set(stockId, state);
  }
  return state;
}

function advancePennyPhase(stockId) {
  const state = getPennyPhase(stockId);
  state.ticksLeft -= 1;
  if (state.ticksLeft <= 0) {
    if (state.phase === 'pump') {
      state.phase = 'dump';
      state.ticksLeft = 3 + Math.floor(Math.random() * 4);
    }
  }
}

function broadcastNews(io, { type, scope, message, price_impact_percent }) {
  db.prepare(
    'INSERT INTO news_events (type, scope, message, price_impact_percent) VALUES (?, ?, ?, ?)'
  ).run(type, scope, message, price_impact_percent ?? null);
  io.emit('newsEvent', { type, scope, message, price_impact_percent, timestamp: new Date().toISOString() });
}

function checkDelistAndBankruptcy(io, stock) {
  if (stock.price > stock.floor_price || stock.is_delisted) return;

  db.prepare('UPDATE stocks SET is_delisted = 1, price = 0 WHERE id = ?').run(stock.id);
  broadcastNews(io, {
    type: '상장폐지',
    scope: `stock:${stock.id}`,
    message: `${stock.name}, 상장폐지 결정 — 거래 영구 정지`,
    price_impact_percent: -100,
  });

  const holders = db
    .prepare('SELECT student_id, quantity FROM holdings WHERE stock_id = ? AND quantity > 0')
    .all(stock.id);
  const clearHolding = db.prepare('UPDATE holdings SET quantity = 0, avg_buy_price = 0 WHERE student_id = ? AND stock_id = ?');
  for (const h of holders) {
    clearHolding.run(h.student_id, stock.id);
  }

  for (const h of holders) {
    evaluateBankruptcy(io, h.student_id, stock.risk_tier === 'penny');
  }
}

function evaluateBankruptcy(io, studentId, causedByPenny) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student || student.status === 'bankrupt') return;

  const totalAssets = computeTotalAssets(studentId);
  if (totalAssets < 1) {
    db.prepare("UPDATE students SET status = 'bankrupt', bankrupt_at = datetime('now'), cash = 0 WHERE id = ?").run(studentId);
    io.to(`student:${studentId}`).emit('bankrupt', {
      message: causedByPenny
        ? '묻지마 투자, 근거 없는 소문에 의한 투자는 위험합니다. 가진 돈을 모두 잃었습니다.'
        : '투자에는 원금을 잃을 위험이 있습니다. 무리한 투자는 위험합니다. 가진 돈을 모두 잃었습니다.',
    });
    broadcastMarketUpdate(io);
  }
}

function applyPriceImpact(io, stock, pctChange, { skipDelistCheck = false } = {}) {
  if (stock.is_delisted) return;
  const newPrice = clampPrice(stock, stock.price * (1 + pctChange));
  db.prepare('UPDATE stocks SET price = ? WHERE id = ?').run(newPrice, stock.id);
  db.prepare('INSERT INTO price_history (stock_id, price) VALUES (?, ?)').run(stock.id, newPrice);
  const updated = { ...stock, price: newPrice };
  if (!skipDelistCheck) {
    checkDelistAndBankruptcy(io, updated);
  }
  return updated;
}

// 매 틱: 모든 종목에 소폭 랜덤워크 적용 (동전주는 변동성 훨씬 크게)
function tickPrices(io) {
  const state = db.prepare('SELECT * FROM game_state WHERE id = 1').get();
  if (!state.is_trading_active) return;

  const stocks = db.prepare('SELECT * FROM stocks WHERE is_delisted = 0').all();
  for (const stock of stocks) {
    const baseVol = stock.risk_tier === 'penny' ? 0.06 : 0.012;
    const pct = (Math.random() * 2 - 1) * baseVol;
    applyPriceImpact(io, stock, pct);
  }
  broadcastMarketUpdate(io);
}

// 이벤트 사이클: 호재/악재/거시경제/실적발표 + 동전주 펌프덤프
function runEventCycle(io) {
  const state = db.prepare('SELECT * FROM game_state WHERE id = 1').get();
  if (!state.is_trading_active) return;

  const roll = Math.random();
  if (roll < 0.35) {
    triggerStockEvent(io, Math.random() < 0.5 ? 'good' : 'bad');
  } else if (roll < 0.6) {
    triggerMacroEvent(io);
  } else if (roll < 0.85) {
    triggerEarningsEvent(io);
  } else {
    triggerPennyEvent(io);
  }
}

function triggerStockEvent(io, kind) {
  const stocks = db.prepare("SELECT * FROM stocks WHERE is_delisted = 0 AND risk_tier = 'normal'").all();
  if (stocks.length === 0) return;
  const stock = pick(stocks);
  const template = kind === 'good' ? pick(GOOD_TEMPLATES) : pick(BAD_TEMPLATES);
  const pct = kind === 'good' ? 0.05 + Math.random() * 0.1 : -(0.05 + Math.random() * 0.1);
  applyPriceImpact(io, stock, pct);
  broadcastNews(io, {
    type: kind === 'good' ? '호재' : '악재',
    scope: `stock:${stock.id}`,
    message: fmt(template, stock.name),
    price_impact_percent: Math.round(pct * 1000) / 10,
  });
  broadcastMarketUpdate(io);
}

function triggerMacroEvent(io) {
  const scenario = pick(MACRO_SCENARIOS);
  const stocks = db.prepare('SELECT * FROM stocks WHERE is_delisted = 0').all();
  for (const stock of stocks) {
    const pct = scenario.impacts[stock.sector] ?? scenario.impacts.DEFAULT ?? 0;
    if (pct !== 0) {
      applyPriceImpact(io, stock, pct);
    }
  }
  broadcastNews(io, {
    type: '거시경제',
    scope: 'market',
    message: scenario.message,
    price_impact_percent: null,
  });
  broadcastMarketUpdate(io);
}

function triggerEarningsEvent(io) {
  const stocks = db.prepare("SELECT * FROM stocks WHERE is_delisted = 0 AND risk_tier = 'normal'").all();
  if (stocks.length === 0) return;
  const stock = pick(stocks);
  const isSurprise = Math.random() < 0.5;
  const template = isSurprise ? pick(EARNINGS_SURPRISE) : pick(EARNINGS_SHOCK);
  const pct = isSurprise ? 0.08 + Math.random() * 0.12 : -(0.08 + Math.random() * 0.12);
  applyPriceImpact(io, stock, pct);
  broadcastNews(io, {
    type: '실적발표',
    scope: `stock:${stock.id}`,
    message: fmt(template, stock.name),
    price_impact_percent: Math.round(pct * 1000) / 10,
  });
  broadcastMarketUpdate(io);
}

function triggerPennyEvent(io) {
  const stocks = db.prepare("SELECT * FROM stocks WHERE is_delisted = 0 AND risk_tier = 'penny'").all();
  if (stocks.length === 0) return;
  const stock = pick(stocks);
  const state = getPennyPhase(stock.id);
  advancePennyPhase(stock.id);

  if (state.phase === 'pump') {
    const template = pick(PENNY_RUMOR_TEMPLATES);
    const pct = 0.15 + Math.random() * 0.25;
    applyPriceImpact(io, stock, pct);
    broadcastNews(io, {
      type: '호재',
      scope: `stock:${stock.id}`,
      message: fmt(template, stock.name),
      price_impact_percent: Math.round(pct * 1000) / 10,
    });
  } else {
    const template = pick(PENNY_CRASH_TEMPLATES);
    const pct = -(0.2 + Math.random() * 0.3);
    applyPriceImpact(io, stock, pct);
    broadcastNews(io, {
      type: '악재',
      scope: `stock:${stock.id}`,
      message: fmt(template, stock.name),
      price_impact_percent: Math.round(pct * 1000) / 10,
    });
  }
  broadcastMarketUpdate(io);
}

// 관리자 수동 이벤트 트리거
function manualEvent(io, { kind, stockId, sector }) {
  if (kind === 'macro') {
    triggerMacroEvent(io);
    return;
  }
  if (kind === 'earnings') {
    if (stockId) {
      const stock = db.prepare('SELECT * FROM stocks WHERE id = ? AND is_delisted = 0').get(stockId);
      if (!stock) return;
      const isSurprise = Math.random() < 0.5;
      const template = isSurprise ? pick(EARNINGS_SURPRISE) : pick(EARNINGS_SHOCK);
      const pct = isSurprise ? 0.08 + Math.random() * 0.12 : -(0.08 + Math.random() * 0.12);
      applyPriceImpact(io, stock, pct);
      broadcastNews(io, {
        type: '실적발표',
        scope: `stock:${stock.id}`,
        message: fmt(template, stock.name),
        price_impact_percent: Math.round(pct * 1000) / 10,
      });
      broadcastMarketUpdate(io);
    } else {
      triggerEarningsEvent(io);
    }
    return;
  }
  if (kind === 'good' || kind === 'bad') {
    const stock = stockId
      ? db.prepare('SELECT * FROM stocks WHERE id = ? AND is_delisted = 0').get(stockId)
      : pick(db.prepare("SELECT * FROM stocks WHERE is_delisted = 0 AND risk_tier = 'normal'").all());
    if (!stock) return;
    const template = kind === 'good' ? pick(GOOD_TEMPLATES) : pick(BAD_TEMPLATES);
    const pct = kind === 'good' ? 0.05 + Math.random() * 0.1 : -(0.05 + Math.random() * 0.1);
    applyPriceImpact(io, stock, pct);
    broadcastNews(io, {
      type: kind === 'good' ? '호재' : '악재',
      scope: `stock:${stock.id}`,
      message: fmt(template, stock.name),
      price_impact_percent: Math.round(pct * 1000) / 10,
    });
    broadcastMarketUpdate(io);
    return;
  }
  if (kind === 'penny') {
    triggerPennyEvent(io);
  }
}

function resetPennyState() {
  pennyState.clear();
}

module.exports = {
  tickPrices,
  runEventCycle,
  manualEvent,
  evaluateBankruptcy,
  checkDelistAndBankruptcy,
  resetPennyState,
};
