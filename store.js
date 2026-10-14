'use strict';
// MongoDB data layer. Documents keep small numeric ids (id) so the web pages work unchanged.
const { MongoClient } = require('mongodb');

const URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'signuphub';
let client = null, d = null;

const COLS = ['users', 'sessions', 'links', 'submissions', 'members', 'event_status', 'counters', 'slots'];
const c = (name) => d.collection(name);
const clean = (doc) => { if (doc) delete doc._id; return doc; };
const cleanAll = (docs) => docs.map(clean);
const isDup = (e) => e && (e.code === 11000 || /E11000|duplicate key/i.test(String(e.message)));
const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });

async function connect() {
  if (!URI) {
    console.error('\nMONGODB_URI is not set. Add your MongoDB connection string as an environment variable named MONGODB_URI.\n');
    process.exit(1);
  }
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  d = client.db(DB_NAME);
  await Promise.all([
    c('users').createIndex({ id: 1 }, { unique: true }),
    c('users').createIndex({ username_lc: 1 }, { unique: true }),
    c('links').createIndex({ id: 1 }, { unique: true }),
    c('links').createIndex({ slug: 1 }, { unique: true }),
    c('submissions').createIndex({ id: 1 }, { unique: true }),
    c('submissions').createIndex({ link_id: 1, day: 1, phone: 1 }, { unique: true }),
    c('submissions').createIndex({ user_id: 1, day: 1 }),
    c('members').createIndex({ id: 1 }, { unique: true }),
    c('members').createIndex({ user_id: 1, phone: 1 }, { unique: true }),
    c('event_status').createIndex({ member_id: 1, event_date: 1 }, { unique: true }),
    c('sessions').createIndex({ user_id: 1 }),
  ]);
  await c('sessions').deleteMany({ expires_at: { $lt: Date.now() } });
  console.log(`[mongo] connected, database "${DB_NAME}"`);
}
const close = async () => { try { await client?.close(); } catch {} };
const ping = () => d.command({ ping: 1 });

async function nextId(name) {
  const r = await c('counters').findOneAndUpdate({ _id: name }, { $inc: { n: 1 } }, { upsert: true, returnDocument: 'after' });
  return r.n;
}

/* ---------- users & sessions ---------- */
const users = {
  count: () => c('users').countDocuments({}),
  byName: async (username) => clean(await c('users').findOne({ username_lc: String(username).toLowerCase() })),
  byId: async (id) => clean(await c('users').findOne({ id })),
  async create(u) {
    const id = await nextId('users');
    const doc = { id, ...u, username_lc: u.username.toLowerCase() };
    await c('users').insertOne(doc);
    return id;
  },
  async firstAdminId() {
    const a = await c('users').find({ role: 'admin' }).sort({ id: 1 }).limit(1).toArray();
    return a[0]?.id ?? null;
  },
  async all() { return cleanAll(await c('users').find({}).sort({ id: 1 }).toArray()); },
  setRole: (id, role) => c('users').updateOne({ id }, { $set: { role } }),
  async remove(id) { await c('sessions').deleteMany({ user_id: id }); await c('users').deleteOne({ id }); },
};
const sessions = {
  create: (hash, userId, expiresAt) => c('sessions').insertOne({ _id: hash, user_id: userId, expires_at: expiresAt }),
  get: (hash) => c('sessions').findOne({ _id: hash }),
  remove: (hash) => c('sessions').deleteOne({ _id: hash }),
};

/* ---------- links ---------- */
const links = {
  async create(l) { const id = await nextId('links'); await c('links').insertOne({ id, archived: 0, ...l }); return id; },
  slugTaken: async (slug) => !!(await c('links').findOne({ slug })),
  byId: async (id, ws) => clean(await c('links').findOne({ id, user_id: ws, archived: 0 })),
  byIdAny: async (id) => clean(await c('links').findOne({ id })),
  bySlug: async (slug) => clean(await c('links').findOne({ slug, archived: 0 })),
  async active(ws) { return cleanAll(await c('links').find({ user_id: ws, archived: 0 }).sort({ id: -1 }).toArray()); },
  async all(ws) { return cleanAll(await c('links').find({ user_id: ws }).sort({ id: 1 }).toArray()); },
  update: (id, set) => c('links').updateOne({ id }, { $set: set }),
  async archive(id, ws) { const r = await c('links').updateOne({ id, user_id: ws }, { $set: { archived: 1, is_open: 0 } }); return r.matchedCount; },
};

