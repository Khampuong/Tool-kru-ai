'use strict';
/**
 * ส่งออกไฟล์ Word (.docx) และ Excel (.xlsx)
 *  - แบบประเมินรายบุคคลที่กรอกแล้ว (พร้อมลายมือชื่ออิเล็กทรอนิกส์)
 *  - ตารางสรุปผลการวิเคราะห์ (IOC, x̄, S.D., ระดับ) สำหรับใส่ในวิทยานิพนธ์
 * PDF ใช้การพิมพ์จากเบราว์เซอร์ (รองรับการตัดคำ/สระภาษาไทยถูกต้องที่สุด)
 */
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, AlignmentType, WidthType,
  VerticalAlign, ShadingType, PageOrientation, BorderStyle, TableLayoutType,
} = require('docx');
const { round2 } = require('./stats');

const FONT = 'TH Sarabun New';
const PT = 16; // ขนาดตัวอักษรมาตรฐานวิทยานิพนธ์
const IOC_OPTS = [1, 0, -1];
const RATE_OPTS = [5, 4, 3, 2, 1];
const CHECK = '✓';

const f2 = (x) => (x === null || x === undefined ? '-' : round2(x).toFixed(2));
const thDate = (iso, time = false) => {
  if (!iso) return '';
  const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z');
  const o = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Bangkok' };
  if (time) Object.assign(o, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('th-TH', o);
};

// ---------------- image helpers ----------------
function imageSize(buf) {
  if (buf.slice(1, 4).toString() === 'PNG') return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const m = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m))
        return { type: 'jpg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}
function fit(sz, maxW, maxH) {
  const s = Math.min(1, maxW / sz.w, maxH / sz.h);
  return { width: Math.round(sz.w * s), height: Math.round(sz.h * s) };
}
function dataUrlBuffer(u) {
  const m = /^data:image\/png;base64,(.+)$/.exec(u || '');
  return m ? Buffer.from(m[1], 'base64') : null;
}
function attachmentBuffer(inst, uploadDir) {
  if (!inst.attachment || !/\.(png|jpe?g)$/i.test(inst.attachment)) return null;
  const p = path.join(uploadDir, path.basename(inst.attachment));
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

// ---------------- docx helpers ----------------
const run = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT }, size: (o.size || PT) * 2, sizeComplexScript: (o.size || PT) * 2, bold: o.bold, boldComplexScript: o.bold, italics: o.italic, color: o.color });
const para = (text, o = {}) =>
  new Paragraph({
    alignment: o.align === 'center' ? AlignmentType.CENTER : o.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
    spacing: { before: o.before ?? 0, after: o.after ?? 0, line: 240 },
    indent: o.indent ? { left: o.indent } : undefined,
    keepNext: o.keepNext,
    keepLines: o.keepNext,
    children: Array.isArray(text) ? text : [run(text, o)],
  });
const border = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
const borders = { top: border, bottom: border, left: border, right: border };
function cell(text, o = {}) {
  return new TableCell({
    children: Array.isArray(text) ? text : [para(text, { align: o.align, bold: o.bold, size: o.size })],
    columnSpan: o.span,
    rowSpan: o.rowSpan,
    width: o.width ? { size: o.width, type: WidthType.DXA } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    borders,
    margins: { top: 30, bottom: 30, left: 80, right: 80 },
  });
}
/** ตารางความกว้างคงที่ (ป้องกัน Word ปรับคอลัมน์อัตโนมัติจนล้นหน้า) */
function fixedTable(rows, widths, o = {}) {
  return new Table({
    rows,
    columnWidths: widths,
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    ...o,
  });
}
const docStyles = {
  default: { document: { run: { font: FONT, size: PT * 2 } } },
};
function headerBlock(inst, meta) {
  const rows = [
    ['ชื่อหัวข้อวิทยานิพนธ์', meta.thesisTitle],
    ['ผู้วิจัย', meta.researcher],
    ['อาจารย์ที่ปรึกษาหลัก', meta.advisor],
    ['อาจารย์ที่ปรึกษาร่วม', meta.coAdvisor],
  ].filter((r) => r[1]);
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const nb = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
  return [
    para(inst.title, { align: 'center', bold: true, size: 18 }),
    para(inst.subtitle, { align: 'center', after: 160 }),
    fixedTable(
      rows.map(
        ([k, v]) =>
          new TableRow({
            children: [
              new TableCell({ borders: nb, width: { size: 2500, type: WidthType.DXA }, children: [para(k, { bold: true })] }),
              new TableCell({ borders: nb, width: { size: 7100, type: WidthType.DXA }, children: [para(v)] }),
            ],
          })
      ),
      [2500, 7100]
    ),
  ];
}

