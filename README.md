# SignUp Hub

A small full-stack app (Node + SQLite, no build step).

- **Sign-up links** – each link records the first N people per day (default 3). People open the link and enter their name, phone number and network. You can open/close a link at any time.
- **Daily records** – see every day's names, numbers and networks, export CSV, add people to your database in one click.
- **Members database** – name, phone, network, and a *Called* / *Attended* tick for every 2nd, 3rd and 4th Friday of each month.
- **Dashboard** – sign-ups per day, network mix, busiest times, Friday funnel (members → called → attended), call/attendance rates, link performance, who is still to call.

## Run it

Requires **Node 18 or newer**. Nothing needs compiling: the database (SQLite) is bundled as a WebAssembly package that `npm install` fetches.

    npm install
    npm start          # http://localhost:3000

Open the site and create your account (the first account is created on the login screen). Then go to **Links → Create link** and share the URL it gives you (there is a WhatsApp button).

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `TZ_NAME` | `Africa/Lagos` | Time zone that decides when "a new day" starts |
| `DATA_DIR` | `./data` | Where the database file (`signup-hub.db`) lives. **Back this folder up.** Run only one copy of the app against it. |
| `ALLOW_REGISTRATION` | `true` | Set to `false` once your account exists so nobody else can sign up |
| `TRUST_PROXY` | – | Set to `true` when behind a proxy/host that provides HTTPS (Render, Railway, nginx…) |
| `COOKIE_SECURE` | – | Set to `true` to force secure cookies on HTTPS |

## Putting it online

People need a public address to click your links. Any host that runs Node 18+ and keeps a **persistent disk** works (a small VPS, Railway, Render with a disk, Fly.io with a volume). Point `DATA_DIR` at the persistent disk, serve it over HTTPS, and set `TRUST_PROXY=true` and `ALLOW_REGISTRATION=false`.

## How the rules work

- A person is recorded only if the link is **open**, today's spots are not full, and their phone number is not already recorded on that link today. The check and the save happen in one database transaction, so two people can never take the same last spot.
- "Removing" a link stops it working but keeps everything it recorded. Deleting a single record frees that spot again.
- Attendance can only be ticked on or after the Friday itself; "Called" can be ticked in advance.
- Each organiser account only ever sees its own links, records and members.
