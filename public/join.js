(() => {
  const slug = location.pathname.split('/').filter(Boolean).pop();
  const card = document.getElementById('card');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let info = null, done = false, timer = null;

  const icons = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>',
    no: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  };
  const stateView = (kind, title, text) => `
    <div class="big-state"><div class="ico ${kind}">${icons[kind]}</div><h2>${esc(title)}</h2><p class="sub">${esc(text)}</p></div>`;

  function pips() {
    return Array.from({ length: Math.min(info.cap, 12) }, (_, i) => `<span class="pip ${i < info.taken ? 'on' : ''}"></span>`).join('');
  }

  function render(error) {
    if (done) return;
    if (!info) { card.innerHTML = stateView('no', 'Link not found', 'This sign-up link does not exist or was removed.'); return; }
    if (info.state === 'closed') { card.innerHTML = `<h1>${esc(info.title)}</h1>` + stateView('no', 'Sign-up is closed', 'This link is not taking sign-ups right now. Please check back later.'); return; }
    if (info.state === 'full') { card.innerHTML = `<h1>${esc(info.title)}</h1>` + stateView('stop', "Today's spots are filled", 'Everyone who was quick enough has already signed up. Try again tomorrow.'); return; }

    const keep = card.querySelector('form') ? Object.fromEntries(new FormData(card.querySelector('form'))) : {};
    card.innerHTML = `
      <h1>${esc(info.title)}</h1>
      <p class="sub">Fill in your details to take one of today's spots. First come, first served.</p>
      <div class="slots"><div class="pips" aria-hidden="true">${pips()}</div><span class="num"><b>${info.remaining}</b> of ${info.cap} spots left today</span></div>
      <form class="join" novalidate>
        <label class="field"><span>Full name</span><input class="input" name="name" autocomplete="name" maxlength="80" required value="${esc(keep.name || '')}"></label>
        <label class="field"><span>Phone number</span><input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="08012345678" maxlength="20" required value="${esc(keep.phone || '')}"></label>
        <fieldset style="border:0;padding:0;margin:0">
          <legend class="field"><span style="font-size:13px;font-weight:500;color:var(--text-2);margin-bottom:6px;display:block">Network provider</span></legend>
          <div class="nets">${info.networks.map((n) => `<label><input type="radio" name="network" value="${esc(n)}" ${keep.network === n ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div>
        </fieldset>
        <div class="form-err" role="alert">${error ? esc(error) : ''}</div>
        <button class="btn primary" style="min-height:46px;font-size:16px" type="submit">Take my spot</button>
      </form>`;
    card.querySelector('form').addEventListener('submit', submit);
  }

  async function load() {
    try {
      const r = await fetch(`/api/public/${encodeURIComponent(slug)}`);
      info = r.ok ? await r.json() : null;
    } catch { return; }
    // While someone is typing, only refresh the spots counter — never rebuild the form under their fingers.
    const slots = card.querySelector('.slots');
    if (slots && info && info.state === 'open') {
      slots.querySelector('.pips').innerHTML = pips();
      slots.querySelector('.num').innerHTML = `<b>${info.remaining}</b> of ${info.cap} spots left today`;
      return;
    }
    render();
  }

  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector('button');
    const err = form.querySelector('.form-err');
    const body = Object.fromEntries(new FormData(form));
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const r = await fetch(`/api/public/${encodeURIComponent(slug)}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        done = true; clearInterval(timer);
        card.innerHTML = stateView('ok', "You're in!", `Your details were recorded for ${j.title}.`) +
          `<div style="text-align:center"><div class="pos num">#${j.position}</div><p class="muted">of ${j.cap} spots today</p></div>`;
        return;
      }
      if (j.state) { info = { ...info, state: j.state }; await load(); return; }
      err.textContent = j.error || 'Something went wrong. Please try again.';
    } catch {
      err.textContent = 'No connection. Check your network and try again.';
    }
    btn.disabled = false; btn.textContent = 'Take my spot';
  }

  load();
  timer = setInterval(() => { if (!done && !document.hidden) load(); }, 10000);
})();
