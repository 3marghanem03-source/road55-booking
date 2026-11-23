import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../public/core.js';

const { ROOMS, price, getSlots, businessDayOf, ammanToUtc, handle, memoryStore, addDays, PENDING_MS } = core;

// Tuesday 2026-11-24, 10:00 AM Amman
const TODAY = '2026-11-24';
const NOW = ammanToUtc(TODAY, 10 * 60);
const FRIDAY = '2026-11-27';
const PIN = 'test-pin-9271';

const mk = (now = NOW) => ({ store: memoryStore(), now, adminPin: PIN });
const at = (ctx, now) => ({ ...ctx, now });
const book = (ctx, over = {}) =>
  handle('book', { date: TODAY, room: 'big-1', slots: [1200, 1260], name: 'أحمد', phone: '0791234567', ...over }, ctx);
const day = (ctx, date = TODAY) => handle('day', { date }, ctx);

test('11 rooms with the right rates', () => {
  assert.equal(ROOMS.length, 11);
  assert.deepEqual(ROOMS.map((r) => r.rate), [6, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4]);
  assert.equal(new Set(ROOMS.map((r) => r.id)).size, 11);
});

test('pricing: every 3rd hour free', () => {
  const t = (h, r) => price(h, r).total;
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((h) => t(h, 5)), [5, 10, 10, 15, 20, 20]);
  assert.equal(t(6, 6), 24);
  assert.deepEqual(price(7, 4), { hours: 7, paid: 5, free: 2, total: 20 });
});

test('slots: normal day 14, Friday 11, close 3:30 gives 15 with a half last slot', () => {
  const normal = getSlots(TODAY);
  assert.equal(normal.length, 14);
  assert.equal(normal[0].start, 13 * 60);
  assert.equal(normal.at(-1).end, 27 * 60);
  assert.equal(getSlots(FRIDAY).length, 11);
  assert.equal(getSlots(FRIDAY)[0].start, 16 * 60);
  const late = getSlots(TODAY, '03:30');
  assert.equal(late.length, 15);
  assert.deepEqual([late.at(-1).start, late.at(-1).end], [27 * 60, 27 * 60 + 30]);
  assert.equal(getSlots(TODAY, '04:00').length, 15);
  // half slot still priced as a full hour
  assert.equal(core.describeBooking(TODAY, 'normal-1', [1560, 1620], '03:30').total, 8);
});

test('1:30 AM Wednesday belongs to Tuesday night', () => {
  const ms = Date.UTC(2026, 10, 24, 22, 30); // = 2026-11-25 01:30 in Amman (UTC+3)
  assert.deepEqual(businessDayOf(ms), { date: '2026-11-24', minute: 25 * 60 + 30 });
  assert.equal(ammanToUtc('2026-11-24', 25 * 60 + 30), ms);
  // independent of device time zone: Intl always resolves Asia/Amman
  assert.equal(core.ammanParts(ms).date, '2026-11-25');
});

test('booking ok, same room overlap 409, other room ok', async () => {
  const ctx = mk();
  const a = await book(ctx);
  assert.equal(a.status, 201);
  assert.match(a.body.booking.id, /^R55-\d{4}$/);
  assert.equal(a.body.booking.status, 'pending');
  assert.equal(a.body.booking.total, 10);
  const b = await book(ctx, { slots: [1260, 1320], phone: '0781111111' });
  assert.equal(b.status, 409);
  const c = await book(ctx, { room: 'big-2', phone: '0781111111' });
  assert.equal(c.status, 201);
  const d = await book(ctx, { slots: [1320], phone: '0781111111' }); // touching, not overlapping
  assert.equal(d.status, 201);
});

test('server ignores client price and computes its own', async () => {
  const r = await book(mk(), { room: 'arabic-1', slots: [1200, 1260, 1320, 1380, 1440, 1500], total: 1 });
  assert.equal(r.status, 201);
  assert.equal(r.body.booking.total, 24);
  assert.equal(r.body.booking.free, 2);
});

