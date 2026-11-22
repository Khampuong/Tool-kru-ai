'use strict';
/**
 * ย้ายข้อมูลจากไฟล์ SQLite ในเครื่อง (data/eval.sqlite + data/uploads) ขึ้น Turso
 *
 *   TURSO_DATABASE_URL=libsql://...  TURSO_AUTH_TOKEN=...  node scripts/migrate-to-turso.js [--force]
 *
 * - ปลายทางต้องว่าง (ไม่มีผู้เชี่ยวชาญ/การมอบหมาย) ไม่เช่นนั้นต้องใส่ --force (ข้อมูลปลายทางจะถูกแทนที่)
 * - คัดลอกทุกตารางรวมถึงรหัสผู้ดูแลและ sessionSecret จึงใช้รหัสผู้ดูแลเดิมได้
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = process.env.SOURCE_DB || path.join(ROOT, 'data', 'eval.sqlite');
const SRC_UPLOADS = path.join(path.dirname(SRC), 'uploads');
const force = process.argv.includes('--force');

if (!process.env.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL.startsWith('file:')) {
  console.error('กรุณาตั้ง TURSO_DATABASE_URL (libsql://...) และ TURSO_AUTH_TOKEN');
  process.exit(1);
}
if (!fs.existsSync(SRC)) {
  console.error('ไม่พบไฟล์ต้นทาง: ' + SRC);
  process.exit(1);
}

const { createClient } = require('@libsql/client');
const store = require('../lib/db'); // เชื่อม Turso ตาม env

const TABLES = ['settings', 'instruments', 'sections', 'item_groups', 'items', 'experts', 'assignments', 'answers', 'section_comments', 'audit'];

(async () => {
  const src = createClient({ url: 'file:' + SRC.replace(/\\/g, '/'), intMode: 'number' });
  const dst = store.db.client;

  await store.open({ seed: false });
  const busy = (await dst.execute('SELECT (SELECT COUNT(*) FROM experts) + (SELECT COUNT(*) FROM assignments) n')).rows[0][0];
  if (busy && !force) {
    console.error(`ปลายทางมีข้อมูลอยู่แล้ว (${busy} แถว) — ใส่ --force หากต้องการแทนที่`);
    process.exit(1);
  }

  const srcTables = new Set((await src.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map((r) => r[0]));
  const stmts = [];
  for (const t of [...TABLES, 'files'].reverse()) stmts.push(`DELETE FROM ${t}`);
  for (const t of TABLES) {
    if (!srcTables.has(t)) continue;
    const rs = await src.execute(`SELECT * FROM ${t}`);
    const cols = rs.columns;
    for (const row of rs.rows) {
      stmts.push({
        sql: `INSERT INTO ${t}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        args: cols.map((_, i) => row[i]),
      });
    }
    console.log(`${t}: ${rs.rows.length} แถว`);
  }
  // ไฟล์แนบ: จากตาราง files (ถ้ามี) หรือจากโฟลเดอร์ uploads
  let nFiles = 0;
  if (srcTables.has('files')) {
    for (const r of (await src.execute('SELECT name, mime, data FROM files')).rows) {
      stmts.push({ sql: 'INSERT INTO files(name,mime,data) VALUES (?,?,?)', args: [r[0], r[1], r[2]] });
      nFiles++;
    }
  } else if (fs.existsSync(SRC_UPLOADS)) {
    for (const f of fs.readdirSync(SRC_UPLOADS, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      stmts.push({ sql: 'INSERT INTO files(name,mime,data) VALUES (?,?,?)', args: [f.name, store.mimeOf(f.name), fs.readFileSync(path.join(SRC_UPLOADS, f.name))] });
      nFiles++;
    }
  }
  console.log(`files: ${nFiles} ไฟล์`);

  // เขียนทั้งหมดในธุรกรรมเดียว (สำเร็จทั้งหมดหรือไม่เปลี่ยนเลย)
  await dst.batch(stmts, 'write');

  for (const t of [...TABLES, 'files']) {
    const n = (await dst.execute(`SELECT COUNT(*) FROM ${t}`)).rows[0][0];
    console.log(`  ปลายทาง ${t}: ${n}`);
  }
  console.log('ย้ายข้อมูลเสร็จ');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
