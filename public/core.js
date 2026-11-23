// Road 55 Gaming Center: shared booking logic.
// No dependencies. Used as-is by the browser (public/app.js), the Netlify Function (netlify/functions/api.mjs)
// and the tests (test/core.test.mjs). Change business rules here only.

// ---------- Config (edit numbers here) ----------
export const TZ = 'Asia/Amman';
export const WHATSAPP_INTL = '962781618141';      // wa.me number, no "+"
export const WHATSAPP_LOCAL = '0781618141';
export const PENDING_MS = 20 * 60 * 1000;         // pending hold: 20 minutes
export const DAYS_AHEAD = 14;                     // today + 13 days
export const MAX_PENDING_PER_PHONE = 3;           // per phone, per day
export const OPEN_MIN = 13 * 60;                  // 1:00 PM
export const FRIDAY_OPEN_MIN = 16 * 60;           // 4:00 PM
export const CLOSE_OPTIONS = { '03:00': 27 * 60, '03:30': 27 * 60 + 30, '04:00': 28 * 60 };
export const DEFAULT_CLOSE = '03:00';
export const SLOT_GRACE_MIN = 30;                 // a slot stays bookable until 30 min after it starts
export const DAY_ROLLOVER_HOUR = 6;               // before 6 AM belongs to the previous business day

export const ROOM_TYPES = [
  { type: 'arabic', label: 'الغرفة العربية الكبيرة', short: 'العربية', rate: 6, count: 1 },
  { type: 'big', label: 'غرف كبيرة', short: 'كبيرة', rate: 5, count: 3 },
  { type: 'floor', label: 'غرف أرضيات', short: 'أرضيات', rate: 5, count: 2 },
  { type: 'normal', label: 'غرف عادية', short: 'عادية', rate: 4, count: 5 },
];

export const ROOMS = ROOM_TYPES.flatMap((t) =>
  Array.from({ length: t.count }, (_, i) => ({
    id: `${t.type}-${i + 1}`,
    type: t.type,
    name: t.count === 1 ? t.label : `${t.short} ${i + 1}`,
    rate: t.rate,
  }))
);

export const roomById = (id) => ROOMS.find((r) => r.id === id) || null;

export const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// ---------- Pricing: every 3rd hour is free ----------
export function price(hours, rate) {
  const h = Math.max(0, Math.floor(hours));
  const free = Math.floor(h / 3);
  const paid = h - free;
  return { hours: h, paid, free, total: paid * rate };
}

// ---------- Time (always Asia/Amman) ----------
const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function ammanParts(ms) {
  const p = {};
  for (const x of dtf.formatToParts(new Date(ms))) p[x.type] = x.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second),
  };
}

function offsetMs(ms) {
  const p = ammanParts(ms);
  const [y, m, d] = p.date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, p.hour, p.minute, p.second) - (ms - (((ms % 1000) + 1000) % 1000));
}

// Amman wall-clock (business date + minutes from that midnight, may exceed 1440) -> UTC ms
export function ammanToUtc(date, minutes) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d) + minutes * 60000;
  let t = guess - offsetMs(guess);
  const off2 = offsetMs(t);
  if (guess - off2 !== t) t = guess - off2;
  return t;
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const weekday = (date) => new Date(date + 'T00:00:00Z').getUTCDay(); // 0 Sun .. 5 Fri

// Which business day (and minute of it) a real moment belongs to. 1:30 AM Wed -> Tue, minute 1530.
export function businessDayOf(ms) {
  const p = ammanParts(ms);
  if (p.hour < DAY_ROLLOVER_HOUR) return { date: addDays(p.date, -1), minute: (p.hour + 24) * 60 + p.minute };
  return { date: p.date, minute: p.hour * 60 + p.minute };
}

export const todayBusinessDate = (now) => businessDayOf(now).date;

export function bookableDates(now) {
  const first = todayBusinessDate(now);
  return Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(first, i));
}

export const isBookableDate = (date, now) => bookableDates(now).includes(date);

