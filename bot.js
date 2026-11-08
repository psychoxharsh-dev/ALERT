require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID || "-1004492353381";
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL || "";
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.log("❌ BOT_TOKEN missing in .env");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ============================================================
// LOGS
// ============================================================
const logs = [];
function log(...a) {
  const line = `${getIndianTime()}  ${a.join(" ")}`;
  console.log(line);
  logs.push(line);
  if (logs.length > 60) logs.shift();
}
bot.on("polling_error", (e) => log("Polling error:", e.message));

// ============================================================
// SETTINGS
// ============================================================
// Run Time  = Track Time - (runGapMin minutes + random 0..runGapRand seconds)
// 2nd msg   = after (secondDelayMin minutes + random 0..secondDelayRand seconds)
function makeSettings(over) {
  return Object.assign(
    {
      running: false,
      busy: false,
      timer: null,
      userLastUsed: {},
      messageCount: 0,
      secondCount: 0,
      firstMsg: true,
      secondMsg: true,
      messagesPerMinute: 3,
      firstAmount: "0.1",
      secondAmount: "4",
      runGapMin: 2,
      runGapRand: 60,
      secondDelayMin: 5,
      secondDelayRand: 60,
      offerName: "It's fake, not real",
      // hidden (panel me nahi dikhte)
      repeatTimeMin: 300,
      repeatTimeMax: 360,
    },
    over
  );
}

const BOTS = {
  1: { s: makeSettings({ secondAmount: "4" }), name: "Bot1" },
  2: { s: makeSettings({ secondAmount: "5", messagesPerMinute: 10 }), name: "Bot2" },
};

const FIELDS = {
  messagesPerMinute: { min: 1, max: 20, int: true },
  runGapMin: { min: 0, max: 1440, int: true },
  runGapRand: { min: 0, max: 3600, int: true },
  secondDelayMin: { min: 0, max: 1440, int: true },
  secondDelayRand: { min: 0, max: 3600, int: true },
  firstAmount: { amount: true },
  secondAmount: { amount: true },
  firstMsg: { bool: true },
  secondMsg: { bool: true },
  offerName: { text: true },
};

