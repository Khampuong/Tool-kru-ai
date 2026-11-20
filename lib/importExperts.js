'use strict';
/**
 * นำเข้ารายชื่อผู้เชี่ยวชาญจากไฟล์ Excel (.xlsx) หรือ CSV
 * - หาแถวหัวตารางอัตโนมัติ (ชื่อ, ตำแหน่ง, สังกัด/สถานที่ทำงาน, ความเชี่ยวชาญ, ติดต่อ, อีเมล, โทรศัพท์ ...)
 * - แปลงรหัสความเชี่ยวชาญ (เช่น D1, D3) ตามตารางคำอธิบายรหัสท้ายแผ่นงาน
 * - แยกช่อง “ช่องทางการติดต่อ” เป็นอีเมล / เบอร์โทร 10 หลัก / ลิงก์อื่น ๆ (เก็บในหมายเหตุ)
 */
const ExcelJS = require('exceljs');

const FIELDS = [
  ['name', /ชื่อ|^name$/i],
  ['position', /ตำแหน่ง|position/i],
  ['workplace', /สังกัด|สถานที่ทำงาน|หน่วยงาน|workplace|organi[sz]ation/i],
  ['experience', /ประสบการณ์|experience/i],
  ['expertise', /เชี่ยวชาญ|expertise/i],
  ['email', /อีเมล|e-?mail/i],
  ['phone', /โทร|phone|mobile/i],
  ['contact', /ติดต่อ|contact/i],
  ['note', /หมายเหตุ|note/i],
];

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return cellText(v.text);
    if (v.hyperlink) return v.hyperlink;
    if (v.result !== undefined) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v);
}
const clean = (s) => cellText(s).replace(/\s+/g, ' ').trim();

/** แปลงไฟล์เป็นตาราง (array ของแถว) */
async function readTable(buf, filename) {
  if (/\.csv$/i.test(filename || '') || !(buf[0] === 0x50 && buf[1] === 0x4b)) {
    const text = buf.toString('utf8').replace(/^﻿/, '');
    return parseCsv(text);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  // เลือกแผ่นงานแรกที่มีหัวตาราง “ชื่อ”
  for (const ws of wb.worksheets) {
    // ws.columnCount คำนวณใหม่ทุกครั้งที่เรียก (ไล่ทุกแถว) จึงเก็บค่าไว้ครั้งเดียว
    const nCols = Math.min(ws.columnCount, 60);
    const nRows = Math.min(ws.rowCount, 5000);
    const rows = [];
    for (let r = 1; r <= nRows; r++) {
      const row = ws.getRow(r);
      const vals = [];
      for (let c = 1; c <= nCols; c++) vals.push(cellText(row.getCell(c).value));
      rows.push(vals);
    }
    if (findHeader(rows) >= 0) return rows;
  }
  return [];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function mapHeader(cells) {
  const map = {};
  cells.forEach((h, i) => {
    const t = clean(h);
    if (!t) return;
    for (const [f, re] of FIELDS) {
      if (map[f] !== undefined) continue;
      // “ชื่อผู้เชี่ยวชาญ” = ชื่อ ไม่ใช่ความเชี่ยวชาญ
      if (f === 'expertise' && /ชื่อ/.test(t)) continue;
      if (f === 'name' && /หัวข้อ|เรื่อง/.test(t)) continue;
      if (re.test(t)) { map[f] = i; break; }
    }
  });
  return map;
}
function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const m = mapHeader(rows[r]);
    if (m.name !== undefined && Object.keys(m).length >= 2) return r;
  }
  return -1;
}

