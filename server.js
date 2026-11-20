'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const store = require('./lib/db');
const { computeResults, round2 } = require('./lib/stats');
const exporter = require('./lib/export');

const PORT = Number(process.env.PORT) || 3000;
store.open();
const { db, httpError } = store;

// ======================= ADMIN AUTH =======================
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, h] = String(stored || '').split(':');
  if (!salt || !h) return false;
  const got = crypto.scryptSync(String(pw), salt, 64);
  const exp = Buffer.from(h, 'hex');
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}
(function initPassword() {
  const s = store.getSettings({ includeSecret: true });
  if (process.env.ADMIN_PASSWORD) return;
  if (!s.adminPasswordHash) {
    const pw = crypto.randomBytes(6).toString('base64url');
    store.setSettings({ adminPasswordHash: hashPassword(pw) });
    fs.writeFileSync(path.join(store.DATA_DIR, 'ADMIN_PASSWORD.txt'), pw + '\n');
    console.log(`\n[ระบบ] สร้างรหัสผ่านผู้ดูแลครั้งแรก: ${pw}\n       (บันทึกไว้ที่ data/ADMIN_PASSWORD.txt — เปลี่ยนได้ในหน้าตั้งค่า)\n`);
  }
})();

// ---------- เก็บรหัสผ่านผู้เชี่ยวชาญแบบเข้ารหัส (ผู้ดูแลเรียกดูได้) ----------
function pwKey() {
  return crypto.createHash('sha256').update('expert-pw:' + secret()).digest();
}
function encryptPw(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', pwKey(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}
function decryptPw(enc) {
  try {
    const [iv, tag, ct] = String(enc).split('.').map((s) => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', pwKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const SESSION_HOURS = 12;
function secret() {
  return store.getSettings({ includeSecret: true }).sessionSecret;
}
function sign(v) {
  return crypto.createHmac('sha256', secret()).update(v).digest('base64url');
}
function makeSession() {
  const v = `${Date.now() + SESSION_HOURS * 3600e3}.${crypto.randomBytes(8).toString('hex')}`;
  return `${v}.${sign(v)}`;
}
function parseCookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}
function isAdmin(req) {
  const c = parseCookies(req).adm;
  if (!c) return false;
  const i = c.lastIndexOf('.');
  const v = c.slice(0, i);
  const sig = c.slice(i + 1);
  const exp = sign(v);
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return false;
  return Number(v.split('.')[0]) > Date.now();
}

// ---------- expert session ----------
// cookie: e.<expertId>.<expiresMs>.<ver>.<sig>  — ver = ส่วนหนึ่งของ hash รหัสผ่าน เพื่อให้รีเซ็ตรหัสแล้ว session เดิมใช้ไม่ได้
function pwVer(hash) {
  return crypto.createHash('sha256').update(String(hash || '')).digest('hex').slice(0, 12);
}
function makeExpertSession(id, hash) {
  const v = `e.${id}.${Date.now() + SESSION_HOURS * 3600e3}.${pwVer(hash)}`;
  return `${v}.${sign(v)}`;
}
function expertSession(req) {
  const c = parseCookies(req).exs;
  if (!c) return null;
  const i = c.lastIndexOf('.');
  const v = c.slice(0, i);
  const sig = c.slice(i + 1);
  const exp = sign(v);
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  const [, id, until, ver] = v.split('.');
  if (Number(until) < Date.now()) return null;
  const e = db.prepare('SELECT * FROM experts WHERE id=?').get(Number(id));
  if (!e || !e.password_hash || pwVer(e.password_hash) !== ver) return null;
  return e;
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบผู้ดูแล' });
  next();
}

// ======================= APP =======================
const app = express();
if (process.env.TRUST_PROXY) {
  const tp = process.env.TRUST_PROXY;
  app.set('trust proxy', tp === 'true' ? true : /^\d+$/.test(tp) ? Number(tp) : tp);
}
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
app.use('/uploads', express.static(store.UPLOAD_DIR, { maxAge: '1h' }));
app.get(['/', '/login'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/e/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'expert.html')));

// ---------- login ----------
const loginAttempts = new Map();
app.post('/api/admin/login', (req, res) => {
  const key = req.ip;
  const a = loginAttempts.get(key) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) Object.assign(a, { n: 0, t: Date.now() });
  if (a.n >= 10) return res.status(429).json({ error: 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที' });
  const pw = String(req.body?.password || '');
  const ok = process.env.ADMIN_PASSWORD
    ? pw.length === process.env.ADMIN_PASSWORD.length &&
      crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(process.env.ADMIN_PASSWORD))
    : checkPassword(pw, store.getSettings({ includeSecret: true }).adminPasswordHash);
  if (!ok) {
    a.n++;
    loginAttempts.set(key, a);
    return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
  }
  loginAttempts.delete(key);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `adm=${encodeURIComponent(makeSession())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`);
  store.audit('admin', 'login', { ip: req.ip });
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'adm=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req) }));
// ---------- expert login ----------
function throttle(req, res) {
  const key = req.ip;
  const a = loginAttempts.get(key) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) Object.assign(a, { n: 0, t: Date.now() });
  if (a.n >= 10) {
    res.status(429).json({ error: 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที' });
    return null;
  }
  return { fail: () => { a.n++; loginAttempts.set(key, a); }, ok: () => loginAttempts.delete(key) };
}
app.post('/api/expert/login', (req, res) => {
  const t = throttle(req, res);
  if (!t) return;
  // เข้าสู่ระบบด้วยอีเมล หรือ เบอร์โทรศัพท์ 10 หลัก
  const login = String(req.body?.login ?? req.body?.email ?? '').trim();
  const pw = String(req.body?.password || '');
  const digits = login.replace(/[\s-]/g, '');
  let cands = [];
  if (/^\d{10}$/.test(digits)) cands = db.prepare('SELECT * FROM experts WHERE phone=? AND password_hash IS NOT NULL').all(digits);
  else if (login) cands = db.prepare('SELECT * FROM experts WHERE lower(trim(email))=? AND password_hash IS NOT NULL').all(login.toLowerCase());
  const e = cands.find((x) => checkPassword(pw, x.password_hash));
  if (!e) {
    t.fail();
    return res.status(401).json({ error: 'อีเมล/เบอร์โทรศัพท์ หรือรหัสผ่านไม่ถูกต้อง' });
  }
  t.ok();
  db.prepare('UPDATE experts SET last_login=CURRENT_TIMESTAMP WHERE id=?').run(e.id);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `exs=${encodeURIComponent(makeExpertSession(e.id, e.password_hash))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`);
  store.audit('expert', 'expert.login', { id: e.id, name: e.name, ip: req.ip });
  res.json({ ok: true });
});
app.post('/api/expert/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'exs=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/expert/me', (req, res) => {
  const e = expertSession(req);
  if (!e) return res.json({ expert: null });
  res.json({
    expert: {
      id: e.id, name: e.name, position: e.position, workplace: e.workplace, experience: e.experience,
      expertise: e.expertise, email: e.email, phone: e.phone,
    },
    experienceOptions: store.getSettings().experienceOptions || [],
    assignments: store.expertAssignments(e.id),
  });
});
/** ผู้เชี่ยวชาญแก้ไขข้อมูลส่วนตัวของตนเอง */
app.put('/api/expert/profile', (req, res) => {
  const e = expertSession(req);
  if (!e) throw httpError(401, 'กรุณาเข้าสู่ระบบ');
  const b = req.body || {};
  const v = {
    name: String(b.name ?? '').trim().slice(0, 200),
    position: String(b.position ?? '').trim().slice(0, 300),
    workplace: String(b.workplace ?? '').trim().slice(0, 300),
    experience: String(b.experience ?? '').trim().slice(0, 100),
    expertise: String(b.expertise ?? '').trim().slice(0, 300),
    email: String(b.email ?? '').trim().slice(0, 200),
    phone: String(b.phone ?? '').replace(/[\s-]/g, ''),
  };
  if (!v.name) throw httpError(400, 'กรุณากรอกชื่อ-นามสกุล');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) throw httpError(400, 'กรุณากรอกอีเมลให้ถูกต้อง');
  if (!/^\d{10}$/.test(v.phone)) throw httpError(400, 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก');
  const clash = db
    .prepare('SELECT id FROM experts WHERE id<>? AND password_hash IS NOT NULL AND (lower(trim(email))=? OR phone=?)')
    .get(e.id, v.email.toLowerCase(), v.phone);
  if (clash) throw httpError(409, 'อีเมลหรือเบอร์โทรศัพท์นี้ถูกใช้กับบัญชีอื่นแล้ว');
  const before = { name: e.name, position: e.position, workplace: e.workplace, experience: e.experience, expertise: e.expertise, email: e.email, phone: e.phone };
  store.tx(() => {
    db.prepare('UPDATE experts SET name=?, position=?, workplace=?, experience=?, expertise=?, email=?, phone=? WHERE id=?')
      .run(v.name, v.position, v.workplace, v.experience, v.expertise, v.email, v.phone, e.id);
    // ปรับตอนที่ 1 ของแบบประเมินที่ยังไม่ลงนาม (ฉบับที่ลงนามแล้วคงข้อมูลเดิมไว้)
    const prof = JSON.stringify({ name: v.name, position: v.position, workplace: v.workplace, experience: v.experience });
    db.prepare("UPDATE assignments SET profile=? WHERE expert_id=? AND status<>'submitted'").run(prof, e.id);
  });
  store.audit('expert', 'expert.profile', { id: e.id, before, after: v });
  res.json({ ok: true });
});
app.post('/api/expert/password', (req, res) => {
  const e = expertSession(req);
  if (!e) throw httpError(401, 'กรุณาเข้าสู่ระบบ');
  const { current, next } = req.body || {};
  if (!checkPassword(String(current || ''), e.password_hash)) throw httpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  if (String(next || '').length < 8) throw httpError(400, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร');
  const h = hashPassword(String(next));
  // รหัสที่ผู้เชี่ยวชาญตั้งเองเป็นความลับของผู้เชี่ยวชาญ จึงลบสำเนาที่ผู้ดูแลเก็บไว้
  db.prepare('UPDATE experts SET password_hash=?, password_enc=NULL WHERE id=?').run(h, e.id);
  res.setHeader('Set-Cookie', `exs=${encodeURIComponent(makeExpertSession(e.id, h))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
  store.audit('expert', 'expert.password', { id: e.id });
  res.json({ ok: true });
});

/** ข้อมูลสาธารณะสำหรับหน้าเข้าสู่ระบบ */
app.get('/api/public/info', (req, res) => {
  const s = store.getSettings();
  const n = db.prepare("SELECT COUNT(*) c FROM instruments WHERE active=1").get().c;
  res.json({ thesisTitle: s.thesisTitle || '', researcher: s.researcher || '', advisor: s.advisor || '', coAdvisor: s.coAdvisor || '', instrumentCount: n });
});

const A = express.Router();
A.use(requireAdmin);

// ---------- settings ----------
const SETTING_KEYS = [
  'thesisTitle', 'researcher', 'advisor', 'coAdvisor', 'contact', 'thanks',
  'iocCriterion', 'ratingCriterion', 'sdMax', 'aggMethod', 'levels', 'experienceOptions',
];
A.get('/settings', (req, res) => res.json({ ...store.getSettings(), envPassword: !!process.env.ADMIN_PASSWORD }));
A.put('/settings', (req, res) => {
  const b = req.body || {};
  const out = {};
  for (const k of SETTING_KEYS) if (k in b) out[k] = b[k];
  for (const k of ['iocCriterion', 'ratingCriterion']) if (k in out) out[k] = Number(out[k]);
  if ('sdMax' in out) out.sdMax = out.sdMax === '' || out.sdMax === null ? null : Number(out.sdMax);
  if ('levels' in out) {
    const l = (out.levels || []).map(Number);
    if (l.length !== 5 || l.some((x) => !Number.isFinite(x)) || l.some((x, i) => i && x >= l[i - 1]))
      throw httpError(400, 'เกณฑ์ระดับต้องเป็นตัวเลข 5 ค่า เรียงจากมากไปน้อย');
    out.levels = l;
  }
  if ('aggMethod' in out && !['respondent', 'pooled'].includes(out.aggMethod)) throw httpError(400, 'วิธีคำนวณไม่ถูกต้อง');
  if ('experienceOptions' in out) out.experienceOptions = (out.experienceOptions || []).map(String).filter(Boolean);
  store.setSettings(out);
  store.audit('admin', 'settings.update', out);
  res.json(store.getSettings());
});
A.post('/password', (req, res) => {
  if (process.env.ADMIN_PASSWORD) throw httpError(400, 'รหัสผ่านถูกกำหนดผ่านตัวแปร ADMIN_PASSWORD จึงเปลี่ยนในหน้านี้ไม่ได้');
  const { current, next } = req.body || {};
  if (!checkPassword(current, store.getSettings({ includeSecret: true }).adminPasswordHash))
    throw httpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  if (String(next || '').length < 8) throw httpError(400, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร');
  store.setSettings({ adminPasswordHash: hashPassword(String(next)) });
  const f = path.join(store.DATA_DIR, 'ADMIN_PASSWORD.txt');
  if (fs.existsSync(f)) fs.unlinkSync(f);
  store.audit('admin', 'password.change', null);
  res.json({ ok: true });
});

// ---------- instruments ----------
A.get('/instruments', (req, res) => res.json(store.listInstruments()));
A.post('/instruments', (req, res) => {
  const id = store.createInstrument(req.body || {});
  store.audit('admin', 'instrument.create', { id });
  res.json({ id });
});
A.get('/instruments/:id', (req, res) => {
  const inst = store.getInstrument(Number(req.params.id));
  if (!inst) throw httpError(404, 'ไม่พบแบบประเมิน');
  res.json(inst);
});
A.put('/instruments/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!store.getInstrument(id)) throw httpError(404, 'ไม่พบแบบประเมิน');
  store.updateInstrumentMeta(id, req.body || {});
  store.audit('admin', 'instrument.update', { id, ...req.body });
  res.json(store.getInstrument(id));
});
A.put('/instruments/:id/structure', (req, res) => {
  const id = Number(req.params.id);
  const before = store.getInstrument(id);
  const r = store.saveStructure(id, req.body?.sections || [], { force: !!req.body?.force });
  store.audit('admin', 'instrument.structure', { id, removedItems: r.removedItems, before: before?.sections });
  res.json(store.getInstrument(id));
});
A.post('/instruments/:id/duplicate', (req, res) => {
  const nid = store.duplicateInstrument(Number(req.params.id));
  if (!nid) throw httpError(404, 'ไม่พบแบบประเมิน');
  store.audit('admin', 'instrument.duplicate', { from: Number(req.params.id), id: nid });
  res.json({ id: nid });
});
A.delete('/instruments/:id', (req, res) => {
  const id = Number(req.params.id);
  const n = db.prepare("SELECT COUNT(*) c FROM assignments WHERE instrument_id=? AND status='submitted'").get(id).c;
  if (n && req.query.force !== '1') throw Object.assign(httpError(409, `มีผู้ประเมินส่งแบบประเมินนี้แล้ว ${n} คน`), { needForce: true });
  const inst = store.getInstrument(id);
  db.prepare('DELETE FROM instruments WHERE id=?').run(id);
  store.audit('admin', 'instrument.delete', { id, title: inst?.title });
  res.json({ ok: true });
});
const ALLOWED_UPLOAD = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'application/pdf': '.pdf' };
A.post('/instruments/:id/attachment', (req, res) => {
  const id = Number(req.params.id);
  const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(req.body?.dataUrl || ''));
  if (!m || !ALLOWED_UPLOAD[m[1]]) throw httpError(400, 'รองรับเฉพาะไฟล์ PNG, JPG, WEBP หรือ PDF');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 10 * 1024 * 1024) throw httpError(400, 'ไฟล์ต้องมีขนาดไม่เกิน 10 MB');
  const name = `inst${id}_${crypto.randomBytes(6).toString('hex')}${ALLOWED_UPLOAD[m[1]]}`;
  fs.writeFileSync(path.join(store.UPLOAD_DIR, name), buf);
  db.prepare('UPDATE instruments SET attachment=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, id);
  store.audit('admin', 'instrument.attachment', { id, name });
  res.json({ attachment: name });
});
A.delete('/instruments/:id/attachment', (req, res) => {
  db.prepare('UPDATE instruments SET attachment=NULL WHERE id=?').run(Number(req.params.id));
  store.audit('admin', 'instrument.attachment.remove', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ---------- experts ----------
A.get('/experts', (req, res) => res.json(store.listExperts()));
A.post('/experts', (req, res) => {
  const id = store.saveExpert(null, req.body || {});
  store.audit('admin', 'expert.create', { id, name: req.body?.name });
  res.json({ id });
});
A.put('/experts/:id', (req, res) => {
  const id = store.saveExpert(Number(req.params.id), req.body || {});
  store.audit('admin', 'expert.update', { id, ...req.body });
  res.json({ id });
});
// ---------- import experts from Excel / CSV ----------
const importer = require('./lib/importExperts');
A.get('/experts/template.xlsx', async (req, res, next) => {
  try {
    sendFile(res, await importer.templateXlsx(), 'แบบฟอร์มรายชื่อผู้เชี่ยวชาญ', 'xlsx');
  } catch (e) {
    next(e);
  }
});
/** body: {dataUrl, filename, commit, skipDuplicates, instrumentIds[]} — commit=false คืนตัวอย่างข้อมูลก่อนนำเข้า */
A.post('/experts/import', async (req, res, next) => {
  try {
    const b = req.body || {};
    const m = /^data:[^;]*;base64,(.+)$/.exec(String(b.dataUrl || ''));
    if (!m) throw httpError(400, 'กรุณาเลือกไฟล์ Excel (.xlsx) หรือ CSV');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 10 * 1024 * 1024) throw httpError(400, 'ไฟล์ต้องมีขนาดไม่เกิน 10 MB');
    const existing = db.prepare('SELECT name FROM experts').all().map((r) => r.name);
    const parsed = await importer.parseExperts(buf, String(b.filename || ''), existing);
    if (!b.commit) return res.json(parsed);
    const toAdd = parsed.rows.filter((r) => r.status === 'new' || (!b.skipDuplicates && r.status !== 'new'));
    const sets = (b.instrumentIds || []).map(Number).filter(Boolean);
    const ids = store.tx(() =>
      toAdd.map((r) => {
        const id = store.saveExpert(null, { ...r, phone: /^\d{10}$/.test(r.phone) ? r.phone : '' });
        if (sets.length) store.setExpertSets(id, sets);
        return id;
      })
    );
    store.audit('admin', 'expert.import', { file: b.filename, added: ids.length, skipped: parsed.rows.length - ids.length, instrumentIds: sets });
    res.json({ added: ids.length, skipped: parsed.rows.length - ids.length });
  } catch (e) {
    next(e);
  }
});
A.put('/experts/:id/sets', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM experts WHERE id=?').get(id)) throw httpError(404, 'ไม่พบผู้เชี่ยวชาญ');
  const r = store.setExpertSets(id, req.body?.instrumentIds || [], { force: !!req.body?.force });
  store.audit('admin', 'expert.sets', { id, instrumentIds: req.body?.instrumentIds, ...r });
  res.json(r);
});
/** สร้าง/รีเซ็ตรหัสผ่านเข้าสู่ระบบของผู้เชี่ยวชาญ — คืนรหัสให้ผู้ดูแลแจ้งผู้เชี่ยวชาญ (แสดงครั้งเดียว) */
A.post('/experts/:id/password', (req, res) => {
  const e = db.prepare('SELECT * FROM experts WHERE id=?').get(Number(req.params.id));
  if (!e) throw httpError(404, 'ไม่พบผู้เชี่ยวชาญ');
  if (!String(e.email || '').trim() && !/^\d{10}$/.test(e.phone || ''))
    throw httpError(400, 'กรุณาบันทึกอีเมลหรือเบอร์โทรศัพท์ 10 หลักของผู้เชี่ยวชาญก่อน (ใช้เป็นชื่อผู้ใช้ในการเข้าสู่ระบบ) — หรือส่งลิงก์ให้ผู้เชี่ยวชาญตั้งค่าบัญชีเอง');
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const pw = Array.from(crypto.randomBytes(10), (b) => alphabet[b % alphabet.length]).join('');
  db.prepare('UPDATE experts SET password_hash=?, password_enc=? WHERE id=?').run(hashPassword(pw), encryptPw(pw), e.id);
  store.audit('admin', 'expert.password.reset', { id: e.id, name: e.name });
  res.json({ email: String(e.email || '').trim(), phone: e.phone || '', password: pw });
});
/** เรียกดูรหัสผ่านที่ผู้ดูแลสร้างไว้ */
A.get('/experts/:id/password', (req, res) => {
  const e = db.prepare('SELECT * FROM experts WHERE id=?').get(Number(req.params.id));
  if (!e) throw httpError(404, 'ไม่พบผู้เชี่ยวชาญ');
  if (!e.password_hash) throw httpError(404, 'ผู้เชี่ยวชาญท่านนี้ยังไม่มีรหัสเข้าระบบ');
  const pw = e.password_enc ? decryptPw(e.password_enc) : null;
  if (!pw) throw httpError(404, 'ไม่มีรหัสที่เก็บไว้ (ผู้เชี่ยวชาญเปลี่ยนรหัสเอง หรือรหัสถูกตั้งก่อนมีระบบเก็บรหัส) — กด “รีเซ็ตรหัส” เพื่อสร้างรหัสใหม่');
  store.audit('admin', 'expert.password.view', { id: e.id, name: e.name });
  res.json({ email: String(e.email || '').trim(), phone: e.phone || '', password: pw });
});
/** ส่งออกข้อมูลเข้าสู่ระบบของผู้เชี่ยวชาญทั้งหมดเป็น Excel */
A.get('/experts/credentials.xlsx', async (req, res, next) => {
  try {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('รหัสเข้าระบบ');
    ws.columns = [
      { header: 'ลำดับ', width: 7 }, { header: 'ชื่อผู้เชี่ยวชาญ', width: 36 }, { header: 'อีเมล (ชื่อผู้ใช้)', width: 32 },
      { header: 'รหัสผ่าน', width: 16 }, { header: 'โทรศัพท์', width: 14 }, { header: 'ชุดเครื่องมือ', width: 22 }, { header: 'หมายเหตุ', width: 40 },
    ];
    ws.getRow(1).font = { bold: true };
    const origin = `${req.protocol}://${req.get('host')}/`;
    store.listExperts().forEach((x, i) => {
      const raw = db.prepare('SELECT password_hash, password_enc FROM experts WHERE id=?').get(x.id);
      const pw = raw.password_hash && raw.password_enc ? decryptPw(raw.password_enc) : null;
      const note = !raw.password_hash ? (x.email ? 'ยังไม่ได้ตั้งรหัส' : 'ไม่มีอีเมล — ใช้ลิงก์เฉพาะบุคคล') : pw ? `เข้าระบบที่ ${origin}` : 'ไม่มีรหัสที่เก็บไว้ (ผู้เชี่ยวชาญเปลี่ยนเอง หรือตั้งก่อนมีระบบเก็บรหัส) — กดรีเซ็ตรหัส';
      ws.addRow([i + 1, x.name, x.email, pw || '', x.phone, x.sets.map((s) => 'ชุด ' + (Number(s.code) || s.instrument_id)).join(', '), note]);
    });
    ws.getColumn(5).numFmt = '@';
    store.audit('admin', 'expert.password.export', null);
    sendFile(res, await wb.xlsx.writeBuffer(), 'รหัสเข้าระบบผู้เชี่ยวชาญ', 'xlsx');
  } catch (e) {
    next(e);
  }
});
A.delete('/experts/:id/password', (req, res) => {
  db.prepare('UPDATE experts SET password_hash=NULL, password_enc=NULL WHERE id=?').run(Number(req.params.id));
  store.audit('admin', 'expert.password.revoke', { id: Number(req.params.id) });
  res.json({ ok: true });
});
A.delete('/experts/:id', (req, res) => {
  const id = Number(req.params.id);
  const n = db.prepare("SELECT COUNT(*) c FROM assignments WHERE expert_id=? AND status='submitted'").get(id).c;
  if (n && req.query.force !== '1') throw Object.assign(httpError(409, `ผู้เชี่ยวชาญท่านนี้ส่งแบบประเมินแล้ว ${n} ฉบับ หากลบ ผลการประเมินจะถูกลบด้วย`), { needForce: true });
  db.prepare('DELETE FROM experts WHERE id=?').run(id);
  store.audit('admin', 'expert.delete', { id });
  res.json({ ok: true });
});

// ---------- assignments ----------
A.get('/instruments/:id/assignments', (req, res) => res.json(store.listAssignments(Number(req.params.id))));
A.post('/instruments/:id/assignments', (req, res) => {
  const ids = (req.body?.expertIds || []).map(Number).filter(Boolean);
  const added = store.assign(Number(req.params.id), ids);
  store.audit('admin', 'assignment.create', { instrumentId: Number(req.params.id), expertIds: ids });
  res.json({ added });
});
A.delete('/assignments/:id', (req, res) => {
  const a = store.getAssignment(Number(req.params.id));
  if (!a) throw httpError(404, 'ไม่พบรายการ');
  if (a.status === 'submitted' && req.query.force !== '1')
    throw Object.assign(httpError(409, 'ผู้เชี่ยวชาญส่งแบบประเมินนี้แล้ว หากลบ คำตอบและลายมือชื่อจะถูกลบด้วย'), { needForce: true });
  db.prepare('DELETE FROM assignments WHERE id=?').run(a.id);
  store.audit('admin', 'assignment.delete', { id: a.id, status: a.status });
  res.json({ ok: true });
});
A.post('/assignments/:id/reopen', (req, res) => {
  const a = store.getAssignment(Number(req.params.id));
  if (!a) throw httpError(404, 'ไม่พบรายการ');
  store.audit('admin', 'assignment.reopen', {
    id: a.id, previous: { signer_name: a.signer_name, signed_at: a.signed_at, hash: a.hash, submitted_at: a.submitted_at },
  });
  db.prepare(
    `UPDATE assignments SET status='draft', submitted_at=NULL, signer_name=NULL, signature=NULL, signed_at=NULL,
      sign_ip=NULL, sign_ua=NULL, hash=NULL, edited_after_sign=0 WHERE id=?`
  ).run(a.id);
  res.json({ ok: true });
});
A.post('/assignments/:id/regenerate-link', (req, res) => {
  const tok = crypto.randomBytes(18).toString('base64url');
  db.prepare('UPDATE assignments SET token=? WHERE id=?').run(tok, Number(req.params.id));
  store.audit('admin', 'assignment.relink', { id: Number(req.params.id) });
  res.json({ token: tok });
});
/** ผู้ดูแลแก้ไขคำตอบ — บันทึกค่าเดิมไว้ใน audit และทำเครื่องหมายว่าแก้ไขหลังลงนาม */
A.put('/assignments/:id/response', (req, res) => {
  const a = store.getAssignment(Number(req.params.id));
  if (!a) throw httpError(404, 'ไม่พบรายการ');
  const inst = store.getInstrument(a.instrument_id);
  const before = store.loadResponse(a);
  store.tx(() => {
    store.writeResponse(a, inst, req.body || {});
    if (a.status === 'submitted') db.prepare('UPDATE assignments SET edited_after_sign=1 WHERE id=?').run(a.id);
  });
  store.audit('admin', 'response.edit', { id: a.id, reason: String(req.body?.reason || ''), before, after: store.loadResponse(a) });
  res.json({ ok: true });
});

// ---------- results ----------
function resultsFor(id) {
  const inst = store.getInstrument(id);
  if (!inst) throw httpError(404, 'ไม่พบแบบประเมิน');
  const subs = store.submissionsFor(id);
  const results = computeResults(inst, subs, store.getSettings());
  return { inst, subs, results };
}
/** รายชื่อผู้เชี่ยวชาญที่ลงนามส่งแล้ว พร้อมลายมือชื่อ (เรียงตามลำดับ “คนที่ 1, 2, …” เดียวกับตารางผล) */
function signersOf(subs) {
  return subs.map((s, i) => {
    const p = s.row.profile ? JSON.parse(s.row.profile) : {};
    return {
      id: s.id,
      no: i + 1,
      name: s.name,
      position: p.position || '',
      workplace: p.workplace || '',
      signerName: s.row.signer_name || s.name,
      signature: s.row.signature || null,
      signedAt: s.row.signed_at,
    };
  });
}
function collectComments(inst, subs) {
  const comments = [];
  for (const s of subs) {
    inst.sections.forEach((sec) => {
      let no = 0;
      sec.groups.forEach((g) =>
        g.items.forEach((it) => {
          no++;
          const c = s.answers[it.id]?.comment;
          if (c) comments.push({ expert: s.name, where: `${sec.title ? sec.title + ' · ' : ''}ข้อ ${no} ${it.text}`, text: c });
        })
      );
      if (s.sectionComments[sec.id]) comments.push({ expert: s.name, where: sec.title || 'ข้อเสนอแนะส่วนนี้', text: s.sectionComments[sec.id] });
    });
    if (s.overallComment) comments.push({ expert: s.name, where: 'ข้อเสนอแนะอื่น ๆ', text: s.overallComment });
  }
  return comments;
}
const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
function sendFile(res, buf, name, fmt) {
  const safe = name.replace(/[\\/:*?"<>|\r\n]+/g, ' ').slice(0, 120);
  res.setHeader('Content-Type', MIME[fmt]);
  res.setHeader('Content-Disposition', `attachment; filename="export.${fmt}"; filename*=UTF-8''${encodeURIComponent(safe + '.' + fmt)}`);
  res.send(Buffer.from(buf));
}
A.get('/instruments/:id/results.:fmt(docx|xlsx)', async (req, res, next) => {
  try {
    const { inst, subs, results } = resultsFor(Number(req.params.id));
    if (!results.n) throw httpError(400, 'ยังไม่มีผู้ประเมินลงนามส่ง');
    const comments = collectComments(inst, subs);
    const fmt = req.params.fmt;
    const signers = signersOf(subs);
    const buf = fmt === 'docx'
      ? await exporter.resultsDocx({ inst, R: results, comments, signers })
      : await exporter.resultsXlsx({ inst, R: results, subs, comments, signers });
    sendFile(res, buf, `ผลการประเมิน ชุดที่ ${inst.code || inst.id}`, fmt);
  } catch (e) {
    next(e);
  }
});
A.get('/instruments/:id/results', (req, res) => {
  const { inst, subs, results } = resultsFor(Number(req.params.id));
  const comments = collectComments(inst, subs);
  const integrity = subs.map((s) => {
    const fresh = store.computeHash(s.row, inst, s);
    return { id: s.id, name: s.name, ok: fresh === s.row.hash, edited: !!s.row.edited_after_sign };
  });
  res.json({ instrument: inst, results, comments, integrity, signers: signersOf(subs) });
});

// ---------- CSV export ----------
function csv(rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
const f2 = (x) => (x === null || x === undefined ? '' : round2(x).toFixed(2));
A.get('/instruments/:id/export.csv', (req, res) => {
  const { inst, subs, results } = resultsFor(Number(req.params.id));
  const type = req.query.type || 'summary';
  let rows = [];
  if (type === 'raw') {
    const head = ['ลำดับ', 'ชื่อผู้ประเมิน', 'ตำแหน่ง', 'สถานที่ทำงาน', 'ประสบการณ์', 'ส่งเมื่อ', 'ลงนามโดย', 'SHA-256'];
    const cols = [];
    inst.sections.forEach((s, si) => {
      let no = 0;
      s.groups.forEach((g) =>
        g.items.forEach((it) => {
          no++;
          const p = inst.sections.length > 1 ? `S${si + 1}_` : '';
          if (inst.useIoc) cols.push([`${p}Q${no}_IOC`, it.id, 'ioc']);
          if (inst.useRating) cols.push([`${p}Q${no}`, it.id, 'rating']);
        })
      );
    });
    rows.push([...head, ...cols.map((c) => c[0])]);
    subs.forEach((s, i) => {
      const p = s.row.profile ? JSON.parse(s.row.profile) : {};
      rows.push([
        i + 1, s.name, p.position, p.workplace, p.experience, s.row.submitted_at, s.row.signer_name, s.row.hash,
        ...cols.map(([, id, k]) => s.answers[id]?.[k] ?? ''),
      ]);
    });
  } else if (type === 'comments') {
    rows.push(['ผู้ประเมิน', 'ตำแหน่ง', 'ความคิดเห็น']);
    for (const s of subs) {
      inst.sections.forEach((sec) => {
        let no = 0;
        sec.groups.forEach((g) =>
          g.items.forEach((it) => {
            no++;
            const c = s.answers[it.id]?.comment;
            if (c) rows.push([s.name, `${sec.title ? sec.title + ' ' : ''}ข้อ ${no} ${it.text}`, c]);
          })
        );
        if (s.sectionComments[sec.id]) rows.push([s.name, sec.title || 'ข้อเสนอแนะส่วนนี้', s.sectionComments[sec.id]]);
      });
      if (s.overallComment) rows.push([s.name, 'ข้อเสนอแนะอื่น ๆ', s.overallComment]);
    }
  } else {
    const E = results.experts.map((_, i) => `คนที่ ${i + 1}`);
    const head = ['ส่วน', 'ด้าน/องค์ประกอบ', 'ข้อ', 'รายการประเมิน'];
    if (inst.useIoc) head.push(...E.map((e) => `IOC ${e}`), 'ΣR', 'IOC', 'ผล IOC');
    if (inst.useRating) head.push(...E.map((e) => `${inst.ratingLabel} ${e}`), 'n', 'x̄', 'S.D.', 'ระดับ', 'ผล');
    rows.push(head);
    const pass = (p) => (p === null || p === undefined ? '' : p ? 'ผ่าน' : 'ไม่ผ่าน');
    const summaryRow = (secT, grpT, label, r, ioc) => {
      const row = [secT, grpT, '', label];
      if (inst.useIoc) row.push(...E.map(() => ''), '', ioc ? f2(ioc.meanIoc) : '', ioc ? `ผ่าน ${ioc.passed}/${ioc.total} ข้อ` : '');
      if (inst.useRating) row.push(...E.map(() => ''), r?.n ?? '', f2(r?.mean), f2(r?.sd), r?.level ?? '', pass(r?.pass));
      return row;
    };
    for (const s of results.sections) {
      for (const g of s.groups) {
        for (const it of g.items) {
          const row = [s.title, g.title, it.no, it.text];
          if (inst.useIoc) row.push(...it.perExpert.map((p) => p.ioc ?? ''), it.ioc.sumR, f2(it.ioc.value), pass(it.ioc.pass));
          if (inst.useRating) row.push(...it.perExpert.map((p) => p.rating ?? ''), it.rating.n, f2(it.rating.mean), f2(it.rating.sd), it.rating.level ?? '', pass(it.rating.pass));
          rows.push(row);
        }
        rows.push(summaryRow(s.title, g.title, `รวม ${g.title}`, g.rating, g.ioc));
      }
      if (results.sections.length > 1) rows.push(summaryRow(s.title, '', `รวม ${s.title}`, s.rating, s.ioc));
    }
    rows.push(summaryRow('', '', 'ภาพรวมทั้งฉบับ', results.overall.rating, results.overall.ioc));
    rows.push([]);
    const st = results.settings;
    rows.push([`จำนวนผู้ประเมิน n = ${results.n}`]);
    if (inst.useIoc) rows.push([`IOC = ΣR / N ; เกณฑ์ IOC ≥ ${st.iocCriterion.toFixed(2)}`]);
    if (inst.useRating)
      rows.push([
        `S.D. แบบกลุ่มตัวอย่าง (n−1) ; เกณฑ์ x̄ ≥ ${st.ratingCriterion.toFixed(2)}${st.sdMax != null ? ` และ S.D. ≤ ${Number(st.sdMax).toFixed(2)}` : ''} ; ค่ารวมรายด้านคำนวณแบบ ${st.aggMethod === 'pooled' ? 'รวมคะแนนดิบทุกค่า' : 'ค่าเฉลี่ยรายบุคคล'}`,
      ]);
  }
  const name = `${inst.code || 'inst' + inst.id}_${type}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(csv(rows));
});

A.get('/audit', (req, res) =>
  res.json(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(Math.min(Number(req.query.limit) || 300, 2000)))
);
A.get('/backup.json', (req, res) => {
  const tables = ['settings', 'instruments', 'sections', 'item_groups', 'items', 'experts', 'assignments', 'answers', 'section_comments', 'audit'];
  const out = {};
  for (const t of tables) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  out.settings = out.settings.filter((r) => !['sessionSecret', 'adminPasswordHash'].includes(r.key));
  res.setHeader('Content-Disposition', `attachment; filename="backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(out);
});

app.use('/api/admin', A);

// ======================= EXPERT API =======================
function expertPayload(a, adminView) {
  const inst = store.getInstrument(a.instrument_id);
  const e = db.prepare('SELECT * FROM experts WHERE id=?').get(a.expert_id);
  const s = store.getSettings();
  const profile = a.profile ? JSON.parse(a.profile) : { name: e.name, position: e.position, workplace: e.workplace, experience: e.experience };
  return {
    instrument: inst,
    meta: {
      thesisTitle: s.thesisTitle, researcher: s.researcher, advisor: s.advisor, coAdvisor: s.coAdvisor,
      contact: s.contact, thanks: s.thanks, experienceOptions: s.experienceOptions,
    },
    status: a.status,
    profile,
    response: store.loadResponse(a),
    signature: a.status === 'submitted'
      ? { name: a.signer_name, image: a.signature, signedAt: a.signed_at, hash: a.hash, editedAfterSign: !!a.edited_after_sign }
      : null,
    adminView: !!adminView,
    assignmentId: adminView ? a.id : undefined,
  };
}
/** ผู้เรียกเป็นเจ้าของลิงก์ (เข้าสู่ระบบเป็นผู้เชี่ยวชาญคนนั้น) หรือเป็นผู้ดูแล */
function canUse(req, a) {
  if (isAdmin(req)) return true;
  const e = expertSession(req);
  return !!e && e.id === a.expert_id;
}
function tokenAssignment(req, { auth = true } = {}) {
  const a = store.getAssignmentByToken(String(req.params.token));
  if (!a) throw httpError(404, 'ลิงก์ไม่ถูกต้องหรือถูกยกเลิกแล้ว');
  const inst = db.prepare('SELECT active FROM instruments WHERE id=?').get(a.instrument_id);
  if (!inst?.active && !isAdmin(req) && a.status !== 'submitted') throw httpError(403, 'แบบประเมินนี้ปิดรับการประเมินแล้ว');
  if (auth && !canUse(req, a)) throw httpError(401, 'กรุณาเข้าสู่ระบบด้วยอีเมลหรือเบอร์โทรศัพท์และรหัสผ่านก่อน');
  return a;
}
app.get('/api/e/:token', (req, res) => {
  const a = tokenAssignment(req, { auth: false });
  if (!canUse(req, a)) {
    // ยังไม่ได้เข้าสู่ระบบ: ส่งเฉพาะข้อมูลสำหรับหน้าตั้งค่าบัญชี/เข้าสู่ระบบ (ไม่มีคำตอบ)
    const e = db.prepare('SELECT name, email, phone, password_hash FROM experts WHERE id=?').get(a.expert_id);
    const inst = db.prepare('SELECT title, subtitle FROM instruments WHERE id=?').get(a.instrument_id);
    return res.json({
      gate: true,
      account: { hasPassword: !!e.password_hash, name: e.name, email: e.email || '', phone: e.phone || '' },
      instrument: inst,
      meta: { thesisTitle: store.getSettings().thesisTitle || '' },
    });
  }
  const admin = isAdmin(req) && req.query.admin === '1';
  if (!admin && !a.opened_at) db.prepare("UPDATE assignments SET opened_at=CURRENT_TIMESTAMP WHERE id=?").run(a.id);
  res.json(expertPayload(a, admin));
});
/** ผู้เชี่ยวชาญตั้งค่าบัญชีครั้งแรกจากลิงก์เฉพาะบุคคล: อีเมล + เบอร์โทร + รหัสผ่าน */
/**
 * ตั้งค่าบัญชีผู้เชี่ยวชาญ (อีเมล + เบอร์โทร + รหัสผ่าน) — ใช้ทั้งจากลิงก์เฉพาะบุคคลและจากหน้าแรก
 * ตั้งได้ครั้งเดียว (บัญชีที่มีรหัสแล้วต้องให้ผู้ดูแลรีเซ็ต)
 */
function setupAccount(e, b) {
  if (e.password_hash) throw httpError(409, 'ท่านมีบัญชีแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่าน (หากลืมรหัส กรุณาติดต่อผู้วิจัย)');
  const email = String(b.email || '').trim();
  const phone = String(b.phone || '').replace(/[\s-]/g, '');
  const pw = String(b.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError(400, 'กรุณากรอกอีเมลให้ถูกต้อง');
  if (!/^\d{10}$/.test(phone)) throw httpError(400, 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก');
  if (pw.length < 8) throw httpError(400, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  if (pw !== String(b.confirm || '')) throw httpError(400, 'ยืนยันรหัสผ่านไม่ตรงกัน');
  if (!b.consent) throw httpError(400, 'กรุณาทำเครื่องหมายยินยอมการเก็บข้อมูล');
  const clash = db
    .prepare('SELECT id FROM experts WHERE id<>? AND password_hash IS NOT NULL AND (lower(trim(email))=? OR phone=?)')
    .get(e.id, email.toLowerCase(), phone);
  if (clash) throw httpError(409, 'อีเมลหรือเบอร์โทรศัพท์นี้ถูกใช้กับบัญชีอื่นแล้ว กรุณาติดต่อผู้วิจัย');
  const h = hashPassword(pw);
  // รหัสที่ผู้เชี่ยวชาญตั้งเองเป็นความลับของผู้เชี่ยวชาญ (ผู้ดูแลรีเซ็ตได้ แต่ดูไม่ได้)
  db.prepare('UPDATE experts SET email=?, phone=?, password_hash=?, password_enc=NULL WHERE id=?').run(email, phone, h, e.id);
  return { email, phone, hash: h };
}
app.post('/api/e/:token/account', (req, res) => {
  const t = throttle(req, res);
  if (!t) return;
  const a = tokenAssignment(req, { auth: false });
  const e = db.prepare('SELECT * FROM experts WHERE id=?').get(a.expert_id);
  const r = setupAccount(e, req.body || {});
  db.prepare('UPDATE experts SET last_login=CURRENT_TIMESTAMP WHERE id=?').run(e.id);
  t.ok();
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `exs=${encodeURIComponent(makeExpertSession(e.id, r.hash))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`);
  store.audit('expert', 'expert.account.setup', { id: e.id, name: e.name, email: r.email, via: 'link', ip: req.ip });
  res.json({ ok: true });
});

// ---------- ลงทะเบียนจากหน้าแรก: เลือกชื่อ → กรอกอีเมล เบอร์โทร รหัสผ่าน → บันทึก → เข้าสู่ระบบอีกครั้ง ----------
/** รายชื่อผู้เชี่ยวชาญที่ยังไม่มีบัญชี (ชื่อที่ลงทะเบียนแล้วจะไม่แสดง) */
app.get('/api/public/experts', (req, res) => {
  res.json(db.prepare('SELECT id, name FROM experts WHERE password_hash IS NULL ORDER BY name').all());
});
app.post('/api/public/register', (req, res) => {
  const t = throttle(req, res);
  if (!t) return;
  const b = req.body || {};
  const e = db.prepare('SELECT * FROM experts WHERE id=?').get(Number(b.expertId));
  if (!e) {
    t.fail();
    throw httpError(400, 'กรุณาเลือกชื่อของท่านจากรายการ');
  }
  const r = setupAccount(e, b);
  t.ok();
  store.audit('expert', 'expert.account.setup', { id: e.id, name: e.name, email: r.email, via: 'register', ip: req.ip });
  res.json({ ok: true, login: r.email });
});
/** ดาวน์โหลดแบบประเมินที่กรอกแล้วเป็น Word / Excel (ผู้เชี่ยวชาญและผู้ดูแล) */
app.get('/api/e/:token/form.:fmt(docx|xlsx)', async (req, res, next) => {
  try {
    const a = tokenAssignment(req);
    const p = expertPayload(a, false);
    const args = { inst: p.instrument, meta: p.meta, profile: p.profile, response: p.response, signature: p.signature, status: p.status, uploadDir: store.UPLOAD_DIR };
    const fmt = req.params.fmt;
    const buf = fmt === 'docx' ? await exporter.formDocx(args) : await exporter.formXlsx(args);
    sendFile(res, buf, `ชุดที่ ${p.instrument.code || p.instrument.id} ${p.profile.name || 'ผู้ประเมิน'}`, fmt);
  } catch (e) {
    next(e);
  }
});
app.put('/api/e/:token/draft', (req, res) => {
  const a = tokenAssignment(req);
  if (a.status === 'submitted') throw httpError(409, 'ท่านลงนามส่งแบบประเมินแล้ว หากต้องการแก้ไขกรุณาติดต่อผู้วิจัย');
  const inst = store.getInstrument(a.instrument_id);
  store.tx(() => {
    store.writeResponse(a, inst, req.body || {});
    db.prepare("UPDATE assignments SET status='draft' WHERE id=?").run(a.id);
  });
  res.json({ ok: true, savedAt: new Date().toISOString() });
});
app.post('/api/e/:token/submit', (req, res) => {
  const a = tokenAssignment(req);
  if (a.status === 'submitted') throw httpError(409, 'ท่านลงนามส่งแบบประเมินแล้ว');
  const b = req.body || {};
  const inst = store.getInstrument(a.instrument_id);
  const signerName = String(b.signerName || '').trim();
  const sig = String(b.signature || '');
  if (!b.consent) throw httpError(400, 'กรุณายืนยันการลงนามอิเล็กทรอนิกส์');
  if (!signerName) throw httpError(400, 'กรุณาพิมพ์ชื่อ-นามสกุลผู้ลงนาม');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length > 700_000) throw httpError(400, 'กรุณาลงลายมือชื่อในช่องลงนาม');
  if (!String(b.profile?.name || '').trim()) throw httpError(400, 'กรุณากรอกชื่อผู้ประเมินในตอนที่ 1');

  // บันทึกคำตอบเป็นร่างก่อน เพื่อไม่ให้ข้อมูลหายหากตรวจแล้วยังไม่ครบ
  store.tx(() => {
    store.writeResponse(a, inst, b);
    db.prepare("UPDATE assignments SET status='draft' WHERE id=?").run(a.id);
  });
  store.tx(() => {
    const fresh = store.getAssignment(a.id);
    const resp = store.loadResponse(fresh);
    const missing = store.missingAnswers(inst, resp.answers);
    if (missing.length) {
      const e = httpError(400, `ยังประเมินไม่ครบ ${missing.length} ข้อ: ${missing.slice(0, 6).map((m) => m.label).join(', ')}${missing.length > 6 ? ' …' : ''}`);
      e.missing = missing.map((m) => m.itemId);
      throw e;
    }
    const signedAt = new Date().toISOString();
    db.prepare(
      `UPDATE assignments SET status='submitted', submitted_at=?, signer_name=?, signature=?, signed_at=?, sign_ip=?, sign_ua=?, edited_after_sign=0 WHERE id=?`
    ).run(signedAt, signerName.slice(0, 200), sig, signedAt, req.ip, String(req.headers['user-agent'] || '').slice(0, 300), a.id);
    const signed = store.getAssignment(a.id);
    const hash = store.computeHash(signed, inst, store.loadResponse(signed));
    db.prepare('UPDATE assignments SET hash=? WHERE id=?').run(hash, a.id);
    store.audit('expert', 'submit', { assignmentId: a.id, signer: signerName, ip: req.ip, hash });
  });
  res.json(expertPayload(store.getAssignment(a.id), false));
});

// ---------- errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'ไม่พบ API' }));
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'เกิดข้อผิดพลาดภายในระบบ' : err.message, needForce: err.needForce, missing: err.missing });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ระบบประเมินเครื่องมือวิจัย พร้อมใช้งานที่ http://localhost:${PORT}/admin`);
  });
}
module.exports = app;
