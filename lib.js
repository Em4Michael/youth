'use strict';
const crypto = require('crypto');

const TZ = process.env.TZ_NAME || 'Africa/Lagos';
const NETWORKS = ['MTN', 'Airtel', 'Glo', '9mobile', 'Other'];

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });

/** YYYY-MM-DD for an instant, in the app's time zone. */
const dayOf = (d = new Date()) => dayFmt.format(d);
const hourOf = (d) => parseInt(hourFmt.format(d), 10) % 24;

function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dateRange(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
/** Monday = 0 … Sunday = 6 */
const weekdayIdx = (day) => (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;

const validDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) ? s : null);
const validMonth = (s) => (typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null);

/** The 2nd, 3rd and 4th Fridays of a month ('YYYY-MM'). */
function eventFridays(ym) {
  const [y, m] = ym.split('-').map(Number);
  const out = [];
  let n = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) break;
    if (dt.getUTCDay() === 5) {
      n++;
      if (n >= 2 && n <= 4) out.push(dt.toISOString().slice(0, 10));
    }
  }
  return out;
}
const isEventDate = (date) => eventFridays(date.slice(0, 7)).includes(date);
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function normPhone(raw) {
  let p = String(raw || '').replace(/[\s\-().]/g, '');
  if (p.startsWith('+234') && p.length === 14) p = '0' + p.slice(4);
  else if (p.startsWith('234') && p.length === 13) p = '0' + p.slice(3);
  if (/^0\d{10}$/.test(p)) return p; // Nigerian format
  if (/^\+\d{8,15}$/.test(p)) return p; // other international
  return null;
}
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^\+?\d[\d\s]*$/.test(s)) s = "'" + s; // block spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/* ---------- passwords & tokens ---------- */
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function verifyPassword(pw, salt, hash) {
  const a = Buffer.from(crypto.scryptSync(pw, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');
function newSlug() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs * 2).unref();
  return (req, res, next) => {
    const now = Date.now();
    const arr = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    arr.push(now);
    hits.set(req.ip, arr);
    next();
  };
}

module.exports = {
  TZ, NETWORKS, dayOf, hourOf, addDays, dateRange, weekdayIdx, validDate, validMonth,
  eventFridays, isEventDate, shiftMonth, normPhone, cleanText, toCsv,
  hashPassword, verifyPassword, sha256, newToken, newSlug, limiter,
};