/** ตารางคำอธิบายรหัส เช่น  D1 | vocational-management | การจัดการวิทยาลัยอาชีวศึกษา */
function codeLegend(rows) {
  const legend = {};
  for (const r of rows) {
    const code = clean(r[0]);
    if (!/^[A-Z]{1,3}\d{1,2}$/.test(code)) continue;
    const thai = r.slice(1).map(clean).filter(Boolean).find((x) => /[฀-๿]/.test(x));
    const any = r.slice(1).map(clean).filter(Boolean).pop();
    if (thai || any) legend[code] = thai || any;
  }
  return legend;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** แยกอีเมล เบอร์โทร และลิงก์อื่น ๆ ออกจากข้อความติดต่อ */
function splitContact(text) {
  const out = { emails: [], phones: [], rest: '' };
  let t = String(text || '');
  // ดึงลิงก์ออกก่อน เพื่อไม่ให้ขั้นตอนทำความสะอาดข้อความทำลาย URL
  const urlRe = /(?:https?:\/\/|www\.)[^\s,|]+/gi;
  const urls = [...new Set(t.match(urlRe) || [])];
  t = t.replace(urlRe, ' ');
  out.emails = [...new Set(t.match(EMAIL_RE) || [])];
  t = t.replace(EMAIL_RE, ' ');
  const phoneRe = /(?:\+?66[\s-]?|0)\d(?:[\s-]?\d){7,8}/g;
  for (const m of t.match(phoneRe) || []) {
    let d = m.replace(/\D/g, '');
    if (d.startsWith('66')) d = '0' + d.slice(2);
    out.phones.push(d);
  }
  t = t.replace(phoneRe, ' ');
  const leftover = t
    .replace(/(?:phone|tel|mobile|e-?mail|อีเมล|โทร(?:ศัพท์)?)\s*[:：]?/gi, ' ')
    .replace(/[|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.]+|[\s,;:.]+$/g, '')
    .trim();
  out.rest = [...urls, leftover].filter(Boolean).join(' ');
  return out;
}

const normName = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

/**
 * @returns {rows:[{line,name,position,workplace,experience,expertise,email,phone,note,status,warnings[]}], header, legend}
 */
async function parseExperts(buf, filename, existingNames = []) {
  const table = await readTable(buf, filename);
  const h = findHeader(table);
  if (h < 0) throw Object.assign(new Error('ไม่พบหัวตารางในไฟล์ (ต้องมีคอลัมน์ “ชื่อ” และคอลัมน์อื่นอย่างน้อย 1 คอลัมน์)'), { status: 400 });
  const map = mapHeader(table[h]);
  const legend = codeLegend(table);
  const seen = new Set(existingNames.map(normName));
  const inFile = new Set();
  const rows = [];
  for (let r = h + 1; r < table.length; r++) {
    const cells = table[r];
    const get = (f) => (map[f] === undefined ? '' : clean(cells[map[f]]));
    const name = get('name');
    if (!name) {
      // หยุดเมื่อเจอแถวว่างหลังเริ่มข้อมูลแล้ว (ส่วนถัดไปมักเป็นคำอธิบายรหัส)
      if (rows.length && cells.every((c) => !clean(c))) break;
      continue;
    }
    if (/^[A-Z]{1,3}\d{1,2}$/.test(clean(cells[0])) && rows.length) break; // ถึงตารางคำอธิบายรหัส
    const warnings = [];
    // ความเชี่ยวชาญ: แปลงรหัส
    let expertise = get('expertise');
    const codes = expertise.split(/[,،;\s]+/).filter(Boolean);
    if (codes.length && codes.every((c) => legend[c])) expertise = codes.map((c) => legend[c]).join(', ');
    // ติดต่อ
    // Excel มักตัดเลข 0 นำหน้าเมื่อเก็บเบอร์เป็นตัวเลข (0812345678 → 812345678)
    let phoneCol = get('phone');
    const pd = phoneCol.replace(/\D/g, '');
    if (/^[1-9]\d{8}$/.test(pd) && pd === phoneCol.replace(/\.0+$/, '')) phoneCol = '0' + pd;
    const contact = splitContact([get('contact'), get('email'), phoneCol].join(' '));
    const email = contact.emails[0] || '';
    let phone = '';
    const notes = [];
    if (get('note')) notes.push(get('note'));
    const ph10 = contact.phones.find((p) => /^\d{10}$/.test(p));
    if (ph10) phone = ph10;
    const otherPhones = contact.phones.filter((p) => p !== phone);
    if (otherPhones.length) {
      notes.push('โทร ' + otherPhones.join(', '));
      if (!phone) warnings.push('เบอร์โทรไม่ใช่ 10 หลัก เก็บไว้ในหมายเหตุ');
    }
    if (contact.emails.length > 1) notes.push('อีเมลอื่น ' + contact.emails.slice(1).join(', '));
    if (contact.rest) notes.push('ช่องทางติดต่อ: ' + contact.rest);
    if (!email) warnings.push('ไม่มีอีเมล (ต้องเพิ่มก่อนตั้งรหัสเข้าระบบ)');

    const key = normName(name);
    let status = 'new';
    if (seen.has(key)) status = 'duplicate';
    else if (inFile.has(key)) status = 'duplicate-in-file';
    inFile.add(key);
    rows.push({
      line: r + 1,
      name,
      position: get('position'),
      workplace: get('workplace'),
      experience: get('experience'),
      expertise,
      email,
      phone,
      note: notes.join(' · '),
      status,
      warnings,
    });
  }
  return { rows, header: Object.fromEntries(Object.entries(map).map(([k, i]) => [k, clean(table[h][i])])), legend };
}

async function templateXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('รายชื่อผู้เชี่ยวชาญ');
  ws.columns = [
    { header: 'ลำดับ', width: 7 },
    { header: 'ชื่อผู้เชี่ยวชาญ', width: 32 },
    { header: 'ตำแหน่ง', width: 36 },
    { header: 'สังกัด', width: 32 },
    { header: 'ความเชี่ยวชาญ', width: 26 },
    { header: 'ประสบการณ์การทำงาน', width: 18 },
    { header: 'อีเมล', width: 28 },
    { header: 'โทรศัพท์ (10 หลัก)', width: 18 },
    { header: 'หมายเหตุ', width: 30 },
  ];
  ws.getRow(1).font = { bold: true, name: 'TH Sarabun New', size: 14 };
  ws.addRow([1, 'รองศาสตราจารย์ ดร.ตัวอย่าง ใจดี', 'อาจารย์ประจำสาขาวิชา...', 'มหาวิทยาลัย...', 'การบริหารการศึกษา', 'มากกว่า 15 ปี', 'example@university.ac.th', '0812345678', '']);
  ws.getColumn(8).numFmt = '@';
  return wb.xlsx.writeBuffer();
}

module.exports = { parseExperts, templateXlsx, splitContact };
