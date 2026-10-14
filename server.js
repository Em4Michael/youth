'use strict';
// Local runs: read settings (like MONGODB_URI) from a .env file if there is one.
try { process.loadEnvFile(require('path').join(__dirname, '.env')); } catch {}
const express = require('express');
const path = require('path');
const store = require('./store');
const L = require('./lib');
const { buildAnalytics } = require('./analytics');

const PORT = Number(process.env.PORT) || 3000;
const ALLOW_REGISTRATION = (process.env.ALLOW_REGISTRATION || 'true').toLowerCase() !== 'false';
const SESSION_DAYS = 30;

const app = express();
// Hosts like Render/Railway put a proxy in front of the app; trust it automatically so visitors are told apart and cookies are Secure.
const TRUST = process.env.TRUST_PROXY || (process.env.RENDER || process.env.RAILWAY_ENVIRONMENT ? 'true' : '');
if (TRUST) app.set('trust proxy', TRUST === 'true' ? 1 : TRUST);
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
async function startSession(req, res, userId) {
  const token = L.newToken();
  const maxAge = SESSION_DAYS * 86400;
  await store.sessions.create(L.sha256(token), userId, Date.now() + maxAge * 1000);
  setSessionCookie(req, res, token, maxAge);
}
async function auth(req, res, next) {
  try {
    const token = readCookie(req, 'sid');
    if (token) {
      const sess = await store.sessions.get(L.sha256(token));
      if (sess && sess.expires_at > Date.now()) {
        const u = await store.users.byId(sess.user_id);
        if (u) {
          req.user = { id: u.id, username: u.username, display_name: u.display_name, role: u.role };
          // Everyone shares the admin's workspace; role decides who may edit.
          req.ws = (await store.users.firstAdminId()) ?? u.id;
          return next();
        }
      }
    }
    bad(res, 'Please sign in.', 401);
  } catch (e) { next(e); }
}
const publicUser = (u) => ({ id: u.id, username: u.username, display_name: u.display_name || u.username, role: u.role || 'viewer' });

/* ================= auth ================= */
const authLimiter = L.limiter(12, 10 * 60 * 1000);

app.get('/api/auth/config', async (req, res) => {
  const count = await store.users.count();
  res.json({ can_register: count === 0 || ALLOW_REGISTRATION, first_user: count === 0, tz: L.TZ });
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const b = req.body || {};
  const count = await store.users.count();
  if (count > 0 && !ALLOW_REGISTRATION) return bad(res, 'Registration is closed.', 403);
  const username = L.cleanText(b.username, 40);
  const display = L.cleanText(b.display_name, 60) || username;
  const password = String(b.password || '');
  if (!username) return bad(res, 'Please enter a username.');
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
    return bad(res, 'Password needs a small letter, a capital letter, a number and a symbol.');
  }
  if (await store.users.byName(username)) return bad(res, 'That username is taken.', 409);
  const { salt, hash } = L.hashPassword(password);
  const role = count === 0 ? 'admin' : 'viewer';
  let id;
  try { id = await store.users.create({ username, display_name: display, salt, hash, role, created_at: nowIso() }); }
  catch (e) { if (store.isDup(e)) return bad(res, 'That username is taken.', 409); throw e; }
  await startSession(req, res, id);
  res.json({ user: publicUser({ id, username, display_name: display, role }) });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const b = req.body || {};
  const u = await store.users.byName(L.cleanText(b.username, 40));
  if (!u || !L.verifyPassword(String(b.password || ''), u.salt, u.hash)) return bad(res, 'Wrong username or password.', 401);
  await startSession(req, res, u.id);
  res.json({ user: publicUser(u) });
});

app.post('/api/auth/logout', async (req, res) => {
  const token = readCookie(req, 'sid');
  if (token) await store.sessions.remove(L.sha256(token));
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

app.get('/api/team', auth, async (req, res) => {
  const rank = { admin: 0, editor: 1, viewer: 2 };
  const rows = (await store.users.all()).sort((a, b) => rank[a.role] - rank[b.role] || a.id - b.id);
  res.json({ me: req.user.id, can_manage: req.user.role === 'admin', members: rows.map((u) => ({ id: u.id, username: u.username, display_name: u.display_name || u.username, role: u.role, joined: u.created_at })) });
});
app.patch('/api/team/:id', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id), role = (req.body || {}).role;
  if (!['editor', 'viewer'].includes(role)) return bad(res, 'Role must be editor or viewer.');
  const u = await store.users.byId(id);
  if (!u) return bad(res, 'Not found.', 404);
  if (u.role === 'admin') return bad(res, "The admin's role cannot be changed.");
  await store.users.setRole(id, role);
  res.json({ ok: true });
});
app.delete('/api/team/:id', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const u = await store.users.byId(id);
  if (!u) return bad(res, 'Not found.', 404);
  if (u.role === 'admin') return bad(res, 'The admin account cannot be removed.');
  await store.users.remove(id);
  res.json({ ok: true });
});