// ============================================================
// HELPERS
// ============================================================
function getIndianTime(date) {
  const d = date || new Date();
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (max) => Math.floor(Math.random() * (max + 1));
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function generateRandomUserId(map, s) {
  const now = Date.now();
  const repeatUsers = Object.keys(map).filter((uid) => {
    const diff = (now - map[uid]) / 1000;
    return diff >= s.repeatTimeMin && diff <= s.repeatTimeMax;
  });
  if (repeatUsers.length && Math.random() <= 0.4) {
    const uid = repeatUsers[Math.floor(Math.random() * repeatUsers.length)];
    map[uid] = now;
    return uid;
  }
  while (true) {
    const first4 = Math.floor(Math.random() * 4000 + 6000);
    const last4 = Math.floor(Math.random() * 9000 + 1000);
    const uid = `${first4}****${last4}`;
    if (!map[uid]) {
      map[uid] = now;
      return uid;
    }
  }
}

// Offer name panel se badalta hai. Neeche ki TEST warning line fixed hai.
const DISCLAIMER = "<b>⚠️ Test message - not a real payment</b>";

function buildMessage1(s, userId, amount, runTime, trackTime) {
  return `<b>Conversation Count 💝</b>

<b>🎁 Offer Name - HAPPY YOU</b>

<b>User Id : ${userId}</b>
<b>User Amount : ₹${amount}</b>
<b>🥳 User Payment : Success</b>

<b>Run Time - ${runTime}</b>
<b>Track Time - ${trackTime}</b>

<b>Powered By - CashFlix</b>`;
}

function buildMessage2(s, userId, amount, runTime, trackTime) {
  return `<b>🔥 New Offer 💝</b>

<b>🎁 Offer Name - ${esc(s.offerName)}</b>

<b>User Id :</b> ${userId}
<b>User Amount :</b> 💰 <b>₹${amount}</b>
<b>🥳 User Payment :</b> Success ✅

<b>Run Time -</b> ${runTime}
<b>Track Time -</b> ${trackTime}

<b>Powered By - CashFlix</b>`;
}

const BUILDERS = { 1: buildMessage1, 2: buildMessage2 };

// ============================================================
// SENDING
// ============================================================
function sendSecondMessage(id, userId, runTime) {
  const { s, name } = BOTS[id];
  const delaySec = s.secondDelayMin * 60 + rand(s.secondDelayRand);
  log(`⏳ ${name} second msg for ${userId} in ${delaySec}s`);
  setTimeout(() => {
    if (!s.secondMsg) return;
    bot
      .sendMessage(CHANNEL_ID, BUILDERS[id](s, userId, s.secondAmount, runTime, getIndianTime()), {
        parse_mode: "HTML",
      })
      .then(() => {
        s.secondCount++;
        log(`✅ ${name} second ₹${s.secondAmount} -> ${userId}`);
      })
      .catch((e) => log(`❌ ${name} second error: ${e.message}`));
  }, delaySec * 1000);
}

async function sendFirstMessage(id, userId, runTime, trackTime) {
  const { s, name } = BOTS[id];
  if (!s.firstMsg) return false;
  try {
    await bot.sendMessage(
      CHANNEL_ID,
      BUILDERS[id](s, userId, s.firstAmount, runTime, trackTime),
      { parse_mode: "HTML" }
    );
    s.messageCount++;
    log(`✅ ${name} first ₹${s.firstAmount} -> ${userId}`);
    return true;
  } catch (e) {
    log(`❌ ${name} send error: ${e.message}`);
    if (String(e.message).includes("429")) await sleep(5000);
    return false;
  }
}

async function sendOne(id) {
  const { s } = BOTS[id];
  const userId = generateRandomUserId(s.userLastUsed, s);
  const gapSec = s.runGapMin * 60 + rand(s.runGapRand);
  const trackDate = new Date();
  const runTime = getIndianTime(new Date(trackDate.getTime() - gapSec * 1000));
  const trackTime = getIndianTime(trackDate);
  const ok = await sendFirstMessage(id, userId, runTime, trackTime);
  if (ok && s.secondMsg) sendSecondMessage(id, userId, runTime);
  return ok;
}

async function tick(id) {
  const { s } = BOTS[id];
  if (s.busy) return;
  s.busy = true;
  try {
    const gap = Math.floor(60000 / s.messagesPerMinute);
    for (let i = 0; i < s.messagesPerMinute; i++) {
      if (!s.running) break;
      await sendOne(id);
      await sleep(gap);
    }
  } finally {
    s.busy = false;
  }
}

async function channelCheck() {
  try {
    const me = await bot.getMe();
    await bot.getChatMember(CHANNEL_ID, me.id);
    return null;
  } catch (e) {
    return `Channel check failed: ${e.message}`;
  }
}

async function startBot(id) {
  const { s, name } = BOTS[id];
  if (s.running) return "Already running";
  const err = await channelCheck();
  if (err) return err;
  s.running = true;
  s.messageCount = 0;
  s.secondCount = 0;
  s.userLastUsed = {};
  log(`🚀 ${name} started - ${s.messagesPerMinute} msgs/min`);
  tick(id);
  s.timer = setInterval(() => tick(id), 60000);
  return null;
}

function stopBot(id) {
  const { s, name } = BOTS[id];
  s.running = false;
  if (s.timer) {
    clearInterval(s.timer);
    s.timer = null;
  }
  log(`🛑 ${name} stopped. First: ${s.messageCount} | Second: ${s.secondCount}`);
}

function publicState(id) {
  const s = BOTS[id].s;
  return {
    running: s.running,
    messageCount: s.messageCount,
    secondCount: s.secondCount,
    users: Object.keys(s.userLastUsed).length,
    firstMsg: s.firstMsg,
    secondMsg: s.secondMsg,
    messagesPerMinute: s.messagesPerMinute,
    firstAmount: s.firstAmount,
    secondAmount: s.secondAmount,
    runGapMin: s.runGapMin,
    runGapRand: s.runGapRand,
    secondDelayMin: s.secondDelayMin,
    secondDelayRand: s.secondDelayRand,
    offerName: s.offerName,
  };
}

// ============================================================
// TELEGRAM COMMANDS
// ============================================================
bot.onText(/^\/start$/, (msg) => {
  bot.sendMessage(msg.chat.id, `👋 Control panel ke liye /app dabao.\nTumhari Telegram ID: ${msg.from.id}`);
});

bot.onText(/^\/app$/, (msg) => {
  if (!WEBAPP_URL) {
    return bot.sendMessage(msg.chat.id, "❌ WEBAPP_URL set nahi hai (https://... wala link).");
  }
  bot.sendMessage(msg.chat.id, "🎛 Control Panel kholo:", {
    reply_markup: {
      inline_keyboard: [[{ text: "Open Mini App", web_app: { url: WEBAPP_URL } }]],
    },
  });
});

bot.onText(/^\/test$/, async (msg) => {
  const err = await startBot(1);
  bot.sendMessage(msg.chat.id, err ? `⚠️ ${err}` : "✅ Bot 1 Started!");
});
bot.onText(/^\/test 2$/, async (msg) => {
  const err = await startBot(2);
  bot.sendMessage(msg.chat.id, err ? `⚠️ ${err}` : "✅ Bot 2 Started!");
});
bot.onText(/^\/stop$/, (msg) => {
  stopBot(1);
  bot.sendMessage(msg.chat.id, "🛑 Bot 1 Stopped.");
});
bot.onText(/^\/stop 2$/, (msg) => {
  stopBot(2);
  bot.sendMessage(msg.chat.id, "🛑 Bot 2 Stopped.");
});

// ============================================================
// WEB SERVER + MINI APP API
// ============================================================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function validateInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (calc !== hash) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (Date.now() / 1000 - authDate > 86400) return null;
  try {
    return JSON.parse(params.get("user"));
  } catch {
    return null;
  }
}

