'use strict';
/**
 * ตัวเชื่อมฐานข้อมูลแบบ async บน libSQL
 *  - Production (Vercel): Turso  — ตั้ง TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
 *  - Local: ไฟล์ SQLite (file:...)
 * API เลียนแบบ node:sqlite:  db.prepare(sql).run/get/all(...args)  แต่คืน Promise
 * ธุรกรรม: db.tx(async () => {...}) — คำสั่งที่เรียกภายใน (แม้เรียกผ่านฟังก์ชันอื่น) จะวิ่งในธุรกรรมเดียวกัน
 * ผ่าน AsyncLocalStorage; tx ที่ซ้อนกันจะรวมเข้ากับธุรกรรมชั้นนอก
 */
const { AsyncLocalStorage } = require('node:async_hooks');
const { createClient } = require('@libsql/client');

const als = new AsyncLocalStorage();

function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  return v;
}
function toPlain(rs) {
  const cols = rs.columns;
  return rs.rows.map((r) => {
    const o = {};
    for (let i = 0; i < cols.length; i++) {
      const v = r[i];
      o[cols[i]] = v instanceof ArrayBuffer ? Buffer.from(v) : v;
    }
    return o;
  });
}

function createDb({ url, authToken }) {
  const client = createClient({ url, authToken, intMode: 'number' });
  const runner = () => als.getStore() || client;
  const exec1 = (sql, args) => runner().execute({ sql, args: args.map(norm) });

  return {
    client,
    prepare(sql) {
      return {
        async run(...args) {
          const r = await exec1(sql, args);
          return {
            changes: r.rowsAffected,
            lastInsertRowid: r.lastInsertRowid == null ? undefined : Number(r.lastInsertRowid),
          };
        },
        async get(...args) {
          return toPlain(await exec1(sql, args))[0];
        },
        async all(...args) {
          return toPlain(await exec1(sql, args));
        },
      };
    },
    async exec(sql) {
      await runner().executeMultiple(sql);
    },
    async tx(fn) {
      if (als.getStore()) return fn();
      const t = await client.transaction('write');
      try {
        const r = await als.run(t, fn);
        await t.commit();
        return r;
      } catch (e) {
        try {
          await t.rollback();
        } catch {
          /* ignore */
        }
        throw e;
      } finally {
        t.close();
      }
    },
  };
}

module.exports = { createDb };
