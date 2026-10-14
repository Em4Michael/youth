'use strict';
const L = require('./lib');

const MAX_LINK_SERIES = 5;

async function buildAnalytics(store, userId, range) {
  const today = L.dayOf();

  const [links, subs, members] = await Promise.all([store.links.all(userId), store.subs.liteAll(userId), store.members.all(userId)]);

  /* ---------- window ---------- */
  let start;
  if (range === 'all') {
    start = subs.length ? subs[0].day : today;
    const floor = L.addDays(today, -365);
    if (start < floor) start = floor;
  } else {
    const n = Math.max(1, Math.min(365, parseInt(range, 10) || 30));
    start = L.addDays(today, -(n - 1));
  }
  const days = L.dateRange(start, today);
  const dayIdx = new Map(days.map((d, i) => [d, i]));
  const inRange = subs.filter((s) => s.day >= start);

  /* ---------- sign-ups per day, stacked by link (colour follows the link, not its rank) ---------- */
  const slotOf = new Map(links.slice(0, MAX_LINK_SERIES).map((l, i) => [l.id, i]));
  const series = [];
  const bySlot = new Map();
  for (const s of inRange) {
    const slot = slotOf.has(s.link_id) ? slotOf.get(s.link_id) : MAX_LINK_SERIES;
    if (!bySlot.has(slot)) {
      const link = links.find((l) => l.id === s.link_id);
      bySlot.set(slot, {
        slot,
        label: slot === MAX_LINK_SERIES ? 'Other links' : link.title,
        data: days.map(() => 0),
      });
    }
    bySlot.get(slot).data[dayIdx.get(s.day)]++;
  }
  [...bySlot.values()].sort((a, b) => a.slot - b.slot).forEach((s) => series.push(s));
  const totalsPerDay = days.map((_, i) => series.reduce((n, s) => n + s.data[i], 0));

  /* ---------- networks ---------- */
  const netCount = new Map(L.NETWORKS.map((n) => [n, 0]));
  for (const s of inRange) netCount.set(s.network, (netCount.get(s.network) || 0) + 1);
  const networks = [...netCount.entries()].map(([name, count]) => ({ name, count })).filter((n) => n.count > 0).sort((a, b) => b.count - a.count);

  /* ---------- weekday × hour heat map ---------- */
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const s of inRange) heat[L.weekdayIdx(s.day)][L.hourOf(new Date(s.created_at))]++;

  /* ---------- link performance ---------- */
  const perLink = new Map();
  for (const s of inRange) {
    if (!perLink.has(s.link_id)) perLink.set(s.link_id, { total: 0, perDay: new Map() });
    const p = perLink.get(s.link_id);
    p.total++;
    p.perDay.set(s.day, (p.perDay.get(s.day) || 0) + 1);
  }
  const linkPerf = links
    .filter((l) => !l.archived || perLink.has(l.id))
    .map((l) => {
      const p = perLink.get(l.id) || { total: 0, perDay: new Map() };
      const created = L.dayOf(new Date(l.created_at));
      const from = created > start ? created : start;
      const windowDays = from > today ? 1 : L.dateRange(from, today).length;
      const daysFull = [...p.perDay.values()].filter((c) => c >= l.daily_cap).length;
      return {
        id: l.id, title: l.title, is_open: !!l.is_open, archived: !!l.archived, cap: l.daily_cap,
        total: p.total, active_days: p.perDay.size, days_full: daysFull, window_days: windowDays,
      };
    })
    .sort((a, b) => b.total - a.total);

  /* ---------- members growth ---------- */
  const memberDays = members.map((m) => L.dayOf(new Date(m.created_at)));
  const membersCum = days.map((d) => memberDays.filter((md) => md <= d).length);

  /* ---------- Friday events (2nd / 3rd / 4th) ---------- */
  const thisMonth = today.slice(0, 7);
  let pool = [];
  for (let k = -4; k <= 1; k++) pool = pool.concat(L.eventFridays(L.shiftMonth(thisMonth, k)));
  const past = pool.filter((d) => d <= today).slice(-12);
  const monthDates = L.eventFridays(thisMonth);
  const wanted = [...new Set([...past, ...monthDates])];
  const statRows = await store.marks.forDates(userId, wanted);
  const createdDayOf = new Map(members.map((m, i) => [m.id, memberDays[i]]));
  const statFor = (d) => {
    const rows = statRows.filter((r) => r.d === d);
    // Members who joined after this Friday count too if someone ticked them for it, so a rate never exceeds 100%.
    const late = rows.filter((r) => createdDayOf.get(r.member_id) > d).length;
    return {
      date: d,
      eligible: d > today ? members.length : memberDays.filter((md) => md <= d).length + late,
      called: rows.reduce((n, r) => n + r.called, 0),
      attended: rows.reduce((n, r) => n + r.attended, 0),
      attended_called: rows.filter((r) => r.called && r.attended).length,
    };
  };
  // Names for each Friday: who came, and who was called but did not come.
  const roster = {};
  for (const d of wanted) {
    const rows = statRows.filter((r) => r.d === d).sort((a, b) => a.name.localeCompare(b.name));
    roster[d] = {
      attended: rows.filter((r) => r.attended).map((r) => ({ name: r.name, phone: r.phone, called: !!r.called })),
      called_only: rows.filter((r) => r.called && !r.attended).map((r) => ({ name: r.name, phone: r.phone })),
    };
  }
  const events = past.map(statFor);
  // This month's 2nd / 3rd / 4th Fridays, for the ticket row at the top of the dashboard.
  const monthEvents = monthDates.map((d, i) => ({ ...statFor(d), nth: i + 2, when: d < today ? 'past' : d === today ? 'today' : 'upcoming' }));
  const sumCalled = events.reduce((n, e) => n + e.called, 0);
  const sumBoth = events.reduce((n, e) => n + e.attended_called, 0);

  /* ---------- who to call next ---------- */
  const nextEvent = pool.find((d) => d >= today) || null;
  let toCall = { date: nextEvent, total: 0, people: [] };
  if (nextEvent) {
    const called = new Set((await store.marks.forDates(userId, [nextEvent])).filter((r) => r.called).map((r) => r.member_id));
    const rows = members.filter((m) => !called.has(m.id)).map((m) => ({ id: m.id, name: m.name, phone: m.phone }));
    toCall = { date: nextEvent, total: rows.length, people: rows.slice(0, 10) };
  }
  const topAttendees = (await store.marks.attendedTotals(userId))
    .filter((x) => x.attended > 0)
    .sort((a, b) => b.attended - a.attended || String(a.name).localeCompare(String(b.name)))
    .slice(0, 6);

  /* ---------- headline numbers ---------- */
  const open = links.filter((l) => !l.archived && l.is_open);
  const takenMap = await store.subs.countsByLink(userId, today);
  const slots = {
    capacity: open.reduce((n, l) => n + l.daily_cap, 0),
    taken: open.reduce((n, l) => n + Math.min(takenMap.get(l.id) || 0, l.daily_cap), 0),
  };

  return {
    range, start, end: today, tz: L.TZ,
    kpis: {
      signups: inRange.length,
      signups_today: takenMap.size ? [...takenMap.values()].reduce((a, b) => a + b, 0) : 0,
      avg_per_day: days.length ? inRange.length / days.length : 0,
      members: members.length,
      links_total: links.filter((l) => !l.archived).length,
      links_open: open.length,
      slots,
      latest_event: events.length ? events[events.length - 1] : null,
      conversion: sumCalled ? sumBoth / sumCalled : null,
    },
    days, series, totalsPerDay, networks, heat, linkPerf, membersCum, events, monthEvents, roster, toCall, topAttendees,
  };
}

module.exports = { buildAnalytics };