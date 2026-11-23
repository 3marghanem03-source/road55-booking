import * as C from './core.js';

const PIN_KEY = 'r55-admin-pin';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { pending: 'بانتظار التأكيد', confirmed: 'مؤكد', cancelled: 'ملغي', expired: 'انتهى' };
const hoursLabel = (n) => (n === 1 ? 'ساعة' : n === 2 ? 'ساعتين' : n <= 10 ? `${n} ساعات` : `${n} ساعة`);

let root, pin, date, data, offset = 0, timer = 0, mounted = false;
const now = () => Date.now() + offset;
const getPin = () => { try { return sessionStorage.getItem(PIN_KEY) || ''; } catch { return ''; } };
const setPin = (v) => { try { v ? sessionStorage.setItem(PIN_KEY, v) : sessionStorage.removeItem(PIN_KEY); } catch {} };

async function call(action, body = {}) {
  const res = await fetch('/api', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, pin, date, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (typeof json.now === 'number') offset = json.now - Date.now();
  if (res.status === 401) { logout('الرمز غلط أو انتهت الجلسة'); throw new Error('401'); }
  return { status: res.status, body: json };
}

export function mountAdmin(el) {
  root = el;
  if (mounted) return;
  mounted = true;
  pin = getPin();
  pin ? enter() : renderLogin();
}

function renderLogin(msg = '') {
  clearInterval(timer);
  root.innerHTML = `<div class="admin"><form class="login card" id="login">
    <img src="assets/logo.svg" alt="شارع 55" width="116" height="100" style="margin:0 auto 10px">
    <h2>لوحة الإدارة</h2>
    <label class="field"><span>الرمز</span><input id="pin" type="password" inputmode="numeric" autocomplete="current-password" required></label>
    <p class="admin-msg bad" id="lmsg">${esc(msg)}</p>
    <button class="btn btn-primary" style="width:100%">دخول</button>
    <p style="margin-top:14px"><a href="#" class="hint">رجوع للموقع</a></p>
  </form></div>`;
  root.querySelector('#pin').focus();
  root.querySelector('#login').onsubmit = (e) => {
    e.preventDefault();
    pin = root.querySelector('#pin').value.trim();
    if (pin) enter();
  };
}

function logout(msg) { setPin(''); pin = ''; renderLogin(msg); }

async function enter() {
  date = date || C.todayBusinessDate(Date.now());
  try {
    const r = await call('alist');
    if (r.status !== 200) return renderLogin(r.body.message || 'صار في مشكلة');
    setPin(pin);
    data = r.body;
    renderShell();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden && location.hash === '#admin') refresh(true); }, 30000);
  } catch (e) {
    if (e.message !== '401') renderLogin('ما قدرنا نوصل للسيرفر');
  }
}

async function refresh(silent) {
  try {
    const r = await call('alist');
    if (r.status === 200) { data = r.body; renderBody(); }
    else if (!silent) msg(r.body.message, true);
  } catch {}
}