// =====================================================================
// แบบประเมินรายบุคคล
// =====================================================================
async function formDocx({ inst, meta, profile, response, signature, status, uploadDir }) {
  const ch = [];
  ch.push(...headerBlock(inst, meta));
  if (status !== 'submitted') ch.push(para('(ฉบับร่าง — ยังไม่ได้ลงนาม)', { align: 'center', color: 'B42318', bold: true, before: 120 }));
  const att = attachmentBuffer(inst, uploadDir);
  if (att) {
    const sz = imageSize(att);
    if (sz) ch.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 120 }, children: [new ImageRun({ type: sz.type, data: att, transformation: fit(sz, 600, 700) })] }));
  }
  ch.push(para('ตอนที่ 1 ข้อมูลผู้ประเมิน', { bold: true, before: 200, size: 17 }));
  ch.push(para(`ชื่อผู้ประเมิน  ${profile.name || '-'}`, { indent: 400 }));
  ch.push(para(`ตำแหน่ง  ${profile.position || '-'}`, { indent: 400 }));
  ch.push(para(`สถานที่ทำงาน  ${profile.workplace || '-'}`, { indent: 400 }));
  const exps = (meta.experienceOptions || []).map((o) => `${o === profile.experience ? '☑' : '☐'} ${o}`).join('   ');
  ch.push(para(`ประสบการณ์การทำงาน   ${exps}`, { indent: 400 }));

  ch.push(para('ตอนที่ 2 การประเมิน', { bold: true, before: 200, size: 17 }));
  if (inst.instructions) ch.push(para(inst.instructions));
  if (inst.useIoc) ch.push(para('เกณฑ์การประเมินความสอดคล้อง (IOC):  +1 = สอดคล้อง   0 = ไม่แน่ใจ   −1 = ไม่สอดคล้อง', { size: 14 }));
  if (inst.useRating)
    ch.push(para(`เกณฑ์การประเมิน${inst.ratingLabel}:  ` + RATE_OPTS.map((v, i) => `${v} = ${inst.ratingLabels[i] || ''}`).join('   '), { size: 14 }));

  const nOpt = (inst.useIoc ? 3 : 0) + (inst.useRating ? 5 : 0);
  const optW = 520;
  const noW = 560;
  const textW = 9600 - noW - nOpt * optW;
  for (const sec of inst.sections) {
    if (sec.title) ch.push(para(sec.title, { bold: true, before: 160 }));
    const head1 = [cell('ข้อ', { bold: true, align: 'center', rowSpan: 2, width: noW, fill: 'E8EDF5' }), cell('รายการประเมิน', { bold: true, align: 'center', rowSpan: 2, width: textW, fill: 'E8EDF5' })];
    if (inst.useIoc) head1.push(cell('ความสอดคล้อง', { bold: true, align: 'center', span: 3, fill: 'E8EDF5' }));
    if (inst.useRating) head1.push(cell(inst.ratingLabel, { bold: true, align: 'center', span: 5, fill: 'E8EDF5' }));
    const head2 = [];
    if (inst.useIoc) head2.push(...['+1', '0', '−1'].map((t) => cell(t, { bold: true, align: 'center', width: optW, fill: 'E8EDF5' })));
    if (inst.useRating) head2.push(...RATE_OPTS.map((t) => cell(String(t), { bold: true, align: 'center', width: optW, fill: 'E8EDF5' })));
    const rows = [new TableRow({ tableHeader: true, children: head1 }), new TableRow({ tableHeader: true, children: head2 })];
    let no = 0;
    for (const g of sec.groups) {
      if (g.title || g.description)
        rows.push(new TableRow({ cantSplit: true, children: [cell([para([run(g.title, { bold: true }), ...(g.description ? [run(': ' + g.description, { size: 14 })] : [])])], { span: 2 + nOpt, fill: 'F2F5FA' })] }));
      for (const it of g.items) {
        no++;
        const a = response.answers[it.id] || {};
        const cells = [cell(String(no), { align: 'center', width: noW }), cell(it.text, { width: textW })];
        if (inst.useIoc) cells.push(...IOC_OPTS.map((v) => cell(a.ioc === v ? CHECK : '', { align: 'center', width: optW, bold: true })));
        if (inst.useRating) cells.push(...RATE_OPTS.map((v) => cell(a.rating === v ? CHECK : '', { align: 'center', width: optW, bold: true })));
        rows.push(new TableRow({ cantSplit: true, children: cells }));
        if (a.comment)
          rows.push(new TableRow({ cantSplit: true, children: [cell('', { width: noW }), cell([para([run('ความคิดเห็น: ', { bold: true, size: 14 }), run(a.comment, { size: 14 })])], { span: 1 + nOpt, fill: 'FFFCEB' })] }));
      }
    }
    ch.push(fixedTable(rows, [noW, textW, ...Array(nOpt).fill(optW)]));
    const sc = response.sectionComments[sec.id];
    ch.push(para([run(`ข้อเสนอแนะ${sec.title ? 'ส่วนนี้' : 'เพิ่มเติม'}  `, { bold: true }), run(sc || '-')], { before: 80, after: 80 }));
  }
  ch.push(para('ตอนที่ 3 ข้อเสนอแนะอื่น ๆ', { bold: true, before: 200, size: 17 }));
  for (const line of String(response.overallComment || '-').split('\n')) ch.push(para(line, { indent: 400 }));

  // ลายมือชื่อ
  ch.push(para('', { before: 300, keepNext: true }));
  const sigBuf = signature ? dataUrlBuffer(signature.image) : null;
  if (sigBuf) {
    const sz = imageSize(sigBuf);
    ch.push(new Paragraph({ alignment: AlignmentType.RIGHT, indent: { right: 1200 }, keepNext: true, children: [new ImageRun({ type: 'png', data: sigBuf, transformation: fit(sz, 200, 80) })] }));
  }
  ch.push(para('ลงชื่อ ................................................ ผู้ประเมิน', { align: 'right', keepNext: true }));
  ch.push(para(`( ${signature?.name || '................................................'} )`, { align: 'right', keepNext: true }));
  ch.push(para(`วันที่ ${signature ? thDate(signature.signedAt) : '......../......................../............'}`, { align: 'right', keepNext: !!signature }));
  if (signature) {
    ch.push(para(`ลงนามอิเล็กทรอนิกส์ ${thDate(signature.signedAt, true)} น.`, { align: 'right', size: 12, color: '5F6B7D' }));
    ch.push(para(`รหัสตรวจสอบเอกสาร (SHA-256): ${signature.hash}`, { size: 10, color: '5F6B7D', before: 200 }));
  }
  if (meta.thanks) ch.push(para(meta.thanks, { align: 'center', before: 300, size: 14 }));

  const doc = new Document({
    creator: 'ระบบประเมินเครื่องมือวิจัย',
    title: inst.title,
    styles: docStyles,
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1300, right: 1000 } } }, children: ch }],
  });
  return Packer.toBuffer(doc);
}

