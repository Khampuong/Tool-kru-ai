'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SEED_DIR = path.join(ROOT, 'seed');

const DEFAULT_SETTINGS = {
  thesisTitle:
    'การจัดการวิทยาลัยอาชีวศึกษาอัจฉริยะโดยอินเทอร์เน็ตเชื่อมโยงพฤติกรรมด้วยอวตารโอภาปราศรัย สู่องค์กรแห่งความสุข',
  researcher:
    'นางสาวภัททชฎา คำพวง นักศึกษาปริญญาเอก สาขาวิชาเทคโนโลยีสารสนเทศและการสื่อสารเพื่อการศึกษา คณะครุศาสตร์อุตสาหกรรม มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ',
  advisor: 'ศาสตราจารย์ ดร.ปรัชญนันท์ นิลสุข',
  coAdvisor: 'รองศาสตราจารย์ ดร.ปณิตา วรรณพิรุณ',
  contact: '',
  thanks: 'ผู้วิจัยขอขอบพระคุณเป็นอย่างสูงที่ให้ความอนุเคราะห์ตอบแบบประเมิน',
  iocCriterion: 0.5,
  ratingCriterion: 3.51,
  sdMax: 1.0,
  aggMethod: 'respondent',
  levels: [4.51, 3.51, 2.51, 1.51, 1.0],
  experienceOptions: ['1–5 ปี', '6–10 ปี', '11–15 ปี', 'มากกว่า 15 ปี'],
};

let db;