/* ================= links ================= */
function linkView(l, taken) {
  return { id: l.id, slug: l.slug, title: l.title, is_open: !!l.is_open, daily_cap: l.daily_cap, created_at: l.created_at, taken_today: taken };
}

app.get('/api/links', auth, async (req, res) => {
  const today = L.dayOf();
  const [rows, counts] = await Promise.all([store.links.active(req.ws), store.subs.countsByLink(req.ws, today)]);
  res.json({ today, links: rows.map((l) => linkView(l, counts.get(l.id) || 0)) });
});

app.post('/api/links', auth, async (req, res) => {
  const b = req.body || {};
  const title = L.cleanText(b.title, 80);
  const cap = b.daily_cap === undefined ? 3 : parseInt(b.daily_cap, 10);
  if (!title) return bad(res, 'Give the link a title.');
  if (!(cap >= 1 && cap <= 500)) return bad(res, 'Daily limit must be between 1 and 500.');
  let slug;
  do slug = L.newSlug(); while (await store.links.slugTaken(slug));
  const row = { user_id: req.ws, slug, title, is_open: 1, daily_cap: cap, created_at: nowIso() };
  const id = await store.links.create(row);
  res.json({ link: linkView({ id, ...row }, 0) });
});

app.patch('/api/links/:id', auth, async (req, res) => {
  const l = await store.links.byId(Number(req.params.id), req.ws);
  if (!l) return bad(res, 'Link not found.', 404);
  const b = req.body || {};
  let title = l.title, is_open = l.is_open, cap = l.daily_cap;
  if (b.title !== undefined) { title = L.cleanText(b.title, 80); if (!title) return bad(res, 'Title cannot be empty.'); }
  if (b.is_open !== undefined) is_open = b.is_open ? 1 : 0;
  if (b.daily_cap !== undefined) { cap = parseInt(b.daily_cap, 10); if (!(cap >= 1 && cap <= 500)) return bad(res, 'Daily limit must be between 1 and 500.'); }
  await store.links.update(l.id, { title, is_open, daily_cap: cap });
  const taken = await store.subs.countFor(l.id, L.dayOf());
  res.json({ link: linkView({ ...l, title, is_open, daily_cap: cap }, taken) });
});

// "Delete" archives the link: it stops working but everything it recorded is kept.
app.delete('/api/links/:id', auth, async (req, res) => {
  if (!(await store.links.archive(Number(req.params.id), req.ws))) return bad(res, 'Link not found.', 404);
  res.json({ ok: true });
});

/* ================= public sign-up page ================= */
const submitLimiter = L.limiter(40, 10 * 60 * 1000);

async function publicState(link) {
  const taken = await store.subs.countFor(link.id, L.dayOf());
  const state = !link.is_open ? 'closed' : taken >= link.daily_cap ? 'full' : 'open';
  return { title: link.title, state, cap: link.daily_cap, taken: Math.min(taken, link.daily_cap), remaining: Math.max(0, link.daily_cap - taken), networks: L.NETWORKS };
}

app.get('/api/public/:slug', async (req, res) => {
  const link = await store.links.bySlug(String(req.params.slug));
  if (!link) return bad(res, 'This link does not exist.', 404);
  res.json(await publicState(link));
});

app.post('/api/public/:slug/submit', submitLimiter, async (req, res) => {
  const b = req.body || {};
  const name = L.cleanText(b.name, 80);
  const phone = L.normPhone(b.phone);
  const network = L.NETWORKS.includes(b.network) ? b.network : null;
  if (name.length < 2) return bad(res, 'Please enter your name.');
  if (!phone) return bad(res, 'Enter a valid phone number, e.g. 08012345678.');
  if (!network) return bad(res, 'Please choose your network provider.');

  try {
    const link = await store.links.bySlug(String(req.params.slug));
    if (!link) return bad(res, 'This link does not exist.', 404);
    if (!link.is_open) return res.status(409).json({ error: 'This link is closed right now.', state: 'closed' });
    const r = await store.subs.take(link, L.dayOf(), { name, phone, network, created_at: nowIso() });
    if (r.full) return res.status(409).json({ error: "Today's spots are already filled.", state: 'full' });
    if (r.duplicate) return bad(res, 'This phone number is already recorded for today.', 409);
    res.json({ ok: true, position: r.position, cap: link.daily_cap, title: link.title });
  } catch (e) {
    console.error(e);
    bad(res, 'Something went wrong. Please try again.', 500);
  }
});