test('rejections', async () => {
  const ctx = mk();
  const code = async (over, c = ctx) => (await book(c, over)).body.error;
  assert.equal(await code({ slots: [13 * 60] }, at(ctx, ammanToUtc(TODAY, 20 * 60))), 'expired');
  assert.equal(await code({ slots: [1200, 1320] }), 'gap');
  assert.equal(await code({ phone: '0712345678' }), 'bad_phone');
  assert.equal(await code({ phone: '07912' }), 'bad_phone');
  assert.equal(await code({ date: addDays(TODAY, 14) }), 'date_range');
  assert.equal(await code({ date: addDays(TODAY, -1) }), 'date_range');
  assert.equal(await code({ date: '2026-13-40' }), 'bad_date');
  assert.equal(await code({ room: 'vip-9' }), 'bad_room');
  assert.equal(await code({ slots: [12 * 60] }), 'bad_slots');
  assert.equal(await code({ slots: [27 * 60] }), 'bad_slots'); // 3:00 AM slot only exists if close is later
  assert.equal(await code({ name: ' ' }), 'bad_name');
  assert.equal(await code({ date: FRIDAY, slots: [15 * 60] }), 'bad_slots');
  const fri = await book(ctx, { date: FRIDAY, slots: [16 * 60] });
  assert.equal(fri.status, 201);
  assert.equal((await book(ctx, { date: addDays(TODAY, 13), phone: '+962 77 123 4567' })).status, 201);
});

test('slot is bookable until 30 minutes after it starts', async () => {
  const ctx = mk(ammanToUtc(TODAY, 20 * 60 + 29));
  assert.equal((await book(ctx, { slots: [1200] })).status, 201);
  assert.equal((await book(at(ctx, ammanToUtc(TODAY, 20 * 60 + 30)), { room: 'big-2', slots: [1200] })).body.error, 'expired');
});

test('max 3 pending per phone per day', async () => {
  const ctx = mk();
  for (const room of ['normal-1', 'normal-2', 'normal-3']) assert.equal((await book(ctx, { room })).status, 201);
  const r = await book(ctx, { room: 'normal-4', phone: '962791234567' });
  assert.equal(r.status, 429);
  assert.equal((await book(ctx, { room: 'normal-4', date: addDays(TODAY, 1) })).status, 201);
});

test('pending expires after 20 min, confirmed stays', async () => {
  const ctx = mk();
  const p = (await book(ctx)).body.booking;
  const m = (await handle('amanual', { pin: PIN, date: TODAY, room: 'big-2', start: 1200, hours: 2, name: 'زبون محل' }, ctx)).body.booking;
  assert.equal(m.status, 'confirmed');
  const before = await day(at(ctx, NOW + PENDING_MS - 1));
  assert.equal(before.body.bookings.length, 2);
  const after = await day(at(ctx, NOW + PENDING_MS));
  assert.deepEqual(after.body.bookings.map((b) => b.room), ['big-2']);
  // slot is free again for someone else
  assert.equal((await book(at(ctx, NOW + PENDING_MS), { phone: '0771234567' })).status, 201);
  const list = await handle('alist', { pin: PIN, date: TODAY }, at(ctx, NOW + PENDING_MS));
  assert.equal(list.body.bookings.find((b) => b.id === p.id).status, 'expired');
});

test('admin: 401 without/with wrong PIN, confirm, cancel frees slots', async () => {
  const ctx = mk();
  const id = (await book(ctx)).body.booking.id;
  assert.equal((await handle('alist', { date: TODAY }, ctx)).status, 401);
  assert.equal((await handle('alist', { date: TODAY, pin: 'nope' }, ctx)).status, 401);
  assert.equal((await handle('aconfirm', { date: TODAY, id }, ctx)).status, 401);
  assert.equal((await handle('alist', { date: TODAY, pin: PIN }, { ...ctx, adminPin: '' })).status, 401);

  const c = await handle('aconfirm', { date: TODAY, id, pin: PIN }, ctx);
  assert.equal(c.status, 200);
  assert.equal(c.body.booking.status, 'confirmed');
  // confirmed does not expire
  assert.equal((await day(at(ctx, NOW + 5 * PENDING_MS))).body.bookings.length, 1);

  const x = await handle('acancel', { date: TODAY, id, pin: PIN }, ctx);
  assert.equal(x.status, 200);
  assert.equal((await day(ctx)).body.bookings.length, 0);
  assert.equal((await book(ctx, { phone: '0771234567' })).status, 201);
  assert.equal((await handle('acancel', { date: TODAY, id: 'R55-0000', pin: PIN }, ctx)).status, 404);
});