function open() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, 'eval.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS instruments (
    id INTEGER PRIMARY KEY, code TEXT, title TEXT NOT NULL, subtitle TEXT DEFAULT '', phase TEXT DEFAULT '',
    kind TEXT DEFAULT 'expert', use_ioc INTEGER DEFAULT 0, use_rating INTEGER DEFAULT 1,
    rating_label TEXT DEFAULT 'ความเหมาะสม', rating_labels TEXT, instructions TEXT DEFAULT '',
    attachment TEXT, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY, instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    title TEXT DEFAULT '', sort INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS item_groups (
    id INTEGER PRIMARY KEY, section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    title TEXT DEFAULT '', description TEXT DEFAULT '', sort INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES item_groups(id) ON DELETE CASCADE,
    text TEXT NOT NULL, sort INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS experts (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, position TEXT DEFAULT '', workplace TEXT DEFAULT '',
    experience TEXT DEFAULT '', expertise TEXT DEFAULT '', email TEXT DEFAULT '', phone TEXT DEFAULT '',
    note TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    expert_id INTEGER NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
    profile TEXT, overall_comment TEXT DEFAULT '',
    opened_at TEXT, updated_at TEXT, submitted_at TEXT,
    signer_name TEXT, signature TEXT, signed_at TEXT, sign_ip TEXT, sign_ua TEXT, hash TEXT,
    edited_after_sign INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(instrument_id, expert_id));
  CREATE TABLE IF NOT EXISTS answers (
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    ioc INTEGER, rating INTEGER, comment TEXT DEFAULT '',
    PRIMARY KEY (assignment_id, item_id));
  CREATE TABLE IF NOT EXISTS section_comments (
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    comment TEXT DEFAULT '', PRIMARY KEY (assignment_id, section_id));
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY, at TEXT DEFAULT CURRENT_TIMESTAMP, actor TEXT, action TEXT, detail TEXT);
  `);
  // migration: รหัสผ่านสำหรับผู้เชี่ยวชาญเข้าสู่ระบบ
  const expCols = db.prepare('PRAGMA table_info(experts)').all().map((c) => c.name);
  if (!expCols.includes('password_hash')) db.exec('ALTER TABLE experts ADD COLUMN password_hash TEXT');
  if (!expCols.includes('last_login')) db.exec('ALTER TABLE experts ADD COLUMN last_login TEXT');
  // รหัสผ่านที่ผู้ดูแลสร้าง เก็บแบบเข้ารหัส (AES-256-GCM) เพื่อเรียกดูภายหลังได้
  if (!expCols.includes('password_enc')) db.exec('ALTER TABLE experts ADD COLUMN password_enc TEXT');
  ensureSettings();
  if (!db.prepare('SELECT COUNT(*) c FROM instruments').get().c) seedInstruments();
  return db;
}

let txDepth = 0;
/** ธุรกรรมที่ซ้อนกันได้ (ชั้นในใช้ SAVEPOINT) */
function tx(fn) {
  const sp = `sp${txDepth}`;
  db.exec(txDepth ? `SAVEPOINT ${sp}` : 'BEGIN');
  txDepth++;
  try {
    const r = fn();
    txDepth--;
    db.exec(txDepth ? `RELEASE ${sp}` : 'COMMIT');
    return r;
  } catch (e) {
    txDepth--;
    db.exec(txDepth ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
    throw e;
  }
}

// ---------------- settings ----------------
function ensureSettings() {
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, JSON.stringify(v));
  ins.run('sessionSecret', JSON.stringify(crypto.randomBytes(32).toString('hex')));
}
function getSettings({ includeSecret = false } = {}) {
  const out = {};
  for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = JSON.parse(r.value);
  if (!includeSecret) {
    delete out.sessionSecret;
    delete out.adminPasswordHash;
  }
  return out;
}
function setSettings(obj) {
  const up = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  tx(() => {
    for (const [k, v] of Object.entries(obj)) up.run(k, JSON.stringify(v));
  });
}

// ---------------- audit ----------------
function audit(actor, action, detail) {
  db.prepare('INSERT INTO audit(actor,action,detail) VALUES (?,?,?)').run(actor, action, JSON.stringify(detail ?? null));
}

// ---------------- seed ----------------
function seedInstruments() {
  const file = path.join(SEED_DIR, 'instruments.json');
  if (!fs.existsSync(file)) return;
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  tx(() => {
    list.forEach((inst, i) => {
      let attachment = null;
      if (inst.attachment) {
        const src = path.join(SEED_DIR, 'uploads', inst.attachment);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(UPLOAD_DIR, inst.attachment));
          attachment = inst.attachment;
        }
      }
      const id = db
        .prepare(
          `INSERT INTO instruments(code,title,subtitle,phase,kind,use_ioc,use_rating,rating_label,rating_labels,instructions,attachment,sort)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          inst.code, inst.title, inst.subtitle, inst.phase, inst.kind, inst.useIoc ? 1 : 0, inst.useRating ? 1 : 0,
          inst.ratingLabel, JSON.stringify(inst.ratingLabels), inst.instructions || '', attachment, i + 1
        ).lastInsertRowid;
      inst.sections.forEach((s, si) => {
        const title = /^ตอนที่ \d+$/.test(s.title) ? '' : s.title;
        const sid = db.prepare('INSERT INTO sections(instrument_id,title,sort) VALUES (?,?,?)').run(id, title, si).lastInsertRowid;
        s.groups.forEach((g, gi) => {
          const gid = db
            .prepare('INSERT INTO item_groups(section_id,title,description,sort) VALUES (?,?,?,?)')
            .run(sid, g.title, g.description || '', gi).lastInsertRowid;
          g.items.forEach((t, ii) => db.prepare('INSERT INTO items(group_id,text,sort) VALUES (?,?,?)').run(gid, t, ii));
        });
      });
    });
  });
}

// ---------------- instruments ----------------
function rowToInstrument(r) {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    subtitle: r.subtitle,
    phase: r.phase,
    kind: r.kind,
    useIoc: !!r.use_ioc,
    useRating: !!r.use_rating,
    ratingLabel: r.rating_label,
    ratingLabels: JSON.parse(r.rating_labels || '[]'),
    instructions: r.instructions,
    attachment: r.attachment,
    active: !!r.active,
    sort: r.sort,
    updatedAt: r.updated_at,
  };
}

function listInstruments() {
  return db
    .prepare(
      `SELECT i.*,
        (SELECT COUNT(*) FROM items it JOIN item_groups g ON g.id=it.group_id JOIN sections s ON s.id=g.section_id WHERE s.instrument_id=i.id) item_count,
        (SELECT COUNT(*) FROM assignments a WHERE a.instrument_id=i.id) assigned,
        (SELECT COUNT(*) FROM assignments a WHERE a.instrument_id=i.id AND a.status='submitted') submitted
       FROM instruments i ORDER BY sort, id`
    )
    .all()
    .map((r) => ({ ...rowToInstrument(r), itemCount: r.item_count, assigned: r.assigned, submitted: r.submitted }));
}

