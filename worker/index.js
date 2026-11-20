/**
 * Cloudflare Worker: ส่งต่อคำขอทั้งหมดไปยัง container ตัวเดียว (SQLite ใช้ได้ทีละ instance)
 * และให้บริการ /__backup สำหรับให้ container สำรอง/กู้คืน data/ กับ R2
 */
import { Container, getContainer } from '@cloudflare/containers';

export class App extends Container {
  defaultPort = 8080;
  sleepAfter = '3h';

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      PORT: '8080',
      TRUST_PROXY: 'true',
      BACKUP_URL: env.PUBLIC_URL || '',
      BACKUP_TOKEN: env.BACKUP_TOKEN || '',
    };
  }
}

function tokenOk(req, env) {
  const want = env.BACKUP_TOKEN;
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

async function handleBackup(req, env, url) {
  if (!tokenOk(req, env)) return new Response('Not found', { status: 404 });
  const p = url.pathname.slice('/__backup'.length);

  if (req.method === 'GET' && p === '/list') {
    const prefix = url.searchParams.get('prefix') || '';
    const keys = [];
    let cursor;
    do {
      const r = await env.BACKUP.list({ prefix, cursor });
      for (const o of r.objects) keys.push({ key: o.key, size: o.size });
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
    return Response.json({ keys });
  }

  if (p.startsWith('/o/')) {
    const key = p.slice(3).split('/').map(decodeURIComponent).join('/');
    if (!/^(db\/eval\.sqlite|uploads\/[^]+)$/.test(key) || key.includes('..')) {
      return new Response('Bad key', { status: 400 });
    }
    if (req.method === 'GET') {
      const obj = await env.BACKUP.get(key);
      if (!obj) return new Response('Not found', { status: 404 });
      return new Response(obj.body, { headers: { 'content-type': 'application/octet-stream' } });
    }
    if (req.method === 'PUT') {
      const buf = await req.arrayBuffer();
      await env.BACKUP.put(key, buf);
      // เก็บประวัติฐานข้อมูลรายชั่วโมงไว้กู้คืนย้อนหลัง
      if (key === 'db/eval.sqlite') {
        const hour = new Date().toISOString().slice(0, 13);
        await env.BACKUP.put(`history/${hour}.sqlite`, buf);
      }
      return new Response('ok');
    }
  }
  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/__backup')) return handleBackup(req, env, url);

    const headers = new Headers(req.headers);
    headers.set('x-forwarded-for', req.headers.get('cf-connecting-ip') || '');
    headers.set('x-forwarded-proto', 'https');
    return getContainer(env.APP, 'main').fetch(new Request(req, { headers }));
  },
};