/* ---------- submissions (the daily cap is enforced with an atomic per-link, per-day counter) ---------- */
const slotKey = (linkId, day) => `${linkId}:${day}`;
const subs = {
  /** Returns { position } when a spot was taken, { full:true } when no spot is left, { duplicate:true } for a repeated phone. */
  async take(link, day, row) {
    const key = slotKey(link.id, day);
    let slot;
    try {
      slot = await c('slots').findOneAndUpdate({ _id: key, taken: { $lt: link.daily_cap } }, { $inc: { taken: 1 } }, { upsert: true, returnDocument: 'after' });
    } catch (e) {
      if (isDup(e)) return { full: true };
      throw e;
    }
    try {
      const id = await nextId('submissions');
      await c('submissions').insertOne({ id, link_id: link.id, user_id: link.user_id, day, ...row });
    } catch (e) {
      await c('slots').updateOne({ _id: key }, { $inc: { taken: -1 } });
      if (isDup(e)) return { duplicate: true };
      throw e;
    }
    return { position: slot.taken };
  },
  countFor: (linkId, day) => c('submissions').countDocuments({ link_id: linkId, day }),
  async countsByLink(ws, day) {
    const rows = await c('submissions').find({ user_id: ws, day }).project({ link_id: 1 }).toArray();
    const m = new Map();
    for (const r of rows) m.set(r.link_id, (m.get(r.link_id) || 0) + 1);
    return m;
  },
  async forDay(ws, day, linkId) {
    const q = { user_id: ws, day, ...(linkId ? { link_id: linkId } : {}) };
    return cleanAll(await c('submissions').find(q).sort({ created_at: 1, id: 1 }).toArray());
  },
  byId: async (id, ws) => clean(await c('submissions').findOne({ id, user_id: ws })),
  async byIds(ids, ws) { return cleanAll(await c('submissions').find({ user_id: ws, id: { $in: ids } }).sort({ id: 1 }).toArray()); },
  /** Make the per-day counters match the real number of records again (after deletes). */
  async resync(keys) {
    for (const k of keys) {
      const [linkId, day] = k.split(':');
      const n = await c('submissions').countDocuments({ link_id: Number(linkId), day });
      await c('slots').updateOne({ _id: k }, { $set: { taken: n } }, { upsert: true });
    }
  },
  async removeMany(filter) {
    const docs = await c('submissions').find(filter).project({ id: 1, link_id: 1, day: 1 }).toArray();
    if (!docs.length) return 0;
    const r = await c('submissions').deleteMany({ id: { $in: docs.map((x) => x.id) } });
    await subs.resync(new Set(docs.map((x) => slotKey(x.link_id, x.day))));
    return r.deletedCount;
  },
  removeIds: (ids, ws) => subs.removeMany({ user_id: ws, id: { $in: ids } }),
  removeDay: (ws, day, linkId) => subs.removeMany({ user_id: ws, day, ...(linkId ? { link_id: linkId } : {}) }),
  liteAll: async (ws) => (await c('submissions').find({ user_id: ws }).project({ link_id: 1, day: 1, network: 1, created_at: 1, id: 1 }).sort({ day: 1, id: 1 }).toArray()).map(clean),
};

/* ---------- members & Friday marks ---------- */
const members = {
  async add(m) {
    try {
      const id = await nextId('members');
      await c('members').insertOne({ id, ...m });
      return { id };
    } catch (e) { if (isDup(e)) return { duplicate: true }; throw e; }
  },
  async search(ws, q) {
    const f = { user_id: ws };
    if (q) { const rx = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); f.$or = [{ name: { $regex: rx, $options: 'i' } }, { phone: { $regex: rx } }]; }
    return cleanAll(await c('members').find(f).toArray()).sort(byName);
  },
  async all(ws) { return cleanAll(await c('members').find({ user_id: ws }).toArray()).sort(byName); },
  count: (ws) => c('members').countDocuments({ user_id: ws }),
  byId: async (id, ws) => clean(await c('members').findOne({ id, user_id: ws })),
  async phonesIn(ws, phones) { return new Set((await c('members').find({ user_id: ws, phone: { $in: phones } }).project({ phone: 1 }).toArray()).map((x) => x.phone)); },
  async update(id, ws, set) {
    try { const r = await c('members').updateOne({ id, user_id: ws }, { $set: set }); return { found: r.matchedCount > 0 }; }
    catch (e) { if (isDup(e)) return { duplicate: true }; throw e; }
  },
  async remove(ids, ws) {
    const mine = (await c('members').find({ user_id: ws, id: { $in: ids } }).project({ id: 1 }).toArray()).map((x) => x.id);
    if (!mine.length) return 0;
    await c('event_status').deleteMany({ member_id: { $in: mine } });
    return (await c('members').deleteMany({ id: { $in: mine } })).deletedCount;
  },
};
const marks = {
  /** All Friday marks for the given dates, for members of this workspace. */
  async forDates(ws, dates) {
    if (!dates.length) return [];
    const ms = await c('members').find({ user_id: ws }).project({ id: 1, name: 1, phone: 1, created_at: 1 }).toArray();
    const byId = new Map(ms.map((m) => [m.id, m]));
    const rows = await c('event_status').find({ event_date: { $in: dates }, member_id: { $in: ms.map((m) => m.id) } }).toArray();
    return rows.map((r) => ({ member_id: r.member_id, d: r.event_date, event_date: r.event_date, called: r.called, attended: r.attended, name: byId.get(r.member_id).name, phone: byId.get(r.member_id).phone }));
  },
  async get(memberId, date) { return clean(await c('event_status').findOne({ member_id: memberId, event_date: date })); },
  async set(memberId, date, field, value, now) {
    const other = field === 'called' ? 'attended' : 'called';
    await c('event_status').updateOne({ member_id: memberId, event_date: date }, { $set: { [field]: value ? 1 : 0, updated_at: now }, $setOnInsert: { [other]: 0 } }, { upsert: true });
    return marks.get(memberId, date);
  },
  /** Everything ever ticked, for the "most consistent attendees" list. */
  async attendedTotals(ws) {
    const ms = await c('members').find({ user_id: ws }).project({ id: 1, name: 1 }).toArray();
    const byId = new Map(ms.map((m) => [m.id, m]));
    const rows = await c('event_status').find({ member_id: { $in: ms.map((m) => m.id) } }).project({ member_id: 1, called: 1, attended: 1 }).toArray();
    const t = new Map();
    for (const r of rows) { const x = t.get(r.member_id) || { id: r.member_id, name: byId.get(r.member_id).name, attended: 0, called: 0 }; x.attended += r.attended; x.called += r.called; t.set(r.member_id, x); }
    return [...t.values()];
  },
};

module.exports = { isDup, connect, close, ping, users, sessions, links, subs, members, marks, nextId, COLS };