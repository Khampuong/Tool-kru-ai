'use strict';
/**
 * Entrypoint สำหรับรันใน Cloudflare Container
 * ดิสก์ของ container ไม่ถาวร จึง:
 *   1) ตอนเริ่ม: กู้คืน data/ (eval.sqlite + uploads) จาก R2 ผ่าน Worker  (/__backup)
 *   2) ระหว่างทำงาน: สำรองขึ้น R2 ทุก 1 นาที (เฉพาะเมื่อมีการเปลี่ยนแปลง)
 *   3) ตอนถูกปิด (SIGTERM): สำรองครั้งสุดท้ายก่อนออก
 * ถ้าไม่ได้ตั้ง BACKUP_URL / BACKUP_TOKEN จะรันแอปตามปกติโดยไม่สำรองข้อมูล
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'eval.sqlite');
const BASE = String(process.env.BACKUP_URL || '').replace(/\/+$/, '');
const TOKEN = String(process.env.BACKUP_TOKEN || '');
const ENABLED = Boolean(BASE && TOKEN);
const INTERVAL_MS = 60_000;

const log = (...a) => console.log('[backup]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function call(method, p, body) {
  return fetch(BASE + '/__backup' + p, {
    method,
    headers: { authorization: 'Bearer ' + TOKEN },
    body,
    signal: AbortSignal.timeout(60_000),
  });
}
async function retry(fn, tries = 6) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      log(`retry ${i}: ${e.message}`);
      await sleep(2000 * i);
    }
  }
}

let lastDbHash = null;
const knownUploads = new Map(); // relPath -> size

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? walk(full, base) : d.isFile() ? [path.relative(base, full).split(path.sep).join('/')] : [];
  });
}
/** ป้องกัน path traversal จากชื่อไฟล์ที่ได้จาก R2 */
function safeUploadPath(rel) {
  const full = path.resolve(UPLOAD_DIR, rel);
  if (!full.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) throw new Error('bad upload key: ' + rel);
  return full;
}

async function restore() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const r = await call('GET', '/o/db/eval.sqlite');
  if (r.status === 404) {
    log('ไม่พบข้อมูลสำรอง — เริ่มฐานข้อมูลใหม่');
  } else if (!r.ok) {
    // ห้ามเริ่มด้วยฐานข้อมูลว่าง ไม่เช่นนั้นการสำรองรอบถัดไปจะเขียนทับข้อมูลจริง
    throw new Error('restore db failed: HTTP ' + r.status);
  } else {
    const buf = Buffer.from(await r.arrayBuffer());
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(DB_FILE + ext, { force: true });
    fs.writeFileSync(DB_FILE, buf);
    lastDbHash = sha(buf);
    log(`กู้คืนฐานข้อมูล ${buf.length} bytes`);
  }
  const lr = await call('GET', '/list?prefix=uploads/');
  if (!lr.ok) throw new Error('list uploads failed: HTTP ' + lr.status);
  const { keys } = await lr.json();
  for (const { key, size } of keys) {
    const rel = key.slice('uploads/'.length);
    const or = await call('GET', '/o/' + key.split('/').map(encodeURIComponent).join('/'));
    if (!or.ok) throw new Error(`restore ${key} failed: HTTP ${or.status}`);
    const dest = safeUploadPath(rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await or.arrayBuffer()));
    knownUploads.set(rel, size);
  }
  log(`กู้คืนไฟล์แนบ ${keys.length} ไฟล์`);
}

async function backupOnce() {
  if (!fs.existsSync(DB_FILE)) return;
  const { DatabaseSync } = require('node:sqlite');
  const tmp = path.join(os.tmpdir(), 'eval-snapshot.sqlite');
  fs.rmSync(tmp, { force: true });
  const c = new DatabaseSync(DB_FILE);
  try {
    c.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } finally {
    c.close();
  }
  const buf = fs.readFileSync(tmp);
  const h = sha(buf);
  if (h !== lastDbHash) {
    const r = await call('PUT', '/o/db/eval.sqlite', buf);
    if (!r.ok) throw new Error('upload db failed: HTTP ' + r.status);
    lastDbHash = h;
    log(`สำรองฐานข้อมูล ${buf.length} bytes`);
  }
  for (const rel of walk(UPLOAD_DIR)) {
    const full = path.join(UPLOAD_DIR, rel);
    const size = fs.statSync(full).size;
    if (knownUploads.get(rel) === size) continue;
    const key = 'uploads/' + rel;
    const r = await call('PUT', '/o/' + key.split('/').map(encodeURIComponent).join('/'), fs.readFileSync(full));
    if (!r.ok) throw new Error(`upload ${key} failed: HTTP ${r.status}`);
    knownUploads.set(rel, size);
    log('สำรองไฟล์', key);
  }
}

// ให้การสำรองทำทีละครั้งเรียงกัน (SIGTERM จะรอรอบที่กำลังทำอยู่ให้เสร็จ)
let chain = Promise.resolve();
function backup() {
  chain = chain.then(backupOnce).catch((e) => console.error('[backup] error:', e.message));
  return chain;
}

(async () => {
  if (ENABLED) await retry(restore);
  else log('BACKUP_URL/BACKUP_TOKEN ไม่ได้ตั้งค่า — ไม่สำรองข้อมูล');
  const app = require('../server.js'); // server.js ไม่ listen เองเมื่อถูก require
  const port = Number(process.env.PORT) || 8080;
  app.listen(port, () => console.log(`ระบบประเมินเครื่องมือวิจัย พร้อมใช้งานที่ port ${port}`));
  if (!ENABLED) return;
  setInterval(backup, INTERVAL_MS).unref();
  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => {
      if (stopping) return;
      stopping = true;
      log(`ได้รับ ${sig} — สำรองข้อมูลครั้งสุดท้าย`);
      await backup();
      process.exit(0);
    });
  }
})().catch((e) => {
  console.error('[boot] fatal:', e);
  process.exit(1);
});
