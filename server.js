require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./db');
const { ensureSeeded, resetAll } = require('./seed');
const engine = require('./engine');
const queries = require('./queries');

ensureSeeded();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const START_CASH = Number(process.env.START_CASH || 1000000);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }
  next();
}

// ---- REST API ----

app.post('/api/join', (req, res) => {
  const nickname = String(req.body.nickname || '').trim().slice(0, 20);
  if (!nickname) return res.status(400).json({ error: '닉네임을 입력해주세요.' });

  let student = db.prepare('SELECT * FROM students WHERE nickname = ?').get(nickname);
  if (!student) {
    const info = db.prepare('INSERT INTO students (nickname, cash) VALUES (?, ?)').run(nickname, START_CASH);
    student = db.prepare('SELECT * FROM students WHERE id = ?').get(info.lastInsertRowid);
  }
  res.json({ studentId: student.id, status: student.status });
});

app.get('/api/state', (req, res) => {
  res.json({
    stocks: queries.getStocks(),
    gameState: { ...queries.getGameState(), session_started_at: new Date(gameStartedAt).toISOString() },
    leaderboard: queries.getLeaderboard(),
  });
});

app.get('/api/portfolio/:id', (req, res) => {
  const portfolio = queries.getPortfolio(Number(req.params.id));
  if (!portfolio) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
  res.json(portfolio);
});

app.get('/api/news', (req, res) => {
  res.json(db.prepare('SELECT * FROM news_events ORDER BY id DESC LIMIT 30').all());
});

app.get('/api/results', (req, res) => {
  res.json({ leaderboard: queries.getLeaderboard(), gameState: queries.getGameState() });
});

// ---- Admin API ----

app.post('/api/admin/login', requireAdmin, (req, res) => res.json({ ok: true }));

app.get('/api/admin/students', requireAdmin, (req, res) => {
  res.json(queries.getLeaderboard());
});

app.post('/api/admin/toggle-trading', requireAdmin, (req, res) => {
  const state = queries.getGameState();
  db.prepare('UPDATE game_state SET is_trading_active = ? WHERE id = 1').run(state.is_trading_active ? 0 : 1);
  const next = queries.getGameState();
  io.emit('gameStateUpdate', next);
  res.json(next);
});

app.post('/api/admin/set-speed', requireAdmin, (req, res) => {
  const { tickIntervalSec, eventIntervalSec } = req.body;
  if (tickIntervalSec) db.prepare('UPDATE game_state SET tick_interval_sec = ? WHERE id = 1').run(Number(tickIntervalSec));
  if (eventIntervalSec) db.prepare('UPDATE game_state SET event_interval_sec = ? WHERE id = 1').run(Number(eventIntervalSec));
  const next = queries.getGameState();
  io.emit('gameStateUpdate', next);
  res.json(next);
});

app.post('/api/admin/trigger-event', requireAdmin, (req, res) => {
  const { kind, stockId } = req.body;
  engine.manualEvent(io, { kind, stockId });
  res.json({ ok: true });
});

function endGame() {
  db.prepare('UPDATE game_state SET is_trading_active = 0, round_ends_at = NULL WHERE id = 1').run();
  const leaderboard = queries.getLeaderboard();
  io.emit('gameStateUpdate', queries.getGameState());
  io.emit('gameEnded', { leaderboard });
  return leaderboard;
}

app.post('/api/admin/end-game', requireAdmin, (req, res) => {
  const leaderboard = endGame();
  res.json({ ok: true, leaderboard });
});

app.post('/api/admin/start-round', requireAdmin, (req, res) => {
  const minutes = Number(req.body.minutes);
  if (!minutes || minutes <= 0) {
    return res.status(400).json({ error: '올바른 분(minutes) 값을 입력해주세요.' });
  }
  const roundEndsAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  db.prepare('UPDATE game_state SET is_trading_active = 1, round_ends_at = ? WHERE id = 1').run(roundEndsAt);
  const next = queries.getGameState();
  io.emit('gameStateUpdate', next);
  res.json(next);
});

app.post('/api/admin/cancel-timer', requireAdmin, (req, res) => {
  db.prepare('UPDATE game_state SET round_ends_at = NULL WHERE id = 1').run();
  const next = queries.getGameState();
  io.emit('gameStateUpdate', next);
  res.json(next);
});

app.post('/api/admin/reset', requireAdmin, (req, res) => {
  resetAll();
  engine.resetPennyState();
  gameStartedAt = Date.now();
  io.emit('gameReset');
  res.json({ ok: true });
});

// ---- Socket.IO ----

const socketToStudent = new Map();

