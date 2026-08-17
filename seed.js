const db = require('./db');

// 실제 기업을 연상시키는 패러디 종목 30개 (교육용 가상 종목, 실존 기업과 무관)
const STOCKS = [
  { name: '삼송전자', symbol: 'SSE', sector: '반도체', price: 78000, floor_price: 100 },
  { name: 'SK하이테크', symbol: 'SKH', sector: '반도체', price: 142000, floor_price: 200 },

  { name: '현다자동차', symbol: 'HDM', sector: '자동차', price: 195000, floor_price: 300 },
  { name: '기아모터스', symbol: 'KAM', sector: '자동차', price: 89000, floor_price: 200 },
  { name: '테슬자동차', symbol: 'TSM', sector: '자동차', price: 250000, floor_price: 300 },

  { name: 'LG배터리', symbol: 'LGB', sector: '배터리', price: 410000, floor_price: 500 },
  { name: '삼송SDI', symbol: 'SSD', sector: '배터리', price: 380000, floor_price: 500 },
  { name: '에코프론', symbol: 'ECF', sector: '배터리', price: 62000, floor_price: 200 },

  { name: '네이바', symbol: 'NVR', sector: '인터넷/플랫폼', price: 215000, floor_price: 300 },
  { name: '카카오프렌즈', symbol: 'KKF', sector: '인터넷/플랫폼', price: 54000, floor_price: 200 },
  { name: '쿠파', symbol: 'CPG', sector: '인터넷/플랫폼', price: 21000, floor_price: 100 },

  { name: '넨씨소프트', symbol: 'NCS', sector: '게임', price: 175000, floor_price: 300 },
  { name: '넥슨코리아', symbol: 'NXK', sector: '게임', price: 24000, floor_price: 100 },
  { name: '스마길게임', symbol: 'SMG', sector: '게임', price: 8900, floor_price: 100 },

  { name: '하이브레인', symbol: 'HBR', sector: '엔터테인먼트', price: 245000, floor_price: 300 },
  { name: 'SM스타쉽', symbol: 'SMS', sector: '엔터테인먼트', price: 68000, floor_price: 200 },
  { name: 'JY피엔터', symbol: 'JYE', sector: '엔터테인먼트', price: 52000, floor_price: 200 },

  { name: '셀트리곤', symbol: 'CTG', sector: '바이오/제약', price: 165000, floor_price: 300 },
  { name: '삼송바이오로직', symbol: 'SBL', sector: '바이오/제약', price: 480000, floor_price: 500 },

  { name: '국민은향', symbol: 'KBB', sector: '금융', price: 58000, floor_price: 200 },
  { name: '신한금융그룹', symbol: 'SHF', sector: '금융', price: 45000, floor_price: 200 },
  { name: '카카오뱅커', symbol: 'KKB', sector: '금융', price: 26000, floor_price: 100 },

  { name: '대한하늘항공', symbol: 'KAL', sector: '항공/조선', price: 21500, floor_price: 100 },
  { name: '대오조선해양', symbol: 'DWS', sector: '항공/조선', price: 31000, floor_price: 100 },
  { name: '한진해운코리아', symbol: 'HJS', sector: '항공/조선', price: 18000, floor_price: 100 },

  { name: 'SK에너지', symbol: 'SKN', sector: '에너지/화학', price: 142000, floor_price: 300 },
  { name: '한화케미칼텍', symbol: 'HWC', sector: '에너지/화학', price: 33000, floor_price: 100 },
  { name: '포항스틸', symbol: 'POS', sector: '에너지/화학', price: 285000, floor_price: 300 },

  // 동전주/작전주 — 상장폐지 체험용 (극단적 변동성, floor_price가 시작가 대비 높아 쉽게 상폐)
  { name: '가즈아바이오', symbol: 'GZB', sector: '테마/작전주', price: 650, floor_price: 100, risk_tier: 'penny' },
  { name: '대박코인게임즈', symbol: 'DBC', sector: '테마/작전주', price: 480, floor_price: 80, risk_tier: 'penny' },
];

function seedStocks() {
  const insert = db.prepare(
    'INSERT INTO stocks (name, symbol, sector, price, floor_price, risk_tier) VALUES (@name, @symbol, @sector, @price, @floor_price, @risk_tier)'
  );
  db.exec('BEGIN');
  try {
    for (const row of STOCKS) {
      insert.run({ risk_tier: 'normal', ...row });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function resetAll() {
  db.exec('BEGIN');
  try {
    db.exec(`
      DELETE FROM transactions;
      DELETE FROM price_history;
      DELETE FROM news_events;
      DELETE FROM holdings;
      DELETE FROM students;
      DELETE FROM stocks;
      UPDATE game_state SET is_trading_active = 1, round_ends_at = NULL WHERE id = 1;
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  seedStocks();
}

function ensureSeeded() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM stocks').get().c;
  if (count === 0) {
    seedStocks();
  }
}

module.exports = { STOCKS, seedStocks, resetAll, ensureSeeded };
