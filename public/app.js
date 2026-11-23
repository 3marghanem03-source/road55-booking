import * as C from './core.js';

const $ = (s, el = document) => el.querySelector(s);
const LS_KEY = 'r55-contact';
const SS_KEY = 'r55-last-booking';

const state = {
  offset: 0,          // server clock - device clock
  dates: [],
  date: null,
  days: {},           // date -> { close, bookings }
  room: null,
  sel: [],
  dur: 2,             // quick pick: hours selected by one tap
  stage: 1,
  booking: null,
};
const now = () => Date.now() + state.offset;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = {
  get(k, s = localStorage) { try { return JSON.parse(s.getItem(k) || 'null'); } catch { return null; } },
  set(k, v, s = localStorage) { try { v == null ? s.removeItem(k) : s.setItem(k, JSON.stringify(v)); } catch {} },
};

export const hoursLabel = (n) => (n === 1 ? 'ساعة' : n === 2 ? 'ساعتين' : n <= 10 ? `${n} ساعات` : `${n} ساعة`);

// ---------- API ----------
async function api(body, date) {
  const t0 = Date.now();
  const res = body
    ? await fetch('/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    : await fetch(`/api?date=${encodeURIComponent(date)}`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (json && typeof json.now === 'number') state.offset = json.now - (t0 + Date.now()) / 2;
  return { status: res.status, body: json };
}

// ---------- Routing ----------
function route() {
  const admin = location.hash === '#admin';
  $('#public').hidden = admin;
  $('#admin').hidden = !admin;
  document.title = admin ? 'Road 55 | الإدارة' : 'Road 55 Gaming Center | احجز غرفتك';
  if (admin) import('./admin.js').then((m) => m.mountAdmin($('#admin')));
  else if (!state.date) initPublic();
}
addEventListener('hashchange', route);

// ---------- Public ----------
function initPublic() {
  state.dates = C.bookableDates(now());
  state.date = state.dates[0];
  renderPrices();
  renderDays();
  renderRooms();
  wireScroll();
  wireBar();
  wireForm();
  restoreLastBooking();
  loadDay(state.date);
  setInterval(() => { if (!document.hidden && state.stage === 1) loadDay(state.date, true); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.stage === 1) loadDay(state.date, true); });
  $('#footer-wa').href = C.whatsappLink('');
  // hero background after first paint so it never delays the headline
  requestAnimationFrame(() => setTimeout(initHero, 0));
}

async function initHero() {
  const hero = $('.hero');
  const canvas = $('#silk');
  const { startSilk } = await import('./silk.js');
  const silk = startSilk(canvas, { reduced: reducedMotion });
  // Optional real video: drop public/assets/hero.mp4 and it replaces the canvas.
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1200));
  idle(async () => {
    try {
      const r = await fetch('assets/hero.mp4', { method: 'HEAD' });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('video')) return;
      const v = document.createElement('video');
      Object.assign(v, { muted: true, loop: true, playsInline: true, autoplay: !reducedMotion, preload: 'metadata' });
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      v.poster = silk.snapshot();
      v.src = 'assets/hero.mp4';
      v.addEventListener('loadeddata', () => { silk.stop(); canvas.remove(); hero.classList.add('has-video'); }, { once: true });
      $('.hero-bg').appendChild(v);
    } catch {}
  });
}

function wireScroll() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-scroll]');
    if (!a) return;
    e.preventDefault();
    const id = a.dataset.scroll;
    const el = id === 'top' ? document.body : document.getElementById(id);
    el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  });
}

async function loadDay(date, silent = false) {
  try {
    const r = await api(null, date);
    if (r.status !== 200) throw new Error(r.body.message || 'error');
    const prev = state.days[date];
    state.days[date] = { close: r.body.close, bookings: r.body.bookings };
    // device clock may be off: recompute dates with server time
    const fresh = C.bookableDates(now());
    if (fresh.join() !== state.dates.join()) {
      state.dates = fresh;
      if (!fresh.includes(state.date)) { state.date = fresh[0]; state.room = null; state.sel = []; }
      renderDays();
    }
    if (date !== state.date) return;
    const lost = pruneSelection();
    if (!silent || JSON.stringify(prev) !== JSON.stringify(state.days[date]) || lost) renderRooms();
    if (lost) toast('في ساعات انحجزت هلأ، شيلناها من اختيارك');
    $('#notice').hidden = true;
  } catch {
    if (!silent) {
      const n = $('#notice');
      n.hidden = false;
      n.innerHTML = 'ما قدرنا نجيب المواعيد. <button class="btn btn-sm btn-ghost" type="button" id="retry">جرب كمان مرة</button>';
      $('#retry').onclick = () => loadDay(state.date);
    }
  }
}