function renderShell() {
  root.innerHTML = `<div class="admin">
    <div class="admin-top">
      <img src="assets/logo.svg" alt="شارع 55" width="46" height="40">
      <strong>لوحة الإدارة</strong>
      <div style="display:flex;gap:6px"><a class="btn btn-sm btn-ghost" href="#">الموقع</a><button class="btn btn-sm btn-ghost" id="out">خروج</button></div>
    </div>
    <div class="card">
      <h2>اليوم</h2>
      <div class="admin-date">
        <button class="btn btn-sm btn-ghost" id="prev" aria-label="اليوم اللي قبل">›</button>
        <input type="date" id="date" class="field" style="min-height:44px;border-radius:12px;border:1px solid var(--line-2);background:rgba(7,11,31,.7);padding:0 10px">
        <button class="btn btn-sm btn-ghost" id="nextd" aria-label="اليوم اللي بعد">‹</button>
        <button class="btn btn-sm btn-ghost" id="today">اليوم</button>
      </div>
      <p class="hint" id="dlabel" style="margin-top:8px"></p>
    </div>
    <div class="card">
      <h2>وقت الإغلاق</h2>
      <div class="seg" id="close">${Object.keys(C.CLOSE_OPTIONS).map((k) => `<button type="button" data-close="${k}">${C.formatTime(C.CLOSE_OPTIONS[k])}</button>`).join('')}</div>
    </div>
    <p class="admin-msg" id="amsg" role="status"></p>
    <div class="card">
      <h2>الحجوزات</h2>
      <div class="counts" id="counts"></div>
      <div class="blist" id="list"></div>
    </div>
    <form class="card" id="manual">
      <h2>حجز يدوي (بالمحل أو بالتلفون)</h2>
      <div class="grid2">
        <label class="field"><span>الغرفة</span><select id="m-room">${C.ROOMS.map((r) => `<option value="${r.id}">${r.name}</option>`).join('')}</select></label>
        <label class="field"><span>من</span><select id="m-start"></select></label>
        <label class="field"><span>كم ساعة</span><select id="m-hours"></select></label>
        <label class="field"><span>السعر</span><input id="m-price" readonly></label>
        <label class="field"><span>الاسم</span><input id="m-name" maxlength="40" required></label>
        <label class="field"><span>الجوال (اختياري)</span><input id="m-phone" type="tel" dir="ltr" maxlength="16"></label>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:12px">احجز (مؤكد)</button>
    </form>
  </div>`;
  const $ = (s) => root.querySelector(s);
  $('#out').onclick = () => logout('');
  $('#date').value = date;
  $('#date').onchange = (e) => { if (C.isValidDate(e.target.value)) { date = e.target.value; refresh(); } };
  $('#prev').onclick = () => { date = C.addDays(date, -1); $('#date').value = date; refresh(); };
  $('#nextd').onclick = () => { date = C.addDays(date, 1); $('#date').value = date; refresh(); };
  $('#today').onclick = () => { date = C.todayBusinessDate(now()); $('#date').value = date; refresh(); };
  $('#close').onclick = async (e) => {
    const b = e.target.closest('[data-close]');
    if (!b || b.getAttribute('aria-pressed') === 'true') return;
    const r = await call('aclose', { close: b.dataset.close });
    if (r.status === 200) { msg('تم تغيير وقت الإغلاق'); refresh(); } else msg(r.body.message, true);
  };
  $('#list').onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'acancel' && !confirm('أكيد بدك تلغي الحجز؟')) return;
    b.disabled = true;
    const r = await call(b.dataset.act, { id: b.dataset.id });
    if (r.status === 200) msg(b.dataset.act === 'aconfirm' ? 'تم التأكيد' : 'تم الإلغاء');
    else msg(r.body.message, true);
    refresh();
  };
  $('#m-room').onchange = fillManual;
  $('#m-start').onchange = fillHours;
  $('#m-hours').onchange = showPrice;
  $('#manual').onsubmit = async (e) => {
    e.preventDefault();
    const r = await call('amanual', {
      room: $('#m-room').value, start: Number($('#m-start').value), hours: Number($('#m-hours').value),
      name: $('#m-name').value, phone: $('#m-phone').value,
    });
    if (r.status === 201) { msg(`تم الحجز ${r.body.booking.id}`); $('#m-name').value = ''; $('#m-phone').value = ''; refresh(); }
    else msg(r.body.message, true);
  };
  renderBody();
}

function msg(text, bad = false) {
  const m = root.querySelector('#amsg');
  if (!m) return;
  m.textContent = text || '';
  m.className = `admin-msg ${bad ? 'bad' : 'ok'}`;
  clearTimeout(msg.t);
  msg.t = setTimeout(() => (m.textContent = ''), 5000);
}

