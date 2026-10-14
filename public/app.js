(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const root = $('#app');
  let me = null, cfg = { tz: 'Africa/Lagos' }, today = '', cleanup = null;

  /* ---------- api + small helpers ---------- */
  async function api(method, url, body) {
    const r = await fetch(url, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !url.startsWith('/api/auth/')) { me = null; showAuth(); throw new Error('Please sign in.'); }
    if (!r.ok) throw new Error(j.error || 'Something went wrong.');
    return j;
  }
  let toastTimer;
  function toast(msg) {
    $('.toast')?.remove();
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.append(t);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3200);
  }
  const fmtDay = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'));
  const fmtFri = (d) => 'Fri ' + fmtDay(d);
  const fmtLong = (d) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'));
  const fmtMonth = (m) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(m + '-01T00:00:00Z'));
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: cfg.tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const ordinal = ['2nd', '3rd', '4th'];

  const svg = (d, s = 20, sw = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const icon = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18V9m5 9V5m5 13v-7m5 7V8"/></svg>',
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>', 15),
    moon: svg('<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>', 17),
    left: svg('<path d="M15 6l-6 6 6 6"/>', 16, 2.2),
    right: svg('<path d="M9 6l6 6-6 6"/>', 16, 2.2),
    eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 19),
    eyeOff: svg('<path d="M17.9 17.9A10.6 10.6 0 0112 19C5.6 19 2 12 2 12a18.6 18.6 0 014.1-5.1M9.9 5.2A9.7 9.7 0 0112 5c6.4 0 10 7 10 7a18.7 18.7 0 01-2.2 3.2M1 1l22 22"/><path d="M14.1 14.1a3 3 0 11-4.2-4.2"/>', 19),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 14, 3),
    phone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>', 15),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>', 16),
    trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>', 16),
    out: svg('<path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M20 12H9"/>', 16),
    dash: svg('<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>'),
    link: svg('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0010 18.7l1-1"/>'),
    list: svg('<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>'),
    team: svg('<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'),
    users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.3c2.2.7 3.5 2.6 3.5 5.2"/>'),
  };

  /* ---------- dialogs ---------- */
  function formDialog({ title, intro, fields = [], submit = 'Save', danger = false, onSubmit }) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      const input = (f) => f.options
        ? `<select class="input" name="${f.name}">${f.options.map((o) => `<option ${o === f.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : `<input class="input" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" required
             ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}
             ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}>`;
      dlg.innerHTML = `<form method="dialog">
        <h2>${esc(title)}</h2>${intro ? `<p class="sub">${esc(intro)}</p>` : ''}
        ${fields.map((f) => `<label class="field"><span>${esc(f.label)}</span>${input(f)}</label>`).join('')}
        <div class="form-err" role="alert"></div>
        <div class="actions"><button class="btn" type="button" data-cancel>Cancel</button>
        <button class="btn ${danger ? 'danger solid' : 'primary'}" type="submit">${esc(submit)}</button></div></form>`;
      document.body.append(dlg);
      const form = $('form', dlg), err = $('.form-err', dlg);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('[type=submit]', dlg); btn.disabled = true;
        try { await onSubmit(Object.fromEntries(new FormData(form))); dlg.dataset.ok = '1'; dlg.close(); }
        catch (ex) { err.textContent = ex.message; btn.disabled = false; }
      });
      $('[data-cancel]', dlg).onclick = () => dlg.close();
      dlg.addEventListener('close', () => { const ok = dlg.dataset.ok === '1'; dlg.remove(); resolve(ok); });
      dlg.showModal();
      $('input,select', dlg)?.focus();
    });
  }
  const confirmDialog = (title, intro, submit, onSubmit) => formDialog({ title, intro, submit, danger: true, onSubmit });

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select();
      document.execCommand('copy'); t.remove();
    }
    toast('Link copied');
  }

  /* ---------- theme ---------- */
  function toggleTheme() {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
    window.dispatchEvent(new Event('themechange'));
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => window.dispatchEvent(new Event('themechange')));

  /* ======================================================================
     AUTH + SHELL
     ====================================================================== */
  async function boot() {
    try { cfg = { ...cfg, ...(await api('GET', '/api/auth/config')) }; } catch {}
    try {
      const j = await api('GET', '/api/auth/me');
      me = j.user; cfg.tz = j.tz; today = j.today;
      if (location.pathname === '/login' || location.pathname === '/signup') history.replaceState(null, '', '/' + (location.hash || '#/dashboard'));
      showShell();
    } catch { showAuth(); }
  }

  let authPop = null;
  function showAuth() {
    cleanup?.(); cleanup = null;
    // /login and /signup are real addresses; anything else signed-out lands on the login page.
    const modeFromUrl = () => ((location.pathname === '/signup' || cfg.first_user) && (cfg.can_register || cfg.first_user) ? 'register' : 'login');
    let mode = modeFromUrl();
    const urlFor = () => (mode === 'register' ? '/signup' : '/login');
    if (location.pathname !== urlFor()) history.replaceState(null, '', urlFor());
    if (authPop) window.removeEventListener('popstate', authPop);
    authPop = () => { if (!me && $('#authForm')) { mode = modeFromUrl(); draw(); } };
    window.addEventListener('popstate', authPop);
    const go = (m) => { mode = m; history.pushState(null, '', urlFor()); draw(); };
    const draw = () => {
      root.innerHTML = `<div class="auth">
        <section class="auth-hero">
          <div class="brand"><div class="brand-mark">${icon.logo}</div>SignUp Hub</div>
          <div>
            <h1>Get the names. Make the calls. See who came.</h1>
            <p>Share a link, collect today's sign-ups, and keep track of every Friday call and attendance in one place.</p>
          </div>
          <div class="auth-steps">
            <div><i>${icon.check}</i>The first people to use your link each day are recorded</div>
            <div><i>${icon.check}</i>Tick who you called on the 2nd, 3rd and 4th Friday</div>
            <div><i>${icon.check}</i>See attendance and trends on your dashboard</div>
          </div>
        </section>
        <section class="auth-form-side"><div class="auth-card">
          <h2>${mode === 'login' ? 'Welcome back' : cfg.first_user ? 'Create your account' : 'Create an account'}</h2>
          <p class="sub" style="margin-top:6px">${mode === 'login' ? 'Sign in to manage your links, records and members.' : 'Choose any username and a password you will remember.'}</p>
          <form id="authForm" novalidate>
            ${mode === 'register' ? '<label class="field"><span>Your name</span><input class="input" name="display_name" autocomplete="name" maxlength="60"></label>' : ''}
            <label class="field"><span>Username</span><input class="input" name="username" autocomplete="username" autocapitalize="none" required></label>
            <label class="field"><span>Password</span><span class="pw-wrap"><input class="input" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required><button type="button" class="pw-eye" id="pwEye" aria-label="Show password" aria-pressed="false" title="Show password">${icon.eye}</button></span>
              ${mode === 'register' ? '<span class="mini" style="font-weight:400">Needs a small letter, a capital letter, a number and a symbol (like ! @ # $).</span>' : ''}</label>
            <div class="form-err" role="alert"></div>
            <button class="btn primary" style="min-height:48px;font-size:16px" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
          </form>
          ${mode === 'login'
            ? (cfg.can_register ? `<p class="sub" style="margin-top:18px;text-align:center">New here? <a href="/signup" id="swap">Create an account</a></p>` : '')
            : `<p class="sub" style="margin-top:18px;text-align:center">Already have an account? <a href="/login" id="swap">Sign in</a></p>`}
        </div></section></div>`;
      $('#pwEye').addEventListener('click', (e) => {
        const inp = $('input[name=password]'), show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        e.currentTarget.innerHTML = show ? icon.eyeOff : icon.eye;
        e.currentTarget.setAttribute('aria-pressed', show);
        const label = show ? 'Hide password' : 'Show password';
        e.currentTarget.setAttribute('aria-label', label); e.currentTarget.title = label;
        inp.focus();
      });
      $('#swap')?.addEventListener('click', (e) => { e.preventDefault(); go(mode === 'login' ? 'register' : 'login'); });
      $('#authForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('button[type=submit]'); btn.disabled = true;
        try {
          const j = await api('POST', `/api/auth/${mode}`, Object.fromEntries(new FormData(e.currentTarget)));
          me = j.user; cfg.first_user = false;
          const m = await api('GET', '/api/auth/me'); cfg.tz = m.tz; today = m.today;
          history.replaceState(null, '', '/#/dashboard');
          showShell();
        } catch (ex) { $('.form-err').textContent = ex.message; btn.disabled = false; }
      });
    };
    draw();
  }

  const ROLE = { admin: 'Admin', editor: 'Editor', viewer: 'View only' };
  const TABS = [['dashboard', 'Dashboard', 'dash'], ['links', 'Links', 'link'], ['records', 'Daily records', 'list'], ['members', 'Members', 'users'], ['team', 'Team', 'team']];

  function showShell() {
    const initial = (me.display_name || me.username || '?').trim().charAt(0).toUpperCase();
    root.innerHTML = `<div class="shell ${me.role === 'viewer' ? 'viewer' : ''}">
        <aside class="side">
          <div class="brand"><div class="brand-mark">${icon.logo}</div>SignUp Hub</div>
          <nav class="nav" aria-label="Main">${TABS.map(([k, t, i]) => `<a href="#/${k}" data-tab="${k}">${icon[i]}<span>${t}</span></a>`).join('')}</nav>
          <div class="side-foot">
            <div class="who-card"><div class="avatar" aria-hidden="true">${esc(initial)}</div><div><b>${esc(me.display_name)}</b><span>${ROLE[me.role] || 'Viewer'}</span></div></div>
            <div class="side-btns"><button class="btn sm icon" data-theme-btn aria-label="Switch light or dark mode" title="Switch light or dark mode">${icon.moon}</button>
              <button class="btn sm" data-logout>${icon.out} Sign out</button></div>
          </div>
        </aside>
        <div>
          <div class="mobile-bar"><div class="brand"><div class="brand-mark">${icon.logo}</div>SignUp Hub</div>
            <div class="toolbar"><button class="btn sm" data-theme-btn aria-label="Switch light or dark mode">${icon.moon}</button><button class="btn sm" data-logout>Sign out</button></div></div>
          <main><div class="content" id="view"></div></main>
        </div>
      </div>
      <nav class="tabbar" aria-label="Main">${TABS.map(([k, t, i]) => `<a href="#/${k}" data-tab="${k}">${icon[i]}<span>${t === 'Daily records' ? 'Records' : t}</span></a>`).join('')}</nav>`;
    $$('[data-theme-btn]').forEach((b) => (b.onclick = toggleTheme));
    $$('[data-logout]').forEach((b) => (b.onclick = async () => { try { await api('POST', '/api/auth/logout'); } catch {} me = null; showAuth(); }));
    route();
  }

  const pages = { dashboard: pageDashboard, links: pageLinks, records: pageRecords, members: pageMembers, team: pageTeam };
  function route() {
    if (!me) return;
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    const name = pages[path] ? path : 'dashboard';
    cleanup?.(); cleanup = null;
    $$('[data-tab]').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === name ? 'page' : 'false'));
    const view = $('#view'); if (!view) return;
    view.innerHTML = '';
    window.scrollTo(0, 0);
    pages[name](view, new URLSearchParams(qs || '')).catch((e) => { view.innerHTML = `<div class="card empty"><strong>Couldn't load this page</strong>${esc(e.message)}</div>`; });
  }
  window.addEventListener('hashchange', route);

  /* ======================================================================
     LINKS
     ====================================================================== */
  const stubsHtml = (taken, cap, big) => `<div class="stubs" aria-hidden="true">${Array.from({ length: cap }, (_, i) => `<span class="stub ${big ? 'lg' : ''} ${i < taken ? 'on' : ''}">${i < taken ? icon.check : ''}</span>`).join('')}</div>`;

  async function pageLinks(el) {
    el.innerHTML = `<div class="page-head"><div><h1>Sign-up links</h1>
      <p>Share a link. The first people to fill it in each day are recorded, up to the daily limit.</p></div></div>
      <form class="card create-form" id="newLink">
        <label class="field"><span>Link title</span><input class="input" name="title" maxlength="80" placeholder="e.g. Friday outreach sign-up" required></label>
        <label class="field"><span>People per day</span><input class="input" name="daily_cap" type="number" min="1" max="500" value="3" required></label>
        <button class="btn primary" style="min-height:46px" type="submit">Create link</button>
      </form><div class="link-grid" id="linkList"></div>`;
    const list = $('#linkList', el);
    let links = [];

    const urlOf = (l) => `${location.origin}/j/${l.slug}`;
    const draw = () => {
      if (!links.length) { list.innerHTML = `<div class="card empty"><div class="ico">${icon.link}</div><strong>No links yet</strong>Create your first link above, then share it with the people you want to sign up.</div>`; return; }
      list.innerHTML = links.map((l) => {
        const full = l.taken_today >= l.daily_cap;
        const state = !l.is_open ? 'closed' : full ? 'full' : 'open';
        const badge = state === 'closed' ? '<span class="badge"><span class="dot"></span>Closed</span>'
          : state === 'full' ? '<span class="badge warn"><span class="dot"></span>Full today</span>'
          : '<span class="badge good"><span class="dot"></span>Open</span>';
        return `<article class="card link-card ${state}" data-id="${l.id}">
          <div class="link-top">
            <div><div class="link-title"><h2>${esc(l.title)}</h2>${badge}</div>
              <p class="mini" style="margin-top:4px">Created ${esc(fmtDay(l.created_at.slice(0, 10)))}</p></div>
            <label class="switch"><input type="checkbox" data-act="toggle" ${l.is_open ? 'checked' : ''}><span class="track"></span><span>${l.is_open ? 'Taking records' : 'Closed'}</span></label>
          </div>
          <div class="url-row"><div class="url-box" title="${esc(urlOf(l))}">${esc(urlOf(l))}</div>
            <button class="btn sm" data-act="copy">${icon.copy} Copy link</button>
            <a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(l.title + ' — sign up here: ' + urlOf(l))}">Share on WhatsApp</a></div>
          <div class="spots"><div class="line"><span class="sub"><b class="num">${l.taken_today}</b> of ${l.daily_cap} spots taken today</span></div>
            ${l.daily_cap <= 12 ? stubsHtml(l.taken_today, l.daily_cap) : `<div class="progress ${full ? 'full' : ''}"><i style="width:${Math.min(100, pct(l.taken_today, l.daily_cap))}%"></i></div>`}</div>
          <div class="link-foot"><div class="toolbar">
            <a class="btn sm" href="#/records?link=${l.id}">View today's records</a>
            <button class="btn sm" data-act="edit">Edit</button></div>
            <button class="btn sm danger ghost" data-act="archive">${icon.trash} Remove link</button></div>
        </article>`;
      }).join('');
    };
    const load = async () => { const j = await api('GET', '/api/links'); links = j.links; today = j.today; draw(); };

    $('#newLink', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget, btn = $('button', f); btn.disabled = true;
      try { await api('POST', '/api/links', Object.fromEntries(new FormData(f))); f.reset(); f.daily_cap.value = 3; toast('Link created'); await load(); }
      catch (ex) { toast(ex.message); }
      btn.disabled = false;
    });

    list.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const card = b.closest('.link-card'); const l = links.find((x) => x.id === Number(card.dataset.id));
      if (b.dataset.act === 'copy') copyText(urlOf(l));
      if (b.dataset.act === 'edit') {
        await formDialog({
          title: 'Edit link', submit: 'Save changes',
          fields: [{ name: 'title', label: 'Title', value: l.title, maxlength: 80 }, { name: 'daily_cap', label: 'People per day', type: 'number', value: l.daily_cap, min: 1, max: 500 }],
          onSubmit: (v) => api('PATCH', `/api/links/${l.id}`, v),
        });
        load();
      }
      if (b.dataset.act === 'archive') {
        await confirmDialog('Remove this link?', `"${l.title}" will stop working immediately. Everything it already recorded is kept in your records and dashboard.`, 'Remove link', () => api('DELETE', `/api/links/${l.id}`));
        load();
      }
    });
    list.addEventListener('change', async (e) => {
      if (e.target.dataset.act !== 'toggle') return;
      const l = links.find((x) => x.id === Number(e.target.closest('.link-card').dataset.id));
      try { await api('PATCH', `/api/links/${l.id}`, { is_open: e.target.checked }); toast(e.target.checked ? 'Link is open and recording' : 'Link closed'); }
      catch (ex) { toast(ex.message); }
      load();
    });

    await load();
    const t = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 15000);
    cleanup = () => clearInterval(t);
  }


  /* ---------------- Team ---------------- */
  async function pageTeam(el) {
    el.innerHTML = `<div class="page-head"><div><h1>Team</h1><p id="teamHint"></p></div></div><section class="card"><div class="rec-list team-list" id="teamList"></div></section>`;
    let data = null;
    const draw = () => {
      const canManage = data.can_manage;
      $('#teamHint', el).textContent = canManage
        ? 'Everyone who signs up can view the data. Give people Editor access if they should be able to change things.'
        : 'Everyone here can view the data. Only the admin decides who can edit.';
      $('#teamList', el).innerHTML = data.members.map((u) => `<div class="rec team-row" data-id="${u.id}">
        <div class="avatar" aria-hidden="true">${esc((u.display_name || '?').charAt(0).toUpperCase())}</div>
        <div class="rec-body"><strong class="rec-name">${esc(u.display_name)}${u.id === data.me ? ' <span class="muted">(you)</span>' : ''}</strong>
          <div class="rec-sub">@${esc(u.username)}</div></div>
        ${canManage && u.role !== 'admin'
          ? `<div class="team-acts"><select class="input sm" data-act="role" aria-label="Role for ${esc(u.display_name)}"><option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>View only</option><option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Editor (full access)</option></select>
            <button class="btn sm danger icon-only" data-act="remove" aria-label="Remove ${esc(u.display_name)}">${icon.trash}</button></div>`
          : `<span class="badge ${u.role === 'viewer' ? '' : 'good'}">${ROLE[u.role]}</span>`}
      </div>`).join('');
    };
    const load = async () => { data = await api('GET', '/api/team'); draw(); };
    el.addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-act=role]'); if (!sel) return;
      try { await api('PATCH', `/api/team/${sel.closest('[data-id]').dataset.id}`, { role: sel.value }); toast('Access updated'); } catch (ex) { toast(ex.message); }
      load();
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act=remove]'); if (!b) return;
      const u = data.members.find((x) => x.id === Number(b.closest('[data-id]').dataset.id));
      await confirmDialog('Remove this person?', `${u.display_name} will be signed out and their account deleted. They can sign up again as view only.`, 'Remove', () => api('DELETE', `/api/team/${u.id}`));
      load();
    });
    await load();
  }

  const CARD_Q = '(max-width: 1279px)';
  const isPhone = () => matchMedia(CARD_Q).matches;
  const isSmall = () => matchMedia('(max-width: 760px)').matches;

  /* ======================================================================
     DAILY RECORDS
     ====================================================================== */
  async function pageRecords(el, qs) {
    let date = qs.get('date') || today;
    let linkId = Number(qs.get('link')) || 0;
    let data = null;
    const sel = new Set();

    el.innerHTML = `<div class="page-head"><div><h1>Daily records</h1><p id="dateLong"></p></div>
      <div class="toolbar">
        <button class="btn sm" id="prev" aria-label="Previous day">${icon.left}</button>
        <input class="input sm" type="date" id="datePick" style="width:auto" aria-label="Date">
        <button class="btn sm" id="next" aria-label="Next day">${icon.right}</button>
        <button class="btn sm" id="todayBtn">Today</button>
        <select class="input sm" id="linkSel" style="width:auto;max-width:200px" aria-label="Filter by link"></select>
      </div></div>
      <div class="chips" id="chips"></div>
      <section class="card">
        <div class="card-bar"><h2 id="count">Records</h2>
          <div class="toolbar"><button class="btn sm" id="addAll">Add all to database</button><a class="btn sm" id="export">Export CSV</a>
          <button class="btn sm danger" id="delAll">${icon.trash} Delete all</button></div></div>
        <div class="sel-bar hidden" id="selBar"><span id="selCount"></span>
          <button class="btn sm danger solid" id="delSel">${icon.trash} Delete selected</button><button class="btn sm ghost" id="clearSel">Clear</button></div>
        <div class="table-wrap" id="tbl"></div></section>`;

    const drawSel = () => {
      $$('#tbl [data-id]', el).forEach((row) => {
        const on = sel.has(Number(row.dataset.id)); row.classList.toggle('sel', on); $('.chk', row).checked = on;
      });
      const all = $('#selAll', el); if (all) { all.checked = data.rows.length > 0 && sel.size === data.rows.length; all.indeterminate = sel.size > 0 && sel.size < data.rows.length; }
      $('#selBar', el).classList.toggle('hidden', !sel.size);
      $('#selCount', el).textContent = `${sel.size} selected`;
    };
    const draw = () => {
      for (const id of [...sel]) if (!data.rows.some((r) => r.id === id)) sel.delete(id);
      $('#datePick', el).value = data.date;
      $('#dateLong', el).textContent = fmtLong(data.date) + (data.date === data.today ? ' (today)' : '');
      $('#linkSel', el).innerHTML = '<option value="0">All links</option>' + data.links.map((l) => `<option value="${l.id}" ${l.id === linkId ? 'selected' : ''}>${esc(l.title)}${l.archived ? ' (removed)' : ''}</option>`).join('');
      $('#chips', el).innerHTML = data.links.map((l) => `<div class="card chip"><div class="row"><span style="font-weight:700">${esc(l.title)}</span>
          <span class="badge ${l.is_open ? 'good' : ''}">${l.archived ? 'Removed' : l.is_open ? 'Open' : 'Closed'}</span></div>
          <div class="row"><b class="num">${l.taken}<span class="muted" style="font-size:15px;font-weight:600"> / ${l.cap}</span></b><span class="mini">spots taken</span></div>
          <div class="progress ${l.taken >= l.cap ? 'full' : ''}"><i style="width:${Math.min(100, pct(l.taken, l.cap))}%"></i></div></div>`).join('');
      $('#count', el).textContent = `${data.rows.length} ${data.rows.length === 1 ? 'person' : 'people'} recorded`;
      $('#export', el).href = `/api/records/export?date=${data.date}`;
      $('#addAll', el).disabled = !data.rows.some((r) => !r.in_members);
      $('#delAll', el).disabled = !data.rows.length;
      const cards = () => `<label class="selrow"><input class="chk" type="checkbox" id="selAll" aria-label="Select all"><span>Select all</span></label>
        <div class="rec-list">${data.rows.map((r, i) => `<article class="rec" data-id="${r.id}">
          <input class="chk" type="checkbox" aria-label="Select ${esc(r.name)}">
          <div class="rec-body">
            <div class="rec-top"><span class="rank num">${i + 1}</span><strong class="rec-name">${esc(r.name)}</strong></div>
            <div class="rec-meta"><a class="rec-call" href="tel:${esc(r.phone)}">${icon.phone}${esc(r.phone)}</a><span class="badge">${esc(r.network)}</span></div>
            <div class="rec-sub">${esc(r.link_title)} · ${esc(fmtTime(r.created_at))}</div>
            <div class="rec-actions">${r.in_members ? '<span class="badge good">In database</span>' : '<button class="btn sm" data-act="add">Add to database</button>'}
              <button class="btn sm danger" data-act="del">${icon.trash} Delete</button></div>
          </div></article>`).join('')}</div>`;
      const table = () => `<table class="tbl"><thead><tr>
          <th style="width:46px"><input class="chk" type="checkbox" id="selAll" aria-label="Select all"></th><th>#</th><th>Name</th><th>Phone</th><th>Network</th><th>Link</th><th>Time</th><th>Database</th><th></th></tr></thead><tbody>
          ${data.rows.map((r, i) => `<tr data-id="${r.id}"><td><input class="chk" type="checkbox" aria-label="Select ${esc(r.name)}"></td>
            <td><span class="rank num">${i + 1}</span></td>
            <td style="font-weight:700">${esc(r.name)}</td>
            <td class="num"><a href="tel:${esc(r.phone)}" style="color:inherit">${esc(r.phone)}</a></td>
            <td>${esc(r.network)}</td><td class="sub">${esc(r.link_title)}</td><td class="num sub">${esc(fmtTime(r.created_at))}</td>
            <td>${r.in_members ? '<span class="badge good">In database</span>' : '<button class="btn sm" data-act="add">Add</button>'}</td>
            <td class="r"><button class="btn sm danger ghost" data-act="del" title="Delete this record and free the spot">${icon.trash} Delete</button></td></tr>`).join('')}
        </tbody></table>`;
      $('#tbl', el).innerHTML = data.rows.length ? (isPhone() ? cards() : table())
        : `<div class="empty"><div class="ico">${icon.list}</div><strong>No records for this day</strong>${data.date === data.today ? 'Share an open link. People who fill it in will appear here right away.' : 'Nobody signed up on this date.'}</div>`;
      drawSel();
    };
    const load = async () => {
      data = await api('GET', `/api/records?date=${date}${linkId ? '&link_id=' + linkId : ''}`);
      date = data.date; today = data.today; draw();
    };
    const go = () => { sel.clear(); load(); };

    $('#datePick', el).addEventListener('change', (e) => { if (e.target.value) { date = e.target.value; go(); } });
    $('#prev', el).onclick = () => { date = addDays(date, -1); go(); };
    $('#next', el).onclick = () => { date = addDays(date, 1); go(); };
    $('#todayBtn', el).onclick = () => { date = today; go(); };
    $('#linkSel', el).addEventListener('change', (e) => { linkId = Number(e.target.value); go(); });
    $('#addAll', el).onclick = async () => {
      try { const j = await api('POST', '/api/records/add-members', { date }); toast(j.added ? `Added ${j.added} new ${j.added === 1 ? 'person' : 'people'} to your database` : 'Everyone is already in your database'); load(); }
      catch (ex) { toast(ex.message); }
    };
    $('#clearSel', el).onclick = () => { sel.clear(); drawSel(); };
    $('#delSel', el).onclick = async () => {
      const ids = [...sel];
      if (await confirmDialog(`Delete ${ids.length} ${ids.length === 1 ? 'record' : 'records'}?`, 'They will be removed for good, and their spots become free again for other people.', 'Delete', async () => { const j = await api('POST', '/api/records/delete', { ids }); toast(`Deleted ${j.deleted} ${j.deleted === 1 ? 'record' : 'records'}`); })) { sel.clear(); load(); }
    };
    $('#delAll', el).onclick = async () => {
      const n = data.rows.length, scope = linkId ? 'for this link on ' : 'on ';
      if (await confirmDialog(`Delete all ${n} ${n === 1 ? 'record' : 'records'}?`, `Everything recorded ${scope}${fmtLong(data.date)} will be removed for good. The spots become free again. People already in your Members database are not affected.`, 'Delete all', async () => { const j = await api('POST', '/api/records/delete', { date: data.date, link_id: linkId || undefined }); toast(`Deleted ${j.deleted} ${j.deleted === 1 ? 'record' : 'records'}`); })) { sel.clear(); load(); }
    };
    $('#tbl', el).addEventListener('change', (e) => {
      if (!e.target.classList.contains('chk')) return;
      if (e.target.id === 'selAll') { sel.clear(); if (e.target.checked) data.rows.forEach((r) => sel.add(r.id)); }
      else { const id = Number(e.target.closest('[data-id]').dataset.id); e.target.checked ? sel.add(id) : sel.delete(id); }
      drawSel();
    });
    $('#tbl', el).addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = Number(b.closest('[data-id]').dataset.id);
      try {
        if (b.dataset.act === 'add') { await api('POST', `/api/records/${id}/add-member`); toast('Added to your database'); }
        if (b.dataset.act === 'del') {
          const r = data.rows.find((x) => x.id === id);
          if (!(await confirmDialog('Delete this record?', `${r.name} will be removed from the list and their spot becomes free again for someone else.`, 'Delete', () => api('DELETE', `/api/records/${id}`)))) return;
          sel.delete(id);
        }
      } catch (ex) { toast(ex.message); }
      load();
    });

    await load();
    const mq = matchMedia(CARD_Q), onResize = () => { if (data) draw(); };
    mq.addEventListener('change', onResize);
    const t = setInterval(() => { if (!document.hidden && date === today) load().catch(() => {}); }, 15000);
    cleanup = () => { clearInterval(t); mq.removeEventListener('change', onResize); };
  }

  /* ======================================================================
     MEMBERS  (call + attendance ticks for 2nd / 3rd / 4th Fridays)
     ====================================================================== */
  async function pageMembers(el, qs) {
    let month = /^\d{4}-\d{2}$/.test(qs.get('month') || '') ? qs.get('month') : '';
    let q = '', data = null, debounce;
    const sel = new Set();
    const NETS = ['MTN', 'Airtel', 'Glo', '9mobile', 'Other'];

    el.innerHTML = `<div class="page-head"><div><h1>Members</h1><p>Tick who was called and who attended on each 2nd, 3rd and 4th Friday.</p></div>
      <div class="toolbar"><button class="btn primary" id="addM">+ Add member</button><a class="btn" id="exportM">Export CSV</a></div></div>
      <div class="toolbar members-bar">
        <div class="month-nav"><button class="btn sm" id="pm" aria-label="Previous month">${icon.left}</button><strong id="monthLbl"></strong>
          <button class="btn sm" id="nm" aria-label="Next month">${icon.right}</button><button class="btn sm ghost" id="thisM">This month</button></div>
        <input class="input sm" id="search" type="search" placeholder="Search name or phone" aria-label="Search members"></div>
      <section class="card">
        <div class="sel-bar hidden" id="selBar"><span id="selCount"></span>
          <button class="btn sm danger solid" id="delSel">${icon.trash} Delete selected</button><button class="btn sm ghost" id="clearSel">Clear</button></div>
        <div class="table-wrap" id="mt"></div></section>`;

    const tot = (d) => `${data.totals[d].called} called, ${data.totals[d].attended} attended`;
    const evHead = (d, i) => `<th class="ev" colspan="2"><div class="d">${esc(fmtFri(d))}</div><div class="t">${ordinal[i]} Friday</div>
        <div class="t" data-tot="${d}">${tot(d)}</div></th>`;
    const tick = (m, d, f) => {
      const on = (m.status[d] || {})[f], future = f === 'attended' && d > data.today;
      return `<input class="tick ${f === 'attended' ? 'att' : ''}" type="checkbox" data-d="${d}" data-f="${f}" ${on ? 'checked' : ''} ${future ? 'disabled title="Available on the day"' : ''}
        aria-label="${esc(m.name)} ${f === 'called' ? 'called for' : 'attended'} ${esc(fmtFri(d))}">`;
    };

    const table = (ev) => `<table class="tbl m-table"><thead>
        <tr><th rowspan="2" class="sticky-col"><span class="namecell"><input class="chk" type="checkbox" id="selAll" aria-label="Select all">Name</span></th><th rowspan="2">Phone</th><th rowspan="2">Network</th>${ev.map(evHead).join('')}<th rowspan="2"></th></tr>
        <tr>${ev.map(() => '<th class="c" style="border-left:1px solid var(--border)">Called</th><th class="c">Attended</th>').join('')}</tr></thead><tbody>
        ${data.members.map((m) => `<tr data-id="${m.id}"><td class="sticky-col"><span class="namecell"><input class="chk" type="checkbox" aria-label="Select ${esc(m.name)}"><b>${esc(m.name)}</b></span></td>
          <td class="num"><a href="tel:${esc(m.phone)}" style="color:inherit">${esc(m.phone)}</a></td><td>${esc(m.network)}</td>
          ${ev.map((d) => `<td class="ev c">${tick(m, d, 'called')}</td><td class="c">${tick(m, d, 'attended')}</td>`).join('')}
          <td class="r" style="white-space:nowrap"><button class="btn sm ghost" data-act="edit">Edit</button><button class="btn sm ghost danger" data-act="del">Delete</button></td></tr>`).join('')}
        </tbody></table>`;

    const cards = (ev) => `<div class="ev-sum">${ev.map((d, i) => `<div class="ev-chip"><b>${esc(fmtFri(d))}</b><span class="mini">${ordinal[i]} Friday</span><span data-tot="${d}">${tot(d)}</span></div>`).join('')}</div>
      <label class="selrow"><input class="chk" type="checkbox" id="selAll" aria-label="Select all"><span>Select all (${data.members.length})</span></label>
      <div class="rec-list">${data.members.map((m) => `<article class="mem" data-id="${m.id}">
        <div class="mem-top"><input class="chk" type="checkbox" aria-label="Select ${esc(m.name)}">
          <div class="mem-id"><strong class="rec-name">${esc(m.name)}</strong>
            <div class="rec-meta"><a class="rec-call" href="tel:${esc(m.phone)}">${icon.phone}${esc(m.phone)}</a><span class="badge">${esc(m.network)}</span></div></div>
          <div class="mem-acts"><button class="btn sm icon-only" data-act="edit" aria-label="Edit ${esc(m.name)}">${icon.edit}</button>
            <button class="btn sm danger icon-only" data-act="del" aria-label="Delete ${esc(m.name)}">${icon.trash}</button></div></div>
        <div class="mem-evs">${ev.map((d) => `<div class="mem-ev"><div class="mem-ev-h"><b>${esc(fmtDay(d))}</b><span>Fri</span></div>
          <label class="pt">${tick(m, d, 'called')}<span>Called</span></label>
          <label class="pt att">${tick(m, d, 'attended')}<span>Attended</span></label></div>`).join('')}</div>
      </article>`).join('')}</div>`;

    const drawSel = () => {
      $$('#mt [data-id]', el).forEach((row) => { const on = sel.has(Number(row.dataset.id)); row.classList.toggle('sel', on); $('.chk', row).checked = on; });
      const all = $('#selAll', el); if (all) { all.checked = data.members.length > 0 && sel.size === data.members.length; all.indeterminate = sel.size > 0 && sel.size < data.members.length; }
      $('#selBar', el).classList.toggle('hidden', !sel.size);
      $('#selCount', el).textContent = `${sel.size} selected`;
    };
    const draw = () => {
      for (const id of [...sel]) if (!data.members.some((m) => m.id === id)) sel.delete(id);
      month = data.month;
      $('#monthLbl', el).textContent = fmtMonth(month);
      $('#exportM', el).href = `/api/members/export?month=${month}`;
      if (!data.total) {
        $('#mt', el).innerHTML = `<div class="empty"><strong>Your database is empty</strong>Add people here, or open <a href="#/records">Daily records</a> and press “Add all to database”.</div>`; drawSel(); return;
      }
      if (!data.members.length) { $('#mt', el).innerHTML = '<div class="empty"><strong>No match</strong>Try a different name or number.</div>'; drawSel(); return; }
      $('#mt', el).innerHTML = isPhone() ? cards(data.events) : table(data.events);
      drawSel();
    };
    const load = async () => {
      data = await api('GET', `/api/members?month=${month || ''}&q=${encodeURIComponent(q)}`);
      today = data.today; draw();
    };
    const memberFields = (m = {}) => [
      { name: 'name', label: 'Full name', value: m.name || '', maxlength: 80 },
      { name: 'phone', label: 'Phone number', value: m.phone || '', type: 'tel', inputmode: 'tel', placeholder: '08012345678', maxlength: 20 },
      { name: 'network', label: 'Network provider', options: NETS, value: m.network || 'MTN' },
    ];

    $('#pm', el).onclick = () => { month = data.prev; load(); };
    $('#nm', el).onclick = () => { month = data.next; load(); };
    $('#thisM', el).onclick = () => { month = today.slice(0, 7); load(); };
    $('#search', el).addEventListener('input', (e) => { clearTimeout(debounce); debounce = setTimeout(() => { q = e.target.value; load(); }, 250); });
    $('#addM', el).onclick = async () => {
      if (await formDialog({ title: 'Add member', fields: memberFields(), submit: 'Add member', onSubmit: (v) => api('POST', '/api/members', v) })) { toast('Member added'); load(); }
    };
    $('#clearSel', el).onclick = () => { sel.clear(); drawSel(); };
    $('#delSel', el).onclick = async () => {
      const ids = [...sel], n = ids.length;
      if (await confirmDialog(`Delete ${n} ${n === 1 ? 'member' : 'members'}?`, 'They and all their call and attendance ticks will be permanently deleted.', 'Delete', async () => { const j = await api('POST', '/api/members/delete', { ids }); toast(`Deleted ${j.deleted} ${j.deleted === 1 ? 'member' : 'members'}`); })) { sel.clear(); load(); }
    };

    $('#mt', el).addEventListener('change', async (e) => {
      const box = e.target;
      if (box.classList.contains('chk')) {
        if (box.id === 'selAll') { sel.clear(); if (box.checked) data.members.forEach((m) => sel.add(m.id)); }
        else { const id = Number(box.closest('[data-id]').dataset.id); box.checked ? sel.add(id) : sel.delete(id); }
        drawSel(); return;
      }
      if (!box.classList.contains('tick')) return;
      const id = Number(box.closest('[data-id]').dataset.id), m = data.members.find((x) => x.id === id);
      const { d, f } = box.dataset, value = box.checked;
      try {
        await api('PUT', `/api/members/${id}/status`, { date: d, field: f, value });
        m.status[d] = { ...(m.status[d] || {}), [f]: value };
        data.totals[d][f] += value ? 1 : -1;
        const t = $(`[data-tot="${d}"]`, el); if (t) t.textContent = tot(d);
      } catch (ex) { box.checked = !value; toast(ex.message); }
    });
    $('#mt', el).addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = Number(b.closest('[data-id]').dataset.id), m = data.members.find((x) => x.id === id);
      if (b.dataset.act === 'edit') {
        if (await formDialog({ title: 'Edit member', fields: memberFields(m), submit: 'Save changes', onSubmit: (v) => api('PATCH', `/api/members/${id}`, v) })) load();
      }
      if (b.dataset.act === 'del') {
        if (await confirmDialog('Delete this member?', `${m.name} and all their call and attendance ticks will be permanently deleted.`, 'Delete member', () => api('DELETE', `/api/members/${id}`))) { sel.delete(id); toast('Member deleted'); load(); }
      }
    });
    await load();
    const mq = matchMedia(CARD_Q), onResize = () => { if (data) draw(); };
    mq.addEventListener('change', onResize);
    cleanup = () => mq.removeEventListener('change', onResize);
  }

  /* ======================================================================
     DASHBOARD
     ====================================================================== */
  const charts = [];
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const slotColor = (slot) => (slot >= 5 ? css('--s-other') : css(`--s${slot + 1}`));

  const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw(chart, _a, o) {
      if (!o || !o.enabled) return;
      const { ctx } = chart;
      ctx.save(); ctx.font = '600 12px system-ui, sans-serif'; ctx.fillStyle = o.color; ctx.textBaseline = 'middle';
      chart.getDatasetMeta(0).data.forEach((bar, i) => ctx.fillText(o.format(chart.data.datasets[0].data[i], i), bar.x + 8, bar.y));
      ctx.restore();
    },
  };
  const endLabels = {
    id: 'endLabels',
    afterDatasetsDraw(chart, _a, o) {
      if (!o || !o.enabled) return;
      const { ctx } = chart; const pts = [];
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i); let k = ds.data.length - 1;
        while (k >= 0 && ds.data[k] == null) k--;
        if (k >= 0 && meta.data[k]) pts.push({ x: meta.data[k].x, y: meta.data[k].y, text: ds.label });
      });
      pts.sort((a, b) => a.y - b.y);
      for (let i = 1; i < pts.length; i++) if (pts[i].y - pts[i - 1].y < 15) pts[i].y = pts[i - 1].y + 15;
      ctx.save(); ctx.font = '600 12px system-ui, sans-serif'; ctx.fillStyle = o.color; ctx.textBaseline = 'middle';
      pts.forEach((p) => ctx.fillText(p.text, p.x + 10, p.y));
      ctx.restore();
    },
  };

  function theme() {
    return { text: css('--text'), t2: css('--text-2'), t3: css('--text-3'), grid: css('--grid'), surface: css('--surface'), border: css('--border') };
  }
  function baseOpts(t, o = {}) {
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: o.padding || { top: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: t.surface, titleColor: t.text, bodyColor: t.t2, footerColor: t.text, borderColor: t.border, borderWidth: 1, padding: 10, cornerRadius: 8, boxPadding: 5, usePointStyle: true, titleFont: { weight: '600' }, footerFont: { weight: '600' } },
        valueLabels: { enabled: false }, endLabels: { enabled: false },
      },
      scales: {
        x: { stacked: !!o.stacked, grid: { display: false }, border: { color: t.border }, ticks: { color: t.t3, maxRotation: 0, autoSkipPadding: 14 } },
        y: { stacked: !!o.stacked, beginAtZero: true, grid: { color: t.grid }, border: { display: false }, ticks: { color: t.t3, precision: 0, callback: o.yFmt } },
      },
    };
  }
  const legendHtml = (items) => items.map((i) => `<span><i style="background:${i.color}"></i>${esc(i.label)}</span>`).join('');
  const chartCard = (id, title, sub, legend, boxCls = '') => `<section class="card chart-card" id="card-${id}">
      <div class="chart-head"><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div><button class="btn sm ghost" data-table="${id}" aria-pressed="false">View as table</button></div>
      ${legend ? `<div class="legend">${legend}</div>` : ''}
      <div class="chart-box ${boxCls}"><canvas id="cv-${id}" role="img" aria-label="${esc(title)}"></canvas></div><div class="tbl-view hidden" id="tv-${id}"></div></section>`;
  const emptyCard = (title, sub, msg) => `<section class="card chart-card"><div class="chart-head"><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div></div><div class="empty" style="padding:36px 10px">${msg}</div></section>`;

  let dashData = null;
  window.addEventListener('themechange', () => { if (dashData && $('#dash')) drawDash(dashData); });

  async function pageDashboard(el) {
    let range = '30';
    try { range = localStorage.getItem('range') || '30'; } catch {}
    const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All time']];
    const hourNow = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: cfg.tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()), 10);
    const greet = hourNow < 12 ? 'Good morning' : hourNow < 17 ? 'Good afternoon' : 'Good evening';
    const first = (me.display_name || me.username).split(' ')[0];
    el.innerHTML = `<div class="page-head"><div><h1>${greet}, ${esc(first)}</h1><p>${esc(fmtLong(today))}</p></div>
      <div class="toolbar"><div class="seg" role="group" aria-label="Time range">${RANGES.map(([k, t]) => `<button data-r="${k}" aria-pressed="${k === range}">${t}</button>`).join('')}</div>
      <button class="btn sm" id="refresh">Refresh</button></div></div><div id="dash"></div>`;
    const load = async () => { dashData = await api('GET', `/api/analytics?range=${range}`); drawDash(dashData); };
    $('.seg', el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      range = b.dataset.r; try { localStorage.setItem('range', range); } catch {}
      $$('.seg button', el).forEach((x) => x.setAttribute('aria-pressed', x === b));
      load();
    });
    $('#refresh', el).onclick = load;
    const mq = matchMedia('(max-width: 760px)'), onBp = () => { if (dashData && $('#dash')) drawDash(dashData); };
    mq.addEventListener('change', onBp);
    cleanup = () => { mq.removeEventListener('change', onBp); charts.splice(0).forEach((c) => c.destroy()); dashData = null; };
    await load();
  }

  function drawDash(d) {
    charts.splice(0).forEach((c) => c.destroy());
    const host = $('#dash'); if (!host) return;
    const t = theme();
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.register(valueLabels, endLabels);
    const k = d.kpis, le = k.latest_event;
    const spans = d.range === 'all' ? 'all time' : `last ${d.range} days`;

    const kpi = (label, value, note) => `<div class="card kpi"><div class="k">${label}</div><div class="v">${value}</div><div class="d">${note}</div></div>`;
    const html = [];
    const nextIdx = d.monthEvents.findIndex((e) => e.when !== 'past');
    const ordLbl = { 2: '2nd', 3: '3rd', 4: '4th' };
    const ticket = (e, i) => {
      const dt = new Date(e.date + 'T00:00:00Z');
      const mon = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(dt);
      const cls = e.when === 'past' ? 'past' : i === nextIdx ? 'next' : '';
      const badge = e.when === 'today' ? '<span class="badge sun">Today</span>' : i === nextIdx ? '<span class="badge sun">Next up</span>' : e.when === 'past' ? '<span class="badge">Done</span>' : '';
      const meter = (label, n, color) => `<div class="meter"><div class="row"><span>${label}</span><span class="num"><b style="color:var(--text)">${n}</b> of ${e.eligible}</span></div><div class="bar"><i style="width:${pct(n, e.eligible)}%;background:${color}"></i></div></div>`;
      return `<article class="ticket ${cls}"><div class="date"><b>${dt.getUTCDate()}</b><span>${mon}</span></div><div class="info"><div class="head"><span>${ordLbl[e.nth]} Friday</span>${badge}</div>${meter('Called', e.called, 'var(--s1)')}${e.when === 'upcoming' ? '' : meter('Attended', e.attended, 'var(--s2)')}</div></article>`;
    };
    html.push(`<h2 class="section-title">This month's Fridays</h2><div class="tickets">${d.monthEvents.map(ticket).join('')}</div>`);
    const lastD = le ? fmtFri(le.date) : '';
    html.push(`<div class="kpis">
      ${kpi('Attended', le ? le.attended.toLocaleString() : '—', le ? `of ${le.eligible} members, ${lastD}` : 'No Friday yet')}
      ${kpi('Called', le ? le.called.toLocaleString() : '—', le ? `of ${le.eligible} members, ${lastD}` : 'No Friday yet')}
      ${kpi('Attendance rate', le && le.eligible ? Math.round((le.attended / le.eligible) * 100) + '%' : '—', le ? `of all members, ${lastD}` : '')}
      ${kpi('Called who came', k.conversion == null ? '—' : Math.round(k.conversion * 100) + '%', 'of members you called')}
    </div>`);

    // Who came: names for any Friday
    const evList = d.events.filter((e) => e.called || e.attended).slice(-8).reverse();
    let rosterDate = evList.length ? evList[0].date : null;
    const person = (p, tag) => `<div class="list-item"><span style="font-weight:600">${esc(p.name)}${tag ? ` <span class="badge sm">${tag}</span>` : ''}</span><a class="num sub" href="tel:${esc(p.phone)}">${esc(p.phone)}</a></div>`;
    const rosterBody = (date) => {
      const r = d.roster[date] || { attended: [], called_only: [] };
      const col = (title, cls, items, empty) => `<div class="roster-col"><h3><span class="badge ${cls}">${items.length}</span> ${title}</h3>${items.length ? `<div class="list">${items.join('')}</div>` : `<p class="mini">${empty}</p>`}</div>`;
      return `<div class="roster-grid">${col('Attended', 'good', r.attended.map((p) => person(p, p.called ? '' : 'not called')), 'Nobody ticked as attended yet.')}
        ${col('Called, did not come', 'warn', r.called_only.map((p) => person(p)), 'Everyone called came, or nobody was called yet.')}</div>`;
    };
    html.push(evList.length ? `<section class="card chart-card" id="roster"><div class="chart-head"><div><h2>Who came and who was called</h2><p>Pick a Friday to see the names</p></div></div>
      <div class="seg roster-pick" role="group" aria-label="Friday">${evList.map((e, i) => `<button data-date="${e.date}" aria-pressed="${i === 0}">${esc(fmtFri(e.date))}</button>`).join('')}</div>
      <div id="rosterBody">${rosterBody(rosterDate)}</div></section>`
      : emptyCard('Who came and who was called', 'Friday events', 'Tick Called and Attended on the Members page and the names will show here.'));
    const later = [];

    // 1 · sign-ups per day
    if (d.series.length) {
      later.push(`<div class="full">${chartCard('daily', 'Sign-ups per day', `Recorded people each day, by link (${spans})`, legendHtml(d.series.map((s) => ({ label: s.label, color: slotColor(s.slot) }))), 'tall')}</div>`);
    } else {
      later.push(`<div class="full">${emptyCard('Sign-ups per day', spans, 'No sign-ups in this period yet. Share an open link to get started.')}</div>`);
    }

    // 2 · networks + heat map
    const heatMax = Math.max(0, ...d.heat.flat());
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const hr = (h) => (h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : h - 12 + 'pm');
    let busiest = '';
    if (heatMax) { d.heat.forEach((row, di) => row.forEach((c, h) => { if (c === heatMax && !busiest) busiest = `${days[di]} around ${hr(h)} (${c} sign-up${c === 1 ? '' : 's'})`; })); }
    const small = isSmall();
    const cols = small ? 6 : 24, per = 24 / cols;
    const grid = d.heat.map((row) => Array.from({ length: cols }, (_, c) => row.slice(c * per, c * per + per).reduce((a, b) => a + b, 0)));
    const gMax = Math.max(0, ...grid.flat());
    const span = (c) => (small ? `${hr(c * per)}–${hr((c + 1) * per % 24)}` : hr(c));
    const heatHtml = heatMax ? `<div class="heat ${small ? 'coarse' : ''}" role="img" aria-label="Sign-ups by weekday and hour. Busiest: ${esc(busiest)}">
        <span></span>${Array.from({ length: cols }, (_, c) => `<span class="hl">${small ? hr(c * per).replace('am', 'a').replace('pm', 'p') : c % 3 === 0 ? hr(c).replace('am', 'a').replace('pm', 'p') : ''}</span>`).join('')}
        ${grid.map((row, di) => `<span class="lab">${days[di]}</span>${row.map((c, h) => `<span class="cell" data-tip="${days[di]} ${span(h)} · ${c} sign-up${c === 1 ? '' : 's'}" style="background:${c ? `var(--heat-${Math.min(4, Math.ceil((c / gMax) * 5) - 1)})` : 'var(--heat-zero)'}"></span>`).join('')}`).join('')}
      </div><div class="heat-legend"><span>Fewer</span>${[0, 1, 2, 3, 4].map((i) => `<i style="background:var(--heat-${i})"></i>`).join('')}<span>More</span></div>` : '';
    const left = d.networks.length ? chartCard('net', 'Network providers', `Share of sign-ups (${spans})`, '', 'short') : emptyCard('Network providers', spans, 'No data yet.');
    const right = heatMax
      ? `<section class="card chart-card"><div class="chart-head"><div><h2>When people sign up</h2><p>Busiest: ${esc(busiest)}. Times are in ${esc(d.tz)}.</p></div></div>${heatHtml}</section>`
      : emptyCard('When people sign up', spans, 'No data yet.');
    later.push(`<div class="grid-2">${left}${right}</div>`);

    // 3 · Friday events
    const evs = d.events.filter((e) => e.eligible || e.called || e.attended);
    if (evs.length) {
      html.push(`<div class="grid-2">
        ${chartCard('funnel', 'Who was called and who came', 'Members, called and attended at recent 2nd, 3rd and 4th Fridays', legendHtml([{ label: 'Members', color: css('--ord1') }, { label: 'Called', color: css('--ord2') }, { label: 'Attended', color: css('--ord3') }]))}
        ${chartCard('rates', 'Call and attendance rate', 'Share of members, per event', legendHtml([{ label: 'Called', color: css('--s1') }, { label: 'Attended', color: css('--s2') }]))}</div>`);
    } else {
      html.push(`<div class="full">${emptyCard('Who was called and who came', 'Members, called and attended', 'No event data yet. Add members and tick the Called / Attended boxes on the Members page.')}</div>`);
    }

    // 4 · link performance + members growth
    const stat = (l) => `${l.archived ? 'Removed' : l.is_open ? 'Open' : 'Closed'}, limit ${l.cap} a day`;
    const perfBody = small
      ? `<div class="perf-list">${d.linkPerf.map((l) => `<div class="perf"><div class="perf-top"><div><b>${esc(l.title)}</b><div class="mini">${stat(l)}</div></div><span class="num perf-n">${l.total}<small> sign-ups</small></span></div>
          <div class="bar-cell"><div class="progress"><i style="width:${pct(l.days_full, l.window_days)}%"></i></div><span class="num mini" style="white-space:nowrap">${l.days_full} / ${l.window_days} days full</span></div></div>`).join('')}</div>`
      : `<div class="table-wrap"><table class="tbl"><thead><tr><th>Link</th><th class="r">Sign-ups</th><th>Days full</th></tr></thead><tbody>
      ${d.linkPerf.map((l) => `<tr><td><div style="font-weight:600">${esc(l.title)}</div><div class="mini">${stat(l)}</div></td>
        <td class="r num">${l.total}</td>
        <td><div class="bar-cell"><div class="progress"><i style="width:${pct(l.days_full, l.window_days)}%"></i></div><span class="num mini" style="white-space:nowrap">${l.days_full} / ${l.window_days}</span></div></td></tr>`).join('')}
      </tbody></table></div>`;
    const perf = d.linkPerf.length ? `<section class="card chart-card"><div class="chart-head"><div><h2>Link performance</h2><p>How often each link fills its daily limit</p></div></div>${perfBody}</section>` : emptyCard('Link performance', '', 'Create a link to see how it performs.');
    const growth = k.members ? chartCard('growth', 'Members over time', `Total in database (${spans})`, '', 'short') : emptyCard('Members over time', spans, 'No members yet.');
    later.push(`<div class="grid-2">${perf}${growth}</div>`);

    // 5 · people lists
    const toCall = d.toCall;
    const callList = toCall.date ? `<section class="card chart-card"><div class="chart-head"><div><h2>Still to call</h2>
      <p>${esc(fmtFri(toCall.date))}: ${toCall.total} ${toCall.total === 1 ? 'member' : 'members'} not called yet</p></div><a class="btn sm" href="#/members?month=${toCall.date.slice(0, 7)}">Open members</a></div>
      ${toCall.people.length ? `<div class="list">${toCall.people.map((p) => `<div class="list-item"><span style="font-weight:600">${esc(p.name)}</span><a class="num sub" href="tel:${esc(p.phone)}">${esc(p.phone)}</a></div>`).join('')}</div>
        ${toCall.total > toCall.people.length ? `<p class="mini" style="margin-top:10px">+ ${toCall.total - toCall.people.length} more</p>` : ''}`
        : '<div class="empty" style="padding:26px 10px"><strong>Everyone has been called 🎉</strong></div>'}</section>` : '';
    const top = d.topAttendees.length ? `<section class="card chart-card"><div class="chart-head"><div><h2>Most consistent attendees</h2><p>Friday events attended, all time</p></div></div>
      <div class="list">${d.topAttendees.map((p, i) => `<div class="list-item"><span style="display:flex;align-items:center;gap:10px"><span class="rank num">${i + 1}</span><b>${esc(p.name)}</b></span><span class="badge good num">${p.attended} attended</span></div>`).join('')}</div></section>`
      : emptyCard('Most consistent attendees', 'Friday events attended', 'Attendance ticks will show up here.');
    html.push(`<div class="grid-2">${callList || emptyCard('Still to call', '', 'No upcoming event found.')}${top}</div>`);

    html.push(`<h2 class="section-title" style="margin-top:28px">Sign-up activity</h2>`, ...later);
    host.innerHTML = html.join('');

    const rp = $('.roster-pick', host);
    if (rp) rp.addEventListener('click', (e) => {
      const b = e.target.closest('[data-date]'); if (!b) return;
      $$('button', rp).forEach((x) => x.setAttribute('aria-pressed', x === b));
      $('#rosterBody', host).innerHTML = rosterBody(b.dataset.date);
    });

    /* ----- build charts ----- */
    const mk = (id, cfgObj) => { const cv = $('#cv-' + id, host); if (!cv) return; const c = new Chart(cv, cfgObj); c._id = id; charts.push(c); return c; };
    const dayLabels = d.days.map(fmtDay);

    if (d.series.length) {
      mk('daily', {
        type: 'bar',
        data: { labels: dayLabels, datasets: d.series.map((s) => ({ label: s.label, data: s.data, backgroundColor: slotColor(s.slot), borderColor: t.surface, borderWidth: 2, borderRadius: 4, borderSkipped: false, maxBarThickness: 26 })) },
        options: (() => { const o = baseOpts(t, { stacked: true }); o.plugins.tooltip.callbacks = { footer: (items) => (items.length > 1 ? 'Total: ' + items.reduce((n, i) => n + i.parsed.y, 0) : '') }; return o; })(),
      });
    }
    if (d.networks.length) {
      const total = d.networks.reduce((n, x) => n + x.count, 0);
      const o = baseOpts(t, { padding: { top: 4, right: 70 } });
      o.indexAxis = 'y'; o.interaction = { mode: 'nearest', intersect: true };
      o.scales.x.grid = { color: t.grid }; o.scales.x.border = { display: false }; o.scales.x.ticks = { color: t.t3, precision: 0 };
      o.scales.y = { grid: { display: false }, border: { color: t.border }, ticks: { color: t.t2, font: { weight: '600' } } };
      o.plugins.valueLabels = { enabled: true, color: t.text, format: (v) => `${v} (${pct(v, total)}%)` };
      o.plugins.tooltip.callbacks = { label: (c) => ` ${c.parsed.x} sign-ups (${pct(c.parsed.x, total)}%)` };
      mk('net', { type: 'bar', data: { labels: d.networks.map((n) => n.name), datasets: [{ label: 'Sign-ups', data: d.networks.map((n) => n.count), backgroundColor: css('--s1'), borderRadius: 5, borderSkipped: 'start', maxBarThickness: 26 }] }, options: o });
    }
    if (evs.length) {
      const labels = evs.map((e) => fmtFri(e.date));
      mk('funnel', {
        type: 'bar',
        data: { labels, datasets: [
          { label: 'Members', data: evs.map((e) => e.eligible), backgroundColor: css('--ord1') },
          { label: 'Called', data: evs.map((e) => e.called), backgroundColor: css('--ord2') },
          { label: 'Attended', data: evs.map((e) => e.attended), backgroundColor: css('--ord3') },
        ].map((x) => ({ ...x, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 16, borderColor: t.surface, borderWidth: 1 })) },
        options: baseOpts(t),
      });
      const rate = (n, e) => (e.eligible ? Math.round((n / e.eligible) * 100) : null);
      const o = baseOpts(t, { padding: { top: 6, right: 84 }, yFmt: (v) => v + '%' });
      o.scales.y.max = 100; o.scales.y.ticks.precision = 0;
      o.plugins.endLabels = { enabled: true, color: t.t2 };
      o.plugins.tooltip.callbacks = { label: (c) => ` ${c.dataset.label}: ${c.parsed.y ?? '–'}%` };
      const line = (label, key, color) => ({ label, data: evs.map((e) => rate(e[key], e)), borderColor: color, backgroundColor: color, pointBackgroundColor: color, pointBorderColor: t.surface, pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2, tension: 0.2, spanGaps: true });
      mk('rates', { type: 'line', data: { labels, datasets: [line('Called', 'called', css('--s1')), line('Attended', 'attended', css('--s2'))] }, options: o });
    }
    if (k.members) {
      const o = baseOpts(t);
      mk('growth', { type: 'line', data: { labels: dayLabels, datasets: [{ label: 'Members', data: d.membersCum, borderColor: css('--s1'), backgroundColor: css('--s1') + '22', fill: true, borderWidth: 2, pointRadius: d.days.length > 45 ? 0 : 3, pointHoverRadius: 5, pointBackgroundColor: css('--s1'), pointBorderColor: t.surface, pointBorderWidth: 2, tension: 0.2 }] }, options: o });
    }
  }

  /* ---- "view as table" toggle + heat-map tooltip (document-level, so they survive re-renders) ---- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-table]'); if (!b) return;
    const id = b.dataset.table, chart = charts.find((c) => c._id === id); if (!chart) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on); b.textContent = on ? 'View as chart' : 'View as table';
    const box = $('#card-' + id + ' .chart-box'), tv = $('#tv-' + id);
    box.classList.toggle('hidden', on); tv.classList.toggle('hidden', !on);
    if (on) {
      const ds = chart.data.datasets;
      tv.innerHTML = `<table class="tbl"><thead><tr><th></th>${ds.map((x) => `<th class="r">${esc(x.label)}</th>`).join('')}</tr></thead><tbody>
        ${chart.data.labels.map((l, i) => `<tr><td>${esc(l)}</td>${ds.map((x) => `<td class="r num">${x.data[i] ?? '–'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
  });
  let tip;
  document.addEventListener('pointermove', (e) => {
    const c = e.target.closest?.('.cell[data-tip]');
    if (!c) { tip?.remove(); tip = null; return; }
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.append(tip); }
    tip.textContent = c.dataset.tip;
    tip.style.left = Math.min(innerWidth - 230, e.clientX + 12) + 'px'; tip.style.top = e.clientY + 14 + 'px';
  });

  boot();
})();