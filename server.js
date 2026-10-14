'use strict';
const express = require('express');
const path = require('path');
const db = require('./db');
const L = require('./lib');
const { buildAnalytics } = require('./analytics');

const PORT = Number(process.env.PORT) || 3000;
const ALLOW_REGISTRATION = (process.env.ALLOW_REGISTRATION || 'true').toLowerCase() !== 'false';
const SESSION_DAYS = 30;

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  });
  next();
});
app.use(express.json({ limit: '50kb' }));

/* ================= helpers ================= */
const nowIso = () => new Date().toISOString();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = req.secure || process.env.COOKIE_SECURE === 'true';
  res.append('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
}
function startSession(req, res, userId) {
  const token = L.newToken();
  const maxAge = SESSION_DAYS * 86400;
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(L.sha256(token), userId, Date.now() + maxAge * 1000);
  setSessionCookie(req, res, token, maxAge);
}
function auth(req, res, next) {
  const token = readCookie(req, 'sid');
  if (token) {
    const row = db.prepare(
      'SELECT u.id, u.username, u.display_name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?'
    ).get(L.sha256(token));
    if (row && row.expires_at > Date.now()) {
      req.user = { id: row.id, username: row.username, display_name: row.display_name, role: row.role };
      // Everyone shares the admin's workspace; role decides who may edit.
      req.ws = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get()?.id ?? row.id;
      return next();
    }
  }
  bad(res, 'Please sign in.', 401);
}
const publicUser = (u) => ({ id: u.id, username: u.username, display_name: u.display_name || u.username, role: u.role || 'viewer' });

/* ================= auth ================= */
const authLimiter = L.limiter(12, 10 * 60 * 1000);

app.get('/api/auth/config', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  res.json({ can_register: count === 0 || ALLOW_REGISTRATION, first_user: count === 0, tz: L.TZ });
});

app.post('/api/auth/register', authLimiter, (req, res) => {
  const b = req.body || {};
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0 && !ALLOW_REGISTRATION) return bad(res, 'Registration is closed.', 403);
  const username = L.cleanText(b.username, 40);
  const display = L.cleanText(b.display_name, 60) || username;
  const password = String(b.password || '');
  if (!username) return bad(res, 'Please enter a username.');
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
    return bad(res, 'Password needs a small letter, a capital letter, a number and a symbol.');
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return bad(res, 'That username is taken.', 409);
  const { salt, hash } = L.hashPassword(password);
  const role = count === 0 ? 'admin' : 'viewer';
  const id = db.prepare('INSERT INTO users (username, display_name, salt, hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(username, display, salt, hash, role, nowIso()).lastInsertRowid;
  startSession(req, res, Number(id));
  res.json({ user: publicUser({ id: Number(id), username, display_name: display, role }) });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const b = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(L.cleanText(b.username, 40));
  if (!u || !L.verifyPassword(String(b.password || ''), u.salt, u.hash)) return bad(res, 'Wrong username or password.', 401);
  startSession(req, res, u.id);
  res.json({ user: publicUser(u) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = readCookie(req, 'sid');
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(L.sha256(token));
  setSessionCookie(req, res, '', 0);
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user), tz: L.TZ, today: L.dayOf() }));

/* ================= roles ================= */
// View-only accounts can read everything but change nothing.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.path.startsWith('/auth/') || req.path.startsWith('/public/')) return next();
  auth(req, res, () => (req.user.role === 'viewer' ? bad(res, 'This is a view-only account. Ask the admin for edit access.', 403) : next()));
});
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : bad(res, 'Only the admin can manage the team.', 403));

