/**
 * Email OTP endpoints for the auth pages (/auth.html).
 *
 *   POST /api/otp/send    { email }            -> generates a 6-digit code
 *   POST /api/otp/verify  { email, code }      -> checks it
 *
 * Delivery is pluggable:
 *   - RESEND_API_KEY set    -> sent via Resend
 *   - SENDGRID_API_KEY set  -> sent via SendGrid
 *   - neither               -> the code is printed to the server log so the
 *     full flow stays testable until an email provider is configured.
 *
 * Codes live in memory only (single-instance deploy), expire after 10
 * minutes, and allow 5 verify attempts. Sends are capped at 5 per email
 * per 10-minute window on top of the global /api rate limit.
 */

const express = require("express");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const CODE_TTL_MS = 10 * 60 * 1000;
const SEND_WINDOW_MS = 10 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_VERIFY_ATTEMPTS = 5;

/** email -> { code, expiresAt, attempts, sentCount, windowStart } */
const store = new Map();

const sendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: false,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again in a few minutes." },
});

const verifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: false,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in a few minutes." },
});

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function fromAddress() {
  return process.env.OTP_FROM_EMAIL || "Legally Unbullied <no-reply@legallyunbullied.app>";
}

async function deliver(email, code) {
  const subject = "Your Legally Unbullied verification code";
  const text =
    `Your Legally Unbullied verification code is ${code}. ` +
    `It expires in 10 minutes. If you did not request it, ignore this email.`;

  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromAddress(), to: [email], subject, text }),
    });
    if (!res.ok) throw new Error(`resend responded ${res.status}`);
    return "resend";
  }

  if (process.env.SENDGRID_API_KEY) {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: (process.env.OTP_FROM_EMAIL || "no-reply@legallyunbullied.app") },
        subject,
        content: [{ type: "text/plain", value: text }],
      }),
    });
    if (!res.ok && res.status !== 202) throw new Error(`sendgrid responded ${res.status}`);
    return "sendgrid";
  }

  // No provider configured: keep the flow testable via the server log.
  console.log(`[otp] no email provider configured - code for ${email}: ${code}`);
  return "log";
}

router.post("/send", sendLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  const now = Date.now();
  const existing = store.get(email);
  if (existing && now - existing.windowStart < SEND_WINDOW_MS && existing.sentCount >= MAX_SENDS_PER_WINDOW) {
    return res.status(429).json({ error: "Too many codes sent. Try again in a few minutes." });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  store.set(email, {
    code,
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
    sentCount: existing && now - existing.windowStart < SEND_WINDOW_MS ? existing.sentCount + 1 : 1,
    windowStart: existing && now - existing.windowStart < SEND_WINDOW_MS ? existing.windowStart : now,
  });

  try {
    const via = await deliver(email, code);
    return res.json({ ok: true, deliveredVia: via });
  } catch (err) {
    console.error("[otp] delivery failed:", err.message);
    store.delete(email);
    return res.status(502).json({ error: "We couldn't send the code right now. Try again shortly." });
  }
});

router.post("/verify", verifyLimiter, (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Enter the 6-digit code from your email." });
  }

  const entry = store.get(email);
  if (!entry || Date.now() > entry.expiresAt) {
    store.delete(email);
    return res.status(400).json({ error: "That code has expired. Request a new one." });
  }
  if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
    store.delete(email);
    return res.status(400).json({ error: "Too many incorrect tries. Request a new code." });
  }

  entry.attempts += 1;
  if (entry.code !== code) {
    return res.status(400).json({ error: "That code doesn't match. Check the email and try again." });
  }

  store.delete(email);
  return res.json({ ok: true });
});

module.exports = router;