// ---------- Schedule / slots ----------
export const openMinutes = (date) => (weekday(date) === 5 ? FRIDAY_OPEN_MIN : OPEN_MIN);
export const closeMinutes = (close) => CLOSE_OPTIONS[close] ?? CLOSE_OPTIONS[DEFAULT_CLOSE];

export function formatTime(min) {
  const h = Math.floor(min / 60) % 24;
  const mm = String(min % 60).padStart(2, '0');
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'ص' : 'م'}`;
}

export function formatDate(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${DAY_NAMES[weekday(date)]} ${d}/${m}`;
}

// Hourly slots. The last one may be 30 min (close 3:30) and still counts as a full hour.
export function getSlots(date, close = DEFAULT_CLOSE) {
  const open = openMinutes(date);
  const end = closeMinutes(close);
  const out = [];
  for (let s = open; s < end; s += 60) {
    const e = Math.min(s + 60, end);
    out.push({ start: s, end: e, label: formatTime(s) });
  }
  return out;
}

export const isSlotExpired = (date, start, now) => now >= ammanToUtc(date, start + SLOT_GRACE_MIN);

// ---------- Day data ----------
export const emptyDay = () => ({ close: DEFAULT_CLOSE, bookings: [] });

export function normalizeDay(d) {
  if (!d || typeof d !== 'object') return emptyDay();
  return {
    close: CLOSE_OPTIONS[d.close] ? d.close : DEFAULT_CLOSE,
    bookings: Array.isArray(d.bookings) ? d.bookings : [],
  };
}

export function effectiveStatus(b, now) {
  if (b.status === 'pending' && now >= b.createdAt + PENDING_MS) return 'expired';
  return b.status;
}

export const isActive = (b, now) => {
  const s = effectiveStatus(b, now);
  return s === 'pending' || s === 'confirmed';
};

// What anyone may see: no names, no phones, no ids.
export function publicDay(day, now) {
  const d = normalizeDay(day);
  return {
    close: d.close,
    bookings: d.bookings.filter((b) => isActive(b, now)).map((b) => ({ room: b.room, slots: [...b.slots], status: b.status })),
  };
}

// bookings: list of active entries ({room, slots}) -> Set of taken slot starts for one room
export function takenSlots(bookings, room) {
  const set = new Set();
  for (const b of bookings) if (b.room === room) for (const s of b.slots) set.add(s);
  return set;
}

export function slotState(date, start, taken, now) {
  if (taken.has(start)) return 'booked';
  if (isSlotExpired(date, start, now)) return 'expired';
  return 'free';
}

// For room cards. pub = publicDay(...)
export function roomAvailability(date, pub, room, now) {
  const taken = takenSlots(pub.bookings, room);
  const slots = getSlots(date, pub.close);
  const states = slots.map((s) => slotState(date, s.start, taken, now));
  const free = states.filter((s) => s === 'free').length;
  const booked = states.filter((s) => s === 'booked').length;
  return { free, booked, total: slots.length, state: free > 0 ? 'free' : booked > 0 ? 'full' : 'over' };
}

// Contiguous range selection logic for the grid. Returns new selected array (sorted starts).
export function toggleSelection(selected, tapped, slots, isFree) {
  const starts = slots.map((s) => s.start);
  const idx = (v) => starts.indexOf(v);
  if (!isFree(tapped)) return selected;
  if (!selected.length) return [tapped];
  const first = selected[0], last = selected[selected.length - 1];
  if (selected.includes(tapped)) {
    if (selected.length === 1) return [];
    if (tapped === first) return selected.slice(1);
    if (tapped === last) return selected.slice(0, -1);
    return starts.slice(idx(first), idx(tapped) + 1);
  }
  const a = Math.min(idx(first), idx(tapped)), b = Math.max(idx(last), idx(tapped));
  const range = starts.slice(a, b + 1);
  return range.every((s) => selected.includes(s) || isFree(s)) ? range : [tapped];
}