const thin = { style: 'thin', color: { argb: 'FF808080' } };
const allThin = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

async function formXlsx({ inst, meta, profile, response, signature, status }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ระบบประเมินเครื่องมือวิจัย';
  const ws = wb.addWorksheet('แบบประเมิน', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const nOpt = (inst.useIoc ? 3 : 0) + (inst.useRating ? 5 : 0);
  const lastCol = 2 + nOpt + 1; // + ความคิดเห็น
  ws.columns = [{ width: 6 }, { width: 62 }, ...Array(nOpt).fill({ width: 5.5 }), { width: 40 }];
  ws.properties.defaultRowHeight = 20;
  const font = { name: FONT, size: 14 };
  const add = (vals, o = {}) => {
    const r = ws.addRow(vals);
    r.font = { ...font, ...(o.font || {}) };
    r.alignment = { vertical: 'middle', wrapText: true, ...(o.align || {}) };
    if (o.merge) ws.mergeCells(r.number, o.merge[0], r.number, o.merge[1]);
    return r;
  };
  add([inst.title], { font: { bold: true, size: 16 }, align: { horizontal: 'center' }, merge: [1, lastCol] });
  add([inst.subtitle], { align: { horizontal: 'center' }, merge: [1, lastCol] }).height = 36;
  for (const [k, v] of [['ชื่อหัวข้อวิทยานิพนธ์', meta.thesisTitle], ['ผู้วิจัย', meta.researcher], ['อาจารย์ที่ปรึกษาหลัก', meta.advisor], ['อาจารย์ที่ปรึกษาร่วม', meta.coAdvisor]])
    if (v) {
      const r = add([`${k}: ${v}`], { merge: [1, lastCol] });
      r.height = v.length > 90 ? 40 : 22;
    }
  if (status !== 'submitted') add(['(ฉบับร่าง — ยังไม่ได้ลงนาม)'], { font: { bold: true, color: { argb: 'FFB42318' } }, merge: [1, lastCol] });
  add([]);
  add(['ตอนที่ 1 ข้อมูลผู้ประเมิน'], { font: { bold: true }, merge: [1, lastCol] });
  for (const [k, v] of [['ชื่อผู้ประเมิน', profile.name], ['ตำแหน่ง', profile.position], ['สถานที่ทำงาน', profile.workplace], ['ประสบการณ์การทำงาน', profile.experience]])
    add(['', `${k}: ${v || '-'}`], { merge: [2, lastCol] });
  add([]);
  add(['ตอนที่ 2 การประเมิน'], { font: { bold: true }, merge: [1, lastCol] });
  if (inst.useIoc) add(['', 'เกณฑ์ IOC: +1 = สอดคล้อง  0 = ไม่แน่ใจ  −1 = ไม่สอดคล้อง'], { merge: [2, lastCol] });
  if (inst.useRating) add(['', `เกณฑ์${inst.ratingLabel}: ` + RATE_OPTS.map((v, i) => `${v} = ${inst.ratingLabels[i]}`).join('  ')], { merge: [2, lastCol] });

  for (const sec of inst.sections) {
    if (sec.title) add([sec.title], { font: { bold: true }, merge: [1, lastCol] });
    const h = ['ข้อ', 'รายการประเมิน'];
    if (inst.useIoc) h.push('+1', '0', '−1');
    if (inst.useRating) h.push(...RATE_OPTS);
    h.push('ความคิดเห็นรายข้อ');
    const hr = add(h, { font: { bold: true }, align: { horizontal: 'center' } });
    hr.eachCell((c) => { c.border = allThin; c.fill = fill('FFE8EDF5'); });
    let no = 0;
    for (const g of sec.groups) {
      if (g.title || g.description) {
        const r = add([g.title + (g.description ? ': ' + g.description : '')], { font: { bold: true }, merge: [1, lastCol] });
        r.getCell(1).fill = fill('FFF2F5FA');
        r.getCell(1).border = allThin;
        r.height = g.description ? 36 : 22;
      }
      for (const it of g.items) {
        no++;
        const a = response.answers[it.id] || {};
        const vals = [no, it.text];
        if (inst.useIoc) vals.push(...IOC_OPTS.map((v) => (a.ioc === v ? CHECK : '')));
        if (inst.useRating) vals.push(...RATE_OPTS.map((v) => (a.rating === v ? CHECK : '')));
        vals.push(a.comment || '');
        const r = add(vals);
        r.eachCell({ includeEmpty: true }, (c, col) => {
          c.border = allThin;
          if (col !== 2 && col !== lastCol) c.alignment = { horizontal: 'center', vertical: 'middle' };
        });
        r.height = Math.max(22, Math.ceil(it.text.length / 55) * 20, Math.ceil((a.comment || '').length / 35) * 20);
      }
    }
    add(['', `ข้อเสนอแนะ${sec.title ? 'ส่วนนี้' : 'เพิ่มเติม'}: ${response.sectionComments[sec.id] || '-'}`], { merge: [2, lastCol] }).height = 30;
  }
  add([]);
  add(['ตอนที่ 3 ข้อเสนอแนะอื่น ๆ'], { font: { bold: true }, merge: [1, lastCol] });
  add(['', response.overallComment || '-'], { merge: [2, lastCol] }).height = 40;
  add([]);
  const sigRow = ws.rowCount + 1;
  const sigBuf = signature ? dataUrlBuffer(signature.image) : null;
  if (sigBuf) {
    add([]).height = 60;
    const sz = fit(imageSize(sigBuf), 180, 70);
    const id = wb.addImage({ buffer: sigBuf, extension: 'png' });
    ws.addImage(id, { tl: { col: 1.6, row: sigRow - 1 }, ext: sz });
  }
  add(['', 'ลงชื่อ ................................................ ผู้ประเมิน'], { align: { horizontal: 'right' }, merge: [2, lastCol] });
  add(['', `( ${signature?.name || '................................................'} )`], { align: { horizontal: 'right' }, merge: [2, lastCol] });
  add(['', `วันที่ ${signature ? thDate(signature.signedAt) : '......../......................../............'}`], { align: { horizontal: 'right' }, merge: [2, lastCol] });
  if (signature) {
    add(['', `ลงนามอิเล็กทรอนิกส์ ${thDate(signature.signedAt, true)} น.`], { font: { size: 11, color: { argb: 'FF5F6B7D' } }, align: { horizontal: 'right' }, merge: [2, lastCol] });
    add(['', `SHA-256: ${signature.hash}`], { font: { size: 10, color: { argb: 'FF5F6B7D' } }, merge: [2, lastCol] });
  }
  return wb.xlsx.writeBuffer();
}

// =====================================================================
// ผลการวิเคราะห์
// =====================================================================
function passText(p) {
  return p === null || p === undefined ? '-' : p ? 'ผ่าน' : 'ไม่ผ่าน';
}
function criteriaLines(inst, st, n) {
  const out = [`จำนวนผู้ประเมิน n = ${n}`];
  if (inst.useIoc) out.push(`IOC = ΣR / N  (R = คะแนนของผู้เชี่ยวชาญ +1, 0, −1; N = จำนวนผู้เชี่ยวชาญ) เกณฑ์ IOC ≥ ${st.iocCriterion.toFixed(2)}`);
  if (inst.useRating) {
    out.push('x̄ = Σx / n ; S.D. = √[Σ(x − x̄)² / (n − 1)]');
    out.push('แปลความหมาย: ' + st.levels.map((l, i) => `${l.toFixed(2)}–${i ? (st.levels[i - 1] - 0.01).toFixed(2) : '5.00'} = ${st.labels[i]}`).join(', '));
    out.push(`เกณฑ์ผ่าน: x̄ ≥ ${st.ratingCriterion.toFixed(2)}${st.sdMax != null ? ` และ S.D. ≤ ${Number(st.sdMax).toFixed(2)}` : ''}; ค่ารวมรายด้านคำนวณแบบ${st.aggMethod === 'pooled' ? 'รวมคะแนนดิบทุกค่า' : 'ค่าเฉลี่ยรายบุคคล'}`);
  }
  return out;
}

/** ตารางรายชื่อผู้เชี่ยวชาญพร้อมลายมือชื่อ (Word) */
function signersDocx(signers) {
  const out = [para('รายชื่อผู้เชี่ยวชาญและลายมือชื่อ', { bold: true, before: 240, after: 60 })];
  const widths = [700, 4300, 2600, 2000];
  const rows = [
    new TableRow({
      tableHeader: true,
      children: ['คนที่', 'ชื่อ-นามสกุล / ตำแหน่ง / สังกัด', 'ลายมือชื่อ', 'วันที่ลงนาม'].map((c, i) => cell(c, { bold: true, align: 'center', fill: 'E8EDF5', width: widths[i] })),
    }),
  ];
  for (const s of signers) {
    const buf = dataUrlBuffer(s.signature);
    const sz = buf ? imageSize(buf) : null;
    const sigCell = sz
      ? cell([new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: buf, transformation: fit(sz, 150, 55) })] }), para(`( ${s.signerName} )`, { align: 'center', size: 12 })], { width: widths[2] })
      : cell('-', { align: 'center', width: widths[2] });
    const info = [para(s.name, { bold: true })];
    if (s.position) info.push(para(s.position, { size: 14 }));
    if (s.workplace) info.push(para(s.workplace, { size: 14, color: '5F6B7D' }));
    rows.push(
      new TableRow({
        cantSplit: true,
        children: [cell(String(s.no), { align: 'center', width: widths[0] }), cell(info, { width: widths[1] }), sigCell, cell(thDate(s.signedAt, true), { align: 'center', size: 14, width: widths[3] })],
      })
    );
  }
  out.push(fixedTable(rows, widths));
  out.push(para('ลายมือชื่ออิเล็กทรอนิกส์ตาม พ.ร.บ.ว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544 ตรวจสอบความถูกต้องด้วยรหัส SHA-256 ของแต่ละฉบับ', { size: 12, color: '5F6B7D', before: 60 }));
  return out;
}