function getInstrument(id) {
  const r = db.prepare('SELECT * FROM instruments WHERE id=?').get(id);
  if (!r) return null;
  const inst = rowToInstrument(r);
  const secs = db.prepare('SELECT * FROM sections WHERE instrument_id=? ORDER BY sort,id').all(id);
  const grpStmt = db.prepare('SELECT * FROM item_groups WHERE section_id=? ORDER BY sort,id');
  const itemStmt = db.prepare('SELECT * FROM items WHERE group_id=? ORDER BY sort,id');
  inst.sections = secs.map((s) => ({
    id: s.id,
    title: s.title,
    groups: grpStmt.all(s.id).map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      items: itemStmt.all(g.id).map((it) => ({ id: it.id, text: it.text })),
    })),
  }));
  return inst;
}

const META_FIELDS = {
  code: 'code', title: 'title', subtitle: 'subtitle', phase: 'phase', kind: 'kind',
  useIoc: 'use_ioc', useRating: 'use_rating', ratingLabel: 'rating_label', ratingLabels: 'rating_labels',
  instructions: 'instructions', active: 'active', sort: 'sort',
};
function updateInstrumentMeta(id, data) {
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(META_FIELDS)) {
    if (!(k in data)) continue;
    let v = data[k];
    if (k === 'ratingLabels') v = JSON.stringify(Array.isArray(v) ? v.slice(0, 5).map(String) : []);
    if (['useIoc', 'useRating', 'active'].includes(k)) v = v ? 1 : 0;
    if (k === 'sort') v = Number(v) || 0;
    if (typeof v === 'string') v = v.trim();
    sets.push(`${col}=?`);
    vals.push(v);
  }
  if (!sets.length) return;
  sets.push("updated_at=CURRENT_TIMESTAMP");
  db.prepare(`UPDATE instruments SET ${sets.join(',')} WHERE id=?`).run(...vals, id);
}

function createInstrument(data) {
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM instruments').get().m;
  const id = db
    .prepare(`INSERT INTO instruments(title,rating_labels,sort) VALUES (?,?,?)`)
    .run(data.title || 'แบบประเมินใหม่', JSON.stringify(['มากที่สุด', 'มาก', 'ปานกลาง', 'น้อย', 'น้อยที่สุด']), maxSort + 1)
    .lastInsertRowid;
  updateInstrumentMeta(id, data);
  const sid = db.prepare('INSERT INTO sections(instrument_id,title,sort) VALUES (?,?,0)').run(id, '').lastInsertRowid;
  const gid = db.prepare('INSERT INTO item_groups(section_id,title,sort) VALUES (?,?,0)').run(sid, 'ด้านที่ 1').lastInsertRowid;
  db.prepare('INSERT INTO items(group_id,text,sort) VALUES (?,?,0)').run(gid, 'รายการประเมินที่ 1');
  return Number(id);
}

function duplicateInstrument(id) {
  const src = getInstrument(id);
  if (!src) return null;
  return tx(() => {
    const nid = createInstrument({ ...src, title: src.title + ' (สำเนา)' });
    db.prepare('DELETE FROM sections WHERE instrument_id=?').run(nid);
    saveStructure(nid, stripIds(src.sections), { force: true });
    return nid;
  });
}
function stripIds(sections) {
  return sections.map((s) => ({
    title: s.title,
    groups: s.groups.map((g) => ({ title: g.title, description: g.description, items: g.items.map((i) => ({ text: i.text })) })),
  }));
}

/**
 * บันทึกโครงสร้างทั้งหมดของแบบประเมิน (ส่วน → ด้าน/องค์ประกอบ → ข้อ)
 * id ที่มีอยู่ = แก้ไข, ไม่มี id = เพิ่มใหม่, id ที่หายไป = ลบ
 * ถ้าข้อที่จะลบมีคำตอบของผู้เชี่ยวชาญแล้ว ต้องส่ง force=true
 */
