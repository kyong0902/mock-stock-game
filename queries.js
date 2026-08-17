const db = require('./db');

function serializeStock(s) {
  return {
    id: s.id,
    name: s.name,
    symbol: s.symbol,
    sector: s.sector,
    price: s.price,
    isDelisted: !!s.is_delisted,
    riskTier: s.risk_tier,
  };
}

function getStocks() {
  return db.prepare('SELECT * FROM stocks ORDER BY sector, name').all().map(serializeStock);
}

function getGameState() {
  return db.prepare('SELECT * FROM game_state WHERE id = 1').get();
}

function computeTotalAssets(studentId) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) return 0;
  const rows = db
    .prepare(
      `SELECT h.quantity, s.price FROM holdings h
       JOIN stocks s ON s.id = h.stock_id
       WHERE h.student_id = ? AND h.quantity > 0 AND s.is_delisted = 0`
    )
    .all(studentId);
  const holdingsValue = rows.reduce((sum, r) => sum + r.quantity * r.price, 0);
  return student.cash + holdingsValue;
}

function getPortfolio(studentId) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) return null;
  const holdings = db
    .prepare(
      `SELECT h.stock_id, h.quantity, h.avg_buy_price, s.name, s.symbol, s.price, s.is_delisted
       FROM holdings h JOIN stocks s ON s.id = h.stock_id
       WHERE h.student_id = ? AND h.quantity > 0`
    )
    .all(studentId);
  const holdingsValue = holdings.reduce((sum, h) => (h.is_delisted ? sum : sum + h.quantity * h.price), 0);
  return {
    id: student.id,
    nickname: student.nickname,
    cash: student.cash,
    status: student.status,
    holdings,
    holdingsValue,
    totalAssets: student.cash + holdingsValue,
  };
}

function getLeaderboard() {
  const students = db.prepare('SELECT * FROM students').all();
  const rows = students.map((s) => ({
    nickname: s.nickname,
    status: s.status,
    totalAssets: s.status === 'bankrupt' ? 0 : computeTotalAssets(s.id),
  }));
  rows.sort((a, b) => b.totalAssets - a.totalAssets);
  return rows;
}

module.exports = { getStocks, getGameState, getPortfolio, getLeaderboard, computeTotalAssets, serializeStock };
