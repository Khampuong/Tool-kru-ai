'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeResults, sd, round2, levelIndex } = require('../lib/stats');

const inst = {
  useIoc: true,
  useRating: true,
  ratingLabels: ['มากที่สุด', 'มาก', 'ปานกลาง', 'น้อย', 'น้อยที่สุด'],
  sections: [
    {
      id: 1, title: 'ส่วนที่ 1',
      groups: [
        { id: 10, title: 'ด้าน A', items: [{ id: 100, text: 'a1' }, { id: 101, text: 'a2' }] },
        { id: 11, title: 'ด้าน B', items: [{ id: 102, text: 'b1' }] },
      ],
    },
  ],
};
// ผู้เชี่ยวชาญ 5 คน
const subs = [
  { id: 1, name: 'E1', answers: { 100: { ioc: 1, rating: 5 }, 101: { ioc: 1, rating: 4 }, 102: { ioc: -1, rating: 2 } } },
  { id: 2, name: 'E2', answers: { 100: { ioc: 1, rating: 5 }, 101: { ioc: 0, rating: 4 }, 102: { ioc: 0, rating: 3 } } },
  { id: 3, name: 'E3', answers: { 100: { ioc: 1, rating: 4 }, 101: { ioc: 1, rating: 5 }, 102: { ioc: 1, rating: 3 } } },
  { id: 4, name: 'E4', answers: { 100: { ioc: 0, rating: 5 }, 101: { ioc: 1, rating: 3 }, 102: { ioc: 0, rating: 2 } } },
  { id: 5, name: 'E5', answers: { 100: { ioc: 1, rating: 4 }, 101: { ioc: -1, rating: 4 }, 102: { ioc: 1, rating: 4 } } },
];

test('IOC = ΣR / N และเกณฑ์ 0.50', () => {
  const r = computeResults(inst, subs, {});
  const [a1, a2] = r.sections[0].groups[0].items;
  const b1 = r.sections[0].groups[1].items[0];
  assert.equal(a1.ioc.sumR, 4);
  assert.equal(a1.ioc.value, 0.8);
  assert.equal(a1.ioc.pass, true);
  assert.equal(a2.ioc.value, 0.4); // (1+0+1+1-1)/5
  assert.equal(a2.ioc.pass, false);
  assert.equal(b1.ioc.value, 0.2);
  assert.equal(r.overall.ioc.passed, 1);
});

test('x̄ และ S.D. แบบ n−1 ตรงกับ Excel STDEV.S', () => {
  const r = computeResults(inst, subs, {});
  const a1 = r.sections[0].groups[0].items[0]; // 5,5,4,5,4
  assert.equal(round2(a1.rating.mean), 4.6);
  assert.equal(round2(a1.rating.sd), 0.55); // STDEV.S(5,5,4,5,4) = 0.5477
  assert.equal(a1.rating.level, 'มากที่สุด');
  assert.equal(a1.rating.freq[5], 3);
  const b1 = r.sections[0].groups[1].items[0]; // 2,3,3,2,4 → 2.8
  assert.equal(round2(b1.rating.mean), 2.8);
  assert.equal(b1.rating.level, 'ปานกลาง');
  assert.equal(b1.rating.pass, false);
});

test('ค่ารวมรายด้าน: วิธีรายบุคคล vs รวมคะแนนดิบ — x̄ เท่ากัน S.D. ต่างกัน', () => {
  const resp = computeResults(inst, subs, { aggMethod: 'respondent' });
  const pool = computeResults(inst, subs, { aggMethod: 'pooled' });
  const gR = resp.sections[0].groups[0].rating;
  const gP = pool.sections[0].groups[0].rating;
  // ด้าน A: คะแนนดิบ 5,4 | 5,4 | 4,5 | 5,3 | 4,4 → เฉลี่ยรายคน 4.5,4.5,4.5,4,4
  assert.equal(round2(gR.mean), 4.3);
  assert.equal(round2(gP.mean), 4.3);
  assert.equal(gR.n, 5);
  assert.equal(gP.n, 10);
  assert.equal(round2(gR.sd), round2(sd([4.5, 4.5, 4.5, 4, 4])));
  assert.equal(round2(gP.sd), round2(sd([5, 4, 5, 4, 4, 5, 5, 3, 4, 4])));
  assert.notEqual(round2(gR.sd), round2(gP.sd));
});

test('การแปลความหมายใช้ค่าที่ปัดแล้ว (ขอบเขต 4.505 → 4.51 = มากที่สุด, 4.50 = มาก)', () => {
  assert.equal(levelIndex(4.505), 0);
  assert.equal(levelIndex(4.5), 1);
  assert.equal(levelIndex(3.5049), 2);
  assert.equal(levelIndex(1.0), 4);
});

test('ผู้ประเมินคนเดียว: S.D. ไม่สามารถคำนวณได้ (null)', () => {
  const r = computeResults(inst, subs.slice(0, 1), {});
  assert.equal(r.sections[0].groups[0].items[0].rating.sd, null);
  assert.equal(r.sections[0].groups[0].items[0].rating.pass, true);
});

test('เกณฑ์ S.D. สูงสุด', () => {
  const s = [1, 2, 3].map((i) => ({ id: i, name: 'x', answers: { 102: { ioc: 1, rating: [5, 5, 2][i - 1] } } }));
  const r = computeResults(inst, s, { sdMax: 1.0 });
  const b1 = r.sections[0].groups[1].items[0]; // x̄ = 4.00, S.D. = 1.73
  assert.equal(round2(b1.rating.mean), 4);
  assert.equal(b1.rating.pass, false);
  const r2 = computeResults(inst, s, { sdMax: null });
  assert.equal(r2.sections[0].groups[1].items[0].rating.pass, true);
});