/* ================= daily records ================= */
app.get('/api/records', auth, async (req, res) => {
  const date = L.validDate(req.query.date) || L.dayOf();
  const linkId = Number(req.query.link_id) || null;
  const [rows, counts, allLinks] = await Promise.all([store.subs.forDay(req.ws, date, linkId), store.subs.countsByLink(req.ws, date), store.links.all(req.ws)]);
  const title = new Map(allLinks.map((l) => [l.id, l.title]));
  const have = await store.members.phonesIn(req.ws, [...new Set(rows.map((r) => r.phone))]);
  const links = allLinks
    .filter((l) => !l.archived || counts.has(l.id))
    .map((l) => ({ id: l.id, title: l.title, is_open: !!l.is_open, cap: l.daily_cap, taken: counts.get(l.id) || 0, archived: !!l.archived }));
  res.json({
    date, today: L.dayOf(), links,
    rows: rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, network: r.network, created_at: r.created_at, link_id: r.link_id, link_title: title.get(r.link_id) || '', in_members: have.has(r.phone) })),
  });
});

app.get('/api/records/export', auth, async (req, res) => {
  const date = L.validDate(req.query.date) || L.dayOf();
  const [rows, allLinks] = await Promise.all([store.subs.forDay(req.ws, date), store.links.all(req.ws)]);
  const title = new Map(allLinks.map((l) => [l.id, l.title]));
  const csv = L.toCsv([['Name', 'Phone', 'Network', 'Link', 'Recorded at (UTC)'], ...rows.map((r) => [r.name, r.phone, r.network, title.get(r.link_id) || '', r.created_at])]);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="records-${date}.csv"` }).send(csv);
});

const idList = (v) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 1000) : []);

app.delete('/api/records/:id', auth, async (req, res) => {
  if (!(await store.subs.removeIds([Number(req.params.id)], req.ws))) return bad(res, 'Record not found.', 404);
  res.json({ ok: true });
});

// Delete many records at once: either the ticked ids, or everything shown for a day (optionally one link).
app.post('/api/records/delete', auth, async (req, res) => {
  const b = req.body || {};
  let deleted = 0;
  if (Array.isArray(b.ids)) {
    const ids = [...new Set(b.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 2000);
    if (!ids.length) return bad(res, 'Nothing selected.');
    deleted = await store.subs.removeIds(ids, req.ws);
  } else if (L.validDate(b.date)) {
    deleted = await store.subs.removeDay(req.ws, b.date, Number(b.link_id) || null);
  } else return bad(res, 'Nothing to delete.');
  res.json({ deleted });
});

async function addToMembers(userId, subs) {
  let added = 0;
  for (const s of subs) {
    const r = await store.members.add({ user_id: userId, name: s.name, phone: s.phone, network: s.network, source: 'link', created_at: nowIso() });
    if (!r.duplicate) added++;
  }
  return added;
}
app.post('/api/records/:id/add-member', auth, async (req, res) => {
  const s = await store.subs.byId(Number(req.params.id), req.ws);
  if (!s) return bad(res, 'Record not found.', 404);
  res.json({ added: await addToMembers(req.ws, [s]) });
});
app.post('/api/records/add-members', auth, async (req, res) => {
  const b = req.body || {};
  const date = L.validDate(b.date) || L.dayOf();
  const ids = idList(b.ids);
  const subs = ids.length ? await store.subs.byIds(ids, req.ws) : await store.subs.forDay(req.ws, date);
  res.json({ added: await addToMembers(req.ws, subs), considered: subs.length });
});

/* ================= members & Friday tracking ================= */
const currentMonth = () => L.dayOf().slice(0, 7);

app.get('/api/members', auth, async (req, res) => {
  const month = L.validMonth(req.query.month) || currentMonth();
  const events = L.eventFridays(month);
  const q = L.cleanText(req.query.q, 60);
  const [members, marks, total] = await Promise.all([store.members.search(req.ws, q), store.marks.forDates(req.ws, events), store.members.count(req.ws)]);
  const byMember = new Map();
  const totals = new Map(events.map((d) => [d, { called: 0, attended: 0 }]));
  for (const m of marks) {
    if (!byMember.has(m.member_id)) byMember.set(m.member_id, {});
    byMember.get(m.member_id)[m.event_date] = { called: !!m.called, attended: !!m.attended };
    totals.get(m.event_date).called += m.called; totals.get(m.event_date).attended += m.attended;
  }
  res.json({
    month, prev: L.shiftMonth(month, -1), next: L.shiftMonth(month, 1), today: L.dayOf(), total, events,
    totals: Object.fromEntries(totals),
    members: members.map((m) => ({ id: m.id, name: m.name, phone: m.phone, network: m.network, source: m.source, created_at: m.created_at, status: byMember.get(m.id) || {} })),
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
app.post('/api/members', auth, async (req, res) => {
  const m = memberInput(req.body || {});
  if (m.error) return bad(res, m.error);
  const r = await store.members.add({ user_id: req.ws, name: m.name, phone: m.phone, network: m.network, source: 'manual', created_at: nowIso() });
  if (r.duplicate) return bad(res, 'That phone number is already in your database.', 409);
  res.json({ id: r.id });
});
app.patch('/api/members/:id', auth, async (req, res) => {
  const m = memberInput(req.body || {});
  if (m.error) return bad(res, m.error);
  const r = await store.members.update(Number(req.params.id), req.ws, { name: m.name, phone: m.phone, network: m.network });
  if (r.duplicate) return bad(res, 'Another member already has that phone number.', 409);
  if (!r.found) return bad(res, 'Member not found.', 404);
  res.json({ ok: true });
});
app.post('/api/members/delete', auth, async (req, res) => {
  const ids = idList((req.body || {}).ids);
  if (!ids.length) return bad(res, 'Nothing selected.');
  res.json({ deleted: await store.members.remove(ids, req.ws) });
});

app.delete('/api/members/:id', auth, async (req, res) => {
  if (!(await store.members.remove([Number(req.params.id)], req.ws))) return bad(res, 'Member not found.', 404);
  res.json({ ok: true });
});

app.put('/api/members/:id/status', auth, async (req, res) => {
  const b = req.body || {};
  const date = L.validDate(b.date);
  if (!date || !L.isEventDate(date)) return bad(res, 'That is not a 2nd, 3rd or 4th Friday.');
  if (!['called', 'attended'].includes(b.field)) return bad(res, 'Unknown field.');
  if (b.field === 'attended' && b.value && date > L.dayOf()) return bad(res, 'You can only mark attendance on or after the event day.');
  const member = await store.members.byId(Number(req.params.id), req.ws);
  if (!member) return bad(res, 'Member not found.', 404);
  const next = await store.marks.set(member.id, date, b.field, b.value, nowIso());
  res.json({ ok: true, called: !!next.called, attended: !!next.attended });
});

app.get('/api/members/export', auth, async (req, res) => {
  const month = L.validMonth(req.query.month) || currentMonth();
  const events = L.eventFridays(month);
  const [members, marks] = await Promise.all([store.members.all(req.ws), store.marks.forDates(req.ws, events)]);
  const key = new Map(marks.map((m) => [m.member_id + '|' + m.event_date, m]));
  const head = ['Name', 'Phone', 'Network', ...events.flatMap((d) => [`${d} called`, `${d} attended`])];
  const body = members.map((m) => [m.name, m.phone, m.network, ...events.flatMap((d) => { const s = key.get(m.id + '|' + d); return [s?.called ? 'Yes' : '', s?.attended ? 'Yes' : '']; })]);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="members-${month}.csv"` }).send(L.toCsv([head, ...body]));
});

/* ================= analytics ================= */
app.get('/api/analytics', auth, async (req, res) => {
  const range = ['7', '30', '90', 'all'].includes(String(req.query.range)) ? String(req.query.range) : '30';
  res.json(await buildAnalytics(store, req.ws, range));
});

/* ================= static ================= */
app.get('/healthz', async (req, res) => { await store.ping(); res.json({ ok: true }); });
app.get('/vendor/chart.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.js')));
app.get(['/login', '/signup'], (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/j/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public/join.html')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', (req, res) => bad(res, 'Not found.', 404));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  bad(res, err.type === 'entity.parse.failed' ? 'Invalid request.' : 'Server error.', err.status || 500);
});

store.connect()
  .then(() => app.listen(PORT, () => console.log(`SignUp Hub running on http://localhost:${PORT}  (time zone: ${L.TZ})`)))
  .catch((e) => { console.error('Could not connect to MongoDB:', e.message); process.exit(1); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => store.close().finally(() => process.exit(0)));
module.exports = app;