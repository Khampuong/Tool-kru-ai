'use strict';
/**
 * สถิติสำหรับการประเมินเครื่องมือวิจัยโดยผู้เชี่ยวชาญ
 *
 * 1) ดัชนีความสอดคล้อง IOC (Rovinelli & Hambleton, 1977)
 *      IOC = ΣR / N
 *      R = คะแนนของผู้เชี่ยวชาญแต่ละคน (+1, 0, −1), N = จำนวนผู้เชี่ยวชาญ
 *      เกณฑ์: IOC ≥ 0.50 ถือว่าข้อคำถามใช้ได้ (ค่าตั้งต้น ปรับได้ในหน้าตั้งค่า)
 *
 * 2) ค่าเฉลี่ย (x̄) และส่วนเบี่ยงเบนมาตรฐาน (S.D.) ของมาตราส่วนประมาณค่า 5 ระดับ
 *      x̄  = Σx / n
 *      S.D. = √( Σ(x − x̄)² / (n − 1) )   (S.D. ของกลุ่มตัวอย่าง, เหมือน SPSS / STDEV.S ของ Excel)
 *      แปลความหมาย (บุญชม ศรีสะอาด, 2545):
 *        4.51–5.00 มากที่สุด | 3.51–4.50 มาก | 2.51–3.50 ปานกลาง | 1.51–2.50 น้อย | 1.00–1.50 น้อยที่สุด
 *      การแปลความหมายใช้ค่าที่ปัดเป็นทศนิยม 2 ตำแหน่งแล้ว เพื่อให้ตัวเลขที่แสดงกับระดับตรงกันเสมอ
 *
 * 3) ค่ารวมรายด้าน / รายส่วน / ภาพรวม มี 2 วิธี (เลือกได้ในหน้าตั้งค่า)
 *      'respondent' — หาค่าเฉลี่ยของผู้ประเมินแต่ละคนในด้านนั้นก่อน แล้วหา x̄ และ S.D. ข้ามผู้ประเมิน
 *                     (เทียบเท่าการ Compute ตัวแปรรายด้านใน SPSS แล้วหา Descriptives)
 *      'pooled'     — นำคะแนนดิบทุกค่าในด้านนั้นมารวมกันแล้วหา x̄ และ S.D.
 *      ค่า x̄ ของทั้งสองวิธีเท่ากันเมื่อข้อมูลครบ ต่างกันเฉพาะ S.D.
 */

const DEFAULT_LEVELS = [4.51, 3.51, 2.51, 1.51, 1.0]; // ขอบล่างของแต่ละระดับ 5 → 1

function round2(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return null;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function mean(xs) {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** S.D. แบบกลุ่มตัวอย่าง (n − 1); n < 2 คืน null */
function sd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (xs.length - 1));
}

/** คืน index ระดับ 0 = สูงสุด (5) … 4 = ต่ำสุด (1) จากค่าเฉลี่ยที่ปัดแล้ว */
function levelIndex(m, levels = DEFAULT_LEVELS) {
  const r = round2(m);
  if (r === null) return null;
  for (let i = 0; i < levels.length; i++) if (r >= levels[i]) return i;
  return levels.length - 1;
}

function describe(xs, ctx) {
  const m = mean(xs);
  const s = sd(xs);
  const li = levelIndex(m, ctx.levels);
  const pass =
    m === null
      ? null
      : round2(m) >= ctx.ratingCriterion && (ctx.sdMax == null || s === null || round2(s) <= ctx.sdMax);
  return {
    n: xs.length,
    mean: m,
    sd: s,
    level: li === null ? null : ctx.labels[li] || null,
    pass,
  };
}

function normSettings(settings = {}, instrument = {}) {
  return {
    iocCriterion: settings.iocCriterion ?? 0.5,
    ratingCriterion: settings.ratingCriterion ?? 3.51,
    sdMax: settings.sdMax === '' || settings.sdMax === undefined ? 1.0 : settings.sdMax,
    aggMethod: settings.aggMethod === 'pooled' ? 'pooled' : 'respondent',
    levels: Array.isArray(settings.levels) && settings.levels.length === 5 ? settings.levels : DEFAULT_LEVELS,
    labels:
      Array.isArray(instrument.ratingLabels) && instrument.ratingLabels.length === 5
        ? instrument.ratingLabels
        : ['มากที่สุด', 'มาก', 'ปานกลาง', 'น้อย', 'น้อยที่สุด'],
  };
}