function slotInfo() {
  const d = state.days[state.date];
  const slots = C.getSlots(state.date, d ? d.close : C.DEFAULT_CLOSE);
  const taken = d && state.room ? C.takenSlots(d.bookings, state.room) : new Set();
  const stateOf = (s) => C.slotState(state.date, s, taken, now());
  return { d, slots, stateOf, isFree: (s) => stateOf(s) === 'free' };
}

function pruneSelection() {
  if (!state.sel.length) return false;
  const { isFree } = slotInfo();
  if (state.sel.every(isFree)) return false;
  state.sel = [];
  return true;
}

function renderDays() {
  const wrap = $('#days');
  wrap.innerHTML = state.dates.map((d, i) => {
    const wd = C.weekday(d);
    const dn = i === 0 ? 'اليوم' : i === 1 ? 'بكرا' : C.DAY_NAMES[wd];
    const num = Number(d.slice(8));
    return `<button class="day" role="tab" type="button" data-date="${d}" aria-selected="${d === state.date}" aria-label="${C.formatDate(d)}">
      <span class="dn">${dn}</span><span class="dd">${num}</span>${wd === 5 ? '<span class="dx">يفتح 4م</span>' : ''}</button>`;
  }).join('');
  wrap.onclick = (e) => {
    const b = e.target.closest('.day');
    if (!b || b.dataset.date === state.date) return;
    state.date = b.dataset.date; state.room = null; state.sel = [];
    wrap.querySelectorAll('.day').forEach((x) => x.setAttribute('aria-selected', x === b));
    renderRooms();
    loadDay(state.date);
  };
}

function renderRooms() {
  const wrap = $('#rooms');
  const d = state.days[state.date];
  if (!d) {
    wrap.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    updateBar();
    return;
  }
  const t = now();
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset : {};
  wrap.innerHTML = C.ROOM_TYPES.map((type) => {
    const rooms = C.ROOMS.filter((r) => r.type === type.type);
    const cards = rooms.map((r) => {
      const a = C.roomAvailability(state.date, d, r.id, t);
      const open = state.room === r.id;
      const label = a.state === 'free' ? 'متاح' : a.state === 'full' ? 'مشغولة' : 'خلص الوقت';
      const btn = `<button class="room" type="button" data-room="${r.id}" aria-expanded="${open}" ${a.state !== 'free' ? 'disabled' : ''}>
        <span class="rn">${r.name}</span><span class="rp">${r.rate} د/ساعة</span><span class="rs">${label}</span></button>`;
      return open ? btn + slotPanel() : btn;
    }).join('');
    return `<div class="group"><div class="group-h"><h3>${type.label}</h3><span>${type.rate} د/ساعة</span></div><div class="room-grid">${cards}</div></div>`;
  }).join('');
  if (focused.slot) wrap.querySelector(`[data-slot="${focused.slot}"]`)?.focus({ preventScroll: true });
  else if (focused.room) wrap.querySelector(`[data-room="${focused.room}"]`)?.focus({ preventScroll: true });
  wrap.onclick = onRoomsClick;
  updateBar();
}

function slotPanel() {
  const { slots, stateOf } = slotInfo();
  const any = slots.some((s) => stateOf(s.start) === 'free');
  const cells = slots.map((s) => {
    const st = stateOf(s.start);
    const i = state.sel.indexOf(s.start);
    const cls = ['slot', st, i >= 0 ? 'sel' : '', i >= 0 && (i + 1) % 3 === 0 ? 'free-h' : ''].join(' ');
    const sub = st === 'booked' ? 'محجوز' : st === 'expired' ? 'خلص' : s.end - s.start < 60 ? 'نص ساعة' : '';
    return `<button type="button" class="${cls}" data-slot="${s.start}" aria-pressed="${i >= 0}" ${st !== 'free' ? 'disabled' : ''}>
      ${s.label}${sub ? `<small>${sub}</small>` : ''}</button>`;
  }).join('');
  const chips = [1, 2, 3, 4, 5, 6].map((h) =>
    `<button type="button" class="chip${h % 3 === 0 ? ' chip-deal' : ''}" data-dur="${h}" aria-pressed="${state.dur === h}">${h}${h % 3 === 0 ? `<small>${h === 3 ? 'ساعة' : 'ساعتين'} علينا</small>` : ''}</button>`).join('');
  return `<div class="slots-panel" id="panel">
    <div class="slots-head"><strong>كم ساعة بدك؟</strong><span class="hint">بعدين اكبس وقت البداية</span></div>
    <div class="chips" role="group" aria-label="عدد الساعات">${chips}</div>
    <div class="slots-head"><strong>ساعات ${C.formatDate(state.date)}</strong>${state.sel.length ? '<button type="button" class="link" data-clear>امسح</button>' : ''}</div>
    <div class="legend"><span><i class="lg-free"></i>متاح</span><span><i class="lg-booked"></i>محجوز</span><span><i class="lg-sel"></i>اختيارك</span></div>
    ${any ? '' : '<p class="slots-empty">ما في ساعات فاضية بهالغرفة اليوم.</p>'}
    <div class="slot-grid">${cells}</div></div>`;
}

