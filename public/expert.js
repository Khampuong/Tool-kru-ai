'use strict';
/* global $, $$, esc, api, toast, thDate, modal, confirmBox, SignaturePad */

const token = location.pathname.split('/').pop();
const params = new URLSearchParams(location.search);
const wantAdmin = params.get('admin') === '1';

let D; // payload
const S = { answers: {}, sectionComments: {}, overallComment: '', profile: {} };
let editable = false;
let loggedIn = false;
let dirty = false;
let saveTimer = null;

const IOC_OPTS = [
  { v: 1, t: '+1' },
  { v: 0, t: '0' },
  { v: -1, t: '−1' },
];
const RATE_OPTS = [5, 4, 3, 2, 1];

load();

async function load() {
  try {
    D = await api('GET', `/api/e/${encodeURIComponent(token)}${wantAdmin ? '?admin=1' : ''}`);
  } catch (e) {
    $('#app').innerHTML = `<div class="card"><h2>ไม่สามารถเปิดแบบประเมินได้</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  if (D.gate) return renderGate();
  if (!D.adminView) {
    const me = await api('GET', '/api/expert/me').catch(() => ({}));
    loggedIn = !!me.expert;
  }
  S.answers = D.response.answers || {};
  S.sectionComments = D.response.sectionComments || {};
  S.overallComment = D.response.overallComment || '';
  S.profile = { ...D.profile };
  editable = D.status !== 'submitted' || D.adminView;
  document.title = `${D.instrument.title} - ${S.profile.name || 'ผู้ประเมิน'}`;
  render();
  if (params.get('print') === '1') setTimeout(() => window.print(), 600);
}

/** ก่อนเข้าแบบประเมิน: ตั้งค่าบัญชี (ครั้งแรก) หรือเข้าสู่ระบบ */
function renderGate() {
  const acc = D.account;
  const setup = !acc.hasPassword;
  document.title = 'การประเมินเครื่องมือ - ' + (setup ? 'ตั้งค่าบัญชี' : 'เข้าสู่ระบบ');
  $('#bar').classList.add('hidden');
  const who = avatarGreet(`สวัสดี 🙏 ${esc(acc.name)}<span>ท่านได้รับเชิญเป็นผู้เชี่ยวชาญประเมินเครื่องมือวิจัย ขอบคุณที่ร่วมสร้างองค์กรแห่งความสุข 💜</span>`);
  const panel = setup
    ? `${who}
      <h2>ตั้งค่าบัญชีก่อนเริ่มประเมิน</h2>
      <p class="lead">กรอกอีเมล เบอร์โทรศัพท์ และตั้งรหัสผ่าน เพื่อใช้เข้าสู่ระบบครั้งต่อไป</p>
      <div class="auth-err" id="err" role="alert"></div>
      <form id="gf" novalidate>
        ${ifield({ id: 'em', label: 'อีเมล', icon: 'mail', type: 'email', value: acc.email, placeholder: 'name@example.com', autocomplete: 'email' })}
        ${ifield({ id: 'ph', label: 'เบอร์โทรศัพท์ (10 หลัก)', icon: 'phone', type: 'tel', value: acc.phone, placeholder: '0812345678', autocomplete: 'tel', attrs: 'inputmode="numeric" maxlength="10"' })}
        ${ifield({ id: 'pw', label: 'ตั้งรหัสผ่าน', icon: 'lock', type: 'password', autocomplete: 'new-password', hint: 'อย่างน้อย 8 ตัวอักษร' })}
        <div class="pw-meter" style="margin:-8px 0 14px"><span id="meter"></span></div>
        ${ifield({ id: 'pw2', label: 'ยืนยันรหัสผ่าน', icon: 'lock', type: 'password', autocomplete: 'new-password' })}
        <label class="check" style="align-items:flex-start;font-size:.88rem;margin:4px 0 8px"><input type="checkbox" id="consent" style="margin-top:4px">
          <span>ข้าพเจ้ายินยอมให้ผู้วิจัยเก็บข้อมูลติดต่อและผลการประเมินเพื่อใช้ในงานวิจัยนี้</span></label>
        <button class="primary auth-btn" type="submit" id="go">สร้างบัญชีและเริ่มประเมิน</button>
      </form>
      <div class="auth-help">${ICON.info}<div>ครั้งต่อไปเข้าสู่ระบบที่หน้าแรกของระบบด้วย <b>อีเมลหรือเบอร์โทรศัพท์</b> และรหัสผ่านนี้</div></div>`
    : `${who}
      <h2>เข้าสู่ระบบเพื่อเริ่มประเมิน</h2>
      <p class="lead">ใช้อีเมลหรือเบอร์โทรศัพท์ และรหัสผ่านของท่าน</p>
      <div class="auth-err" id="err" role="alert"></div>
      <form id="gf" novalidate>
        ${ifield({ id: 'login', label: 'อีเมล หรือ เบอร์โทรศัพท์', icon: 'mail', value: acc.email || acc.phone, autocomplete: 'username' })}
        ${ifield({ id: 'pw', label: 'รหัสผ่าน', icon: 'lock', type: 'password', autocomplete: 'current-password' })}
        <button class="primary auth-btn" type="submit" id="go">เข้าสู่ระบบ</button>
      </form>
      <div class="auth-help">${ICON.info}<div>ลืมรหัสผ่าน? กรุณาติดต่อผู้วิจัยเพื่อรีเซ็ตรหัสผ่าน</div></div>`;
  const extra = `<div class="auth-chip" style="background:rgba(127,227,216,.18)">ท่านได้รับเชิญให้ประเมิน: ${esc(D.instrument?.title || '')}</div>`;
  authLayout($('#app'), authHero(D.meta, { extra }), panel);
  bindEyes($('#app'));
  const err = $('#err');
  const go = $('#go');
  if (setup) {
    bindPwMeter($('#pw'), $('#meter'), $('#pw-hint'));
    const ph = $('#ph');
    ph.addEventListener('input', () => (ph.value = ph.value.replace(/\D/g, '').slice(0, 10)));
    ($('#em').value ? $('#pw') : $('#em')).focus();
  } else $('#pw').focus();

  $('#gf').addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr(err, '');
    let body;
    if (setup) {
      body = { email: $('#em').value.trim(), phone: $('#ph').value.trim(), password: $('#pw').value, confirm: $('#pw2').value, consent: $('#consent').checked };
      const bad =
        (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email) && ['em', 'กรุณากรอกอีเมลให้ถูกต้อง']) ||
        (!/^\d{10}$/.test(body.phone) && ['ph', 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก']) ||
        (body.password.length < 8 && ['pw', 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร']) ||
        (body.password !== body.confirm && ['pw2', 'ยืนยันรหัสผ่านไม่ตรงกัน']) ||
        (!$('#consent').checked && ['consent', 'กรุณาทำเครื่องหมายยินยอมการเก็บข้อมูล']);
      if (bad) {
        showErr(err, bad[1]);
        return $('#' + bad[0]).focus();
      }
    } else {
      body = { login: $('#login').value.trim(), password: $('#pw').value };
      if (!body.login || !body.password) return showErr(err, 'กรุณากรอกอีเมล/เบอร์โทรศัพท์ และรหัสผ่าน');
    }
    go.disabled = true;
    go.textContent = setup ? 'กำลังสร้างบัญชี…' : 'กำลังเข้าสู่ระบบ…';
    try {
      await api('POST', setup ? `/api/e/${encodeURIComponent(token)}/account` : '/api/expert/login', body);
      document.body.classList.remove('auth');
      $('#app').innerHTML = '<p class="muted">กำลังเปิดแบบประเมิน…</p>';
      await load();
    } catch (ex) {
      showErr(err, ex.message);
      go.disabled = false;
      go.textContent = setup ? 'สร้างบัญชีและเริ่มประเมิน' : 'เข้าสู่ระบบ';
    }
  });
}

function allItems() {
  return D.instrument.sections.flatMap((s) => s.groups.flatMap((g) => g.items));
}
function isComplete(id) {
  const a = S.answers[id] || {};
  return (!D.instrument.useIoc || a.ioc != null) && (!D.instrument.useRating || a.rating != null);
}

function render() {
  const inst = D.instrument;
  const m = D.meta;
  const dis = editable ? '' : 'disabled';
  const banner = [];
  if (loggedIn) banner.push('<p class="small no-print"><a href="/">← แบบประเมินของฉัน</a></p>');
  if (D.adminView)
    banner.push(`<div class="alert warn no-print"><b>โหมดผู้ดูแลระบบ</b> — การแก้ไขในหน้านี้จะถูกบันทึกในประวัติการแก้ไข${
      D.status === 'submitted' ? ' และแสดงสถานะ “แก้ไขหลังลงนาม” ในผลการตรวจสอบความถูกต้อง' : ''}</div>`);
  if (D.status === 'submitted' && !D.adminView)
    banner.push(`<div class="alert ok no-print">ท่านลงนามส่งแบบประเมินเรียบร้อยแล้ว เมื่อ ${esc(thDate(D.signature.signedAt))} ขอขอบพระคุณเป็นอย่างสูง
      <div class="small muted">หากต้องการแก้ไข กรุณาติดต่อผู้วิจัย</div></div>`);
  if (!inst.active) banner.push(`<div class="alert bad no-print">แบบประเมินนี้ปิดรับการประเมินแล้ว</div>`);

  const att = inst.attachment
    ? /\.pdf$/i.test(inst.attachment)
      ? `<p class="no-print"><a class="btn" href="/uploads/${esc(inst.attachment)}" target="_blank" rel="noopener">📎 เปิดเอกสารประกอบการประเมิน (PDF)</a></p>`
      : `<figure style="margin:14px 0;text-align:center"><a href="/uploads/${esc(inst.attachment)}" target="_blank" rel="noopener">
           <img src="/uploads/${esc(inst.attachment)}" alt="ภาพประกอบการประเมิน" style="max-width:100%;border:1px solid var(--border);border-radius:8px"></a>
           <figcaption class="small muted no-print">คลิกที่ภาพเพื่อขยาย</figcaption></figure>`
    : '';

  const legend = [];
  if (inst.useIoc) legend.push('<b>เกณฑ์การประเมินความสอดคล้อง (IOC):</b> +1 = สอดคล้อง &nbsp; 0 = ไม่แน่ใจ &nbsp; −1 = ไม่สอดคล้อง');
  if (inst.useRating)
    legend.push(`<b>เกณฑ์การประเมิน${esc(inst.ratingLabel)}:</b> ` + RATE_OPTS.map((v, i) => `${v} = ${esc(inst.ratingLabels[i] || '')}`).join(' &nbsp; '));

  const expOpts = (m.experienceOptions || [])
    .map((o) => `<label class="check"><input type="radio" name="exp" value="${esc(o)}" ${S.profile.experience === o ? 'checked' : ''} ${dis}> ${esc(o)}</label>`)
    .join(' ');

  $('#app').innerHTML = `
  ${banner.join('')}
  <div class="paper">
    <div class="doc-title"><h1>${esc(inst.title)}</h1><div>${esc(inst.subtitle)}</div></div>
    <table class="meta-table">
      <tr><td>ชื่อหัวข้อวิทยานิพนธ์</td><td>${esc(m.thesisTitle)}</td></tr>
      <tr><td>ผู้วิจัย</td><td>${esc(m.researcher)}</td></tr>
      ${m.advisor ? `<tr><td>อาจารย์ที่ปรึกษาหลัก</td><td>${esc(m.advisor)}</td></tr>` : ''}
      ${m.coAdvisor ? `<tr><td>อาจารย์ที่ปรึกษาร่วม</td><td>${esc(m.coAdvisor)}</td></tr>` : ''}
    </table>
    ${att}

    <h2>ตอนที่ 1 ข้อมูลผู้ประเมิน</h2>
    <div class="grid cols-2">
      <div class="field"><label for="p-name">ชื่อผู้ประเมิน <span style="color:var(--bad)">*</span></label><input type="text" id="p-name" data-p="name" value="${esc(S.profile.name)}" ${dis}></div>
      <div class="field"><label for="p-position">ตำแหน่ง</label><input type="text" id="p-position" data-p="position" value="${esc(S.profile.position)}" ${dis}></div>
      <div class="field"><label for="p-workplace">สถานที่ทำงาน</label><input type="text" id="p-workplace" data-p="workplace" value="${esc(S.profile.workplace)}" ${dis}></div>
      <div class="field"><label>ประสบการณ์การทำงาน</label><div class="row" style="gap:14px">${expOpts}</div></div>
    </div>

    <h2 style="margin-top:22px">ตอนที่ 2 การประเมิน</h2>
    ${inst.instructions ? `<p>${esc(inst.instructions)}</p>` : ''}
    <div class="legend">${legend.join('<br>')}</div>
    <p class="small muted no-print">กดปุ่ม 💬 ท้ายแต่ละข้อเพื่อเขียนความคิดเห็นหรือข้อเสนอแนะรายข้อ
      ${editable ? ' · ใช้ปุ่ม <b>“กรอกทั้งองค์ประกอบ”</b> เพื่อใส่คะแนนเดียวกันทุกข้อ แล้วปรับรายข้อได้' : ''}</p>
    ${qfillButtons('all', `กรอกทุกข้อทั้งฉบับ (${allItems().length} ข้อ):`)}
    ${inst.sections.map(renderSection).join('')}

    <h2 style="margin-top:22px">ตอนที่ 3 ข้อเสนอแนะอื่น ๆ</h2>
    <textarea id="overall" rows="4" placeholder="ข้อเสนอแนะเพิ่มเติม" ${dis}>${esc(S.overallComment)}</textarea>

    ${signatureBlock()}
    ${m.thanks ? `<p style="text-align:center;margin-top:26px" class="small">${esc(m.thanks)}</p>` : ''}
  </div>`;

  bind();
  renderBar();
  updateProgress();
}

function renderSection(sec) {
  const inst = D.instrument;
  const dis = editable ? '' : 'disabled';
  let no = 0;
  const colCount = 2 + (inst.useIoc ? 3 : 0) + (inst.useRating ? 5 : 0) + 1;
  const head1 = `<tr><th rowspan="2">ข้อ</th><th rowspan="2">รายการประเมิน</th>
    ${inst.useIoc ? '<th colspan="3">ความสอดคล้อง</th>' : ''}
    ${inst.useRating ? `<th colspan="5">${esc(inst.ratingLabel)}</th>` : ''}
    <th rowspan="2" class="no-print" title="ความคิดเห็น">💬</th></tr>
    <tr>${inst.useIoc ? IOC_OPTS.map((o) => `<th>${o.t}</th>`).join('') : ''}${inst.useRating ? RATE_OPTS.map((v) => `<th>${v}</th>`).join('') : ''}</tr>`;

  const rows = sec.groups
    .map((g) => {
      const gh = g.title || g.description
        ? `<tr class="grp"><td colspan="${colCount}">${esc(g.title)}${g.description ? `<div class="desc">${esc(g.description)}</div>` : ''}
            ${g.items.length > 1 ? qfillButtons('g' + g.id, `กรอกทั้ง${/^ด้าน/.test(g.title) ? 'ด้าน' : 'องค์ประกอบ'}นี้ (${g.items.length} ข้อ):`) : ''}</td></tr>`
        : '';
      return gh + g.items.map((it) => renderItem(it, ++no, dis)).join('');
    })
    .join('');

  const nSec = sec.groups.reduce((a, g) => a + g.items.length, 0);
  return `<section style="margin-top:16px">
    ${sec.title ? `<h3>${esc(sec.title)}</h3>` : ''}
    ${inst.sections.length > 1 && sec.groups.length > 1 ? qfillButtons('s' + sec.id, `กรอกทุกข้อใน${sec.title ? sec.title.split(' ').slice(0, 2).join(' ') : 'ส่วนนี้'} (${nSec} ข้อ):`) : ''}
    <table class="qtable"><thead>${head1}</thead><tbody>${rows}</tbody></table>
    <div class="field" style="margin-top:8px"><label for="sc-${sec.id}">ข้อเสนอแนะ${sec.title ? 'ส่วนนี้' : 'เพิ่มเติม'}</label>
      <textarea id="sc-${sec.id}" data-sec="${sec.id}" rows="2" ${dis}>${esc(S.sectionComments[sec.id] || '')}</textarea></div>
  </section>`;
}

function radio(it, k, v, label, dis, mobile) {
  const a = S.answers[it.id] || {};
  const checked = a[k] === v;
  const name = `${mobile ? 'm' : 'd'}-${k}-${it.id}`;
  const attrs = `type="radio" name="${name}" data-item="${it.id}" data-k="${k}" data-v="${v}" ${checked ? 'checked' : ''} ${dis}`;
  if (mobile) return `<label><input ${attrs}><span>${label}</span></label>`;
  return `<td class="opt"><label data-mark="${checked ? '✓' : ''}" title="${esc(label)}"><input ${attrs} aria-label="ข้อ ${it.id} ${esc(label)}"></label></td>`;
}

function renderItem(it, no, dis) {
  const inst = D.instrument;
  const a = S.answers[it.id] || {};
  const iocCells = inst.useIoc ? IOC_OPTS.map((o) => radio(it, 'ioc', o.v, o.t, dis)).join('') : '';
  const rateCells = inst.useRating ? RATE_OPTS.map((v) => radio(it, 'rating', v, String(v), dis)).join('') : '';
  const mob = `<div class="opt-mobile">
     ${inst.useIoc ? `<div class="scale"><span class="lab">ความสอดคล้อง</span>${IOC_OPTS.map((o) => radio(it, 'ioc', o.v, o.t, dis, true)).join('')}</div>` : ''}
     ${inst.useRating ? `<div class="scale"><span class="lab">${esc(inst.ratingLabel)}</span>${RATE_OPTS.map((v) => radio(it, 'rating', v, String(v), dis, true)).join('')}</div>` : ''}
   </div>`;
  const colCount = 2 + (inst.useIoc ? 3 : 0) + (inst.useRating ? 5 : 0) + 1;
  const hasC = !!(a.comment && a.comment.trim());
  return `<tr class="item" id="row-${it.id}">
      <td class="no">${no}</td>
      <td>${esc(it.text)}${mob}</td>
      ${iocCells}${rateCells}
      <td class="cmt"><button type="button" class="${hasC ? 'has' : ''}" data-cmt="${it.id}" title="ความคิดเห็นรายข้อ" aria-label="ความคิดเห็นข้อ ${no}">💬</button></td>
    </tr>
    <tr class="cmt-row ${hasC ? '' : 'empty hidden'}" id="cmt-${it.id}"><td colspan="${colCount}">
      <div class="field"><label class="small" for="ci-${it.id}">ความคิดเห็น / ข้อเสนอแนะ ข้อ ${no}</label>
      <textarea id="ci-${it.id}" data-citem="${it.id}" rows="2" ${editable ? '' : 'disabled'}>${esc(a.comment || '')}</textarea></div>
    </td></tr>`;
}

function signatureBlock() {
  const sig = D.signature;
  if (!sig) return '';
  return `<div class="signature-block"><div class="inner">
    <img src="${sig.image}" alt="ลายมือชื่อผู้ประเมิน">
    <div>ลงชื่อ ................................................ ผู้ประเมิน</div>
    <div>( ${esc(sig.name)} )</div>
    <div>วันที่ ${esc(thDate(sig.signedAt, false))}</div>
    <div class="small muted">ลงนามอิเล็กทรอนิกส์ เวลา ${esc(thDate(sig.signedAt))}</div>
  </div></div>
  <p class="hash" style="margin-top:14px">รหัสตรวจสอบเอกสาร (SHA-256): ${esc(sig.hash)}${sig.editedAfterSign ? ' — <b style="color:var(--bad)">มีการแก้ไขโดยผู้ดูแลหลังลงนาม</b>' : ''}</p>`;
}

/** ตั้งค่าคำตอบ 1 ข้อ และซิงก์ปุ่มของมุมมองโต๊ะทำงานและมือถือ */
function setAnswer(id, k, v) {
  S.answers[id] = { ...(S.answers[id] || {}), [k]: v };
  $$(`input[data-item="${id}"][data-k="${k}"]`).forEach((x) => {
    x.checked = Number(x.dataset.v) === v;
    const lab = x.closest('td.opt label');
    if (lab) lab.dataset.mark = x.checked ? '✓' : '';
  });
  if (isComplete(id)) $(`#row-${id}`)?.classList.remove('missing');
}

/** กรอกคะแนนเดียวกันให้ทุกข้อในองค์ประกอบ / ส่วน / ทั้งฉบับ */
function quickFill(scope, k, v) {
  const inst = D.instrument;
  let items;
  if (scope.startsWith('g')) items = inst.sections.flatMap((s) => s.groups).find((g) => String(g.id) === scope.slice(1))?.items || [];
  else if (scope.startsWith('s')) items = inst.sections.find((s) => String(s.id) === scope.slice(1))?.groups.flatMap((g) => g.items) || [];
  else items = allItems();
  items.forEach((it) => setAnswer(it.id, k, v));
  changed();
  const label = k === 'ioc' ? (v > 0 ? '+1' : v < 0 ? '−1' : '0') : String(v);
  toast(`กรอก ${label} ให้ ${items.length} ข้อแล้ว — ปรับรายข้อได้ตามต้องการ`);
}

/** ปุ่มกรอกด่วน (แสดงเฉพาะเมื่อแก้ไขได้ และไม่พิมพ์) */
function qfillButtons(scope, label) {
  if (!editable) return '';
  const inst = D.instrument;
  const ioc = inst.useIoc
    ? `<span class="qf-lab">IOC</span>${IOC_OPTS.map((o) => `<button type="button" data-qf="${scope}" data-k="ioc" data-v="${o.v}">${o.t}</button>`).join('')}`
    : '';
  const rate = inst.useRating
    ? `<span class="qf-lab">${esc(inst.ratingLabel)}</span>${RATE_OPTS.map((v) => `<button type="button" data-qf="${scope}" data-k="rating" data-v="${v}">${v}</button>`).join('')}`
    : '';
  return `<div class="qfill no-print"><span class="qf-title">${esc(label)}</span>${ioc}${rate}</div>`;
}

function bind() {
  $$('#app input[type=radio][data-item]').forEach((r) =>
    r.addEventListener('change', () => {
      setAnswer(r.dataset.item, r.dataset.k, Number(r.dataset.v));
      changed();
    })
  );
  $$('#app [data-qf]').forEach((b) => b.addEventListener('click', () => quickFill(b.dataset.qf, b.dataset.k, Number(b.dataset.v))));
  $$('#app [data-cmt]').forEach((b) =>
    b.addEventListener('click', () => {
      const row = $(`#cmt-${b.dataset.cmt}`);
      row.classList.toggle('hidden');
      if (!row.classList.contains('hidden')) row.querySelector('textarea').focus();
    })
  );
  $$('#app [data-citem]').forEach((t) =>
    t.addEventListener('input', () => {
      const id = t.dataset.citem;
      S.answers[id] = { ...(S.answers[id] || {}), comment: t.value };
      const has = !!t.value.trim();
      $(`[data-cmt="${id}"]`).classList.toggle('has', has);
      $(`#cmt-${id}`).classList.toggle('empty', !has);
      changed();
    })
  );
  $$('#app [data-sec]').forEach((t) =>
    t.addEventListener('input', () => {
      S.sectionComments[t.dataset.sec] = t.value;
      changed();
    })
  );
  $('#overall').addEventListener('input', (e) => {
    S.overallComment = e.target.value;
    changed();
  });
  $$('#app [data-p]').forEach((i) =>
    i.addEventListener('input', () => {
      S.profile[i.dataset.p] = i.value;
      changed();
    })
  );
  $$('#app input[name=exp]').forEach((i) =>
    i.addEventListener('change', () => {
      S.profile.experience = i.value;
      changed();
    })
  );
}

function renderBar() {
  const bar = $('#bar');
  bar.classList.remove('hidden');
  const acts = $('#barActions');
  const base = `/api/e/${encodeURIComponent(token)}/form`;
  const dl = `<a class="btn" href="${base}.docx">⬇ Word</a><a class="btn" href="${base}.xlsx">⬇ Excel</a>
    <button id="bPrint" title="เลือกปลายทาง “บันทึกเป็น PDF” ในหน้าต่างพิมพ์">🖨 PDF / พิมพ์</button>`;
  if (D.adminView) {
    acts.innerHTML = `${dl}<button class="primary" id="bAdminSave">บันทึกการแก้ไข (ผู้ดูแล)</button>`;
    $('#bAdminSave').addEventListener('click', adminSave);
  } else if (D.status === 'submitted') {
    acts.innerHTML = dl;
  } else {
    acts.innerHTML = `<button id="bSave">บันทึกร่าง</button><button class="primary" id="bSubmit">✍️ ลงนามและส่งแบบประเมิน</button>`;
    $('#bSave').addEventListener('click', () => saveDraft(true));
    $('#bSubmit').addEventListener('click', openSign);
  }
  $('#bPrint')?.addEventListener('click', () => window.print());
}

function updateProgress() {
  const items = allItems();
  const done = items.filter((i) => isComplete(i.id)).length;
  $('#prog').style.width = `${items.length ? (done / items.length) * 100 : 0}%`;
  $('#progText').textContent = `ประเมินแล้ว ${done}/${items.length} ข้อ`;
}

function changed() {
  dirty = true;
  updateProgress();
  if (D.adminView || D.status === 'submitted') {
    $('#saveState').textContent = 'มีการแก้ไขที่ยังไม่บันทึก';
    return;
  }
  $('#saveState').textContent = 'กำลังบันทึก…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDraft(false), 1200);
}

function payload() {
  return { answers: S.answers, sectionComments: S.sectionComments, overallComment: S.overallComment, profile: S.profile };
}

async function saveDraft(manual) {
  clearTimeout(saveTimer);
  try {
    await api('PUT', `/api/e/${encodeURIComponent(token)}/draft`, payload());
    dirty = false;
    $('#saveState').textContent = `บันทึกร่างอัตโนมัติแล้ว ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
    if (manual) toast('บันทึกร่างแล้ว ท่านสามารถกลับมาทำต่อได้ด้วยลิงก์เดิม');
  } catch (e) {
    $('#saveState').textContent = 'บันทึกไม่สำเร็จ';
    toast(e.message, true);
  }
}

window.addEventListener('beforeunload', (e) => {
  if (!dirty) return;
  if (!D.adminView && D.status !== 'submitted') {
    fetch(`/api/e/${encodeURIComponent(token)}/draft`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()), keepalive: true,
    });
  } else {
    e.preventDefault();
    e.returnValue = '';
  }
});

function markMissing() {
  const missing = allItems().filter((i) => !isComplete(i.id));
  $$('tr.item').forEach((r) => r.classList.remove('missing'));
  missing.forEach((i) => $(`#row-${i.id}`)?.classList.add('missing'));
  return missing;
}

function openSign() {
  const missing = markMissing();
  if (!String(S.profile.name || '').trim()) {
    toast('กรุณากรอกชื่อผู้ประเมินในตอนที่ 1', true);
    $('#p-name').focus();
    return;
  }
  if (missing.length) {
    toast(`ยังประเมินไม่ครบ ${missing.length} ข้อ (แถวสีแดง)`, true);
    $(`#row-${missing[0].id}`).scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  let pad;
  modal(
    `<h2>ลงนามอิเล็กทรอนิกส์</h2>
     <p class="small muted">โปรดลงลายมือชื่อในกรอบด้านล่างด้วยเมาส์ นิ้ว หรือปากกาสไตลัส</p>
     <div class="sig-pad-wrap"><canvas id="sigCanvas" aria-label="กรอบลงลายมือชื่อ"></canvas><div class="hint">ลงลายมือชื่อเหนือเส้นนี้</div></div>
     <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="sm" id="sigClear">ล้างลายเซ็น</button></div>
     <div class="field" style="margin-top:10px"><label for="sigName">ชื่อ-นามสกุลผู้ลงนาม (ตัวบรรจง)</label>
       <input type="text" id="sigName" value="${esc(S.profile.name || '')}"></div>
     <label class="check" style="margin-top:12px;align-items:flex-start"><input type="checkbox" id="sigConsent" style="margin-top:5px">
       <span>ข้าพเจ้ายืนยันว่าได้พิจารณาและให้ความเห็นในแบบประเมินนี้ด้วยตนเอง และยินยอมให้ใช้ลายมือชื่ออิเล็กทรอนิกส์นี้แทนการลงลายมือชื่อบนเอกสาร
       (ตาม พ.ร.บ.ว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544) หลังส่งแล้วจะไม่สามารถแก้ไขได้ด้วยตนเอง</span></label>
     <div class="actions"><button data-close>ยกเลิก</button><button class="primary" id="sigSubmit">ยืนยันลงนามและส่ง</button></div>`,
    {
      onMount: (m, close) => {
        pad = new SignaturePad($('#sigCanvas', m));
        $('#sigClear', m).addEventListener('click', () => pad.clear());
        $('#sigSubmit', m).addEventListener('click', async () => {
          if (pad.isEmpty()) return toast('กรุณาลงลายมือชื่อ', true);
          if (!$('#sigName', m).value.trim()) return toast('กรุณาพิมพ์ชื่อ-นามสกุลผู้ลงนาม', true);
          if (!$('#sigConsent', m).checked) return toast('กรุณาทำเครื่องหมายยืนยันการลงนาม', true);
          const btn = $('#sigSubmit', m);
          btn.disabled = true;
          btn.textContent = 'กำลังส่ง…';
          try {
            clearTimeout(saveTimer);
            D = await api('POST', `/api/e/${encodeURIComponent(token)}/submit`, {
              ...payload(), signerName: $('#sigName', m).value.trim(), signature: pad.toDataURL(), consent: true,
            });
            dirty = false;
            pad.destroy();
            close(true);
            editable = false;
            render();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            toast('ส่งแบบประเมินเรียบร้อยแล้ว ขอบพระคุณครับ/ค่ะ');
          } catch (e) {
            btn.disabled = false;
            btn.textContent = 'ยืนยันลงนามและส่ง';
            toast(e.message, true);
            if (e.data?.missing) {
              close(false);
              e.data.missing.forEach((id) => $(`#row-${id}`)?.classList.add('missing'));
            }
          }
        });
      },
    }
  ).then(() => pad?.destroy());
}

async function adminSave() {
  const reason = await modal(
    `<h2>บันทึกการแก้ไขโดยผู้ดูแล</h2>
     <div class="field"><label for="why">เหตุผลการแก้ไข (บันทึกในประวัติ)</label><textarea id="why" rows="3" placeholder="เช่น ผู้เชี่ยวชาญแจ้งแก้ไขข้อ 5 ทางโทรศัพท์"></textarea></div>
     <div class="actions"><button data-close>ยกเลิก</button><button class="primary" id="ok">บันทึก</button></div>`,
    { onMount: (m, close) => $('#ok', m).addEventListener('click', () => close($('#why', m).value.trim() || '(ไม่ระบุ)')) }
  );
  if (reason == null) return;
  try {
    await api('PUT', `/api/admin/assignments/${D.assignmentId}/response`, { ...payload(), reason });
    dirty = false;
    $('#saveState').textContent = 'บันทึกแล้ว';
    toast('บันทึกการแก้ไขแล้ว');
    await load();
  } catch (e) {
    toast(e.message, true);
  }
}
