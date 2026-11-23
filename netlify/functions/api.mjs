// The only server: storage + HTTP. All rules live in public/core.js.
import { getStore } from '@netlify/blobs';
import { handle } from '../../public/core.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const LOCAL_DEV = process.env.NETLIFY_DEV === 'true';

function blobAdapter() {
  const store = getStore({ name: 'road55', consistency: 'strong' });
  return {
    async get(date) {
      const r = await store.getWithMetadata(`day-${date}`, { type: 'json' });
      if (!r) return null;
      // The local `netlify dev` blobs sandbox does not return etags on reads. Production does.
      // Locally only, fall back to a plain write so the site is testable. In production a missing etag fails safe (503).
      if (!r.etag && LOCAL_DEV) return { data: r.data, etag: '*local*' };
      return { data: r.data, etag: r.etag || '*missing*' };
    },
    async set(date, data, etag) {
      if (etag === '*local*') { await store.setJSON(`day-${date}`, data); return true; }
      const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
      const r = await store.setJSON(`day-${date}`, data, opts);
      return r ? r.modified !== false : true;
    },
  };
}

export default async (req) => {
  try {
    let action, data;
    if (req.method === 'GET') {
      action = 'day';
      data = { date: new URL(req.url).searchParams.get('date') };
    } else if (req.method === 'POST') {
      const text = await req.text();
      if (text.length > 4000) return json({ error: 'too_large' }, 413);
      try { data = JSON.parse(text || '{}'); } catch { return json({ error: 'bad_json' }, 400); }
      action = data && data.action;
      if (action === 'day') return json({ error: 'bad_action' }, 400);
    } else {
      return json({ error: 'method' }, 405);
    }
    const res = await handle(action, data, {
      store: blobAdapter(),
      now: Date.now(),
      adminPin: process.env.ADMIN_PIN || '',
    });
    return json(res.body, res.status);
  } catch (e) {
    console.error(e);
    return json({ error: 'server', message: 'صار في مشكلة، جرب كمان مرة' }, 500);
  }
};

export const config = { path: '/api' };