function onRoomsClick(e) {
  const chip = e.target.closest('[data-dur]');
  if (chip) {
    state.dur = Number(chip.dataset.dur);
    if (state.sel.length) quickPick(state.sel[0]);
    renderRooms();
    return;
  }
  if (e.target.closest('[data-clear]')) { state.sel = []; renderRooms(); return; }
  const slot = e.target.closest('.slot');
  if (slot && !slot.disabled) {
    const { slots, isFree } = slotInfo();
    const s = Number(slot.dataset.slot);
    // first tap: pick `dur` hours from here. Later taps: extend/trim (range fill) like the spec.
    if (!state.sel.length) quickPick(s);
    else {
      const next = C.toggleSelection(state.sel, s, slots, isFree);
      if (next.length === 1 && next[0] === s && !state.sel.includes(s)) quickPick(s);
      else state.sel = next;
    }
    renderRooms();
    return;
  }
  const room = e.target.closest('.room');
  if (!room || room.disabled) return;
  const id = room.dataset.room;
  state.room = state.room === id ? null : id;
  state.sel = [];
  renderRooms();
  if (state.room) {
    requestAnimationFrame(() => $('#panel')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' }));
  }
}

function quickPick(start) {
  const { slots, isFree } = slotInfo();
  state.sel = C.selectFrom(start, state.dur, slots, isFree);
  if (state.sel.length && state.sel.length < state.dur) toast(`بس ${hoursLabel(state.sel.length)} فاضية من هالوقت`);
}

function updateBar() {
  const room = state.room && C.roomById(state.room);
  const n = state.sel.length;
  $('#bar-room').textContent = room ? room.name : 'اختار غرفتك';
  if (room && n) {
    const p = C.price(n, room.rate);
    $('#bar-meta').innerHTML = `${hoursLabel(n)} · <b>${p.total} د</b>${p.free ? ` · ${hoursLabel(p.free)} مجاناً` : ''}`;
  } else {
    $('#bar-meta').textContent = room ? 'اختار ساعاتك من الجدول' : 'وبعدين الساعات';
  }
  $('#next').disabled = !(room && n);
}

function wireBar() {
  const bar = $('#bar');
  let inView = false;
  const sync = () => {
    const show = inView && state.stage === 1;
    bar.hidden = !show;
    document.body.classList.toggle('has-bar', show);
  };
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; sync(); }, { rootMargin: '0px 0px -30% 0px' }).observe($('#book'));
  wireBar.sync = sync;
  $('#next').onclick = () => { if (state.room && state.sel.length) showStage(2); };
}

function showStage(n) {
  state.stage = n;
  for (const i of [1, 2, 3]) $(`#stage${i}`).hidden = i !== n;
  wireBar.sync && wireBar.sync();
  if (n === 2) renderSummary();
  if (n === 1) renderRooms();
  $('#book').scrollIntoView({ behavior: 'auto', block: 'start' });
}

function renderSummary() {
  const d = state.days[state.date];
  const b = C.describeBooking(state.date, state.room, state.sel, d ? d.close : C.DEFAULT_CLOSE);
  $('#summary').innerHTML = `
    <div class="sum-row"><span>الغرفة</span><b>${b.roomName}</b></div>
    <div class="sum-row"><span>التاريخ</span><b>${b.dateLabel}</b></div>
    <div class="sum-row"><span>الوقت</span><b>من ${b.from} لـ ${b.to}</b></div>
    <div class="sum-row"><span>ساعات مدفوعة</span><b>${b.paid} × ${b.rate} د</b></div>
    <div class="sum-row sum-free"><span>ساعات مجانية</span><b>${b.free ? hoursLabel(b.free) : 'ولا ساعة'}</b></div>
    <div class="sum-total"><span>المجموع</span><strong>${b.total} <small>د.أ</small></strong></div>`;
  const saved = store.get(LS_KEY);
  if (saved) {
    if (!$('#f-name').value) $('#f-name').value = saved.name || '';
    if (!$('#f-phone').value) $('#f-phone').value = saved.phone || '';
  }
  // returning customers: details are already filled, so go straight to the button
  (saved && saved.name && saved.phone ? $('#confirm') : $('#f-name')).focus({ preventScroll: true });
}