// Quick pick: `hours` consecutive free slots starting at `start` (stops early at a booked/expired slot).
export function selectFrom(start, hours, slots, isFree) {
  const starts = slots.map((s) => s.start);
  const out = [];
  for (let i = starts.indexOf(start); i >= 0 && i < starts.length && out.length < hours && isFree(starts[i]); i++) out.push(starts[i]);
  return out;
}

// ---------- Validation ----------
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const toAsciiDigits = (s) => s.replace(ARABIC_DIGITS, (c) => String((c.charCodeAt(0) & 0xf) % 10));

export function normalizePhone(input) {
  let s = toAsciiDigits(String(input ?? '')).replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00962')) s = '0' + s.slice(5);
  else if (s.startsWith('962')) s = '0' + s.slice(3);
  else if (/^7[789]\d{7}$/.test(s)) s = '0' + s;
  return s;
}

export const isValidPhone = (p) => /^07[789]\d{7}$/.test(normalizePhone(p));

export function cleanName(input) {
  return String(input ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}

export const isValidName = (n) => {
  const s = cleanName(n);
  return s.length >= 2 && s.length <= 40 && !/^\d+$/.test(s);
};

const ERR = {
  bad_date: [400, 'التاريخ مش صحيح'],
  date_range: [400, 'الحجز متاح لـ 14 يوم قدام بس'],
  bad_room: [400, 'الغرفة مش موجودة'],
  bad_slots: [400, 'اختار ساعات صحيحة ضمن الدوام'],
  gap: [400, 'لازم الساعات تكون ورا بعض'],
  expired: [400, 'في ساعة وقتها خلص'],
  bad_name: [400, 'اكتب اسمك (حرفين على الأقل)'],
  bad_phone: [400, 'رقم الجوال لازم يكون أردني مثل 0791234567'],
  too_many: [429, 'عندك 3 حجوزات معلقة بهاليوم، استنى التأكيد'],
  conflict: [409, 'في حدا سبقك على هالوقت، اختار وقت ثاني'],
  unauthorized: [401, 'الرمز غلط'],
  not_found: [404, 'الحجز مش موجود'],
  bad_close: [400, 'وقت الإغلاق مش صحيح'],
  close_conflict: [409, 'في حجوزات بعد هالوقت، ألغيها أول'],
  bad_action: [400, 'طلب مش معروف'],
  busy: [503, 'في ضغط، جرب كمان مرة'],
};

export function fail(code, extra) {
  const [status, message] = ERR[code] || [400, code];
  return { status, body: { error: code, message, ...extra } };
}

// Returns error code or null.
export function validateSlots(date, close, slots, now, { allowPast = false } = {}) {
  if (!Array.isArray(slots) || !slots.length || !slots.every(Number.isInteger)) return 'bad_slots';
  const valid = getSlots(date, close).map((s) => s.start);
  if (new Set(slots).size !== slots.length) return 'bad_slots';
  if (!slots.every((s) => valid.includes(s))) return 'bad_slots';
  const sorted = [...slots].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] !== 60) return 'gap';
  if (!allowPast && sorted.some((s) => isSlotExpired(date, s, now))) return 'expired';
  return null;
}

export function hasConflict(day, room, slots, now, exceptId) {
  const want = new Set(slots);
  return day.bookings.some((b) => b.id !== exceptId && b.room === room && isActive(b, now) && b.slots.some((s) => want.has(s)));
}

// ---------- Booking summary + WhatsApp ----------
export function describeBooking(date, roomId, slots, close = DEFAULT_CLOSE) {
  const room = roomById(roomId);
  const sorted = [...slots].sort((a, b) => a - b);
  const all = getSlots(date, close);
  const last = all.find((s) => s.start === sorted[sorted.length - 1]);
  const p = price(sorted.length, room.rate);
  return {
    room: room.id, roomName: room.name, rate: room.rate, date, dateLabel: formatDate(date),
    slots: sorted, start: sorted[0], end: last ? last.end : sorted[sorted.length - 1] + 60,
    from: formatTime(sorted[0]), to: formatTime(last ? last.end : sorted[sorted.length - 1] + 60),
    ...p,
  };
}