test('admin: manual booking conflicts and close time', async () => {
  const ctx = mk();
  const r = await handle('amanual', { pin: PIN, date: TODAY, room: 'floor-1', start: 1500, hours: 2, name: 'تلفون' }, ctx);
  assert.equal(r.status, 201);
  assert.equal((await handle('amanual', { pin: PIN, date: TODAY, room: 'floor-1', start: 1560, hours: 1, name: 'ثاني' }, ctx)).status, 409);
  assert.equal((await handle('amanual', { pin: PIN, date: TODAY, room: 'floor-2', start: 1560, hours: 2, name: 'بعد الإغلاق' }, ctx)).status, 400);
  assert.equal((await handle('aclose', { pin: PIN, date: TODAY, close: '05:00' }, ctx)).status, 400);
  assert.equal((await handle('aclose', { pin: PIN, date: TODAY, close: '04:00' }, ctx)).status, 200);
  assert.equal((await day(ctx)).body.close, '04:00');
  assert.equal((await handle('amanual', { pin: PIN, date: TODAY, room: 'floor-2', start: 1560, hours: 2, name: 'آخر الليل' }, ctx)).status, 201);
  // cannot shrink close below an active booking
  assert.equal((await handle('aclose', { pin: PIN, date: TODAY, close: '03:00' }, ctx)).status, 409);
});

test('public day never returns name or phone', async () => {
  const ctx = mk();
  await book(ctx, { name: 'سرّي جداً', phone: '0799999999' });
  const r = await day(ctx);
  assert.equal(r.status, 200);
  const s = JSON.stringify(r.body);
  assert.ok(!s.includes('سرّي') && !s.includes('0799999999') && !s.includes('R55-'));
  for (const b of r.body.bookings) assert.deepEqual(Object.keys(b).sort(), ['room', 'slots', 'status']);
});

test('concurrent bookings of the same slot: exactly one wins (etag retry)', async () => {
  const ctx = mk();
  const rs = await Promise.all([
    book(ctx, { phone: '0791000001' }),
    book(ctx, { phone: '0791000002' }),
    book(ctx, { phone: '0791000003', room: 'big-2' }),
  ]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 201, 409]);
  assert.equal((await day(ctx)).body.bookings.length, 2);
});

test('selection: contiguous fill, booked in between starts over', () => {
  const slots = getSlots(TODAY);
  const booked = new Set([1080]);
  const free = (s) => !booked.has(s);
  assert.deepEqual(core.toggleSelection([], 840, slots, free), [840]);
  assert.deepEqual(core.toggleSelection([840], 960, slots, free), [840, 900, 960]);
  assert.deepEqual(core.toggleSelection([840], 1200, slots, free), [1200]);
  assert.deepEqual(core.toggleSelection([840, 900, 960], 960, slots, free), [840, 900]);
  assert.deepEqual(core.toggleSelection([840], 840, slots, free), []);
  assert.deepEqual(core.toggleSelection([840], 1080, slots, free), [840]);
});

test('quick pick by duration stops at a booked slot', () => {
  const slots = getSlots(TODAY);
  const free = (s) => s !== 1080;
  assert.deepEqual(core.selectFrom(840, 3, slots, free), [840, 900, 960]);
  assert.deepEqual(core.selectFrom(960, 3, slots, free), [960, 1020]);
  assert.deepEqual(core.selectFrom(1560, 3, slots, free), [1560]); // last slot of the night
  assert.deepEqual(core.selectFrom(1080, 2, slots, free), []);
});

test('whatsapp message has all the fields', () => {
  const b = { ...core.describeBooking(TODAY, 'big-1', [1200, 1260, 1320]), id: 'R55-1234', name: 'أحمد', phone: '0791234567' };
  const t = core.whatsappText(b);
  for (const part of ['R55-1234', 'كبيرة 1', 'الثلاثاء 24/11', '8:00 م', '11:00 م', '3 (منها 1 مجاناً)', '10 د.أ', 'أحمد', '0791234567'])
    assert.ok(t.includes(part), part);
  assert.ok(core.whatsappLink(t).startsWith('https://wa.me/962781618141?text='));
  assert.ok(!t.includes('—'));
});