app.get('/api/team', auth, (req, res) => {
  const rows = db.prepare("SELECT id, username, display_name, role, created_at FROM users ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, id").all();
  res.json({ me: req.user.id, can_manage: req.user.role === 'admin', members: rows.map((u) => ({ id: u.id, username: u.username, display_name: u.display_name || u.username, role: u.role, joined: u.created_at })) });
});
app.patch('/api/team/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id), role = (req.body || {}).role;
  if (!['editor', 'viewer'].includes(role)) return bad(res, 'Role must be editor or viewer.');
  const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!u) return bad(res, 'Not found.', 404);
  if (u.role === 'admin') return bad(res, "The admin's role cannot be changed.");
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  res.json({ ok: true });
});
app.delete('/api/team/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!u) return bad(res, 'Not found.', 404);
  if (u.role === 'admin') return bad(res, 'The admin account cannot be removed.');
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ================= links ================= */
function linkView(l, taken) {
  return { id: l.id, slug: l.slug, title: l.title, is_open: !!l.is_open, daily_cap: l.daily_cap, created_at: l.created_at, taken_today: taken };
}

app.get('/api/links', auth, (req, res) => {
  const today = L.dayOf();
  const rows = db.prepare('SELECT * FROM links WHERE user_id = ? AND archived = 0 ORDER BY id DESC').all(req.ws);
  const counts = new Map(db.prepare('SELECT link_id, COUNT(*) AS c FROM submissions WHERE user_id = ? AND day = ? GROUP BY link_id').all(req.ws, today).map((r) => [r.link_id, r.c]));
  res.json({ today, links: rows.map((l) => linkView(l, counts.get(l.id) || 0)) });
});

app.post('/api/links', auth, (req, res) => {
  const b = req.body || {};
  const title = L.cleanText(b.title, 80);
  const cap = b.daily_cap === undefined ? 3 : parseInt(b.daily_cap, 10);
  if (!title) return bad(res, 'Give the link a title.');
  if (!(cap >= 1 && cap <= 500)) return bad(res, 'Daily limit must be between 1 and 500.');
  let slug;
  do slug = L.newSlug(); while (db.prepare('SELECT 1 FROM links WHERE slug = ?').get(slug));
  const id = db.prepare('INSERT INTO links (user_id, slug, title, is_open, daily_cap, created_at) VALUES (?, ?, ?, 1, ?, ?)').run(req.ws, slug, title, cap, nowIso()).lastInsertRowid;
  res.json({ link: linkView(db.prepare('SELECT * FROM links WHERE id = ?').get(Number(id)), 0) });
});

app.patch('/api/links/:id', auth, (req, res) => {
  const l = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ? AND archived = 0').get(Number(req.params.id), req.ws);
  if (!l) return bad(res, 'Link not found.', 404);
  const b = req.body || {};
  let title = l.title, is_open = l.is_open, cap = l.daily_cap;
  if (b.title !== undefined) { title = L.cleanText(b.title, 80); if (!title) return bad(res, 'Title cannot be empty.'); }
  if (b.is_open !== undefined) is_open = b.is_open ? 1 : 0;
  if (b.daily_cap !== undefined) { cap = parseInt(b.daily_cap, 10); if (!(cap >= 1 && cap <= 500)) return bad(res, 'Daily limit must be between 1 and 500.'); }
  db.prepare('UPDATE links SET title = ?, is_open = ?, daily_cap = ? WHERE id = ?').run(title, is_open, cap, l.id);
  const taken = db.prepare('SELECT COUNT(*) AS c FROM submissions WHERE link_id = ? AND day = ?').get(l.id, L.dayOf()).c;
  res.json({ link: linkView(db.prepare('SELECT * FROM links WHERE id = ?').get(l.id), taken) });
});

// "Delete" archives the link: it stops working but everything it recorded is kept.
app.delete('/api/links/:id', auth, (req, res) => {
  const r = db.prepare('UPDATE links SET archived = 1, is_open = 0 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.ws);
  if (!r.changes) return bad(res, 'Link not found.', 404);
  res.json({ ok: true });
});

/* ================= public sign-up page ================= */
const submitLimiter = L.limiter(40, 10 * 60 * 1000);

function publicState(link) {
  const today = L.dayOf();
  const taken = db.prepare('SELECT COUNT(*) AS c FROM submissions WHERE link_id = ? AND day = ?').get(link.id, today).c;
  const state = !link.is_open ? 'closed' : taken >= link.daily_cap ? 'full' : 'open';
  return { title: link.title, state, cap: link.daily_cap, taken: Math.min(taken, link.daily_cap), remaining: Math.max(0, link.daily_cap - taken), networks: L.NETWORKS };
}

app.get('/api/public/:slug', (req, res) => {
  const link = db.prepare('SELECT * FROM links WHERE slug = ? AND archived = 0').get(String(req.params.slug));
  if (!link) return bad(res, 'This link does not exist.', 404);
  res.json(publicState(link));
});

app.post('/api/public/:slug/submit', submitLimiter, (req, res) => {
  const b = req.body || {};
  const name = L.cleanText(b.name, 80);
  const phone = L.normPhone(b.phone);
  const network = L.NETWORKS.includes(b.network) ? b.network : null;
  if (name.length < 2) return bad(res, 'Please enter your name.');
  if (!phone) return bad(res, 'Enter a valid phone number, e.g. 08012345678.');
  if (!network) return bad(res, 'Please choose your network provider.');

  try {
    const result = db.tx(() => {
      const link = db.prepare('SELECT * FROM links WHERE slug = ? AND archived = 0').get(String(req.params.slug));
      if (!link) return { code: 404, error: 'This link does not exist.' };
      if (!link.is_open) return { code: 409, error: 'This link is closed right now.', state: 'closed' };
      const day = L.dayOf();
      const taken = db.prepare('SELECT COUNT(*) AS c FROM submissions WHERE link_id = ? AND day = ?').get(link.id, day).c;
      if (taken >= link.daily_cap) return { code: 409, error: "Today's spots are already filled.", state: 'full' };
      db.prepare('INSERT INTO submissions (link_id, user_id, day, name, phone, network, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(link.id, link.user_id, day, name, phone, network, nowIso());
      return { code: 200, position: taken + 1, cap: link.daily_cap, title: link.title };
    });
    if (result.code !== 200) return res.status(result.code).json({ error: result.error, state: result.state });
    res.json({ ok: true, position: result.position, cap: result.cap, title: result.title });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return bad(res, 'This phone number is already recorded for today.', 409);
    console.error(e);
    bad(res, 'Something went wrong. Please try again.', 500);
  }
});

/* ================= daily records ================= */
app.get('/api/records', auth, (req, res) => {
  const date = L.validDate(req.query.date) || L.dayOf();
  const linkId = Number(req.query.link_id) || null;
  const rows = db.prepare(
    `SELECT s.id, s.name, s.phone, s.network, s.created_at, s.link_id, l.title AS link_title,
            EXISTS (SELECT 1 FROM members m WHERE m.user_id = s.user_id AND m.phone = s.phone) AS in_members
       FROM submissions s JOIN links l ON l.id = s.link_id
      WHERE s.user_id = ? AND s.day = ? ${linkId ? 'AND s.link_id = ?' : ''}
      ORDER BY s.created_at, s.id`
  ).all(...(linkId ? [req.ws, date, linkId] : [req.ws, date]));
  const counts = new Map(db.prepare('SELECT link_id, COUNT(*) AS c FROM submissions WHERE user_id = ? AND day = ? GROUP BY link_id').all(req.ws, date).map((r) => [r.link_id, r.c]));
  const links = db.prepare('SELECT id, title, is_open, daily_cap, archived FROM links WHERE user_id = ? ORDER BY id').all(req.ws)
    .filter((l) => !l.archived || counts.has(l.id))
    .map((l) => ({ id: l.id, title: l.title, is_open: !!l.is_open, cap: l.daily_cap, taken: counts.get(l.id) || 0, archived: !!l.archived }));
  res.json({ date, today: L.dayOf(), rows: rows.map((r) => ({ ...r, in_members: !!r.in_members })), links });
});

app.get('/api/records/export', auth, (req, res) => {
  const date = L.validDate(req.query.date) || L.dayOf();
  const rows = db.prepare(
    `SELECT s.name, s.phone, s.network, l.title, s.created_at FROM submissions s JOIN links l ON l.id = s.link_id
      WHERE s.user_id = ? AND s.day = ? ORDER BY s.created_at, s.id`
  ).all(req.ws, date);
  const csv = L.toCsv([['Name', 'Phone', 'Network', 'Link', 'Recorded at (UTC)'], ...rows.map((r) => [r.name, r.phone, r.network, r.title, r.created_at])]);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="records-${date}.csv"` }).send(csv);
});

const idList = (v) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 1000) : []);
const inList = (ids) => ids.map(() => '?').join(',');

app.delete('/api/records/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM submissions WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.ws);
  if (!r.changes) return bad(res, 'Record not found.', 404);
  res.json({ ok: true });
});

// Delete many records at once: either the ticked ids, or everything shown for a day (optionally one link).
app.post('/api/records/delete', auth, (req, res) => {
  const b = req.body || {};
  let deleted = 0;
  if (Array.isArray(b.ids)) {
    const ids = [...new Set(b.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 2000);
    if (!ids.length) return bad(res, 'Nothing selected.');
    db.tx(() => { for (const id of ids) deleted += db.prepare('DELETE FROM submissions WHERE id = ? AND user_id = ?').run(id, req.ws).changes; });
  } else if (L.validDate(b.date)) {
    const linkId = Number(b.link_id) || null;
    deleted = db.prepare(`DELETE FROM submissions WHERE user_id = ? AND day = ? ${linkId ? 'AND link_id = ?' : ''}`)
      .run(...(linkId ? [req.ws, b.date, linkId] : [req.ws, b.date])).changes;
  } else return bad(res, 'Nothing to delete.');
  res.json({ deleted });
});

function addToMembers(userId, subs) {
  let added = 0;
  const ins = db.prepare("INSERT OR IGNORE INTO members (user_id, name, phone, network, source, created_at) VALUES (?, ?, ?, ?, 'link', ?)");
  db.tx(() => { for (const s of subs) added += ins.run(userId, s.name, s.phone, s.network, nowIso()).changes; });
  return added;
}
app.post('/api/records/:id/add-member', auth, (req, res) => {
  const s = db.prepare('SELECT name, phone, network FROM submissions WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.ws);
  if (!s) return bad(res, 'Record not found.', 404);
  res.json({ added: addToMembers(req.ws, [s]) });
});
app.post('/api/records/add-members', auth, (req, res) => {
  const b = req.body || {};
  const date = L.validDate(b.date) || L.dayOf();
  const ids = idList(b.ids);
  const subs = ids.length
    ? db.prepare(`SELECT name, phone, network FROM submissions WHERE user_id = ? AND id IN (${inList(ids)}) ORDER BY id`).all(req.ws, ...ids)
    : db.prepare('SELECT name, phone, network FROM submissions WHERE user_id = ? AND day = ? ORDER BY id').all(req.ws, date);
  res.json({ added: addToMembers(req.ws, subs), considered: subs.length });
});

/* ================= members & Friday tracking ================= */
const currentMonth = () => L.dayOf().slice(0, 7);

app.get('/api/members', auth, (req, res) => {
  const month = L.validMonth(req.query.month) || currentMonth();
  const events = L.eventFridays(month);
  const q = L.cleanText(req.query.q, 60).replace(/[%_]/g, '');
  const like = `%${q}%`;
  const members = db.prepare(
    `SELECT id, name, phone, network, source, created_at FROM members
      WHERE user_id = ? AND (name LIKE ? OR phone LIKE ?) ORDER BY name COLLATE NOCASE`
  ).all(req.ws, like, like);
  const marks = db.prepare(
    `SELECT es.member_id, es.event_date, es.called, es.attended FROM event_status es JOIN members m ON m.id = es.member_id
      WHERE m.user_id = ? AND es.event_date IN (${events.map(() => '?').join(',')})`
  ).all(req.ws, ...events);
  const byMember = new Map();
  for (const m of marks) {
    if (!byMember.has(m.member_id)) byMember.set(m.member_id, {});
    byMember.get(m.member_id)[m.event_date] = { called: !!m.called, attended: !!m.attended };
  }
  const total = db.prepare('SELECT COUNT(*) AS c FROM members WHERE user_id = ?').get(req.ws).c;
  const totals = db.prepare(
    `SELECT es.event_date AS d, SUM(es.called) AS called, SUM(es.attended) AS attended FROM event_status es JOIN members m ON m.id = es.member_id
      WHERE m.user_id = ? AND es.event_date IN (${events.map(() => '?').join(',')}) GROUP BY es.event_date`
  ).all(req.ws, ...events);
  res.json({
    month, prev: L.shiftMonth(month, -1), next: L.shiftMonth(month, 1), today: L.dayOf(), total, events,
    totals: Object.fromEntries(events.map((d) => { const t = totals.find((x) => x.d === d); return [d, { called: t?.called || 0, attended: t?.attended || 0 }]; })),
    members: members.map((m) => ({ ...m, status: byMember.get(m.id) || {} })),
  });
});

function memberInput(b) {
  const name = L.cleanText(b.name, 80);
  const phone = L.normPhone(b.phone);
  const network = L.NETWORKS.includes(b.network) ? b.network : 'Other';
  if (name.length < 2) return { error: 'Please enter a name.' };
  if (!phone) return { error: 'Enter a valid phone number, e.g. 08012345678.' };
  return { name, phone, network };
}
app.post('/api/members', auth, (req, res) => {
  const m = memberInput(req.body || {});
  if (m.error) return bad(res, m.error);
  try {
    const id = db.prepare("INSERT INTO members (user_id, name, phone, network, source, created_at) VALUES (?, ?, ?, ?, 'manual', ?)").run(req.ws, m.name, m.phone, m.network, nowIso()).lastInsertRowid;
    res.json({ id: Number(id) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return bad(res, 'That phone number is already in your database.', 409);
    throw e;
  }
});
app.patch('/api/members/:id', auth, (req, res) => {
  const m = memberInput(req.body || {});
  if (m.error) return bad(res, m.error);
  try {
    const r = db.prepare('UPDATE members SET name = ?, phone = ?, network = ? WHERE id = ? AND user_id = ?').run(m.name, m.phone, m.network, Number(req.params.id), req.ws);
    if (!r.changes) return bad(res, 'Member not found.', 404);
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return bad(res, 'Another member already has that phone number.', 409);
    throw e;
  }
});
app.post('/api/members/delete', auth, (req, res) => {
  const ids = idList((req.body || {}).ids);
  if (!ids.length) return bad(res, 'Nothing selected.');
  const r = db.prepare(`DELETE FROM members WHERE user_id = ? AND id IN (${inList(ids)})`).run(req.ws, ...ids);
  res.json({ deleted: r.changes });
});

app.delete('/api/members/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM members WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.ws);
  if (!r.changes) return bad(res, 'Member not found.', 404);
  res.json({ ok: true });
});

app.put('/api/members/:id/status', auth, (req, res) => {
  const b = req.body || {};
  const date = L.validDate(b.date);
  if (!date || !L.isEventDate(date)) return bad(res, 'That is not a 2nd, 3rd or 4th Friday.');
  if (!['called', 'attended'].includes(b.field)) return bad(res, 'Unknown field.');
  if (b.field === 'attended' && b.value && date > L.dayOf()) return bad(res, 'You can only mark attendance on or after the event day.');
  const member = db.prepare('SELECT id FROM members WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.ws);
  if (!member) return bad(res, 'Member not found.', 404);
  const cur = db.prepare('SELECT called, attended FROM event_status WHERE member_id = ? AND event_date = ?').get(member.id, date) || { called: 0, attended: 0 };
  const next = { called: cur.called, attended: cur.attended, [b.field]: b.value ? 1 : 0 };
  db.prepare(
    `INSERT INTO event_status (member_id, event_date, called, attended, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (member_id, event_date) DO UPDATE SET called = excluded.called, attended = excluded.attended, updated_at = excluded.updated_at`
  ).run(member.id, date, next.called, next.attended, nowIso());
  res.json({ ok: true, called: !!next.called, attended: !!next.attended });
});

app.get('/api/members/export', auth, (req, res) => {
  const month = L.validMonth(req.query.month) || currentMonth();
  const events = L.eventFridays(month);
  const members = db.prepare('SELECT id, name, phone, network FROM members WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(req.ws);
  const marks = db.prepare(`SELECT es.member_id, es.event_date, es.called, es.attended FROM event_status es JOIN members m ON m.id = es.member_id WHERE m.user_id = ? AND es.event_date IN (${events.map(() => '?').join(',')})`).all(req.ws, ...events);
  const key = new Map(marks.map((m) => [m.member_id + '|' + m.event_date, m]));
  const head = ['Name', 'Phone', 'Network', ...events.flatMap((d) => [`${d} called`, `${d} attended`])];
  const body = members.map((m) => [m.name, m.phone, m.network, ...events.flatMap((d) => { const s = key.get(m.id + '|' + d); return [s?.called ? 'Yes' : '', s?.attended ? 'Yes' : '']; })]);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="members-${month}.csv"` }).send(L.toCsv([head, ...body]));
});

/* ================= analytics ================= */
app.get('/api/analytics', auth, (req, res) => {
  const range = ['7', '30', '90', 'all'].includes(String(req.query.range)) ? String(req.query.range) : '30';
  res.json(buildAnalytics(db, req.ws, range));
});

/* ================= static ================= */
app.get('/healthz', (req, res) => { db.prepare('SELECT 1 AS ok').get(); res.json({ ok: true }); });
app.get('/vendor/chart.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.js')));
app.get('/j/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public/join.html')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', (req, res) => bad(res, 'Not found.', 404));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  bad(res, err.type === 'entity.parse.failed' ? 'Invalid request.' : 'Server error.', err.status || 500);
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`SignUp Hub running on http://localhost:${PORT}  (time zone: ${L.TZ})`));
}
module.exports = app;