io.on('connection', (socket) => {
  socket.on('join', (studentId) => {
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    if (!student) return;
    socketToStudent.set(socket.id, student.id);
    socket.join(`student:${student.id}`);
    socket.emit('portfolioUpdate', queries.getPortfolio(student.id));
  });

  socket.on('trade', ({ type, stockId, quantity }) => {
    const studentId = socketToStudent.get(socket.id);
    if (!studentId) return;
    const qty = Math.max(1, Math.floor(Number(quantity) || 0));

    const state = queries.getGameState();
    if (!state.is_trading_active) {
      socket.emit('tradeError', { message: '현재 거래가 중지되어 있습니다.' });
      return;
    }

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    if (!student || student.status === 'bankrupt') {
      socket.emit('tradeError', { message: '이미 파산한 계정입니다.' });
      return;
    }

    const stock = db.prepare('SELECT * FROM stocks WHERE id = ?').get(stockId);
    if (!stock || stock.is_delisted) {
      socket.emit('tradeError', { message: '거래할 수 없는 종목입니다.' });
      return;
    }

    const holding = db.prepare('SELECT * FROM holdings WHERE student_id = ? AND stock_id = ?').get(studentId, stockId);

    if (type === 'buy') {
      const cost = stock.price * qty;
      if (cost > student.cash) {
        socket.emit('tradeError', { message: '현금이 부족합니다.' });
        return;
      }
      db.prepare('UPDATE students SET cash = cash - ? WHERE id = ?').run(cost, studentId);
      if (holding) {
        const newQty = holding.quantity + qty;
        const newAvg = (holding.avg_buy_price * holding.quantity + cost) / newQty;
        db.prepare('UPDATE holdings SET quantity = ?, avg_buy_price = ? WHERE student_id = ? AND stock_id = ?').run(
          newQty, newAvg, studentId, stockId
        );
      } else {
        db.prepare('INSERT INTO holdings (student_id, stock_id, quantity, avg_buy_price) VALUES (?, ?, ?, ?)').run(
          studentId, stockId, qty, stock.price
        );
      }
      db.prepare('INSERT INTO transactions (student_id, stock_id, type, quantity, price) VALUES (?, ?, ?, ?, ?)').run(
        studentId, stockId, 'buy', qty, stock.price
      );
    } else if (type === 'sell') {
      if (!holding || holding.quantity < qty) {
        socket.emit('tradeError', { message: '보유 수량이 부족합니다.' });
        return;
      }
      db.prepare('UPDATE students SET cash = cash + ? WHERE id = ?').run(stock.price * qty, studentId);
      db.prepare('UPDATE holdings SET quantity = ? WHERE student_id = ? AND stock_id = ?').run(
        holding.quantity - qty, studentId, stockId
      );
      db.prepare('INSERT INTO transactions (student_id, stock_id, type, quantity, price) VALUES (?, ?, ?, ?, ?)').run(
        studentId, stockId, 'sell', qty, stock.price
      );
    } else {
      return;
    }

    socket.emit('portfolioUpdate', queries.getPortfolio(studentId));
    io.emit('leaderboardData', queries.getLeaderboard());
    engine.evaluateBankruptcy(io, studentId, stock.risk_tier === 'penny');
  });

  socket.on('requestPortfolio', () => {
    const studentId = socketToStudent.get(socket.id);
    if (!studentId) return;
    socket.emit('portfolioUpdate', queries.getPortfolio(studentId));
  });

  socket.on('disconnect', () => {
    socketToStudent.delete(socket.id);
  });
});

// marketUpdate 브로드캐스트 시 개별 학생 포트폴리오도 함께 갱신해 클라이언트가 최신 평가금액을 보게 함
const originalMarketEmit = io.emit.bind(io);
io.emit = function patchedEmit(event, ...args) {
  const result = originalMarketEmit(event, ...args);
  if (event === 'marketUpdate') {
    for (const [socketId, studentId] of socketToStudent.entries()) {
      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) {
        targetSocket.emit('portfolioUpdate', queries.getPortfolio(studentId));
      }
    }
  }
  return result;
};

// ---- 시뮬레이션 루프 (관리자가 속도를 바꾸면 다음 사이클부터 반영) ----

function scheduleTick() {
  const state = queries.getGameState();
  setTimeout(() => {
    try {
      engine.tickPrices(io);
    } finally {
      scheduleTick();
    }
  }, Math.max(2, state.tick_interval_sec) * 1000);
}

// 게임(서버)이 시작된 뒤 처음 90초 동안은 뉴스 이벤트가 뜨지 않고,
// 그 이후부터 event_interval_sec 주기로 자동 발생함 (전체 초기화 시 다시 90초 대기)
const FIRST_EVENT_DELAY_SEC = 90;
let gameStartedAt = Date.now();

function scheduleEvent() {
  const state = queries.getGameState();
  const elapsedSec = (Date.now() - gameStartedAt) / 1000;
  const delaySec =
    elapsedSec < FIRST_EVENT_DELAY_SEC
      ? Math.max(1, FIRST_EVENT_DELAY_SEC - elapsedSec)
      : Math.max(5, state.event_interval_sec);
  setTimeout(() => {
    try {
      engine.runEventCycle(io);
    } finally {
      scheduleEvent();
    }
  }, delaySec * 1000);
}

// 타이머로 설정한 라운드 종료 시각이 지나면 자동으로 게임 종료 처리
setInterval(() => {
  const state = queries.getGameState();
  if (state.is_trading_active && state.round_ends_at) {
    if (new Date(state.round_ends_at).getTime() <= Date.now()) {
      endGame();
    }
  }
}, 1000);

scheduleTick();
scheduleEvent();

server.listen(PORT, () => {
  console.log(`모의주식투자 서버 실행 중: http://localhost:${PORT}`);
});