function auth(req, res, next) {
  const user = validateInitData(req.get("X-Init-Data"));
  if (!user) return res.status(401).json({ error: "Telegram ke andar se Mini App kholo." });
  if (!ADMIN_IDS.includes(String(user.id))) {
    return res.status(403).json({
      error: `Access nahi hai. Tumhari ID ${user.id} hai - ise ADMIN_IDS me add karo.`,
    });
  }
  req.user = user;
  next();
}

app.get("/health", (req, res) => res.send("🤖 Bot is running!"));

app.use("/api", auth);

app.get("/api/state", (req, res) => {
  res.json({
    time: getIndianTime(),
    bots: { 1: publicState(1), 2: publicState(2) },
    logs: logs.slice(-40),
  });
});

app.post("/api/bot/:id/start", async (req, res) => {
  const id = req.params.id;
  if (!BOTS[id]) return res.status(404).json({ error: "Bot not found" });
  const err = await startBot(id);
  res.json({ ok: !err, error: err });
});

app.post("/api/bot/:id/stop", (req, res) => {
  const id = req.params.id;
  if (!BOTS[id]) return res.status(404).json({ error: "Bot not found" });
  stopBot(id);
  res.json({ ok: true });
});

app.post("/api/bot/:id/send-one", async (req, res) => {
  const id = req.params.id;
  if (!BOTS[id]) return res.status(404).json({ error: "Bot not found" });
  const err = await channelCheck();
  if (err) return res.json({ ok: false, error: err });
  const ok = await sendOne(id);
  res.json({ ok, error: ok ? null : "Send failed - logs dekho" });
});

app.post("/api/bot/:id/settings", (req, res) => {
  const id = req.params.id;
  if (!BOTS[id]) return res.status(404).json({ error: "Bot not found" });
  const s = BOTS[id].s;
  const body = req.body || {};
  const next = {};

  for (const [key, rule] of Object.entries(FIELDS)) {
    if (!(key in body)) continue;
    const v = body[key];
    if (rule.bool) {
      next[key] = !!v;
    } else if (rule.text) {
      const t = String(v).trim().slice(0, 60);
      if (!t) return res.json({ ok: false, error: "Offer name khali nahi ho sakta" });
      next[key] = t;
    } else if (rule.amount) {
      const n = Number(v);
      if (!isFinite(n) || n < 0 || n > 1000000) return res.json({ ok: false, error: `${key} galat hai` });
      next[key] = String(n);
    } else {
      const n = Number(v);
      if (!isFinite(n)) return res.json({ ok: false, error: `${key} number hona chahiye` });
      next[key] = Math.min(rule.max, Math.max(rule.min, rule.int ? Math.round(n) : n));
    }
  }

  Object.assign(s, next);
  log(`⚙️ ${BOTS[id].name} settings updated`);
  res.json({ ok: true, state: publicState(id) });
});

app.listen(PORT, () => log(`🌐 Web server on port ${PORT}`));
log("🤖 Bot Started...");
if (!ADMIN_IDS.length) log("⚠️ ADMIN_IDS empty - Mini App access band hai. /start se apni ID dekho.");
