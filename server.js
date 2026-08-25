const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));
app.use(express.static(path.join(__dirname, "public")));

const users = new Map();
const captchaStore = new Map();

function getUser(req) {
  return req.session.user ? users.get(req.session.user) : null;
}

function auth(req, res, next) {
  if (!getUser(req)) return res.status(401).json({ error: "Chưa đăng nhập" });
  next();
}

function makeCaptcha() {
  const a = crypto.randomInt(1, 10);
  const b = crypto.randomInt(1, 10);
  const id = crypto.randomUUID();
  captchaStore.set(id, { answer: String(a + b), expires: Date.now() + 5 * 60 * 1000 });
  return { id, question: `${a} + ${b} = ?` };
}

app.post("/api/register", (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: "Username không hợp lệ" });
  if (users.has(username)) return res.status(409).json({ error: "Username đã tồn tại" });
  users.set(username, { username, coins: 0, lastClaim: 0, history: [], bot: { status: "offline", uptime: 0 } });
  req.session.user = username;
  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  if (!users.has(username)) return res.status(404).json({ error: "Không tìm thấy tài khoản" });
  req.session.user = username;
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get("/api/me", auth, (req, res) => {
  const u = getUser(req);
  res.json({ username: u.username, coins: u.coins, lastClaim: u.lastClaim, history: u.history.slice(-20).reverse(), bot: u.bot });
});

app.get("/api/captcha", auth, (req, res) => res.json(makeCaptcha()));

app.post("/api/claim", auth, (req, res) => {
  const u = getUser(req);
  const { captchaId, answer } = req.body;
  const c = captchaStore.get(captchaId);
  if (!c || c.expires < Date.now()) return res.status(400).json({ error: "CAPTCHA hết hạn" });
  captchaStore.delete(captchaId);
  if (String(answer).trim() !== c.answer) return res.status(400).json({ error: "CAPTCHA sai" });

  const day = 24 * 60 * 60 * 1000;
  if (Date.now() - u.lastClaim < day) {
    const left = day - (Date.now() - u.lastClaim);
    return res.status(429).json({ error: `Bạn đã claim. Còn ${Math.ceil(left / 3600000)} giờ.` });
  }
  const amount = 100;
  u.coins += amount;
  u.lastClaim = Date.now();
  u.history.push({ amount, type: "claim", time: Date.now() });
  res.json({ ok: true, amount, coins: u.coins });
});

// Demo bot controls. Replace these handlers with your real hosting API.
app.post("/api/bot/:action", auth, (req, res) => {
  const u = getUser(req);
  const action = req.params.action;
  if (!["start", "stop", "restart"].includes(action)) return res.status(400).json({ error: "Action không hợp lệ" });

  if (action === "start") u.bot.status = "online";
  if (action === "stop") u.bot.status = "offline";
  if (action === "restart") u.bot.status = "restarting";

  setTimeout(() => {
    if (action === "restart") u.bot.status = "online";
  }, 1000);

  res.json({ ok: true, status: u.bot.status });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`Legacy Dashboard running on http://localhost:${PORT}`));