function setErr(id, msg) {
  $(`#e-${id}`).textContent = msg || '';
  const input = $(`#f-${id}`);
  if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
}

function wireForm() {
  $('#back').onclick = () => showStage(1);
  $('#again').onclick = () => {
    state.booking = null; state.room = null; state.sel = [];
    store.set(SS_KEY, null, sessionStorage);
    showStage(1);
    loadDay(state.date);
  };
  $('#f-name').addEventListener('input', () => setErr('name'));
  $('#f-phone').addEventListener('input', () => setErr('phone'));
  $('#form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setErr('form');
    const name = C.cleanName($('#f-name').value);
    const phone = C.normalizePhone($('#f-phone').value);
    let bad = false;
    if (!C.isValidName(name)) { setErr('name', 'اكتب اسمك'); bad = true; }
    if (!C.isValidPhone(phone)) { setErr('phone', 'الرقم لازم يكون مثل 0791234567'); bad = true; }
    if (bad) return;
    store.set(LS_KEY, { name, phone });

    const btn = $('#confirm');
    btn.disabled = true;
    const label = btn.lastChild.textContent;
    btn.lastChild.textContent = ' لحظة...';
    // open the tab inside the tap so the browser does not block it; we point it at WhatsApp after the server answers
    let win = null;
    try { win = window.open('', '_blank'); if (win) win.opener = null; } catch {}
    try {
      const r = await api({ action: 'book', date: state.date, room: state.room, slots: state.sel, name, phone });
      if (r.status === 201) {
        const bk = { ...r.body.booking };
        const url = C.whatsappLink(C.whatsappText(bk));
        state.booking = { ...bk, url };
        store.set(SS_KEY, state.booking, sessionStorage);
        if (win) win.location.href = url;
        renderSuccess();
        showStage(3);
        return;
      }
      if (win) win.close();
      if (r.status === 409 || r.body.error === 'expired' || r.body.error === 'bad_slots') {
        state.sel = [];
        showStage(1);
        toast(r.body.message || 'في حدا سبقك على هالوقت، اختار وقت ثاني');
        loadDay(state.date);
        return;
      }
      if (r.body.error === 'bad_phone') setErr('phone', r.body.message);
      else if (r.body.error === 'bad_name') setErr('name', r.body.message);
      else setErr('form', r.body.message || 'صار في مشكلة، جرب كمان مرة');
    } catch {
      if (win) win.close();
      setErr('form', 'في مشكلة بالنت، جرب كمان مرة');
    } finally {
      btn.disabled = false;
      btn.lastChild.textContent = label;
    }
  });
}

let countdown = 0;
function renderSuccess() {
  const b = state.booking;
  $('#s-id').textContent = b.id;
  $('#s-summary').textContent = `${b.roomName} · ${b.dateLabel} · من ${b.from} لـ ${b.to} · ${b.total} د.أ`;
  $('#s-wa').href = b.url;
  const tick = () => {
    const left = Math.max(0, Math.ceil((b.expiresAt - now()) / 60000));
    $('#s-left').textContent = left;
  };
  clearInterval(countdown);
  tick();
  countdown = setInterval(tick, 15000);
}

function restoreLastBooking() {
  const b = store.get(SS_KEY, sessionStorage);
  if (b && b.expiresAt > now()) {
    state.booking = b;
    state.date = state.dates.includes(b.date) ? b.date : state.date;
    renderSuccess();
    for (const i of [1, 2, 3]) $(`#stage${i}`).hidden = i !== 3;
    state.stage = 3;
  }
}

function renderPrices() {
  $('#price-grid').innerHTML = C.ROOM_TYPES.map((t) => {
    const p3 = C.price(3, t.rate).total;
    return `<div class="price card"><h3>${t.label}</h3><span class="pc">${t.count === 1 ? 'غرفة وحدة' : `${t.count} ${t.count <= 10 ? 'غرف' : 'غرفة'}`}</span>
      <div class="pr">${t.rate}<small>د/ساعة</small></div><div class="px">3 ساعات بـ ${p3} د بدل ${t.rate * 3}</div></div>`;
  }).join('');
}

let toastT = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), 5000);
}

route();