function renderBody() {
  const $ = (s) => root.querySelector(s);
  if (!$('#list')) return;
  $('#dlabel').textContent = `${C.formatDate(date)}${C.weekday(date) === 5 ? ' (الجمعة من 4م)' : ''}`;
  root.querySelectorAll('[data-close]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.close === data.close));
  const list = data.bookings || [];
  const count = (s) => list.filter((b) => b.status === s).length;
  const income = list.filter((b) => b.status === 'confirmed').reduce((a, b) => a + b.total, 0);
  $('#counts').innerHTML = `<span>مؤكد: <b>${count('confirmed')}</b></span><span>بانتظار: <b>${count('pending')}</b></span><span>ملغي/منتهي: <b>${count('cancelled') + count('expired')}</b></span><span>مجموع المؤكد: <b>${income} د</b></span>`;
  $('#list').innerHTML = list.length ? list.map((b) => {
    const wa = C.phoneToWa(b.phone);
    const dim = b.status === 'cancelled' || b.status === 'expired';
    const left = b.status === 'pending' ? ` · باقي ${Math.max(0, Math.ceil((b.expiresAt - now()) / 60000))} د` : '';
    return `<div class="bk ${dim ? 'dim' : ''}">
      <div class="bk-top"><b>${esc(b.roomName)} · ${esc(b.from)} لـ ${esc(b.to)}</b><span class="badge st-${b.status}">${STATUS[b.status]}${left}</span></div>
      <div class="meta"><bdi dir="ltr">${esc(b.id)}</bdi> · ${hoursLabel(b.hours)}${b.free ? ` (${b.free} مجاناً)` : ''} · <b>${b.total} د</b>${b.source === 'manual' ? ' · يدوي' : ''}</div>
      <div class="meta">${esc(b.name)}${b.phone ? ` · ${wa ? `<a href="${wa}" target="_blank" rel="noopener" dir="ltr">${esc(b.phone)}</a>` : esc(b.phone)}` : ''}</div>
      ${b.status === 'cancelled' ? '' : `<div class="bk-actions">
        ${b.status !== 'confirmed' ? `<button class="btn btn-ok" data-act="aconfirm" data-id="${esc(b.id)}">تأكيد</button>` : ''}
        <button class="btn btn-bad" data-act="acancel" data-id="${esc(b.id)}">إلغاء</button></div>`}
    </div>`;
  }).join('') : '<p class="hint">ما في حجوزات بهاليوم.</p>';
  fillManual();
}

function takenFor(room) {
  const active = (data.bookings || []).filter((b) => b.status === 'pending' || b.status === 'confirmed');
  return C.takenSlots(active, room);
}

function fillManual() {
  const $ = (s) => root.querySelector(s);
  const room = $('#m-room').value;
  const taken = takenFor(room);
  const keep = Number($('#m-start').value);
  const t = now();
  const opts = C.getSlots(date, data.close)
    .filter((s) => !taken.has(s.start) && t < C.ammanToUtc(date, s.end))
    .map((s) => `<option value="${s.start}" ${s.start === keep ? 'selected' : ''}>${s.label}</option>`);
  $('#m-start').innerHTML = opts.join('') || '<option value="">ما في وقت فاضي</option>';
  fillHours();
}

function fillHours() {
  const $ = (s) => root.querySelector(s);
  const start = Number($('#m-start').value);
  const taken = takenFor($('#m-room').value);
  const all = C.getSlots(date, data.close).map((s) => s.start);
  let n = 0;
  for (let i = all.indexOf(start); i >= 0 && i < all.length && !taken.has(all[i]); i++) n++;
  const keep = Number($('#m-hours').value) || 1;
  $('#m-hours').innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}" ${i + 1 === Math.min(keep, n) ? 'selected' : ''}>${hoursLabel(i + 1)}</option>`).join('');
  showPrice();
}

function showPrice() {
  const $ = (s) => root.querySelector(s);
  const room = C.roomById($('#m-room').value);
  const h = Number($('#m-hours').value) || 0;
  const p = C.price(h, room.rate);
  $('#m-price').value = h ? `${p.total} د${p.free ? ` (${p.free} مجاناً)` : ''}` : '';
}