function saveStructure(instrumentId, sections, { force = false } = {}) {
  const current = getInstrument(instrumentId);
  if (!current) throw httpError(404, 'ไม่พบแบบประเมิน');
  const keepSec = new Set();
  const keepGrp = new Set();
  const keepItem = new Set();
  for (const s of sections) {
    if (s.id) keepSec.add(Number(s.id));
    for (const g of s.groups || []) {
      if (g.id) keepGrp.add(Number(g.id));
      for (const it of g.items || []) if (it.id) keepItem.add(Number(it.id));
    }
  }
  const curSec = current.sections.map((s) => s.id);
  const curGrp = current.sections.flatMap((s) => s.groups.map((g) => g.id));
  const curItem = current.sections.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.id)));
  // id ที่ส่งมาต้องเป็นของแบบประเมินนี้
  for (const id of keepSec) if (!curSec.includes(id)) throw httpError(400, 'รหัสส่วนไม่ถูกต้อง');
  for (const id of keepGrp) if (!curGrp.includes(id)) throw httpError(400, 'รหัสด้านไม่ถูกต้อง');
  for (const id of keepItem) if (!curItem.includes(id)) throw httpError(400, 'รหัสข้อไม่ถูกต้อง');

  const removedItems = curItem.filter((id) => !keepItem.has(id));
  if (removedItems.length && !force) {
    const ph = removedItems.map(() => '?').join(',');
    const c = db.prepare(`SELECT COUNT(*) c FROM answers WHERE item_id IN (${ph})`).get(...removedItems).c;
    if (c > 0) {
      const err = httpError(409, `ข้อที่ถูกลบมีคำตอบของผู้ประเมินแล้ว ${c} คำตอบ หากยืนยันจะลบคำตอบเหล่านั้นด้วย`);
      err.needForce = true;
      throw err;
    }
  }

  return tx(() => {
    const delItem = db.prepare('DELETE FROM items WHERE id=?');
    const delGrp = db.prepare('DELETE FROM item_groups WHERE id=?');
    const delSec = db.prepare('DELETE FROM sections WHERE id=?');
    removedItems.forEach((id) => delItem.run(id));
    curGrp.filter((id) => !keepGrp.has(id)).forEach((id) => delGrp.run(id));
    curSec.filter((id) => !keepSec.has(id)).forEach((id) => delSec.run(id));

    sections.forEach((s, si) => {
      let sid = Number(s.id) || null;
      if (sid) db.prepare('UPDATE sections SET title=?, sort=? WHERE id=?').run(String(s.title || '').trim(), si, sid);
      else sid = db.prepare('INSERT INTO sections(instrument_id,title,sort) VALUES (?,?,?)').run(instrumentId, String(s.title || '').trim(), si).lastInsertRowid;
      (s.groups || []).forEach((g, gi) => {
        let gid = Number(g.id) || null;
        const t = String(g.title || '').trim();
        const d = String(g.description || '').trim();
        if (gid) db.prepare('UPDATE item_groups SET section_id=?, title=?, description=?, sort=? WHERE id=?').run(sid, t, d, gi, gid);
        else gid = db.prepare('INSERT INTO item_groups(section_id,title,description,sort) VALUES (?,?,?,?)').run(sid, t, d, gi).lastInsertRowid;
        (g.items || []).forEach((it, ii) => {
          const text = String(it.text || '').trim();
          if (!text) throw httpError(400, 'ข้อความรายการประเมินต้องไม่ว่าง');
          if (it.id) db.prepare('UPDATE items SET group_id=?, text=?, sort=? WHERE id=?').run(gid, text, ii, Number(it.id));
          else db.prepare('INSERT INTO items(group_id,text,sort) VALUES (?,?,?)').run(gid, text, ii);
        });
      });
    });
    db.prepare('UPDATE instruments SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(instrumentId);
    return { removedItems: removedItems.length };
  });
}

function itemIdsOf(inst) {
  return inst.sections.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.id)));
}