/**
 * @param instrument {useIoc, useRating, ratingLabels, sections:[{id,title,groups:[{id,title,items:[{id,text}]}]}]}
 * @param submissions [{id, name, answers: {[itemId]: {ioc, rating}}}]  — เฉพาะที่ส่งแล้ว
 * @param settings
 */
function computeResults(instrument, submissions, settings) {
  const ctx = normSettings(settings, instrument);
  const subs = submissions.map((s) => ({ ...s, answers: s.answers || {} }));

  // ค่ารวมของชุดรายการ (ด้าน/ส่วน/ทั้งฉบับ)
  function aggregateRating(itemIds) {
    if (ctx.aggMethod === 'pooled') {
      const xs = [];
      for (const s of subs)
        for (const id of itemIds) {
          const v = s.answers[id]?.rating;
          if (Number.isFinite(v)) xs.push(v);
        }
      return describe(xs, ctx);
    }
    const perPerson = [];
    for (const s of subs) {
      const xs = [];
      for (const id of itemIds) {
        const v = s.answers[id]?.rating;
        if (Number.isFinite(v)) xs.push(v);
      }
      if (xs.length) perPerson.push(mean(xs));
    }
    return describe(perPerson, ctx);
  }

  function itemStats(item) {
    const out = { id: item.id, no: item.no, text: item.text, perExpert: [] };
    const iocs = [];
    const ratings = [];
    const freq = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    const iocFreq = { 1: 0, 0: 0, '-1': 0 };
    for (const s of subs) {
      const a = s.answers[item.id] || {};
      out.perExpert.push({ ioc: a.ioc ?? null, rating: a.rating ?? null });
      if (instrument.useIoc && Number.isFinite(a.ioc)) {
        iocs.push(a.ioc);
        iocFreq[a.ioc]++;
      }
      if (instrument.useRating && Number.isFinite(a.rating)) {
        ratings.push(a.rating);
        freq[a.rating]++;
      }
    }
    if (instrument.useIoc) {
      const sum = iocs.reduce((a, b) => a + b, 0);
      const ioc = iocs.length ? sum / iocs.length : null;
      out.ioc = {
        n: iocs.length,
        sumR: sum,
        value: ioc,
        pass: ioc === null ? null : round2(ioc) >= ctx.iocCriterion,
        freq: iocFreq,
      };
    }
    if (instrument.useRating) out.rating = { ...describe(ratings, ctx), freq };
    if (out.ioc && out.rating) out.pass = out.ioc.pass !== false && out.rating.pass !== false;
    else out.pass = (out.ioc || out.rating)?.pass ?? null;
    return out;
  }

  function iocSummary(items) {
    const vals = items.map((i) => i.ioc?.value).filter((v) => v !== null && v !== undefined);
    return {
      meanIoc: mean(vals),
      passed: items.filter((i) => i.ioc?.pass).length,
      total: items.length,
    };
  }

  const allIds = [];
  const allItems = [];
  const sections = instrument.sections.map((sec) => {
    const secIds = [];
    const secItems = [];
    let no = 0;
    const groups = sec.groups.map((g) => {
      const items = g.items.map((it) => itemStats({ ...it, no: ++no }));
      const ids = g.items.map((it) => it.id);
      secIds.push(...ids);
      secItems.push(...items);
      return {
        id: g.id,
        title: g.title,
        items,
        rating: instrument.useRating ? aggregateRating(ids) : null,
        ioc: instrument.useIoc ? iocSummary(items) : null,
      };
    });
    allIds.push(...secIds);
    allItems.push(...secItems);
    return {
      id: sec.id,
      title: sec.title,
      groups,
      rating: instrument.useRating ? aggregateRating(secIds) : null,
      ioc: instrument.useIoc ? iocSummary(secItems) : null,
    };
  });

  return {
    settings: ctx,
    experts: subs.map((s) => ({ id: s.id, name: s.name })),
    n: subs.length,
    sections,
    overall: {
      rating: instrument.useRating ? aggregateRating(allIds) : null,
      ioc: instrument.useIoc ? iocSummary(allItems) : null,
      itemsPassed: allItems.filter((i) => i.pass).length,
      itemsTotal: allItems.length,
    },
  };
}

module.exports = { computeResults, mean, sd, round2, levelIndex, DEFAULT_LEVELS };
