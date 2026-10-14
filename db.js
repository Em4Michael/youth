const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'signup-hub.db');

// SQLite running as WebAssembly: nothing to compile, so it installs the same way on Windows, Mac and Linux.
// It marks the open database with a ".lock" folder. If the app was killed without closing, that folder is
// left behind and would block the next start. This app is meant to run as a single process, so clear it.
fs.rmSync(DB_FILE + '.lock', { recursive: true, force: true });

const raw = new Database(DB_FILE);

// Small wrapper with the familiar  db.prepare(sql).get(...params) / .all(...) / .run(...)  style.
const bind = (params) => params.map((p) => (p === undefined ? null : p));
const db = {
  exec: (sql) => raw.exec(sql),
  prepare(sql) {
    const one = (method) => (...params) => {
      const st = raw.prepare(sql);
      try { return st[method](bind(params)); } finally { st.finalize(); }
    };
    return { get: one('get'), all: one('all'), run: one('run') };
  },
  close: () => raw.close(),
};
db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                 -- sha256 of the cookie token
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- A public sign-up link owned by an organiser. Archived links keep their records.
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 1,
  daily_cap INTEGER NOT NULL DEFAULT 3,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- What people type in on the public page. One row = one recorded person.
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,                   -- YYYY-MM-DD in the app time zone
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  network TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_submission_once_per_day ON submissions(link_id, day, phone);
CREATE INDEX IF NOT EXISTS ix_submission_user_day ON submissions(user_id, day);

-- The organiser's people database.
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'Other',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, phone)
);

-- Called / attended ticks for each 2nd, 3rd and 4th Friday.
CREATE TABLE IF NOT EXISTS event_status (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL,
  called INTEGER NOT NULL DEFAULT 0,
  attended INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (member_id, event_date)
);
`);

// Roles: 'admin' (first account), 'editor' (full access), 'viewer' (view only).
if (!raw.all("PRAGMA table_info(users)").some((c) => c.name === 'role')) {
  raw.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'");
}
if (!raw.get("SELECT 1 AS x FROM users WHERE role = 'admin'")) {
  raw.exec("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)");
}

/** Run fn inside a write transaction; rolls back if fn throws. */
db.tx = (fn) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { db.close(); } catch {} process.exit(0); });
}

module.exports = db;