export function whatsappText(b) {
  const lines = [
    'مرحبا Road 55، بدي أأكد حجزي:',
    `رقم الحجز: ${b.id}`,
    `الغرفة: ${b.roomName}`,
    `التاريخ: ${b.dateLabel}`,
    `الوقت: من ${b.from} لـ ${b.to}`,
    `الساعات: ${b.hours}${b.free ? ` (منها ${b.free} مجاناً)` : ''}`,
    `المبلغ: ${b.total} د.أ`,
    `الاسم: ${b.name}`,
    `الجوال: ${b.phone}`,
  ];
  return lines.join('\n');
}

export const whatsappLink = (text, number = WHATSAPP_INTL) =>
  `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

export function phoneToWa(phone) {
  const p = normalizePhone(phone);
  return /^07[789]\d{7}$/.test(p) ? `https://wa.me/962${p.slice(1)}` : null;
}

// ---------- Request handling (used by the Netlify Function and the tests) ----------
// ctx = { store: { get(date) -> {data, etag}|null, set(date, data, etag|null) -> boolean }, now: ms, adminPin, random? }

function pinOk(given, expected) {
  if (!expected || typeof given !== 'string' || !given) return false;
  const a = String(given), b = String(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function newId(day, random) {
  const used = new Set(day.bookings.map((b) => b.id));
  for (let i = 0; i < 50; i++) {
    const id = 'R55-' + String(Math.floor(random() * 9000) + 1000);
    if (!used.has(id)) return id;
  }
  return 'R55-' + Date.now().toString().slice(-6);
}

// Read-modify-write with optimistic concurrency (etag), retried on conflict.
async function mutate(ctx, date, fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await ctx.store.get(date);
    const day = normalizeDay(cur && cur.data);
    const res = fn(day);
    if (!res.write) return res;
    const ok = await ctx.store.set(date, day, cur ? cur.etag ?? null : null);
    if (ok) return res;
  }
  return fail('busy');
}

async function readDay(ctx, date) {
  const cur = await ctx.store.get(date);
  return normalizeDay(cur && cur.data);
}

const ownerView = (b, date, close) => ({
  ...describeBooking(date, b.room, b.slots, close),
  id: b.id, name: b.name, phone: b.phone, status: b.status, createdAt: b.createdAt,
  expiresAt: b.status === 'pending' ? b.createdAt + PENDING_MS : null,
});

export async function handle(action, data, ctx) {
  const now = ctx.now;
  const random = ctx.random || Math.random;
  data = data && typeof data === 'object' ? data : {};
  const date = data.date;

  if (action === 'day') {
    if (!isValidDate(date)) return fail('bad_date');
    return { status: 200, body: { date, now, ...publicDay(await readDay(ctx, date), now) } };
  }

  if (action === 'book') {
    if (!isValidDate(date)) return fail('bad_date');
    if (!isBookableDate(date, now)) return fail('date_range');
    const room = roomById(data.room);
    if (!room) return fail('bad_room');
    const name = cleanName(data.name);
    if (!isValidName(name)) return fail('bad_name');
    if (!isValidPhone(data.phone)) return fail('bad_phone');
    const phone = normalizePhone(data.phone);
    return mutate(ctx, date, (day) => {
      const bad = validateSlots(date, day.close, data.slots, now);
      if (bad) return fail(bad);
      const slots = [...data.slots].sort((a, b) => a - b);
      if (hasConflict(day, room.id, slots, now)) return fail('conflict');
      const mine = day.bookings.filter((b) => b.phone === phone && effectiveStatus(b, now) === 'pending').length;
      if (mine >= MAX_PENDING_PER_PHONE) return fail('too_many');
      const p = price(slots.length, room.rate);
      const b = { id: newId(day, random), room: room.id, slots, status: 'pending', name, phone, createdAt: now, source: 'web', total: p.total };
      day.bookings.push(b);
      return { write: true, status: 201, body: { booking: ownerView(b, date, day.close) } };
    });
  }

  if (!['alist', 'aconfirm', 'acancel', 'amanual', 'aclose'].includes(action)) return fail('bad_action');
  if (!pinOk(data.pin, ctx.adminPin)) return fail('unauthorized');
  if (!isValidDate(date)) return fail('bad_date');

  if (action === 'alist') {
    const day = await readDay(ctx, date);
    const list = day.bookings
      .map((b) => ({ ...ownerView(b, date, day.close), status: effectiveStatus(b, now), source: b.source || 'web' }))
      .sort((a, b) => a.start - b.start || a.room.localeCompare(b.room));
    return { status: 200, body: { date, now, close: day.close, bookings: list } };
  }

  if (action === 'aconfirm' || action === 'acancel') {
    return mutate(ctx, date, (day) => {
      const b = day.bookings.find((x) => x.id === data.id);
      if (!b) return fail('not_found');
      if (action === 'acancel') {
        b.status = 'cancelled';
        b.cancelledAt = now;
      } else {
        const st = effectiveStatus(b, now);
        if (st === 'cancelled') return fail('not_found');
        if (st === 'expired' && hasConflict(day, b.room, b.slots, now, b.id)) return fail('conflict');
        b.status = 'confirmed';
        b.confirmedAt = now;
      }
      return { write: true, status: 200, body: { booking: { ...ownerView(b, date, day.close), status: b.status } } };
    });
  }

  if (action === 'amanual') {
    const room = roomById(data.room);
    if (!room) return fail('bad_room');
    const name = cleanName(data.name);
    if (!isValidName(name)) return fail('bad_name');
    const phone = data.phone ? normalizePhone(data.phone) : '';
    if (phone && !isValidPhone(phone)) return fail('bad_phone');
    const hours = Number(data.hours), start = Number(data.start);
    if (!Number.isInteger(hours) || hours < 1 || hours > 15 || !Number.isInteger(start)) return fail('bad_slots');
    return mutate(ctx, date, (day) => {
      const all = getSlots(date, day.close).map((s) => s.start);
      const i = all.indexOf(start);
      const slots = i < 0 ? [] : all.slice(i, i + hours);
      if (slots.length !== hours) return fail('bad_slots');
      const bad = validateSlots(date, day.close, slots, now, { allowPast: true });
      if (bad) return fail(bad);
      if (hasConflict(day, room.id, slots, now)) return fail('conflict');
      const p = price(slots.length, room.rate);
      const b = { id: newId(day, random), room: room.id, slots, status: 'confirmed', name, phone, createdAt: now, confirmedAt: now, source: 'manual', total: p.total };
      day.bookings.push(b);
      return { write: true, status: 201, body: { booking: ownerView(b, date, day.close) } };
    });
  }

  // aclose
  if (!CLOSE_OPTIONS[data.close]) return fail('bad_close');
  return mutate(ctx, date, (day) => {
    const end = CLOSE_OPTIONS[data.close];
    if (day.bookings.some((b) => isActive(b, now) && b.slots.some((s) => s >= end))) return fail('close_conflict');
    day.close = data.close;
    return { write: true, status: 200, body: { date, close: day.close } };
  });
}

// In-memory store with etags (tests, and a reference for the Blobs adapter).
export function memoryStore() {
  const m = new Map();
  let n = 0;
  return {
    map: m,
    async get(date) {
      const v = m.get(date);
      return v ? { data: JSON.parse(v.json), etag: v.etag } : null;
    },
    async set(date, data, etag) {
      const cur = m.get(date);
      if (etag === null ? cur : !cur || cur.etag !== etag) return false;
      m.set(date, { json: JSON.stringify(data), etag: `e${++n}` });
      return true;
    },
  };
}
