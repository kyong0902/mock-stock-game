const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, 'game.db'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT UNIQUE NOT NULL,
  cash REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  bankrupt_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  symbol TEXT UNIQUE NOT NULL,
  sector TEXT NOT NULL,
  price REAL NOT NULL,
  floor_price REAL NOT NULL,
  is_delisted INTEGER NOT NULL DEFAULT 0,
  risk_tier TEXT NOT NULL DEFAULT 'normal'
);

CREATE TABLE IF NOT EXISTS holdings (
  student_id INTEGER NOT NULL,
  stock_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  avg_buy_price REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (student_id, stock_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  stock_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price REAL NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_history (
  stock_id INTEGER NOT NULL,
  price REAL NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  message TEXT NOT NULL,
  price_impact_percent REAL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  is_trading_active INTEGER NOT NULL DEFAULT 1,
  tick_interval_sec INTEGER NOT NULL DEFAULT 6,
  event_interval_sec INTEGER NOT NULL DEFAULT 25,
  event_frequency REAL NOT NULL DEFAULT 1.0,
  round_ends_at TEXT
);
`);

// 기존에 만들어진 game.db에는 round_ends_at 컬럼이 없을 수 있어 안전하게 추가
try {
  db.exec('ALTER TABLE game_state ADD COLUMN round_ends_at TEXT');
} catch (e) {
  // 이미 컬럼이 존재하면 무시
}

const gameStateRow = db.prepare('SELECT * FROM game_state WHERE id = 1').get();
if (!gameStateRow) {
  db.prepare(
    'INSERT INTO game_state (id, is_trading_active, tick_interval_sec, event_interval_sec, event_frequency, round_ends_at) VALUES (1, 1, 6, 25, 1.0, NULL)'
  ).run();
}

module.exports = db;