// ---------------- experts ----------------
const EXPERT_FIELDS = ['name', 'position', 'workplace', 'experience', 'expertise', 'email', 'phone', 'note'];
function listExperts() {
  return db
    .prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM assignments a WHERE a.expert_id=e.id) assigned,
        (SELECT COUNT(*) FROM assignments a WHERE a.expert_id=e.id AND a.status='submitted') submitted
       FROM experts e ORDER BY e.id`
    )
    .all()
    .map(({ password_hash, password_enc, ...e }) => ({ ...e, hasLogin: !!password_hash, hasStoredPw: !!(password_hash && password_enc), sets: expertSets(e.id) }));
}

/** ชุดเครื่องมือที่ผู้เชี่ยวชาญได้รับมอบหมาย พร้อมสถานะ */
function expertSets(expertId) {
  return db
    .prepare(
      `SELECT a.instrument_id, a.status, i.code, (SELECT COUNT(*) FROM answers x WHERE x.assignment_id=a.id) answered
       FROM assignments a JOIN instruments i ON i.id=a.instrument_id WHERE a.expert_id=? ORDER BY i.sort, i.id`
    )
    .all(expertId);
}

/**
 * กำหนดชุดเครื่องมือของผู้เชี่ยวชาญให้ตรงกับรายการที่เลือก
 * - ชุดที่เพิ่ม → สร้างลิงก์ใหม่
 * - ชุดที่เอาออก → ลบได้เฉพาะที่ยังไม่ลงนาม; ถ้ามีคำตอบร่างแล้วต้อง force
 */
function setExpertSets(expertId, instrumentIds, { force = false } = {}) {
  const want = new Set(instrumentIds.map(Number).filter(Boolean));
  const valid = new Set(db.prepare('SELECT id FROM instruments').all().map((r) => r.id));
  for (const id of want) if (!valid.has(id)) throw httpError(400, 'ชุดเครื่องมือไม่ถูกต้อง');
  const cur = expertSets(expertId);
  const removing = cur.filter((c) => !want.has(c.instrument_id));
  const signed = removing.filter((c) => c.status === 'submitted');
  if (signed.length)
    throw httpError(409, `ไม่สามารถเอาชุดที่ ${signed.map((c) => Number(c.code) || c.instrument_id).join(', ')} ออกได้ เพราะผู้เชี่ยวชาญลงนามส่งแล้ว (ลบได้จากหน้าแบบประเมินชุดนั้น)`);
  const withDraft = removing.filter((c) => c.answered > 0);
  if (withDraft.length && !force) {
    const e = httpError(409, `ชุดที่ ${withDraft.map((c) => Number(c.code) || c.instrument_id).join(', ')} มีคำตอบที่ผู้เชี่ยวชาญกรอกไว้แล้ว หากเอาออก คำตอบจะถูกลบ`);
    e.needForce = true;
    throw e;
  }
  const have = new Set(cur.map((c) => c.instrument_id));
  return tx(() => {
    const del = db.prepare('DELETE FROM assignments WHERE expert_id=? AND instrument_id=?');
    removing.forEach((c) => del.run(expertId, c.instrument_id));
    const ins = db.prepare('INSERT INTO assignments(instrument_id,expert_id,token) VALUES (?,?,?)');
    let added = 0;
    for (const id of want) if (!have.has(id)) { ins.run(id, expertId, newToken()); added++; }
    return { added, removed: removing.length };
  });
}

/** รายการแบบประเมินที่มอบหมายให้ผู้เชี่ยวชาญ (สำหรับหน้าหลักผู้เชี่ยวชาญ) */
function expertAssignments(expertId) {
  return db
    .prepare(
      `SELECT a.token, a.status, a.submitted_at, a.updated_at, i.id instrument_id, i.code, i.title, i.subtitle, i.phase, i.active,
        (SELECT COUNT(*) FROM answers x WHERE x.assignment_id=a.id) answered,
        (SELECT COUNT(*) FROM items it JOIN item_groups g ON g.id=it.group_id JOIN sections s ON s.id=g.section_id WHERE s.instrument_id=i.id) total
       FROM assignments a JOIN instruments i ON i.id=a.instrument_id
       WHERE a.expert_id=? ORDER BY i.sort, i.id`
    )
    .all(expertId);
}
function saveExpert(id, data) {
  const vals = EXPERT_FIELDS.map((f) => String(data[f] ?? '').trim());
  if (!vals[0]) throw httpError(400, 'กรุณาระบุชื่อผู้เชี่ยวชาญ');
  // เบอร์โทรศัพท์: ตัวเลข 10 หลัก (ตัดขีด/ช่องว่างออกก่อนตรวจ) เว้นว่างได้
  const pi = EXPERT_FIELDS.indexOf('phone');
  vals[pi] = vals[pi].replace(/[\s-]/g, '');
  if (vals[pi] && !/^\d{10}$/.test(vals[pi])) throw httpError(400, 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก เช่น 0812345678');
  if (id) {
    db.prepare(`UPDATE experts SET ${EXPERT_FIELDS.map((f) => f + '=?').join(',')} WHERE id=?`).run(...vals, id);
    return Number(id);
  }
  return Number(
    db.prepare(`INSERT INTO experts(${EXPERT_FIELDS.join(',')}) VALUES (${EXPERT_FIELDS.map(() => '?').join(',')})`).run(...vals)
      .lastInsertRowid
  );
}

// ---------------- assignments ----------------
function newToken() {
  return crypto.randomBytes(18).toString('base64url');
}
function assign(instrumentId, expertIds) {
  const ins = db.prepare('INSERT OR IGNORE INTO assignments(instrument_id,expert_id,token) VALUES (?,?,?)');
  let added = 0;
  tx(() => {
    for (const eid of expertIds) added += Number(ins.run(instrumentId, eid, newToken()).changes);
  });
  return added;
}
function listAssignments(instrumentId) {
  return db
    .prepare(
      `SELECT a.id,a.token,a.status,a.opened_at,a.updated_at,a.submitted_at,a.signer_name,a.signed_at,a.edited_after_sign,a.hash,
        e.id expert_id,e.name,e.position,e.workplace,e.email,
        (SELECT COUNT(*) FROM answers x WHERE x.assignment_id=a.id) answered
       FROM assignments a JOIN experts e ON e.id=a.expert_id WHERE a.instrument_id=? ORDER BY a.id`
    )
    .all(instrumentId);
}
function getAssignmentByToken(token) {
  return db.prepare('SELECT * FROM assignments WHERE token=?').get(token);
}
function getAssignment(id) {
  return db.prepare('SELECT * FROM assignments WHERE id=?').get(id);
}

function loadResponse(a) {
  const answers = {};
  for (const r of db.prepare('SELECT item_id,ioc,rating,comment FROM answers WHERE assignment_id=?').all(a.id))
    answers[r.item_id] = { ioc: r.ioc, rating: r.rating, comment: r.comment || '' };
  const sectionComments = {};
  for (const r of db.prepare('SELECT section_id,comment FROM section_comments WHERE assignment_id=?').all(a.id))
    sectionComments[r.section_id] = r.comment;
  return { answers, sectionComments, overallComment: a.overall_comment || '' };
}

/** เขียนคำตอบ (ใช้ทั้งผู้เชี่ยวชาญบันทึกร่าง และผู้ดูแลแก้ไข) — ตรวจค่าที่อนุญาตเท่านั้น */
function writeResponse(a, inst, body) {
  const validItems = new Set(itemIdsOf(inst));
  const validSecs = new Set(inst.sections.map((s) => s.id));
  const up = db.prepare(
    `INSERT INTO answers(assignment_id,item_id,ioc,rating,comment) VALUES (?,?,?,?,?)
     ON CONFLICT(assignment_id,item_id) DO UPDATE SET ioc=excluded.ioc, rating=excluded.rating, comment=excluded.comment`
  );
  const del = db.prepare('DELETE FROM answers WHERE assignment_id=? AND item_id=?');
  const upSec = db.prepare(
    `INSERT INTO section_comments(assignment_id,section_id,comment) VALUES (?,?,?)
     ON CONFLICT(assignment_id,section_id) DO UPDATE SET comment=excluded.comment`
  );
  for (const [k, v] of Object.entries(body.answers || {})) {
    const itemId = Number(k);
    if (!validItems.has(itemId)) continue;
    const ioc = inst.useIoc && [1, 0, -1].includes(v?.ioc) ? v.ioc : null;
    const rating = inst.useRating && [1, 2, 3, 4, 5].includes(v?.rating) ? v.rating : null;
    const comment = String(v?.comment || '').slice(0, 4000);
    if (ioc === null && rating === null && !comment) del.run(a.id, itemId);
    else up.run(a.id, itemId, ioc, rating, comment);
  }
  for (const [k, v] of Object.entries(body.sectionComments || {})) {
    if (validSecs.has(Number(k))) upSec.run(a.id, Number(k), String(v || '').slice(0, 8000));
  }
  const sets = ['updated_at=CURRENT_TIMESTAMP'];
  const vals = [];
  if ('overallComment' in body) {
    sets.push('overall_comment=?');
    vals.push(String(body.overallComment || '').slice(0, 8000));
  }
  if (body.profile) {
    sets.push('profile=?');
    vals.push(JSON.stringify(cleanProfile(body.profile)));
  }
  db.prepare(`UPDATE assignments SET ${sets.join(',')} WHERE id=?`).run(...vals, a.id);
}

function cleanProfile(p) {
  const o = {};
  for (const f of ['name', 'position', 'workplace', 'experience']) o[f] = String(p?.[f] ?? '').trim().slice(0, 300);
  return o;
}

/** ตรวจว่ากรอกครบทุกข้อหรือยัง คืนรายการข้อที่ยังขาด */
function missingAnswers(inst, answers) {
  const missing = [];
  inst.sections.forEach((s, si) => {
    let no = 0;
    s.groups.forEach((g) =>
      g.items.forEach((it) => {
        no++;
        const a = answers[it.id] || {};
        const lack = (inst.useIoc && a.ioc == null) || (inst.useRating && a.rating == null);
        if (lack) missing.push({ itemId: it.id, label: (s.title ? s.title.split(' ').slice(0, 2).join(' ') + ' ' : '') + 'ข้อ ' + no });
      })
    );
  });
  return missing;
}

/** ค่าแฮชของเอกสารที่ลงนาม: รวมข้อความรายการ คำตอบ ความคิดเห็น ข้อมูลผู้ประเมิน และลายมือชื่อ */
function computeHash(a, inst, resp) {
  const items = inst.sections.flatMap((s) =>
    s.groups.flatMap((g) =>
      g.items.map((it) => {
        const x = resp.answers[it.id] || {};
        return [it.id, it.text, x.ioc ?? null, x.rating ?? null, x.comment || ''];
      })
    )
  );
  const secs = inst.sections.map((s) => [s.id, resp.sectionComments[s.id] || '']);
  const payload = JSON.stringify({
    instrument: [inst.id, inst.title],
    profile: a.profile ? JSON.parse(a.profile) : null,
    items,
    secs,
    overall: resp.overallComment || '',
    signer: a.signer_name,
    signedAt: a.signed_at,
    signature: a.signature,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function submissionsFor(instrumentId) {
  const rows = db
    .prepare(
      `SELECT a.*, e.name FROM assignments a JOIN experts e ON e.id=a.expert_id
       WHERE a.instrument_id=? AND a.status='submitted' ORDER BY a.submitted_at, a.id`
    )
    .all(instrumentId);
  return rows.map((a) => {
    const r = loadResponse(a);
    const profile = a.profile ? JSON.parse(a.profile) : {};
    return { id: a.id, name: profile.name || a.name, answers: r.answers, sectionComments: r.sectionComments, overallComment: r.overallComment, row: a };
  });
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = {
  open, get db() { return db; }, tx, UPLOAD_DIR, DATA_DIR,
  getSettings, setSettings, audit,
  listInstruments, getInstrument, updateInstrumentMeta, createInstrument, duplicateInstrument, saveStructure, itemIdsOf,
  listExperts, saveExpert, expertAssignments, setExpertSets,
  assign, listAssignments, getAssignmentByToken, getAssignment, loadResponse, writeResponse, cleanProfile,
  missingAnswers, computeHash, submissionsFor, httpError,
};