async function resultsDocx({ inst, R, comments, signers = [] }) {
  const st = R.settings;
  const ch = [para(`ผลการประเมิน${inst.title}`, { align: 'center', bold: true, size: 18 }), para(inst.subtitle, { align: 'center', after: 160 })];
  ch.push(para(`ผู้เชี่ยวชาญจำนวน ${R.n} คน`, { after: 120 }));
  const cols = ['ข้อ', 'รายการประเมิน'];
  if (inst.useIoc) cols.push('IOC', 'แปลผล');
  if (inst.useRating) cols.push('x̄', 'S.D.', 'ระดับ');
  if (inst.useRating && !inst.useIoc) cols.push('ผล');
  const nNum = cols.length - 2;
  const numW = 900;
  const textW = 9600 - 600 - nNum * numW;
  const widths = [600, textW, ...Array(nNum).fill(numW)];
  const hdr = new TableRow({ tableHeader: true, children: cols.map((c, i) => cell(c, { bold: true, align: 'center', width: widths[i], fill: 'E8EDF5' })) });
  const valCells = (ioc, r, pass, isItem) => {
    const out = [];
    if (inst.useIoc) out.push(cell(isItem ? f2(ioc?.value) : f2(ioc?.meanIoc), { align: 'center' }), cell(isItem ? (ioc?.pass == null ? '-' : ioc.pass ? 'ใช้ได้' : 'ปรับปรุง') : `ผ่าน ${ioc?.passed}/${ioc?.total}`, { align: 'center' }));
    if (inst.useRating) out.push(cell(f2(r?.mean), { align: 'center' }), cell(f2(r?.sd), { align: 'center' }), cell(r?.level || '-', { align: 'center' }));
    if (inst.useRating && !inst.useIoc) out.push(cell(passText(pass), { align: 'center' }));
    return out;
  };
  for (const s of R.sections) {
    if (s.title) ch.push(para(s.title, { bold: true, before: 160, after: 60 }));
    const rows = [hdr];
    for (const g of s.groups) {
      if (g.title) rows.push(new TableRow({ children: [cell(g.title, { bold: true, span: cols.length, fill: 'F2F5FA' })] }));
      for (const it of g.items) rows.push(new TableRow({ cantSplit: true, children: [cell(String(it.no), { align: 'center' }), cell(it.text), ...valCells(it.ioc, it.rating, it.pass, true)] }));
      if (g.title && g.items.length)
        rows.push(new TableRow({ children: [cell(`รวม${g.title}`, { bold: true, span: 2, fill: 'F6F7F9' }), ...valCells(g.ioc, g.rating, g.rating?.pass, false)] }));
    }
    if (R.sections.length > 1) rows.push(new TableRow({ children: [cell(`รวม${s.title}`, { bold: true, span: 2, fill: 'E7EFFA' }), ...valCells(s.ioc, s.rating, s.rating?.pass, false)] }));
    ch.push(fixedTable(rows, widths));
  }
  ch.push(para('', { before: 120 }));
  ch.push(fixedTable([hdr, new TableRow({ children: [cell('ภาพรวมทั้งฉบับ', { bold: true, span: 2, fill: 'E7EFFA' }), ...valCells(R.overall.ioc, R.overall.rating, R.overall.rating?.pass, false)] })], widths));
  ch.push(para('', { before: 120 }));
  for (const l of criteriaLines(inst, st, R.n)) ch.push(para(l, { size: 14 }));
  if (signers.length) ch.push(...signersDocx(signers));

  // ตารางคะแนนรายผู้เชี่ยวชาญ (ภาคผนวก)
  const matrix = (k, title) => {
    ch.push(para(title, { bold: true, before: 240, after: 60 }));
    const E = R.experts.map((_, i) => `คนที่ ${i + 1}`);
    const extra = k === 'ioc' ? ['ΣR', 'IOC'] : ['x̄', 'S.D.'];
    const head = new TableRow({ tableHeader: true, children: ['ข้อ', ...E, ...extra].map((c) => cell(c, { bold: true, align: 'center', fill: 'E8EDF5', size: 14 })) });
    const rows = [head];
    R.sections.forEach((s, si) =>
      s.groups.forEach((g) =>
        g.items.forEach((it) => {
          const vals = it.perExpert.map((p) => (p[k] == null ? '-' : k === 'ioc' && p[k] > 0 ? '+' + p[k] : String(p[k])));
          const ex = k === 'ioc' ? [String(it.ioc.sumR), f2(it.ioc.value)] : [f2(it.rating.mean), f2(it.rating.sd)];
          rows.push(new TableRow({ cantSplit: true, children: [`${R.sections.length > 1 ? `${si + 1}.` : ''}${it.no}`, ...vals, ...ex].map((v) => cell(v, { align: 'center', size: 14 })) }));
        })
      )
    );
    const nc = 1 + E.length + 2;
    const w = Math.floor(8900 / (nc - 1));
    ch.push(fixedTable(rows, [700, ...Array(nc - 1).fill(w)]));
    ch.push(para(R.experts.map((e, i) => `คนที่ ${i + 1} = ${e.name}`).join(', '), { size: 13, before: 60 }));
  };
  if (inst.useIoc) matrix('ioc', 'ตารางผลการพิจารณาความสอดคล้อง (IOC) รายผู้เชี่ยวชาญ');
  if (inst.useRating) matrix('rating', `ตารางคะแนน${inst.ratingLabel}รายผู้เชี่ยวชาญ`);

  if (comments.length) {
    ch.push(para('ความคิดเห็นและข้อเสนอแนะของผู้เชี่ยวชาญ', { bold: true, before: 240, after: 60 }));
    const rows = [new TableRow({ tableHeader: true, children: ['ผู้เชี่ยวชาญ', 'ตำแหน่งในแบบประเมิน', 'ความคิดเห็น'].map((c) => cell(c, { bold: true, align: 'center', fill: 'E8EDF5' })) })];
    for (const c of comments) rows.push(new TableRow({ cantSplit: true, children: [cell(c.expert, { width: 2200 }), cell(c.where, { width: 2400 }), cell(c.text, { width: 5000 })] }));
    ch.push(fixedTable(rows, [2200, 2400, 5000]));
  }
  const doc = new Document({
    title: `ผลการประเมิน ${inst.title}`,
    styles: docStyles,
    sections: [{ properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT }, margin: { top: 1134, bottom: 1134, left: 1300, right: 1000 } } }, children: ch }],
  });
  return Packer.toBuffer(doc);
}

