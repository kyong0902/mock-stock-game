const db = require('./db');
const { computeTotalAssets, getStocks, getLeaderboard } = require('./queries');

function broadcastMarketUpdate(io) {
  io.emit('marketUpdate', { stocks: getStocks(), leaderboard: getLeaderboard() });
}

const GOOD_TEMPLATES = [
  '{name}, 새로 나온 물건이 인기 폭발이에요! 불티나게 팔려요 🎉',
  '{name}, 외국에 물건을 잔뜩 팔기로 했대요! 신난다 🎉',
  '{name}, 멋진 신기술을 새로 만들었대요! 다들 깜짝 놀랐어요 😲',
  '{name}, 유명한 부자가 이 회사 주식을 잔뜩 샀대요!',
  '{name}, 나라에서 이 회사를 도와주기로 했대요!',
];

const BAD_TEMPLATES = [
  '{name}, 공장에 불이 났어요 ㅠㅠ',
  '{name}, 물건에 문제가 있어서 다시 가져가야 한대요 ㅠㅠ 사람들이 실망했어요',
  '{name}, 다른 회사랑 다퉜는데 졌대요 ㅠㅠ',
  '{name}, 회사 높은 사람이 나쁜 짓을 했다는 소문이 났어요 ㅠㅠ',
  '{name}, 요즘 물건이 잘 안 팔려요 ㅠㅠ',
];

const EARNINGS_SURPRISE = ['{name}, 이번에 돈을 예상보다 훨씬 많이 벌었대요! 최고예요 🎉'];
const EARNINGS_SHOCK = ['{name}, 실적이 안 좋아요 ㅠㅠ 물건이 잘 안 팔렸어요 ㅠㅠ'];

const PENNY_RUMOR_TEMPLATES = [
  '{name}, SNS에서 "대박 난다"는 소문이 쫙 퍼졌어요!',
  '{name}, 누가 이 주식을 엄청 많이 사고 있다는 소문이에요!',
  '{name}, 곧 새로운 사업을 한다는 소문이 돌아요! (진짜인지는 아무도 몰라요)',
];

const PENNY_CRASH_TEMPLATES = [
  '{name}, 거짓 소문으로 사람들을 속였다는 게 들통났어요 ㅠㅠ',
  '{name}, 회사에 돈이 부족해졌대요 ㅠㅠ',
  '{name}, 곧 이 주식을 사고팔 수 없게 될 수도 있대요 ㅠㅠ 다들 깜짝 놀랐어요',
];

const MACRO_SCENARIOS = [
  {
    message: '은행에서 돈을 빌릴 때 내야 하는 이자가 올랐어요',
    impacts: { 금융: 0.04, DEFAULT: -0.015 },
  },
  {
    message: '은행에서 돈을 빌릴 때 내야 하는 이자가 내렸어요',
    impacts: { 금융: -0.03, DEFAULT: 0.015 },
  },
  {
    message: '기름값이 많이 올랐어요! 기름을 만드는 회사는 좋고, 기름을 많이 쓰는 비행기 회사는 힘들어졌어요',
    impacts: { '에너지/화학': 0.05, '항공/조선': -0.04 },
  },
  {
    message: '기름값이 뚝 떨어졌어요! 기름을 만드는 회사는 힘들고, 비행기 회사는 신났어요',
    impacts: { '에너지/화학': -0.05, '항공/조선': 0.04 },
  },
  {
    message: '원화 가치가 조금 떨어졌어요! 외국에 물건을 파는 회사들이 더 유리해졌어요',
    impacts: { 반도체: 0.03, 자동차: 0.03, 배터리: 0.03, '항공/조선': 0.02 },
  },
  {
    message: '원화 가치가 올랐어요! 외국에 물건을 파는 회사들은 조금 힘들어졌어요',
    impacts: { 반도체: -0.03, 자동차: -0.03, 배터리: -0.03, '항공/조선': -0.02, '인터넷/플랫폼': 0.01 },
  },
  {
    message: '전 세계 경제가 좋아지고 있대요! 다 같이 신나요 🎉',
    impacts: { DEFAULT: 0.025 },
  },
  {
    message: '전 세계 경제가 안 좋아지고 있대요 ㅠㅠ',
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

function broadcastNews(io, { type, scope, message, price_impact_percent, stockId, stockName, sector, affectedSectors, marketWide }) {
  db.prepare(
    'INSERT INTO news_events (type, scope, message, price_impact_percent) VALUES (?, ?, ?, ?)'
  ).run(type, scope, message, price_impact_percent ?? null);
  io.emit('newsEvent', {
    type, scope, message, price_impact_percent,
    stockId: stockId ?? null,
    stockName: stockName ?? null,
    sector: sector ?? null,
    affectedSectors: affectedSectors ?? null,
    marketWide: marketWide ?? false,
    timestamp: new Date().toISOString(),
  });
}

function checkDelistAndBankruptcy(io, stock) {
  if (stock.price > stock.floor_price || stock.is_delisted) return;

  db.prepare('UPDATE stocks SET is_delisted = 1, price = 0 WHERE id = ?').run(stock.id);
  broadcastNews(io, {
    type: '상장폐지',
    scope: `stock:${stock.id}`,
    message: `${stock.name}, 상장폐지됐어요 ㅠㅠ 이제 이 주식은 다시 사고팔 수 없어요`,
    price_impact_percent: -100,
    stockId: stock.id,
    stockName: stock.name,
    sector: stock.sector,
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
    stockId: stock.id,
    stockName: stock.name,
    sector: stock.sector,
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
  const affectedSectors = Object.keys(scenario.impacts).filter((k) => k !== 'DEFAULT');
  const marketWide = Object.prototype.hasOwnProperty.call(scenario.impacts, 'DEFAULT');
  broadcastNews(io, {
    type: '거시경제',
    scope: 'market',
    message: scenario.message,
    price_impact_percent: null,
    affectedSectors,
    marketWide,
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
    stockId: stock.id,
    stockName: stock.name,
    sector: stock.sector,
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
      stockId: stock.id,
      stockName: stock.name,
      sector: stock.sector,
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
      stockId: stock.id,
      stockName: stock.name,
      sector: stock.sector,
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
        stockId: stock.id,
        stockName: stock.name,
        sector: stock.sector,
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
      stockId: stock.id,
      stockName: stock.name,
      sector: stock.sector,
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