async function resultsXlsx({ inst, R, subs, comments, signers = [] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ระบบประเมินเครื่องมือวิจัย';
  const font = { name: FONT, size: 14 };
  const st = R.settings;
  const styleHeader = (row) => row.eachCell((c) => { c.font = { ...font, bold: true }; c.fill = fill('FFE8EDF5'); c.border = allThin; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  const styleBody = (row, textCols = [2]) => row.eachCell({ includeEmpty: true }, (c, col) => { c.font = { ...font, ...(c.font?.bold ? { bold: true } : {}) }; c.border = allThin; c.alignment = { vertical: 'middle', wrapText: true, horizontal: textCols.includes(col) ? 'left' : 'center' }; });
  const num = (x) => (x === null || x === undefined ? '-' : x);

  // ---- สรุปผล ----
  const ws = wb.addWorksheet('สรุปผล', { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const cols = ['ข้อ', 'รายการประเมิน'];
  if (inst.useIoc) cols.push('ΣR', 'IOC', 'แปลผล IOC');
  if (inst.useRating) cols.push('n', 'x̄', 'S.D.', 'ระดับ');
  cols.push('ผล');
  ws.columns = cols.map((c, i) => ({ width: i === 1 ? 60 : i === 0 ? 7 : 11 }));
  const t = ws.addRow([`ผลการประเมิน${inst.title}`]);
  t.font = { ...font, bold: true, size: 16 };
  ws.mergeCells(1, 1, 1, cols.length);
  ws.addRow([inst.subtitle]).font = font;
  ws.mergeCells(2, 1, 2, cols.length);
  ws.addRow([`ผู้เชี่ยวชาญ n = ${R.n} คน`]).font = font;
  styleHeader(ws.addRow(cols));
  const vals = (ioc, r, pass, isItem) => {
    const v = [];
    if (inst.useIoc) v.push(isItem ? ioc.sumR : '', isItem ? num(ioc.value) : num(ioc?.meanIoc), isItem ? (ioc.pass == null ? '-' : ioc.pass ? 'ใช้ได้' : 'ปรับปรุง') : `ผ่าน ${ioc?.passed}/${ioc?.total}`);
    if (inst.useRating) v.push(r?.n ?? '', num(r?.mean), num(r?.sd), r?.level || '-');
    v.push(passText(pass));
    return v;
  };
  const fmtRow = (row) => {
    row.eachCell((c) => { if (typeof c.value === 'number' && !Number.isInteger(c.value)) c.numFmt = '0.00'; });
  };
  const sumRow = (label, ioc, r, argb) => {
    const row = ws.addRow(['', label, ...vals(ioc, r, inst.useRating ? r?.pass : null, false)]);
    styleBody(row);
    row.eachCell((c) => { c.fill = fill(argb); c.font = { ...font, bold: true }; });
    fmtRow(row);
  };
  for (const s of R.sections) {
    if (s.title) {
      const r = ws.addRow([s.title]);
      ws.mergeCells(r.number, 1, r.number, cols.length);
      r.font = { ...font, bold: true };
    }
    for (const g of s.groups) {
      if (g.title) {
        const r = ws.addRow([g.title]);
        ws.mergeCells(r.number, 1, r.number, cols.length);
        r.getCell(1).fill = fill('FFF2F5FA');
        r.getCell(1).font = { ...font, bold: true };
        r.getCell(1).border = allThin;
      }
      for (const it of g.items) {
        const row = ws.addRow([it.no, it.text, ...vals(it.ioc, it.rating, it.pass, true)]);
        styleBody(row);
        fmtRow(row);
      }
      if (g.title && g.items.length) sumRow(`รวม${g.title}`, g.ioc, g.rating, 'FFF6F7F9');
    }
    if (R.sections.length > 1) sumRow(`รวม${s.title}`, s.ioc, s.rating, 'FFE7EFFA');
  }
  sumRow('ภาพรวมทั้งฉบับ', R.overall.ioc, R.overall.rating, 'FFE7EFFA');
  ws.addRow([]);
  for (const l of criteriaLines(inst, st, R.n)) ws.addRow(['', l]).font = { ...font, size: 12 };

  // ---- รายชื่อผู้เชี่ยวชาญและลายมือชื่อ (ท้ายแผ่นงานสรุปผล) ----
  if (signers.length) {
    const nc = cols.length;
    const sigFrom = 3;
    const sigTo = Math.max(sigFrom, nc - 2);
    ws.addRow([]);
    const t2 = ws.addRow(['รายชื่อผู้เชี่ยวชาญและลายมือชื่อ']);
    t2.font = { ...font, bold: true };
    ws.mergeCells(t2.number, 1, t2.number, nc);
    const hr = ws.addRow([]);
    hr.getCell(1).value = 'คนที่';
    hr.getCell(2).value = 'ชื่อ-นามสกุล / ตำแหน่ง / สังกัด';
    hr.getCell(sigFrom).value = 'ลายมือชื่อ';
    hr.getCell(sigTo + 1).value = 'วันที่ลงนาม';
    ws.mergeCells(hr.number, sigFrom, hr.number, sigTo);
    ws.mergeCells(hr.number, sigTo + 1, hr.number, nc);
    for (let c = 1; c <= nc; c++) {
      const x = hr.getCell(c);
      x.font = { ...font, bold: true };
      x.fill = fill('FFE8EDF5');
      x.border = allThin;
      x.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    for (const s of signers) {
      const r = ws.addRow([]);
      r.height = 58;
      r.getCell(1).value = s.no;
      r.getCell(2).value = [s.name, s.position, s.workplace].filter(Boolean).join('\n');
      r.getCell(sigTo + 1).value = thDate(s.signedAt, true);
      ws.mergeCells(r.number, sigFrom, r.number, sigTo);
      ws.mergeCells(r.number, sigTo + 1, r.number, nc);
      for (let c = 1; c <= nc; c++) {
        const x = r.getCell(c);
        x.font = font;
        x.border = allThin;
        x.alignment = { vertical: 'middle', wrapText: true, horizontal: c === 2 ? 'left' : 'center' };
      }
      const buf = dataUrlBuffer(s.signature);
      if (buf) {
        const id = wb.addImage({ buffer: buf, extension: 'png' });
        ws.addImage(id, { tl: { col: sigFrom - 1 + 0.15, row: r.number - 1 + 0.1 }, ext: fit(imageSize(buf), 150, 60) });
      }
    }
  }

  // ---- ตารางรายผู้เชี่ยวชาญ ----
  const matrix = (k, name) => {
    const m = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
    const E = R.experts.map((e, i) => `คนที่ ${i + 1}`);
    const extra = k === 'ioc' ? ['ΣR', 'IOC'] : ['x̄', 'S.D.'];
    m.columns = [{ width: 8 }, { width: 55 }, ...E.map(() => ({ width: 9 })), { width: 9 }, { width: 9 }];
    styleHeader(m.addRow(['ข้อ', 'รายการประเมิน', ...E, ...extra]));
    R.sections.forEach((s, si) =>
      s.groups.forEach((g) =>
        g.items.forEach((it) => {
          const v = it.perExpert.map((p) => p[k] ?? '-');
          const ex = k === 'ioc' ? [it.ioc.sumR, num(it.ioc.value)] : [num(it.rating.mean), num(it.rating.sd)];
          const row = m.addRow([`${R.sections.length > 1 ? `${si + 1}.` : ''}${it.no}`, it.text, ...v, ...ex]);
          styleBody(row);
          fmtRow(row);
        })
      )
    );
    m.addRow([]);
    R.experts.forEach((e, i) => (m.addRow(['', `คนที่ ${i + 1} = ${e.name}`]).font = font));
  };
  if (inst.useIoc) matrix('ioc', 'IOC รายผู้เชี่ยวชาญ');
  if (inst.useRating) matrix('rating', 'คะแนนรายผู้เชี่ยวชาญ');

  // ---- ข้อมูลดิบ (1 แถว = 1 คน สำหรับ SPSS) ----
  const raw = wb.addWorksheet('ข้อมูลดิบ', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  const rc = [];
  inst.sections.forEach((s, si) => {
    let no = 0;
    s.groups.forEach((g) =>
      g.items.forEach((it) => {
        no++;
        const p = inst.sections.length > 1 ? `S${si + 1}_` : '';
        if (inst.useIoc) rc.push([`${p}Q${no}_IOC`, it.id, 'ioc']);
        if (inst.useRating) rc.push([`${p}Q${no}`, it.id, 'rating']);
      })
    );
  });
  const rh = ['ลำดับ', 'ชื่อผู้ประเมิน', 'ตำแหน่ง', 'สถานที่ทำงาน', 'ประสบการณ์', 'ลงนามเมื่อ', 'SHA-256', ...rc.map((c) => c[0])];
  raw.columns = rh.map((h, i) => ({ width: i === 1 ? 26 : i === 6 ? 20 : i < 6 ? 16 : 10 }));
  styleHeader(raw.addRow(rh));
  subs.forEach((s, i) => {
    const p = s.row.profile ? JSON.parse(s.row.profile) : {};
    const row = raw.addRow([i + 1, s.name, p.position, p.workplace, p.experience, thDate(s.row.signed_at, true), s.row.hash, ...rc.map(([, id, k]) => s.answers[id]?.[k] ?? '')]);
    styleBody(row, [2, 3, 4]);
  });

  // ---- ความคิดเห็น ----
  const cw = wb.addWorksheet('ความคิดเห็น');
  cw.columns = [{ width: 28 }, { width: 40 }, { width: 80 }];
  styleHeader(cw.addRow(['ผู้เชี่ยวชาญ', 'ตำแหน่งในแบบประเมิน', 'ความคิดเห็น']));
  for (const c of comments) styleBody(cw.addRow([c.expert, c.where, c.text]), [1, 2, 3]);

  return wb.xlsx.writeBuffer();
}

module.exports = { formDocx, formXlsx, resultsDocx, resultsXlsx };
