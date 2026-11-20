'use strict';
/* global $, $$, esc, api, toast, thDate, fmt2, modal, confirmBox, copyText */

const view = $('#view');
const STATUS = {
  pending: ['ยังไม่เปิด', ''],
  draft: ['กำลังประเมิน', 'warn'],
  submitted: ['ลงนามส่งแล้ว', 'ok'],
};
let settingsCache = null;
/** ไอคอนประจำชุดเครื่องมือ (ตามระยะการวิจัย Smart Campus · IoB · Avatar · Happy Org) */
const INST_ICON = {
  '01': ['🏫', 'องค์ประกอบวิทยาลัยอัจฉริยะ · IoB · อวตาร'],
  '02': ['😊', 'ตัวบ่งชี้องค์กรแห่งความสุข'],
  '03': ['🧩', 'สถาปัตยกรรมระบบ'],
  '04': ['🤖', 'แพลตฟอร์มและอวตารโอภาปราศรัย'],
  '05': ['🧠', 'โมเดลการจัดการ'],
  '06': ['💜', 'องค์กรแห่งความสุข'],
  '07': ['⭐', 'ความพึงพอใจ'],
};

// ======================= boot & routing =======================
(async function boot() {
  const [me, ex] = await Promise.all([api('GET', '/api/admin/me'), api('GET', '/api/expert/me')]);
  if (me.admin) {
    if (location.pathname !== '/admin') history.replaceState(null, '', '/admin' + location.hash);
    $('#topbar').classList.remove('hidden');
    window.addEventListener('hashchange', route);
    return route();
  }
  if (ex.expert) return showExpertHome(ex);
  showLogin();
})();

$('#logout').addEventListener('click', async () => {
  await api('POST', '/api/admin/logout');
  location.href = '/';
});

let loginRole = 'expert';
async function showLogin() {
  let info = {};
  try {
    info = await api('GET', '/api/public/info');
  } catch { /* แสดงหน้าเข้าสู่ระบบได้แม้ไม่มีข้อมูลงานวิจัย */ }
  document.title = 'การประเมินเครื่องมือ' + (info.thesisTitle ? ` - ${info.thesisTitle}` : '');
  if (location.pathname === '/admin') loginRole = 'admin';
  let remembered = '';
  try { remembered = localStorage.getItem('eval.login') || ''; } catch { /* ไม่มี storage */ }

  let mode = 'login'; // login | register
  let flash = '';
  const hero = () => authHero(info, { extra: info.instrumentCount ? `<div class="auth-chip" style="background:rgba(127,227,216,.18)">เครื่องมือวิจัยที่เปิดรับการประเมิน ${info.instrumentCount} ชุด</div>` : '' });

  /** ลงทะเบียนครั้งแรก: เลือกชื่อ → กรอกอีเมล เบอร์โทร รหัสผ่าน → บันทึก → กลับไปเข้าสู่ระบบ */
  const drawRegister = async () => {
    let names = [];
    try {
      names = await api('GET', '/api/public/experts');
    } catch { /* แสดงข้อความด้านล่าง */ }
    const panel = `
      ${avatarGreet('ยินดีที่ได้รู้จัก 😊<span>กรอกข้อมูลเพียง 3 ขั้นตอน ก็พร้อมเริ่มประเมินได้เลย</span>')}
      <h2>กรอกข้อมูลเพื่อเข้าสู่ระบบ</h2>
      <p class="lead">สำหรับผู้เชี่ยวชาญที่เข้าใช้ครั้งแรก เลือกชื่อของท่าน กรอกอีเมล เบอร์โทรศัพท์ และตั้งรหัสผ่าน</p>
      <div class="reg-steps"><span class="on">1 เลือกชื่อ</span><span>2 กรอกข้อมูล</span><span>3 บันทึก</span></div>
      <div class="auth-err" id="err" role="alert"></div>
      ${names.length ? `<form id="rf" novalidate>
        <div class="ifield"><label for="rname">ชื่อ-นามสกุล</label>
          <div class="ibox">${ICON.user}<select id="rname" required>
            <option value="">— เลือกชื่อของท่าน —</option>
            ${names.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}</select></div>
          <div class="ihint">ไม่พบชื่อของท่าน? หากเคยลงทะเบียนแล้ว ให้กลับไปเข้าสู่ระบบ หรือติดต่อผู้วิจัย</div></div>
        ${ifield({ id: 'rem2', label: 'อีเมล', icon: 'mail', type: 'email', placeholder: 'name@example.com', autocomplete: 'email' })}
        ${ifield({ id: 'rph', label: 'เบอร์โทรศัพท์ (10 หลัก)', icon: 'phone', type: 'tel', placeholder: '0812345678', autocomplete: 'tel', attrs: 'inputmode="numeric" maxlength="10"' })}
        ${ifield({ id: 'rpw', label: 'ตั้งรหัสผ่าน', icon: 'lock', type: 'password', autocomplete: 'new-password', hint: 'อย่างน้อย 8 ตัวอักษร' })}
        <div class="pw-meter" style="margin:-8px 0 14px"><span id="meter"></span></div>
        ${ifield({ id: 'rpw2', label: 'ยืนยันรหัสผ่าน', icon: 'lock', type: 'password', autocomplete: 'new-password' })}
        <label class="check" style="align-items:flex-start;font-size:.88rem;margin:4px 0 8px"><input type="checkbox" id="rconsent" style="margin-top:4px">
          <span>ข้าพเจ้ายืนยันว่าเป็นบุคคลตามชื่อที่เลือก และยินยอมให้ผู้วิจัยเก็บข้อมูลติดต่อและผลการประเมินเพื่อใช้ในงานวิจัยนี้</span></label>
        <button class="primary auth-btn" type="submit" id="rgo">บันทึก</button>
      </form>` : `<div class="auth-help">${ICON.info}<div>ผู้เชี่ยวชาญทุกท่านลงทะเบียนเรียบร้อยแล้ว กรุณากลับไปเข้าสู่ระบบ หรือติดต่อผู้วิจัยหากลืมรหัสผ่าน</div></div>`}
      <button type="button" class="auth-btn auth-btn-ghost" id="back">← กลับไปหน้าเข้าสู่ระบบ</button>`;
    authLayout(view, hero(), panel);
    bindEyes(view);
    $('#back').addEventListener('click', () => { mode = 'login'; draw(); });
    if (!names.length) return;
    const err = $('#err');
    const steps = $$('.reg-steps span');
    const mark = () => {
      const s = !$('#rname').value ? 0 : !($('#rem2').value && $('#rph').value && $('#rpw').value) ? 1 : 2;
      steps.forEach((x, i) => x.classList.toggle('on', i <= s));
    };
    $('#rf').addEventListener('input', mark);
    $('#rf').addEventListener('change', mark);
    bindPwMeter($('#rpw'), $('#meter'), $('#rpw-hint'));
    const ph = $('#rph');
    ph.addEventListener('input', () => (ph.value = ph.value.replace(/\D/g, '').slice(0, 10)));
    $('#rname').focus();
    $('#rf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        expertId: Number($('#rname').value), email: $('#rem2').value.trim(), phone: ph.value.trim(),
        password: $('#rpw').value, confirm: $('#rpw2').value, consent: $('#rconsent').checked,
      };
      const bad =
        (!body.expertId && ['rname', 'กรุณาเลือกชื่อของท่าน']) ||
        (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email) && ['rem2', 'กรุณากรอกอีเมลให้ถูกต้อง']) ||
        (!/^\d{10}$/.test(body.phone) && ['rph', 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก']) ||
        (body.password.length < 8 && ['rpw', 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร']) ||
        (body.password !== body.confirm && ['rpw2', 'ยืนยันรหัสผ่านไม่ตรงกัน']) ||
        (!body.consent && ['rconsent', 'กรุณาทำเครื่องหมายยืนยันและยินยอม']);
      if (bad) {
        showErr(err, bad[1]);
        return $('#' + bad[0]).focus();
      }
      showErr(err, '');
      const go = $('#rgo');
      go.disabled = true;
      go.textContent = 'กำลังบันทึก…';
      try {
        const r = await api('POST', '/api/public/register', body);
        remembered = r.login;
        mode = 'login';
        flash = 'บันทึกข้อมูลเรียบร้อยแล้ว กรุณาเข้าสู่ระบบอีกครั้งด้วยอีเมลหรือเบอร์โทรศัพท์และรหัสผ่านที่ตั้งไว้';
        draw();
      } catch (ex) {
        showErr(err, ex.message);
        go.disabled = false;
        go.textContent = 'บันทึก';
      }
    });
  };

  const draw = () => {
    if (loginRole === 'expert' && mode === 'register') return drawRegister();
    const isExp = loginRole === 'expert';
    const panel = `
      ${avatarGreet(isExp
        ? 'สวัสดี 🙏 ยินดีต้อนรับท่านผู้เชี่ยวชาญ<span>ขอบคุณที่ร่วมสร้างวิทยาลัยอัจฉริยะสู่องค์กรแห่งความสุข 💜</span>'
        : 'สวัสดี 🙏 ยินดีต้อนรับผู้วิจัย<span>พร้อมดูภาพรวมการประเมินเครื่องมือแล้ว</span>')}
      <h2>เข้าสู่ระบบ</h2>
      <p class="lead">${isExp ? 'เข้าสู่ระบบเพื่อประเมินเครื่องมือวิจัยที่ได้รับเชิญ' : 'สำหรับผู้วิจัย / ผู้ดูแลระบบ'}</p>
      <div class="seg" role="tablist">
        <button type="button" role="tab" data-role="expert" class="${isExp ? 'on' : ''}" aria-selected="${isExp}">${ICON.user.replace('<svg', '<svg width="16" height="16"')} ผู้เชี่ยวชาญ</button>
        <button type="button" role="tab" data-role="admin" class="${isExp ? '' : 'on'}" aria-selected="${!isExp}">${ICON.lock.replace('<svg', '<svg width="16" height="16"')} ผู้ดูแลระบบ</button>
      </div>
      ${flash && isExp ? `<div class="auth-ok" role="status">${esc(flash)}</div>` : ''}
      <div class="auth-err" id="err" role="alert"></div>
      <form id="lf" novalidate>
        ${isExp ? ifield({ id: 'login', label: 'อีเมล หรือ เบอร์โทรศัพท์', icon: 'mail', value: remembered, placeholder: 'name@example.com หรือ 0812345678', autocomplete: 'username', attrs: 'required' }) : ''}
        ${ifield({ id: 'pw', label: 'รหัสผ่าน', icon: 'lock', type: 'password', placeholder: '••••••••', autocomplete: 'current-password', attrs: 'required' })}
        ${isExp ? `<div class="auth-row"><label class="check"><input type="checkbox" id="rem" ${remembered ? 'checked' : ''}> จดจำอีเมล/เบอร์โทรในเครื่องนี้</label></div>` : ''}
        <button class="primary auth-btn" type="submit" id="go">เข้าสู่ระบบ</button>
      </form>
      ${isExp
        ? `<div class="auth-or"><span>เข้าใช้ครั้งแรก?</span></div>
           <button type="button" class="auth-btn auth-btn-ghost" id="toReg">${ICON.user.replace('<svg', '<svg width="18" height="18"')} คลิกกรอกข้อมูลเพื่อเข้าสู่ระบบ</button>
           <div class="auth-help">${ICON.info}<div>ผู้เชี่ยวชาญที่ยังไม่มีบัญชี: เลือกชื่อของท่าน กรอกอีเมล เบอร์โทรศัพท์ ตั้งรหัสผ่าน แล้วกดบันทึก จากนั้นเข้าสู่ระบบอีกครั้ง
           · หากลืมรหัสผ่าน กรุณาติดต่อผู้วิจัยเพื่อรีเซ็ต</div></div>`
        : `<div class="auth-help">${ICON.info}<div>สำหรับผู้วิจัยและผู้ดูแลระบบเท่านั้น ใช้จัดการแบบประเมิน ผู้เชี่ยวชาญ และดูผลการวิเคราะห์</div></div>`}`;
    authLayout(view, authHero(info, { extra: info.instrumentCount ? `<div class="auth-chip" style="background:rgba(127,227,216,.18)">เครื่องมือวิจัยที่เปิดรับการประเมิน ${info.instrumentCount} ชุด</div>` : '' }), panel);
    bindEyes(view);
    $$('[data-role]').forEach((b) => b.addEventListener('click', () => { loginRole = b.dataset.role; flash = ''; draw(); }));
    $('#toReg')?.addEventListener('click', () => { mode = 'register'; flash = ''; draw(); });
    const first = isExp && !remembered ? $('#login') : $('#pw');
    first.focus();
    $('#lf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#err');
      const go = $('#go');
      if (isExp && !$('#login').value.trim()) return showErr(err, 'กรุณากรอกอีเมลหรือเบอร์โทรศัพท์'), $('#login').focus();
      if (!$('#pw').value) return showErr(err, 'กรุณากรอกรหัสผ่าน'), $('#pw').focus();
      showErr(err, '');
      go.disabled = true;
      go.textContent = 'กำลังเข้าสู่ระบบ…';
      try {
        if (isExp) {
          const login = $('#login').value.trim();
          await api('POST', '/api/expert/login', { login, password: $('#pw').value });
          try { $('#rem').checked ? localStorage.setItem('eval.login', login) : localStorage.removeItem('eval.login'); } catch { /* ไม่มี storage */ }
          location.href = '/';
        } else {
          await api('POST', '/api/admin/login', { password: $('#pw').value });
          location.href = '/admin';
        }
      } catch (ex) {
        showErr(err, ex.message);
        go.disabled = false;
        go.textContent = 'เข้าสู่ระบบ';
        $('#pw').select();
      }
    });
  };
  draw();
}

// ======================= expert home =======================
/** ผู้เชี่ยวชาญแก้ไขข้อมูลส่วนตัว */
function editMyProfile(e, experienceOptions) {
  const opts = [...new Set([...(experienceOptions || []), e.experience].filter(Boolean))];
  return modal(
    `${avatarGreet('อัปเดตข้อมูลของท่านได้ที่นี่ ✨<span>ข้อมูลจะแสดงในแบบประเมินที่ยังไม่ได้ลงนาม</span>', { size: 56 })}
     <h2>แก้ไขข้อมูลส่วนตัว</h2>
     <div class="auth-err" id="perr" role="alert"></div>
     <form id="pf" class="grid cols-2" novalidate>
       <div class="field" style="grid-column:1/-1"><label for="p-name">ชื่อ-นามสกุล (พร้อมคำนำหน้า/ตำแหน่งทางวิชาการ) *</label><input type="text" id="p-name" value="${esc(e.name)}" autocomplete="name"></div>
       <div class="field"><label for="p-pos">ตำแหน่ง</label><input type="text" id="p-pos" value="${esc(e.position)}"></div>
       <div class="field"><label for="p-work">สถานที่ทำงาน / สังกัด</label><input type="text" id="p-work" value="${esc(e.workplace)}"></div>
       <div class="field"><label for="p-exp">ประสบการณ์การทำงาน</label><select id="p-exp"><option value="">— เลือก —</option>
         ${opts.map((o) => `<option ${o === e.experience ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
       <div class="field"><label for="p-skill">ความเชี่ยวชาญ</label><input type="text" id="p-skill" value="${esc(e.expertise)}" placeholder="เช่น ด้านการบริหารการศึกษา"></div>
       <div class="field"><label for="p-mail">อีเมล *</label><input type="email" id="p-mail" value="${esc(e.email)}" autocomplete="email"></div>
       <div class="field"><label for="p-tel">เบอร์โทรศัพท์ (10 หลัก) *</label><input type="tel" id="p-tel" value="${esc(e.phone)}" inputmode="numeric" maxlength="10" autocomplete="tel"></div>
     </form>
     <div class="actions"><button data-close>ยกเลิก</button><button class="primary" id="psave">บันทึกข้อมูล</button></div>`,
    {
      onMount: (m, close) => {
        const tel = $('#p-tel', m);
        tel.addEventListener('input', () => (tel.value = tel.value.replace(/\D/g, '').slice(0, 10)));
        const save = async () => {
          const body = {
            name: $('#p-name', m).value.trim(), position: $('#p-pos', m).value.trim(), workplace: $('#p-work', m).value.trim(),
            experience: $('#p-exp', m).value, expertise: $('#p-skill', m).value.trim(),
            email: $('#p-mail', m).value.trim(), phone: tel.value.trim(),
          };
          const bad =
            (!body.name && ['p-name', 'กรุณากรอกชื่อ-นามสกุล']) ||
            (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email) && ['p-mail', 'กรุณากรอกอีเมลให้ถูกต้อง']) ||
            (!/^\d{10}$/.test(body.phone) && ['p-tel', 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก']);
          if (bad) {
            showErr($('#perr', m), bad[1]);
            return $('#' + bad[0], m).focus();
          }
          const btn = $('#psave', m);
          btn.disabled = true;
          try {
            await api('PUT', '/api/expert/profile', body);
            try { if (localStorage.getItem('eval.login')) localStorage.setItem('eval.login', body.email); } catch { /* ไม่มี storage */ }
            close(true);
            toast('บันทึกข้อมูลส่วนตัวแล้ว');
            showExpertHome(await api('GET', '/api/expert/me'));
          } catch (err) {
            btn.disabled = false;
            showErr($('#perr', m), err.message);
          }
        };
        $('#psave', m).addEventListener('click', save);
        $('#pf', m).addEventListener('submit', (ev) => (ev.preventDefault(), save()));
      },
    }
  );
}
function showExpertHome({ expert, assignments, experienceOptions = [] }) {
  document.title = 'การประเมินเครื่องมือ - ' + expert.name;
  const btn = (a) =>
    !a.active && a.status !== 'submitted'
      ? '<span class="badge bad">ปิดรับการประเมิน</span>'
      : `<a class="btn ${a.status === 'submitted' ? '' : 'primary'}" href="/e/${esc(a.token)}">${
          a.status === 'submitted' ? 'ดูฉบับที่ลงนามแล้ว' : a.status === 'draft' ? 'ประเมินต่อ' : 'เริ่มประเมิน'
        }</a>`;
  view.innerHTML = `
  <div class="hello">
    <div class="row between">
      <div class="row" style="gap:16px;flex-wrap:nowrap"><div class="av-wrap hello-av">${AVATAR_SVG}</div>
        <div><span class="hello-chip">อวตารโอภาปราศรัย · ยินดีต้อนรับ</span><h1>สวัสดี 🙏 ${esc(expert.name)}</h1>
        <p>ขอบคุณที่ร่วมประเมินเครื่องมือวิจัย เพื่อวิทยาลัยอัจฉริยะสู่องค์กรแห่งความสุข 💜</p></div></div>
      <div class="row"><button class="sm btn" id="chpw">🔑 เปลี่ยนรหัสผ่าน</button><button class="sm btn" id="exOut">ออกจากระบบ</button></div>
    </div>
    <div class="row" style="margin-top:14px;gap:8px">
      ${(() => {
        const done = assignments.filter((a) => a.status === 'submitted').length;
        const pct = assignments.length ? Math.round((done / assignments.length) * 100) : 0;
        return `<div class="progress" style="flex:1;max-width:340px;background:rgba(255,255,255,.25)"><span style="width:${pct}%"></span></div>
          <span class="small">ส่งแล้ว ${done}/${assignments.length} ชุด</span>`;
      })()}
    </div>
  </div>
  <div class="card profile-card">
    <div class="row between" style="margin-bottom:10px">
      <h2 style="margin:0">👤 ข้อมูลส่วนตัว</h2>
      <button class="sm primary" id="editProfile">✏️ แก้ไขข้อมูลส่วนตัว</button>
    </div>
    <div class="pf-grid">
      ${[
        ['ชื่อ-นามสกุล', expert.name],
        ['ตำแหน่ง', expert.position],
        ['สถานที่ทำงาน / สังกัด', expert.workplace],
        ['ประสบการณ์การทำงาน', expert.experience],
        ['ความเชี่ยวชาญ', expert.expertise],
        ['อีเมล', expert.email],
        ['เบอร์โทรศัพท์', expert.phone],
      ].map(([k, v]) => `<div class="pf-item"><span>${k}</span><b>${v ? esc(v) : '<i class="muted" style="font-weight:400">ยังไม่ได้ระบุ</i>'}</b></div>`).join('')}
    </div>
    <p class="small muted" style="margin:10px 0 0">ข้อมูลนี้จะแสดงในตอนที่ 1 ของแบบประเมินที่ยังไม่ได้ลงนาม · อีเมลหรือเบอร์โทรศัพท์ใช้เป็นชื่อผู้ใช้ในการเข้าสู่ระบบ</p>
  </div>
  <h2>แบบประเมินที่ได้รับมอบหมาย (${assignments.length})</h2>
  ${assignments.length ? `<div class="grid cols-2">${assignments
    .map((a) => {
      const [st, cls] = STATUS[a.status] || [a.status, ''];
      const pct = a.total ? Math.min(100, Math.round((a.answered / a.total) * 100)) : 0;
      return `<div class="card">
        <div class="row between"><span class="badge info">${esc(a.code ? 'ชุดที่ ' + Number(a.code) : '')}${a.phase ? ' · ' + esc(a.phase) : ''}</span><span class="badge ${cls}">${st}</span></div>
        <h3 style="margin:8px 0 4px">${esc(a.title)}</h3>
        <div class="small muted" style="margin-bottom:10px">${esc(a.subtitle)}</div>
        <div class="row" style="margin-bottom:10px"><div class="progress" style="flex:1"><span style="width:${pct}%"></span></div><span class="small nowrap">${a.answered}/${a.total} ข้อ</span></div>
        ${a.status === 'submitted' ? `<div class="small muted" style="margin-bottom:8px">ลงนามส่งเมื่อ ${esc(thDate(a.submitted_at))}</div>` : ''}
        <div class="row">${btn(a)}${a.status === 'submitted' ? `<a class="btn sm" href="/api/e/${esc(a.token)}/form.docx">Word</a><a class="btn sm" href="/api/e/${esc(a.token)}/form.xlsx">Excel</a>` : ''}</div>
      </div>`;
    })
    .join('')}</div>` : '<div class="alert info">ยังไม่มีแบบประเมินที่มอบหมายให้ท่าน</div>'}`;
  $('#exOut').addEventListener('click', async () => {
    await api('POST', '/api/expert/logout');
    location.href = '/';
  });
  $('#editProfile').addEventListener('click', () => editMyProfile(expert, experienceOptions));
  $('#chpw').addEventListener('click', () =>
    modal(
      `<h2>เปลี่ยนรหัสผ่าน</h2>
       <div class="stack"><div class="field"><label for="cur">รหัสผ่านปัจจุบัน</label><input type="password" id="cur" autocomplete="current-password"></div>
       <div class="field"><label for="nw">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</label><input type="password" id="nw" autocomplete="new-password"></div></div>
       <div class="actions"><button data-close>ยกเลิก</button><button class="primary" id="ok">บันทึก</button></div>`,
      {
        onMount: (m, close) =>
          $('#ok', m).addEventListener('click', async () => {
            try {
              await api('POST', '/api/expert/password', { current: $('#cur', m).value, next: $('#nw', m).value });
              close();
              toast('เปลี่ยนรหัสผ่านแล้ว');
            } catch (err) {
              toast(err.message, true);
            }
          }),
      }
    )
  );
}

async function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || 'instruments').split('/');
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (parts[0] === 'instrument' ? 'instruments' : parts[0])));
  view.innerHTML = '<p class="muted">กำลังโหลด…</p>';
  try {
    if (parts[0] === 'instruments') await viewInstruments();
    else if (parts[0] === 'instrument') await viewInstrument(Number(parts[1]), parts[2] || 'assign');
    else if (parts[0] === 'experts') await viewExperts();
    else if (parts[0] === 'settings') await viewSettings();
    else if (parts[0] === 'audit') await viewAudit();
    else location.hash = '#/instruments';
  } catch (e) {
    if (e.status === 401) return location.reload();
    view.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`;
  }
}

async function getSettings() {
  if (!settingsCache) settingsCache = await api('GET', '/api/admin/settings');
  return settingsCache;
}

/** เรียก API ที่อาจต้องยืนยัน (409 needForce) */
async function apiForce(method, url, body) {
  try {
    return await api(method, url, body);
  } catch (e) {
    if (e.status === 409 && e.data?.needForce) {
      if (!(await confirmBox(e.message + '\n\nต้องการดำเนินการต่อหรือไม่?', { okText: 'ดำเนินการต่อ', danger: true }))) return null;
      const sep = url.includes('?') ? '&' : '?';
      return body && method !== 'DELETE' ? api(method, url, { ...body, force: true }) : api(method, url + sep + 'force=1', body);
    }
    throw e;
  }
}

// ======================= instruments list =======================
async function viewInstruments() {
  const [list, experts] = await Promise.all([api('GET', '/api/admin/instruments'), api('GET', '/api/admin/experts')]);
  const assigned = list.reduce((a, i) => a + i.assigned, 0);
  const submitted = list.reduce((a, i) => a + i.submitted, 0);
  const pctAll = assigned ? Math.round((submitted / assigned) * 100) : 0;
  const withAcc = experts.filter((e) => e.hasLogin).length;
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'สวัสดีตอนเช้า' : hr < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  view.innerHTML = `
  <div class="hello">
    <div class="row between">
      <div class="row" style="gap:16px;flex-wrap:nowrap"><div class="av-wrap hello-av">${AVATAR_SVG}</div>
        <div><span class="hello-chip">Smart Campus · IoB · AI Avatar</span><h1>${greet} 👋</h1><p>ภาพรวมการประเมินเครื่องมือวิจัย สู่วิทยาลัยอัจฉริยะและองค์กรแห่งความสุข 💜</p></div></div>
      <div class="row"><a class="btn" href="#/experts">👥 จัดการผู้เชี่ยวชาญ</a><button class="primary" id="newInst" style="background:#fff;color:var(--primary)">✦ สร้างแบบประเมินใหม่</button></div>
    </div>
  </div>
  <div class="grid cols-4" style="margin-bottom:16px">
    <div class="card stat"><div class="k"><i>🧪</i>เครื่องมือที่เปิดรับ</div><div class="v">${list.filter((i) => i.active).length}<small> / ${list.length} ชุด</small></div></div>
    <div class="card stat"><div class="k"><i>👥</i>ผู้เชี่ยวชาญ</div><div class="v">${experts.length}<small> คน · มีบัญชี ${withAcc}</small></div></div>
    <div class="card stat"><div class="k"><i>✍️</i>ลงนามส่งแล้ว</div><div class="v">${submitted}<small> / ${assigned} ฉบับ</small></div></div>
    <div class="card stat"><div class="k"><i>📈</i>ความคืบหน้ารวม</div><div class="v">${pctAll}<small>%</small></div>
      <div class="progress" style="margin-top:8px"><span style="width:${pctAll}%"></span></div></div>
  </div>
  <h2 style="margin:6px 0 12px">ชุดเครื่องมือวิจัย</h2>
  <div class="grid cols-2">
  ${list
    .map((i) => {
      const pct = i.assigned ? Math.round((i.submitted / i.assigned) * 100) : 0;
      const scales = [i.useIoc && 'IOC', i.useRating && esc(i.ratingLabel) + ' 5 ระดับ'].filter(Boolean).join(' + ');
      return `<a class="card" href="#/instrument/${i.id}" style="text-decoration:none;color:inherit;display:block">
        <div class="row between"><span class="badge info">${esc(i.code ? 'ชุดที่ ' + Number(i.code) : 'ไม่ระบุชุด')}${i.phase ? ' · ' + esc(i.phase) : ''}</span>
          ${i.active ? '' : '<span class="badge bad">ปิดรับ</span>'}${i.kind === 'survey' ? '<span class="badge">แบบสอบถามผู้ใช้</span>' : ''}</div>
        <div class="inst-head"><span class="inst-ic">${(INST_ICON[i.code] || ['📋'])[0]}</span>
          <div><div class="small muted">${esc((INST_ICON[i.code] || [, ''])[1])}</div><h3 style="margin:0">${esc(i.title)}</h3></div></div>
        <div class="small muted" style="margin-bottom:10px">${esc(i.subtitle)}</div>
        <div class="small">${i.itemCount} ข้อ · ${scales}</div>
        <div class="row" style="margin-top:8px"><div class="progress" style="flex:1"><span style="width:${pct}%"></span></div>
          <span class="small nowrap">ส่งแล้ว ${i.submitted}/${i.assigned} คน</span></div>
      </a>`;
    })
    .join('')}
  </div>`;
  $('#newInst').addEventListener('click', async () => {
    const r = await api('POST', '/api/admin/instruments', { title: 'แบบประเมินใหม่' });
    location.hash = `#/instrument/${r.id}/edit`;
  });
}

// ======================= instrument detail =======================
async function viewInstrument(id, tab) {
  const inst = await api('GET', `/api/admin/instruments/${id}`);
  const tabs = [
    ['assign', 'ผู้ประเมิน & ลิงก์'],
    ['results', 'ผลการวิเคราะห์'],
    ['edit', 'แก้ไขแบบประเมิน'],
  ];
  view.innerHTML = `
    <p class="small"><a href="#/instruments">← แบบประเมินทั้งหมด</a></p>
    <h1>${esc(inst.title)}</h1>
    <p class="muted" style="margin-top:-6px">${esc(inst.subtitle)}</p>
    <div class="tabs">${tabs.map(([k, t]) => `<a href="#/instrument/${id}/${k}" class="${k === tab ? 'active' : ''}">${t}</a>`).join('')}</div>
    <div id="tab"></div>`;
  const el = $('#tab');
  if (tab === 'results') await tabResults(inst, el);
  else if (tab === 'edit') await tabEdit(inst, el);
  else await tabAssign(inst, el);
}

// ---------- assign tab ----------
async function tabAssign(inst, el) {
  const [rows, experts] = await Promise.all([
    api('GET', `/api/admin/instruments/${inst.id}/assignments`),
    api('GET', '/api/admin/experts'),
  ]);
  const total = inst.sections.reduce((a, s) => a + s.groups.reduce((b, g) => b + g.items.length, 0), 0);
  const assigned = new Set(rows.map((r) => r.expert_id));
  const avail = experts.filter((e) => !assigned.has(e.id));
  const link = (t) => `${location.origin}/e/${t}`;

  el.innerHTML = `
  <div class="card">
    <div class="row between"><h2 style="margin:0">ผู้ประเมินแบบประเมินนี้ (${rows.length} คน)</h2>
      <div class="row"><button id="addExp" class="primary">+ เพิ่มผู้ประเมิน</button></div></div>
    <p class="small muted">ส่งลิงก์เฉพาะบุคคลให้ผู้เชี่ยวชาญแต่ละท่าน เมื่อเปิดลิงก์ครั้งแรก ผู้เชี่ยวชาญจะตั้งค่าบัญชี (อีเมล เบอร์โทรศัพท์ รหัสผ่าน) ก่อน แล้วจึงประเมิน เขียนความคิดเห็น และลงนามอิเล็กทรอนิกส์</p>
    ${rows.length ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>#</th><th>ผู้ประเมิน</th><th>สถานะ</th><th>ความคืบหน้า</th><th>ลงนาม</th><th>จัดการ</th></tr></thead>
      <tbody>${rows
        .map((r, i) => {
          const [st, cls] = STATUS[r.status] || [r.status, ''];
          const pct = total ? Math.min(100, Math.round((r.answered / total) * 100)) : 0;
          return `<tr>
          <td class="num">${i + 1}</td>
          <td><b>${esc(r.name)}</b><div class="small muted">${esc([r.position, r.workplace].filter(Boolean).join(' · '))}</div></td>
          <td><span class="badge ${cls}">${st}</span>${r.edited_after_sign ? ' <span class="badge bad" title="ผู้ดูแลแก้ไขหลังลงนาม">แก้ไขหลังลงนาม</span>' : ''}
            <div class="small muted">${r.opened_at ? 'เปิดครั้งแรก ' + esc(thDate(r.opened_at)) : ''}</div></td>
          <td style="min-width:120px"><div class="progress"><span style="width:${pct}%"></span></div><div class="small muted">${r.answered}/${total} ข้อ</div></td>
          <td class="small">${r.status === 'submitted' ? `${esc(r.signer_name)}<div class="muted">${esc(thDate(r.signed_at))}</div>` : '-'}</td>
          <td><div class="row" style="gap:4px">
            <button class="sm" data-copy="${esc(link(r.token))}">คัดลอกลิงก์</button>
            <a class="btn sm" href="/e/${esc(r.token)}?admin=1" target="_blank" rel="noopener">ดู/แก้ไข</a>
            ${r.status === 'submitted' ? `<a class="btn sm" href="/api/e/${esc(r.token)}/form.docx">Word</a>
              <a class="btn sm" href="/api/e/${esc(r.token)}/form.xlsx">Excel</a>
              <a class="btn sm" href="/e/${esc(r.token)}?admin=1&print=1" target="_blank" rel="noopener">PDF</a>
              <button class="sm" data-reopen="${r.id}">ส่งคืนให้แก้ไข</button>` : ''}
            <button class="sm ghost" data-relink="${r.id}" title="ยกเลิกลิงก์เดิมและสร้างใหม่">สร้างลิงก์ใหม่</button>
            <button class="sm danger" data-del="${r.id}">ลบ</button>
          </div></td></tr>`;
        })
        .join('')}</tbody></table></div>` : '<div class="alert info">ยังไม่มีผู้ประเมิน กด “+ เพิ่มผู้ประเมิน” เพื่อเลือกผู้เชี่ยวชาญ</div>'}
  </div>`;

  $$('[data-copy]', el).forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy)));
  $$('[data-reopen]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      if (!(await confirmBox('ส่งแบบประเมินคืนให้ผู้เชี่ยวชาญแก้ไข?\nลายมือชื่อเดิมจะถูกยกเลิก (เก็บประวัติไว้) และผู้เชี่ยวชาญต้องลงนามใหม่อีกครั้ง', { okText: 'ส่งคืน' }))) return;
      await api('POST', `/api/admin/assignments/${b.dataset.reopen}/reopen`);
      toast('ส่งคืนแล้ว');
      route();
    })
  );
  $$('[data-relink]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      if (!(await confirmBox('ลิงก์เดิมจะใช้ไม่ได้อีก ต้องการสร้างลิงก์ใหม่หรือไม่?'))) return;
      const r = await api('POST', `/api/admin/assignments/${b.dataset.relink}/regenerate-link`);
      await copyText(link(r.token));
      route();
    })
  );
  $$('[data-del]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      if (!(await confirmBox('ลบผู้ประเมินออกจากแบบประเมินนี้?', { danger: true, okText: 'ลบ' }))) return;
      if (await apiForce('DELETE', `/api/admin/assignments/${b.dataset.del}`)) {
        toast('ลบแล้ว');
        route();
      }
    })
  );
  $('#addExp').addEventListener('click', () => pickExperts(inst, avail));
}

function pickExperts(inst, avail) {
  modal(
    `<h2>เพิ่มผู้ประเมิน</h2>
     ${avail.length ? `<div class="row" style="margin-bottom:8px"><label class="check"><input type="checkbox" id="all"> เลือกทั้งหมด</label></div>
       <div class="stack" style="max-height:340px;overflow:auto">${avail
         .map((e) => `<label class="check"><input type="checkbox" value="${e.id}"> <span><b>${esc(e.name)}</b> <span class="small muted">${esc([e.position, e.workplace].filter(Boolean).join(' · '))}</span></span></label>`)
         .join('')}</div>` : '<p class="muted">ผู้เชี่ยวชาญทุกคนอยู่ในแบบประเมินนี้แล้ว</p>'}
     <div class="actions"><button id="newE">+ เพิ่มผู้เชี่ยวชาญคนใหม่</button><span style="flex:1"></span><button data-close>ยกเลิก</button><button class="primary" id="ok">เพิ่ม</button></div>`,
    {
      onMount: (m, close) => {
        $('#all', m)?.addEventListener('change', (e) => $$('input[value]', m).forEach((c) => (c.checked = e.target.checked)));
        $('#newE', m).addEventListener('click', async () => {
          close();
          if (await expertForm(null, { presetInstrument: inst.id })) route();
        });
        $('#ok', m).addEventListener('click', async () => {
          const ids = $$('input[value]:checked', m).map((c) => Number(c.value));
          if (!ids.length) return close();
          await api('POST', `/api/admin/instruments/${inst.id}/assignments`, { expertIds: ids });
          close();
          toast(`เพิ่มผู้ประเมิน ${ids.length} คนแล้ว`);
          route();
        });
      },
    }
  );
}

// ---------- results tab ----------
async function tabResults(inst, el) {
  const { results: R, comments, integrity, signers = [] } = await api('GET', `/api/admin/instruments/${inst.id}/results`);
  const st = R.settings;
  const passB = (p) => (p == null ? '-' : p ? '<span class="badge ok">ผ่าน</span>' : '<span class="badge bad">ไม่ผ่าน</span>');
  const exp = `/api/admin/instruments/${inst.id}/export.csv`;

  if (!R.n) {
    el.innerHTML = `<div class="alert info">ยังไม่มีผู้ประเมินลงนามส่งแบบประเมิน ผลการวิเคราะห์จะแสดงเมื่อมีผู้ส่งอย่างน้อย 1 คน</div>`;
    return;
  }
  const ov = R.overall;
  const cards = [
    `<div class="card"><div class="muted small">จำนวนผู้ประเมิน (n)</div><div style="font-size:1.8rem;font-weight:700">${R.n}</div>${R.n < 3 ? '<div class="small" style="color:var(--warn)">โดยทั่วไปควรมีผู้เชี่ยวชาญอย่างน้อย 3 คน (นิยมใช้ 3–5 คน)</div>' : ''}</div>`,
  ];
  if (inst.useIoc)
    cards.push(`<div class="card"><div class="muted small">IOC เฉลี่ยทั้งฉบับ</div><div style="font-size:1.8rem;font-weight:700">${fmt2(ov.ioc.meanIoc)}</div>
      <div class="small">ผ่านเกณฑ์ (≥ ${st.iocCriterion.toFixed(2)}) ${ov.ioc.passed}/${ov.ioc.total} ข้อ</div></div>`);
  if (inst.useRating)
    cards.push(`<div class="card"><div class="muted small">${esc(inst.ratingLabel)}ภาพรวม</div><div style="font-size:1.8rem;font-weight:700">x̄ = ${fmt2(ov.rating.mean)}</div>
      <div class="small">S.D. = ${fmt2(ov.rating.sd)} · ระดับ<b>${esc(ov.rating.level || '-')}</b></div></div>`);
  cards.push(`<div class="card"><div class="muted small">ข้อที่ผ่านเกณฑ์ทั้งหมด</div><div style="font-size:1.8rem;font-weight:700">${ov.itemsPassed}/${ov.itemsTotal}</div></div>`);

  const badInt = integrity.filter((x) => !x.ok || x.edited);
  const colsIoc = inst.useIoc ? 3 : 0;
  const colsRate = inst.useRating ? 4 : 0;

  const sumRow = (cls, label, ioc, r) => `<tr class="${cls}"><td colspan="2">${esc(label)}</td>
    ${inst.useIoc ? `<td class="num">-</td><td class="num">${fmt2(ioc?.meanIoc)}</td><td class="num small">ผ่าน ${ioc?.passed}/${ioc?.total}</td>` : ''}
    ${inst.useRating ? `<td class="num">${fmt2(r?.mean)}</td><td class="num">${fmt2(r?.sd)}</td><td class="num">${esc(r?.level || '-')}</td>` : ''}
    <td class="num">${inst.useRating ? passB(r?.pass) : ''}</td></tr>`;

  const tables = R.sections
    .map(
      (s) => `
    <div class="card">
      ${s.title ? `<h3>${esc(s.title)}</h3>` : ''}
      <div class="table-wrap"><table class="data">
      <thead><tr><th rowspan="2" style="width:46px">ข้อ</th><th rowspan="2">รายการประเมิน</th>
        ${inst.useIoc ? '<th colspan="3">ความสอดคล้อง (IOC)</th>' : ''}
        ${inst.useRating ? `<th colspan="3">${esc(inst.ratingLabel)}</th>` : ''}<th rowspan="2">ผล</th></tr>
        <tr>${inst.useIoc ? '<th>ΣR</th><th>IOC</th><th>แปลผล</th>' : ''}${inst.useRating ? '<th>x̄</th><th>S.D.</th><th>ระดับ</th>' : ''}</tr></thead>
      <tbody>
      ${s.groups
        .map(
          (g) => `${g.title ? `<tr class="group"><td colspan="${3 + colsIoc + colsRate}">${esc(g.title)}</td></tr>` : ''}
        ${g.items
          .map(
            (it) => `<tr><td class="num">${it.no}</td><td>${esc(it.text)}</td>
            ${inst.useIoc ? `<td class="num">${it.ioc.sumR}</td><td class="num">${fmt2(it.ioc.value)}</td><td class="num small">${it.ioc.pass == null ? '-' : it.ioc.pass ? 'ใช้ได้' : 'ปรับปรุง'}</td>` : ''}
            ${inst.useRating ? `<td class="num">${fmt2(it.rating.mean)}</td><td class="num">${fmt2(it.rating.sd)}</td><td class="num">${esc(it.rating.level || '-')}</td>` : ''}
            <td class="num">${passB(it.pass)}</td></tr>`
          )
          .join('')}
        ${g.title && g.items.length ? sumRow('sum', 'รวม' + g.title, g.ioc, g.rating) : ''}`
        )
        .join('')}
      ${R.sections.length > 1 ? sumRow('total', 'รวม' + (s.title || 'ส่วนนี้'), s.ioc, s.rating) : ''}
      </tbody></table></div>
    </div>`
    )
    .join('');

  // ตารางคะแนนรายผู้เชี่ยวชาญ
  const E = R.experts;
  const matrix = (k) => `<div class="table-wrap"><table class="data"><thead><tr><th>ส่วน/ข้อ</th>${E.map((e, i) => `<th title="${esc(e.name)}">คนที่ ${i + 1}</th>`).join('')}
      ${k === 'ioc' ? '<th>ΣR</th><th>IOC</th>' : '<th>x̄</th><th>S.D.</th>'}</tr></thead><tbody>
      ${R.sections
        .map((s, si) =>
          s.groups
            .flatMap((g) => g.items)
            .map(
              (it) => `<tr><td class="nowrap">${R.sections.length > 1 ? `ส่วนที่ ${si + 1} ` : ''}ข้อ ${it.no}</td>
              ${it.perExpert.map((p) => `<td class="num">${p[k] == null ? '-' : k === 'ioc' && p[k] > 0 ? '+' + p[k] : p[k]}</td>`).join('')}
              ${k === 'ioc' ? `<td class="num">${it.ioc.sumR}</td><td class="num">${fmt2(it.ioc.value)}</td>` : `<td class="num">${fmt2(it.rating.mean)}</td><td class="num">${fmt2(it.rating.sd)}</td>`}</tr>`
            )
            .join('')
        )
        .join('')}</tbody></table></div>
      <p class="small muted">${E.map((e, i) => `คนที่ ${i + 1} = ${esc(e.name)}`).join(' · ')}</p>`;

  el.innerHTML = `
  <div class="row between no-print" style="margin-bottom:12px">
    <div class="row">
      <a class="btn primary" href="/api/admin/instruments/${inst.id}/results.xlsx" title="สรุปผล, IOC รายคน, คะแนนรายคน, ข้อมูลดิบ, ความคิดเห็น">⬇ Excel</a>
      <a class="btn primary" href="/api/admin/instruments/${inst.id}/results.docx" title="ตารางสำหรับใส่ในวิทยานิพนธ์">⬇ Word</a>
      <button id="print" title="เลือกปลายทาง “บันทึกเป็น PDF” ในหน้าต่างพิมพ์">🖨 PDF / พิมพ์</button>
    </div>
    <details><summary class="small">ไฟล์ CSV</summary><div class="row" style="margin-top:6px">
      <a class="btn sm" href="${exp}?type=summary">สรุปผล</a>
      <a class="btn sm" href="${exp}?type=raw">ข้อมูลดิบ (SPSS)</a>
      <a class="btn sm" href="${exp}?type=comments">ความคิดเห็น</a></div></details>
  </div>
  ${badInt.length ? `<div class="alert bad"><b>ตรวจพบเอกสารที่ไม่ตรงกับตอนลงนาม:</b> ${badInt
    .map((x) => `${esc(x.name)} (${x.edited ? 'ผู้ดูแลแก้ไขคำตอบหลังลงนาม' : 'ข้อความ/คำตอบเปลี่ยนแปลงหลังลงนาม'})`)
    .join(', ')}<div class="small">ผลยังคำนวณจากข้อมูลปัจจุบัน หากต้องการให้ผู้เชี่ยวชาญยืนยันใหม่ ใช้ปุ่ม “ส่งคืนให้แก้ไข”</div></div>`
    : `<div class="alert ok small">ตรวจสอบลายมือชื่ออิเล็กทรอนิกส์ ${integrity.length} ฉบับ: ข้อมูลตรงกับตอนลงนามทั้งหมด (SHA-256)</div>`}
  <div class="grid cols-3">${cards.join('')}</div>
  ${tables}
  <div class="card"><div class="table-wrap"><table class="data">${sumRow('total', 'ภาพรวมทั้งฉบับ', ov.ioc, ov.rating)}</table></div></div>
  <div class="card">
    <h3>เกณฑ์และสูตรที่ใช้คำนวณ</h3>
    <ul class="small">
      ${inst.useIoc ? `<li><b>IOC = ΣR / N</b> (Rovinelli & Hambleton) — R = คะแนนของผู้เชี่ยวชาญ (+1, 0, −1), N = จำนวนผู้เชี่ยวชาญ; ข้อที่ IOC ≥ ${st.iocCriterion.toFixed(2)} ถือว่าใช้ได้</li>` : ''}
      ${inst.useRating ? `<li><b>x̄ = Σx / n</b>, <b>S.D. = √[Σ(x − x̄)² / (n − 1)]</b> (S.D. ของกลุ่มตัวอย่าง เทียบเท่า STDEV.S ใน Excel และ SPSS)</li>
      <li>แปลความหมาย: ${st.levels.map((l, i) => `${l.toFixed(2)}–${i ? (st.levels[i - 1] - 0.01).toFixed(2) : '5.00'} = ${esc(st.labels[i])}`).join(' · ')}</li>
      <li>เกณฑ์ผ่าน: x̄ ≥ ${st.ratingCriterion.toFixed(2)}${st.sdMax != null ? ` และ S.D. ≤ ${Number(st.sdMax).toFixed(2)} (ความเห็นสอดคล้องกัน)` : ''}</li>
      <li>ค่ารวมรายด้าน/ภาพรวม: ${st.aggMethod === 'pooled' ? 'นำคะแนนดิบทุกค่าในด้านมาคำนวณ x̄ และ S.D.' : 'หาค่าเฉลี่ยของผู้ประเมินแต่ละคนในด้านนั้นก่อน แล้วหา x̄ และ S.D. ข้ามผู้ประเมิน'} (เปลี่ยนได้ที่หน้าตั้งค่า)</li>` : ''}
      <li>ทุกค่าคำนวณจากข้อมูลจริงทศนิยมเต็ม แล้วปัดแสดง 2 ตำแหน่ง การแปลความหมายใช้ค่าที่ปัดแล้วเพื่อให้ตรงกับตัวเลขที่แสดง</li>
    </ul>
  </div>
  <div class="card sign-card">
    <h3>รายชื่อผู้เชี่ยวชาญและลายมือชื่อ (${signers.length})</h3>
    <div class="table-wrap"><table class="data">
      <thead><tr><th style="width:56px">คนที่</th><th>ชื่อ-นามสกุล / ตำแหน่ง / สังกัด</th><th style="width:220px">ลายมือชื่อ</th><th style="width:170px">วันที่ลงนาม</th></tr></thead>
      <tbody>${signers
        .map((s) => {
          const bad = integrity.find((x) => x.id === s.id && (!x.ok || x.edited));
          return `<tr>
          <td class="num">${s.no}</td>
          <td><b>${esc(s.name)}</b>${s.position ? `<div class="small">${esc(s.position)}</div>` : ''}${s.workplace ? `<div class="small muted">${esc(s.workplace)}</div>` : ''}</td>
          <td style="text-align:center">${s.signature ? `<img src="${s.signature}" alt="ลายมือชื่อ ${esc(s.name)}" style="max-width:190px;max-height:64px;display:block;margin:0 auto">` : '-'}
            <div class="small muted">( ${esc(s.signerName)} )</div>${bad ? '<span class="badge bad">ไม่ตรงกับตอนลงนาม</span>' : ''}</td>
          <td class="num small">${esc(thDate(s.signedAt))}</td></tr>`;
        })
        .join('')}</tbody></table></div>
    <p class="small muted" style="margin:8px 0 0">ลายมือชื่ออิเล็กทรอนิกส์ตาม พ.ร.บ.ว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544 · ลำดับ “คนที่” ตรงกับตารางคะแนนรายผู้เชี่ยวชาญ</p>
  </div>
  <details class="card"><summary><b>ตารางคะแนนรายผู้เชี่ยวชาญ</b> (สำหรับภาคผนวก)</summary>
    ${inst.useIoc ? `<h3 style="margin-top:12px">ความสอดคล้อง (IOC)</h3>${matrix('ioc')}` : ''}
    ${inst.useRating ? `<h3 style="margin-top:12px">${esc(inst.ratingLabel)}</h3>${matrix('rating')}` : ''}
  </details>
  <div class="card"><h3>ความคิดเห็นและข้อเสนอแนะของผู้เชี่ยวชาญ (${comments.length})</h3>
    ${comments.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>ผู้ประเมิน</th><th>ตำแหน่งในแบบประเมิน</th><th>ความคิดเห็น</th></tr></thead><tbody>
      ${comments.map((c) => `<tr><td class="nowrap">${esc(c.expert)}</td><td class="small">${esc(c.where)}</td><td style="white-space:pre-wrap">${esc(c.text)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">ไม่มีความคิดเห็น</p>'}
  </div>`;
  $('#print').addEventListener('click', () => {
    $$('details', el).forEach((d) => (d.open = true));
    window.print();
  });
}

// ---------- edit tab ----------
async function tabEdit(inst, el) {
  const sections = JSON.parse(JSON.stringify(inst.sections));
  const labels = [...inst.ratingLabels];
  while (labels.length < 5) labels.push('');

  el.innerHTML = `
  <div class="card">
    <div class="row between"><h2 style="margin:0">ข้อมูลแบบประเมิน</h2>
      <div class="row"><button id="dup">ทำสำเนา</button><button class="danger" id="delInst">ลบแบบประเมิน</button></div></div>
    <form id="meta" class="grid cols-2" style="margin-top:12px">
      <div class="field"><label>รหัสชุด</label><input type="text" name="code" value="${esc(inst.code || '')}" placeholder="เช่น 01"></div>
      <div class="field"><label>ระยะการวิจัย</label><input type="text" name="phase" value="${esc(inst.phase || '')}" placeholder="เช่น ระยะที่ 1"></div>
      <div class="field" style="grid-column:1/-1"><label>ชื่อแบบประเมิน</label><input type="text" name="title" value="${esc(inst.title)}" required></div>
      <div class="field" style="grid-column:1/-1"><label>คำอธิบายใต้ชื่อ</label><textarea name="subtitle" rows="2">${esc(inst.subtitle || '')}</textarea></div>
      <div class="field" style="grid-column:1/-1"><label>คำชี้แจงการตอบ</label><textarea name="instructions" rows="2">${esc(inst.instructions || '')}</textarea></div>
      <div class="field"><label>มาตรวัด</label>
        <label class="check"><input type="checkbox" name="useIoc" ${inst.useIoc ? 'checked' : ''}> ความสอดคล้อง IOC (+1 / 0 / −1)</label>
        <label class="check"><input type="checkbox" name="useRating" ${inst.useRating ? 'checked' : ''}> มาตราส่วนประมาณค่า 5 ระดับ</label></div>
      <div class="field"><label>ประเภท</label><select name="kind">
        <option value="expert" ${inst.kind === 'expert' ? 'selected' : ''}>แบบประเมินโดยผู้เชี่ยวชาญ</option>
        <option value="survey" ${inst.kind === 'survey' ? 'selected' : ''}>แบบสอบถามผู้ใช้/กลุ่มตัวอย่าง</option></select>
        <label class="check"><input type="checkbox" name="active" ${inst.active ? 'checked' : ''}> เปิดรับการประเมิน</label></div>
      <div class="field"><label>ชื่อมาตรวัด 5 ระดับ</label><input type="text" name="ratingLabel" value="${esc(inst.ratingLabel || '')}" placeholder="เช่น ความเหมาะสม"></div>
      <div class="field"><label>ความหมายระดับ 5 → 1</label><div class="grid" style="grid-template-columns:repeat(5,1fr);gap:4px">
        ${labels.map((l, i) => `<input type="text" data-label="${i}" value="${esc(l)}" title="ระดับ ${5 - i}" aria-label="ระดับ ${5 - i}">`).join('')}</div></div>
      <div style="grid-column:1/-1"><button class="primary" type="submit">บันทึกข้อมูลแบบประเมิน</button></div>
    </form>
  </div>
  <div class="card">
    <h2>เอกสาร/ภาพประกอบ</h2>
    <p class="small muted">เช่น ภาพสถาปัตยกรรมหรือโมเดลที่ให้ผู้เชี่ยวชาญพิจารณา (PNG, JPG, WEBP, PDF ไม่เกิน 10 MB)</p>
    ${inst.attachment ? (/\.pdf$/i.test(inst.attachment) ? `<p><a href="/uploads/${esc(inst.attachment)}" target="_blank">เปิดไฟล์ PDF</a></p>` : `<img src="/uploads/${esc(inst.attachment)}" style="max-width:100%;max-height:300px;border:1px solid var(--border);border-radius:8px" alt="">`) : '<p class="muted">ยังไม่มีไฟล์</p>'}
    <div class="row" style="margin-top:8px"><input type="file" id="file" accept="image/png,image/jpeg,image/webp,application/pdf">
      ${inst.attachment ? '<button class="danger sm" id="rmFile">ลบไฟล์</button>' : ''}</div>
  </div>
  <div class="card">
    <div class="row between"><h2 style="margin:0">รายการประเมิน</h2><button class="primary" id="saveStruct">บันทึกรายการประเมิน</button></div>
    <p class="small muted">แก้ไขข้อความได้โดยตรง ใช้ปุ่ม ↑ ↓ เพื่อจัดลำดับ หมายเลขข้อจะเรียงใหม่อัตโนมัติในแต่ละส่วน การแก้ไขข้อความหลังผู้เชี่ยวชาญลงนามแล้วจะถูกตรวจพบในผลการตรวจสอบลายมือชื่อ</p>
    <div id="ed"></div>
    <button id="addSec" style="margin-top:6px">+ เพิ่มส่วน</button>
  </div>`;

  // ----- meta -----
  $('#meta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      code: f.code.value, phase: f.phase.value, title: f.title.value, subtitle: f.subtitle.value, instructions: f.instructions.value,
      useIoc: f.useIoc.checked, useRating: f.useRating.checked, kind: f.kind.value, active: f.active.checked,
      ratingLabel: f.ratingLabel.value, ratingLabels: $$('[data-label]', f).map((i) => i.value.trim()),
    };
    if (!body.useIoc && !body.useRating) return toast('ต้องเลือกมาตรวัดอย่างน้อย 1 แบบ', true);
    await api('PUT', `/api/admin/instruments/${inst.id}`, body);
    toast('บันทึกแล้ว');
    route();
  });
  $('#dup').addEventListener('click', async () => {
    const r = await api('POST', `/api/admin/instruments/${inst.id}/duplicate`);
    toast('ทำสำเนาแล้ว');
    location.hash = `#/instrument/${r.id}/edit`;
  });
  $('#delInst').addEventListener('click', async () => {
    if (!(await confirmBox(`ลบ “${inst.title}” พร้อมรายการประเมินและลิงก์ผู้ประเมินทั้งหมด?`, { danger: true, okText: 'ลบ' }))) return;
    if (await apiForce('DELETE', `/api/admin/instruments/${inst.id}`)) location.hash = '#/instruments';
  });
  $('#file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('ไฟล์ใหญ่เกิน 10 MB', true);
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        await api('POST', `/api/admin/instruments/${inst.id}/attachment`, { dataUrl: rd.result });
        toast('อัปโหลดแล้ว');
        route();
      } catch (err) {
        toast(err.message, true);
      }
    };
    rd.readAsDataURL(file);
  });
  $('#rmFile')?.addEventListener('click', async () => {
    await api('DELETE', `/api/admin/instruments/${inst.id}/attachment`);
    route();
  });

  // ----- structure editor -----
  const ed = $('#ed');
  const tools = (kind, path, len) => {
    const last = path[path.length - 1];
    return `<div class="ed-tools">
      <button type="button" class="sm" data-act="up" data-kind="${kind}" data-path="${path}" ${last === 0 ? 'disabled' : ''} title="เลื่อนขึ้น">↑</button>
      <button type="button" class="sm" data-act="down" data-kind="${kind}" data-path="${path}" ${last === len - 1 ? 'disabled' : ''} title="เลื่อนลง">↓</button>
      <button type="button" class="sm danger" data-act="del" data-kind="${kind}" data-path="${path}" title="ลบ">✕</button></div>`;
  };
  function draw() {
    ed.innerHTML = sections
      .map((s, si) => {
        let no = 0;
        return `<div class="ed-section">
        <div class="row" style="flex-wrap:nowrap"><input type="text" data-f="title" data-path="${si}" value="${esc(s.title)}" placeholder="ชื่อส่วน (เว้นว่างได้ถ้ามีส่วนเดียว)">${tools('sec', [si], sections.length)}</div>
        ${s.groups
          .map(
            (g, gi) => `<div class="ed-group">
            <div class="row" style="flex-wrap:nowrap"><input type="text" data-f="title" data-path="${si},${gi}" value="${esc(g.title)}" placeholder="ชื่อด้าน/องค์ประกอบ" style="font-weight:600">${tools('grp', [si, gi], s.groups.length)}</div>
            <textarea data-f="description" data-path="${si},${gi}" rows="1" placeholder="คำอธิบายด้าน (ถ้ามี)" style="margin-top:6px;min-height:34px">${esc(g.description || '')}</textarea>
            ${g.items
              .map(
                (it, ii) => `<div class="ed-item"><span class="n">${++no}</span>
                <textarea data-f="text" data-path="${si},${gi},${ii}" rows="1">${esc(it.text)}</textarea>${tools('item', [si, gi, ii], g.items.length)}</div>`
              )
              .join('')}
            <button type="button" class="sm" data-act="addItem" data-path="${si},${gi}">+ เพิ่มข้อ</button>
          </div>`
          )
          .join('')}
        <button type="button" class="sm" data-act="addGrp" data-path="${si}">+ เพิ่มด้าน/องค์ประกอบ</button>
      </div>`;
      })
      .join('');
    $$('textarea', ed).forEach(autoGrow);
  }
  const at = (path) => {
    const p = String(path).split(',').map(Number);
    if (p.length === 1) return sections[p[0]];
    if (p.length === 2) return sections[p[0]].groups[p[1]];
    return sections[p[0]].groups[p[1]].items[p[2]];
  };
  const parentList = (kind, p) => (kind === 'sec' ? sections : kind === 'grp' ? sections[p[0]].groups : sections[p[0]].groups[p[1]].items);
  ed.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.f) return;
    at(t.dataset.path)[t.dataset.f] = t.value;
    if (t.tagName === 'TEXTAREA') autoGrow(t);
  });
  ed.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const p = String(b.dataset.path).split(',').map(Number);
    const act = b.dataset.act;
    if (act === 'addItem') sections[p[0]].groups[p[1]].items.push({ text: '' });
    else if (act === 'addGrp') sections[p[0]].groups.push({ title: '', description: '', items: [{ text: '' }] });
    else {
      const list = parentList(b.dataset.kind, p);
      const i = p[p.length - 1];
      if (act === 'del') {
        const what = { sec: 'ส่วนนี้ พร้อมด้านและข้อทั้งหมด', grp: 'ด้านนี้ พร้อมข้อทั้งหมด', item: 'ข้อนี้' }[b.dataset.kind];
        if (!(await confirmBox(`ลบ${what}? (ยังไม่บันทึกจนกว่าจะกด “บันทึกรายการประเมิน”)`, { danger: true, okText: 'ลบ' }))) return;
        list.splice(i, 1);
      } else {
        const j = act === 'up' ? i - 1 : i + 1;
        [list[i], list[j]] = [list[j], list[i]];
      }
    }
    draw();
  });
  $('#addSec').addEventListener('click', () => {
    sections.push({ title: '', groups: [{ title: '', description: '', items: [{ text: '' }] }] });
    draw();
  });
  $('#saveStruct').addEventListener('click', async () => {
    const empty = sections.some((s) => s.groups.some((g) => g.items.some((i) => !String(i.text).trim())));
    if (empty) return toast('มีข้อที่ยังไม่ได้กรอกข้อความ', true);
    try {
      const r = await apiForce('PUT', `/api/admin/instruments/${inst.id}/structure`, { sections });
      if (r) {
        toast('บันทึกรายการประเมินแล้ว');
        route();
      }
    } catch (err) {
      toast(err.message, true);
    }
  });
  draw();
}

function autoGrow(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 2 + 'px';
}

// ======================= experts =======================
async function viewExperts() {
  const list = await api('GET', '/api/admin/experts');
  view.innerHTML = `
  <div class="row between" style="margin-bottom:14px"><h1 style="margin:0">ผู้เชี่ยวชาญ (${list.length})</h1>
    <div class="row"><a class="btn" href="/api/admin/experts/credentials.xlsx" title="ชื่อ อีเมล รหัสผ่าน ของผู้เชี่ยวชาญทุกคน">⬇ รหัสเข้าระบบ (Excel)</a>
      <button id="imp">⬆ นำเข้าจาก Excel</button><button class="primary" id="add">+ เพิ่มผู้เชี่ยวชาญ</button></div></div>
  <div class="card">${list.length ? `<div class="table-wrap"><table class="data">
    <thead><tr><th>#</th><th>ชื่อ</th><th>ตำแหน่ง / สถานที่ทำงาน</th><th>ความเชี่ยวชาญ</th><th>ติดต่อ</th><th>ชุดเครื่องมือ</th><th>บัญชีเข้าระบบ</th><th></th></tr></thead>
    <tbody>${list
      .map(
        (e, i) => `<tr><td class="num">${i + 1}</td><td><b>${esc(e.name)}</b>${e.experience ? `<div class="small muted">ประสบการณ์ ${esc(e.experience)}</div>` : ''}</td>
        <td class="small">${esc(e.position)}<div class="muted">${esc(e.workplace)}</div></td><td class="small">${esc(e.expertise)}</td>
        <td class="small">${esc(e.email)}<div>${esc(e.phone)}</div></td>
        <td>${e.sets.length ? `<div class="row" style="gap:4px">${e.sets
          .map((x) => `<a href="#/instrument/${x.instrument_id}/assign" class="badge ${STATUS[x.status]?.[1] || ''}" style="text-decoration:none" title="${esc(STATUS[x.status]?.[0] || '')}">ชุด ${Number(x.code) || x.instrument_id}</a>`)
          .join('')}</div><div class="small muted">ส่งแล้ว ${e.submitted}/${e.assigned}</div>` : '<span class="small muted">ยังไม่เลือก</span>'}</td>
        <td class="small">${e.hasLogin ? `<span class="badge ok">เปิดใช้</span><div class="muted">${e.last_login ? 'เข้าล่าสุด ' + esc(thDate(e.last_login)) : 'ยังไม่เคยเข้า'}</div>` : '<span class="badge">ยังไม่ตั้ง</span>'}</td>
        <td><div class="row" style="gap:4px;flex-wrap:nowrap">${e.hasStoredPw ? `<button class="sm" data-viewpw="${e.id}">ดูรหัส</button>` : ''}<button class="sm" data-pw="${e.id}">${e.hasLogin ? 'รีเซ็ตรหัส' : 'ตั้งรหัสเข้าระบบ'}</button><button class="sm" data-edit="${e.id}">แก้ไข</button><button class="sm danger" data-del="${e.id}">ลบ</button></div></td></tr>`
      )
      .join('')}</tbody></table></div>` : '<p class="muted">ยังไม่มีผู้เชี่ยวชาญ</p>'}</div>`;
  $('#add').addEventListener('click', async () => (await expertForm(null)) && route());
  $('#imp').addEventListener('click', async () => (await importExperts()) && route());
  $$('[data-edit]').forEach((b) => b.addEventListener('click', async () => (await expertForm(list.find((e) => e.id === Number(b.dataset.edit)))) && route()));
  $$('[data-pw]').forEach((b) =>
    b.addEventListener('click', async () => {
      const e = list.find((x) => x.id === Number(b.dataset.pw));
      if (e.hasLogin && !(await confirmBox(`รีเซ็ตรหัสผ่านของ “${e.name}”?\nรหัสเดิมจะใช้ไม่ได้ทันที`, { okText: 'รีเซ็ต' }))) return;
      try {
        const r = await api('POST', `/api/admin/experts/${e.id}/password`);
        await showCredentials(e, r);
        route();
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
  $$('[data-viewpw]').forEach((b) =>
    b.addEventListener('click', async () => {
      const e = list.find((x) => x.id === Number(b.dataset.viewpw));
      try {
        await showCredentials(e, await api('GET', `/api/admin/experts/${e.id}/password`));
      } catch (err) {
        toast(err.message, true);
        route();
      }
    })
  );
  $$('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const e = list.find((x) => x.id === Number(b.dataset.del));
      if (!(await confirmBox(`ลบผู้เชี่ยวชาญ “${e.name}”?`, { danger: true, okText: 'ลบ' }))) return;
      if (await apiForce('DELETE', `/api/admin/experts/${e.id}`)) {
        toast('ลบแล้ว');
        route();
      }
    })
  );
}

function showCredentials(e, r) {
  const ids = [r.email && `อีเมล: ${r.email}`, r.phone && `หรือเบอร์โทรศัพท์: ${r.phone}`].filter(Boolean).join('\n');
  const msg = `เรียน ${e.name}\nขอเรียนเชิญประเมินเครื่องมือวิจัย ผ่านระบบการประเมินเครื่องมือ\nเว็บไซต์: ${location.origin}/\n${ids}\nรหัสผ่าน: ${r.password}`;
  return modal(
    `<h2>ข้อมูลเข้าสู่ระบบของผู้เชี่ยวชาญ</h2>
     <div class="alert info small">ระบบเก็บรหัสนี้ไว้แบบเข้ารหัสแล้ว เรียกดูได้อีกด้วยปุ่ม “ดูรหัส” หรือดาวน์โหลด “รหัสเข้าระบบ (Excel)”
       (หากผู้เชี่ยวชาญเปลี่ยนรหัสเอง สำเนานี้จะถูกลบ)</div>
     <textarea id="msg" rows="6" readonly>${esc(msg)}</textarea>
     <div class="actions"><button class="primary" id="cp">คัดลอกข้อความ</button><button data-close>ปิด</button></div>`,
    { onMount: (m) => $('#cp', m).addEventListener('click', () => copyText(msg)) }
  );
}

/** นำเข้ารายชื่อผู้เชี่ยวชาญจาก Excel/CSV: เลือกไฟล์ → ดูตัวอย่าง → ยืนยัน */
async function importExperts() {
  const insts = await api('GET', '/api/admin/instruments');
  let file = null;
  let preview = null;
  const ST = { new: ['ใหม่', 'ok'], duplicate: ['ซ้ำกับในระบบ', 'warn'], 'duplicate-in-file': ['ซ้ำในไฟล์', 'warn'] };
  return modal(
    `<h2>นำเข้ารายชื่อผู้เชี่ยวชาญจาก Excel</h2>
     <p class="small muted">รองรับไฟล์ .xlsx และ .csv ระบบหาหัวตารางอัตโนมัติ (ชื่อ, ตำแหน่ง, สังกัด, ความเชี่ยวชาญ, ช่องทางการติดต่อ, อีเมล, โทรศัพท์ ...)
       แปลงรหัสความเชี่ยวชาญ (เช่น D1–D5) ตามตารางคำอธิบายในไฟล์ และแยกอีเมล/เบอร์โทรออกจากช่องทางการติดต่อ
       · <a href="/api/admin/experts/template.xlsx">ดาวน์โหลดแบบฟอร์มตัวอย่าง</a></p>
     <input type="file" id="xf" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv">
     <div id="pv" style="margin-top:12px"></div>
     <div class="actions"><button data-close>ยกเลิก</button><button class="primary" id="go" disabled>นำเข้า</button></div>`,
    {
      wide: true,
      onMount: (m, close) => {
        const pv = $('#pv', m);
        const go = $('#go', m);
        const count = () => {
          if (!preview) return 0;
          const skip = $('#skipDup', m)?.checked ?? true;
          return preview.rows.filter((r) => r.status === 'new' || !skip).length;
        };
        const updBtn = () => {
          const n = count();
          go.disabled = !n;
          go.textContent = `นำเข้า ${n} รายชื่อ`;
        };
        $('#xf', m).addEventListener('change', (ev) => {
          const f = ev.target.files[0];
          if (!f) return;
          if (f.size > 10 * 1024 * 1024) return toast('ไฟล์ใหญ่เกิน 10 MB', true);
          const rd = new FileReader();
          rd.onload = async () => {
            file = { dataUrl: rd.result, filename: f.name };
            pv.innerHTML = '<p class="muted">กำลังอ่านไฟล์…</p>';
            try {
              preview = await api('POST', '/api/admin/experts/import', { ...file, commit: false });
            } catch (err) {
              preview = null;
              pv.innerHTML = `<div class="alert bad">${esc(err.message)}</div>`;
              return updBtn();
            }
            const nDup = preview.rows.filter((r) => r.status !== 'new').length;
            const nNoMail = preview.rows.filter((r) => !r.email).length;
            pv.innerHTML = `
              <div class="small" style="margin-bottom:6px">พบ <b>${preview.rows.length}</b> รายชื่อ
                · คอลัมน์ที่จับคู่ได้: ${Object.entries(preview.header).map(([k, v]) => `${esc(v)}`).join(', ')}
                ${Object.keys(preview.legend).length ? ` · รหัส: ${Object.entries(preview.legend).map(([k, v]) => `${esc(k)}=${esc(v)}`).join(', ')}` : ''}</div>
              ${nNoMail ? `<div class="alert warn small">${nNoMail} รายชื่อไม่มีอีเมล — นำเข้าได้ แต่ต้องเพิ่มอีเมลภายหลังก่อนตั้งรหัสเข้าระบบ (หรือใช้ลิงก์เฉพาะบุคคลแทน)</div>` : ''}
              <div class="table-wrap" style="max-height:330px;overflow:auto"><table class="data small">
                <thead><tr><th>แถว</th><th>สถานะ</th><th>ชื่อ</th><th>ตำแหน่ง / สังกัด</th><th>ความเชี่ยวชาญ</th><th>อีเมล / โทร</th><th>หมายเหตุ</th></tr></thead>
                <tbody>${preview.rows
                  .map((r) => `<tr><td class="num">${r.line}</td><td><span class="badge ${ST[r.status][1]}">${ST[r.status][0]}</span></td>
                    <td><b>${esc(r.name)}</b></td><td>${esc(r.position)}<div class="muted">${esc(r.workplace)}</div></td><td>${esc(r.expertise)}</td>
                    <td>${esc(r.email) || '<span class="muted">-</span>'}<div>${esc(r.phone)}</div></td>
                    <td style="overflow-wrap:anywhere">${esc(r.note)}</td></tr>`)
                  .join('')}</tbody></table></div>
              ${nDup ? `<label class="check" style="margin-top:8px"><input type="checkbox" id="skipDup" checked> ข้ามรายชื่อที่ซ้ำ (${nDup} รายชื่อ)</label>` : ''}
              <div class="field" style="margin-top:10px"><label>มอบหมายชุดเครื่องมือให้รายชื่อที่นำเข้า (ไม่บังคับ — เลือกภายหลังได้)</label>
                <div class="row" style="gap:12px">${insts
                  .map((i) => `<label class="check"><input type="checkbox" name="iset" value="${i.id}"> ${esc(i.code ? 'ชุดที่ ' + Number(i.code) : i.title)}</label>`)
                  .join('')}</div></div>`;
            $('#skipDup', m)?.addEventListener('change', updBtn);
            updBtn();
          };
          rd.readAsDataURL(f);
        });
        go.addEventListener('click', async () => {
          go.disabled = true;
          try {
            const r = await api('POST', '/api/admin/experts/import', {
              ...file, commit: true, skipDuplicates: $('#skipDup', m)?.checked ?? true,
              instrumentIds: $$('input[name=iset]:checked', m).map((c) => Number(c.value)),
            });
            toast(`นำเข้าแล้ว ${r.added} รายชื่อ${r.skipped ? ` · ข้าม ${r.skipped}` : ''}`);
            close(true);
          } catch (err) {
            go.disabled = false;
            toast(err.message, true);
          }
        });
      },
    }
  );
}

async function expertForm(e, { presetInstrument } = {}) {
  const [s, insts] = await Promise.all([getSettings(), api('GET', '/api/admin/instruments')]);
  const v = e || {};
  const cur = new Map((v.sets || []).map((x) => [x.instrument_id, x]));
  const setBoxes = insts
    .map((i) => {
      const a = cur.get(i.id);
      const checked = a || i.id === presetInstrument;
      const locked = a?.status === 'submitted';
      const st = a ? STATUS[a.status] : null;
      return `<label class="check" style="align-items:flex-start;padding:4px 0">
        <input type="checkbox" name="set" value="${i.id}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''} style="margin-top:5px">
        <span><b>${esc(i.code ? 'ชุดที่ ' + Number(i.code) : 'ไม่ระบุชุด')}</b> ${esc(i.title)}
          ${st ? `<span class="badge ${st[1]}">${st[0]}</span>` : ''}${!i.active ? ' <span class="badge bad">ปิดรับ</span>' : ''}
          <div class="small muted">${esc(i.subtitle)}</div></span></label>`;
    })
    .join('');
  return modal(
    `<h2>${e ? 'แก้ไขข้อมูลผู้เชี่ยวชาญ' : 'เพิ่มผู้เชี่ยวชาญ'}</h2>
    <form id="ef" class="grid cols-2">
      <div class="field" style="grid-column:1/-1"><label>ชื่อ-นามสกุล (พร้อมคำนำหน้า/ตำแหน่งทางวิชาการ) *</label><input type="text" name="name" value="${esc(v.name)}" required placeholder="เช่น รองศาสตราจารย์ ดร.สมชาย ใจดี"></div>
      <div class="field"><label>ตำแหน่ง</label><input type="text" name="position" value="${esc(v.position)}"></div>
      <div class="field"><label>สถานที่ทำงาน</label><input type="text" name="workplace" value="${esc(v.workplace)}"></div>
      <div class="field"><label>ประสบการณ์การทำงาน</label><select name="experience"><option value="">-</option>
        ${(s.experienceOptions || []).map((o) => `<option ${v.experience === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
      <div class="field"><label>ความเชี่ยวชาญ</label><input type="text" name="expertise" value="${esc(v.expertise)}" placeholder="เช่น ด้านการบริหารการศึกษา"></div>
      <div class="field"><label>อีเมล</label><input type="email" name="email" value="${esc(v.email)}"></div>
      <div class="field"><label>โทรศัพท์ (10 หลัก)</label><input type="tel" name="phone" value="${esc(v.phone)}" inputmode="numeric" maxlength="10" pattern="[0-9]{10}" placeholder="0812345678" title="ตัวเลข 10 หลัก"></div>
      <div class="field" style="grid-column:1/-1"><label>หมายเหตุ</label><textarea name="note" rows="2">${esc(v.note)}</textarea></div>
      <div class="field" style="grid-column:1/-1">
        <div class="row between"><label>ชุดเครื่องมือที่ให้ประเมิน</label>
          <span class="row" style="gap:4px"><button type="button" class="sm" id="setAll">เลือกทั้งหมด</button><button type="button" class="sm" id="setNone">ไม่เลือก</button></span></div>
        <div style="max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px 10px">${setBoxes}</div>
        <span class="small muted">ชุดที่ลงนามส่งแล้วจะถูกล็อกไว้ (ลบได้จากหน้าแบบประเมินชุดนั้น)</span>
      </div>
    </form>
    <p class="small muted">ข้อมูลนี้จะแสดงเป็นค่าเริ่มต้นในตอนที่ 1 ของแบบประเมิน ผู้เชี่ยวชาญแก้ไขได้ก่อนลงนาม</p>
    <div class="actions"><button data-close>ยกเลิก</button><button class="primary" id="ok">บันทึก</button></div>`,
    {
      onMount: (m, close) => {
        // โทรศัพท์: รับเฉพาะตัวเลข ไม่เกิน 10 หลัก
        const ph = $('input[name=phone]', m);
        ph.addEventListener('input', () => (ph.value = ph.value.replace(/\D/g, '').slice(0, 10)));
        const boxes = () => $$('input[name=set]:not(:disabled)', m);
        $('#setAll', m).addEventListener('click', () => boxes().forEach((c) => (c.checked = true)));
        $('#setNone', m).addEventListener('click', () => boxes().forEach((c) => (c.checked = false)));
        const go = async () => {
          const f = $('#ef', m);
          const fd = new FormData(f);
          fd.delete('set');
          const body = Object.fromEntries(fd);
          if (!body.name.trim()) return toast('กรุณาระบุชื่อ', true);
          if (body.phone && !/^\d{10}$/.test(body.phone)) {
            ph.focus();
            return toast('เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก', true);
          }
          // รวมชุดที่ถูกล็อก (ลงนามแล้ว) ไว้ด้วยเสมอ
          const instrumentIds = $$('input[name=set]', m).filter((c) => c.checked).map((c) => Number(c.value));
          try {
            const r = e ? await api('PUT', `/api/admin/experts/${e.id}`, body) : await api('POST', '/api/admin/experts', body);
            const sr = await apiForce('PUT', `/api/admin/experts/${r.id}/sets`, { instrumentIds });
            toast(sr ? `บันทึกแล้ว${sr.added ? ` · เพิ่ม ${sr.added} ชุด` : ''}${sr.removed ? ` · เอาออก ${sr.removed} ชุด` : ''}` : 'บันทึกข้อมูลแล้ว (ชุดเครื่องมือไม่เปลี่ยน)');
            close(r.id);
          } catch (err) {
            toast(err.message, true);
          }
        };
        $('#ok', m).addEventListener('click', go);
        $('#ef', m).addEventListener('submit', (ev) => (ev.preventDefault(), go()));
      },
    }
  );
}

// ======================= settings =======================
async function viewSettings() {
  settingsCache = null;
  const s = await getSettings();
  view.innerHTML = `
  <h1>ตั้งค่า</h1>
  <form id="sf">
  <div class="card"><h2>ข้อมูลงานวิจัย (แสดงบนหัวแบบประเมิน)</h2>
    <div class="grid">
      <div class="field"><label>ชื่อหัวข้อวิทยานิพนธ์</label><textarea name="thesisTitle" rows="2">${esc(s.thesisTitle)}</textarea></div>
      <div class="field"><label>ผู้วิจัย</label><textarea name="researcher" rows="2">${esc(s.researcher)}</textarea></div>
      <div class="grid cols-2">
        <div class="field"><label>อาจารย์ที่ปรึกษาหลัก</label><input type="text" name="advisor" value="${esc(s.advisor)}"></div>
        <div class="field"><label>อาจารย์ที่ปรึกษาร่วม</label><input type="text" name="coAdvisor" value="${esc(s.coAdvisor)}"></div>
      </div>
      <div class="field"><label>ข้อความขอบคุณท้ายแบบประเมิน</label><input type="text" name="thanks" value="${esc(s.thanks)}"></div>
      <div class="field"><label>ตัวเลือกประสบการณ์การทำงาน (คั่นด้วยเครื่องหมาย | )</label><input type="text" name="experienceOptions" value="${esc((s.experienceOptions || []).join(' | '))}"></div>
    </div>
  </div>
  <div class="card"><h2>เกณฑ์การวิเคราะห์ข้อมูล</h2>
    <div class="grid cols-3">
      <div class="field"><label>เกณฑ์ IOC ขั้นต่ำ</label><input type="number" step="0.01" min="-1" max="1" name="iocCriterion" value="${s.iocCriterion}"></div>
      <div class="field"><label>เกณฑ์ค่าเฉลี่ยขั้นต่ำ (x̄)</label><input type="number" step="0.01" min="1" max="5" name="ratingCriterion" value="${s.ratingCriterion}"></div>
      <div class="field"><label>S.D. สูงสุดที่ยอมรับ (เว้นว่าง = ไม่ใช้)</label><input type="number" step="0.01" min="0" name="sdMax" value="${s.sdMax ?? ''}"></div>
    </div>
    <div class="field" style="margin-top:12px"><label>ขอบล่างของระดับ 5 → 1 (ค่าเฉลี่ยที่ปัดทศนิยม 2 ตำแหน่ง)</label>
      <div class="grid" style="grid-template-columns:repeat(5,minmax(0,1fr));gap:6px">${s.levels.map((l, i) => `<input type="number" step="0.01" data-level="${i}" value="${l}" aria-label="ระดับ ${5 - i}">`).join('')}</div>
      <span class="small muted">ค่าตั้งต้น 4.51 / 3.51 / 2.51 / 1.51 / 1.00 (บุญชม ศรีสะอาด, 2545)</span></div>
    <div class="field" style="margin-top:12px"><label>วิธีคำนวณ S.D. รายด้านและภาพรวม</label>
      <label class="check"><input type="radio" name="aggMethod" value="respondent" ${s.aggMethod !== 'pooled' ? 'checked' : ''}> หาค่าเฉลี่ยรายบุคคลในด้านก่อน แล้วหา x̄, S.D. ข้ามผู้ประเมิน (แบบ Compute ใน SPSS)</label>
      <label class="check"><input type="radio" name="aggMethod" value="pooled" ${s.aggMethod === 'pooled' ? 'checked' : ''}> รวมคะแนนดิบทุกค่าในด้าน แล้วหา x̄, S.D.</label>
      <span class="small muted">ค่า x̄ เท่ากันทั้งสองวิธีเมื่อข้อมูลครบ ต่างกันเฉพาะ S.D. — เลือกให้ตรงกับที่ระบุในบทที่ 3 ของวิทยานิพนธ์</span></div>
  </div>
  <button class="primary" type="submit">บันทึกการตั้งค่า</button>
  </form>
  <div class="card" style="margin-top:16px"><h2>รหัสผ่านผู้ดูแล</h2>
    ${s.envPassword ? '<p class="muted">กำหนดผ่านตัวแปร ADMIN_PASSWORD</p>' : `<form id="pf" class="grid cols-3">
      <div class="field"><label>รหัสผ่านปัจจุบัน</label><input type="password" name="current" autocomplete="current-password"></div>
      <div class="field"><label>รหัสผ่านใหม่ (≥ 8 ตัว)</label><input type="password" name="next" autocomplete="new-password"></div>
      <div class="field" style="justify-content:flex-end"><button type="submit">เปลี่ยนรหัสผ่าน</button></div></form>`}
  </div>
  <div class="card"><h2>สำรองข้อมูล</h2><a class="btn" href="/api/admin/backup.json">⬇ ดาวน์โหลดข้อมูลทั้งหมด (JSON)</a>
    <p class="small muted">ฐานข้อมูลหลักอยู่ที่ไฟล์ data/eval.sqlite สามารถคัดลอกไฟล์นี้เก็บไว้ได้</p></div>`;

  $('#sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      thesisTitle: f.thesisTitle.value, researcher: f.researcher.value, advisor: f.advisor.value, coAdvisor: f.coAdvisor.value,
      thanks: f.thanks.value,
      experienceOptions: f.experienceOptions.value.split('|').map((x) => x.trim()).filter(Boolean),
      iocCriterion: f.iocCriterion.value, ratingCriterion: f.ratingCriterion.value, sdMax: f.sdMax.value,
      aggMethod: f.aggMethod.value, levels: $$('[data-level]', f).map((i) => Number(i.value)),
    };
    try {
      await api('PUT', '/api/admin/settings', body);
      settingsCache = null;
      toast('บันทึกการตั้งค่าแล้ว');
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('#pf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/admin/password', { current: e.target.current.value, next: e.target.next.value });
      e.target.reset();
      toast('เปลี่ยนรหัสผ่านแล้ว');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ======================= audit =======================
const ACTIONS = {
  login: 'เข้าสู่ระบบ', 'settings.update': 'แก้ไขการตั้งค่า', 'password.change': 'เปลี่ยนรหัสผ่าน',
  'instrument.create': 'สร้างแบบประเมิน', 'instrument.update': 'แก้ไขข้อมูลแบบประเมิน', 'instrument.structure': 'แก้ไขรายการประเมิน',
  'instrument.duplicate': 'ทำสำเนาแบบประเมิน', 'instrument.delete': 'ลบแบบประเมิน', 'instrument.attachment': 'อัปโหลดไฟล์ประกอบ',
  'instrument.attachment.remove': 'ลบไฟล์ประกอบ', 'expert.create': 'เพิ่มผู้เชี่ยวชาญ', 'expert.update': 'แก้ไขผู้เชี่ยวชาญ',
  'expert.delete': 'ลบผู้เชี่ยวชาญ', 'assignment.create': 'มอบหมายผู้ประเมิน', 'assignment.delete': 'ลบผู้ประเมินออกจากแบบประเมิน',
  'expert.password.view': 'ผู้ดูแลเรียกดูรหัสผู้เชี่ยวชาญ', 'expert.password.export': 'ดาวน์โหลดรหัสเข้าระบบ (Excel)',
  'expert.profile': 'ผู้เชี่ยวชาญแก้ไขข้อมูลส่วนตัว', 'expert.account.setup': 'ผู้เชี่ยวชาญตั้งค่าบัญชี',
  'expert.import': 'นำเข้ารายชื่อจาก Excel', 'expert.sets': 'กำหนดชุดเครื่องมือของผู้เชี่ยวชาญ',
  'expert.login': 'ผู้เชี่ยวชาญเข้าสู่ระบบ', 'expert.password': 'ผู้เชี่ยวชาญเปลี่ยนรหัสผ่าน',
  'expert.password.reset': 'ตั้ง/รีเซ็ตรหัสผู้เชี่ยวชาญ', 'expert.password.revoke': 'ยกเลิกบัญชีผู้เชี่ยวชาญ',
  'assignment.reopen': 'ส่งคืนให้แก้ไข', 'assignment.relink': 'สร้างลิงก์ใหม่', 'response.edit': 'ผู้ดูแลแก้ไขคำตอบ', submit: 'ผู้เชี่ยวชาญลงนามส่ง',
};
async function viewAudit() {
  const rows = await api('GET', '/api/admin/audit?limit=500');
  view.innerHTML = `<h1>ประวัติการแก้ไข</h1><div class="card"><div class="table-wrap"><table class="data">
    <thead><tr><th>เวลา</th><th>ผู้ทำรายการ</th><th>รายการ</th><th>รายละเอียด</th></tr></thead><tbody>
    ${rows
      .map((r) => {
        let d = r.detail;
        try {
          const o = JSON.parse(r.detail);
          if (o && typeof o === 'object') {
            delete o.before;
            delete o.after;
            d = Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
          }
        } catch { /* keep raw */ }
        return `<tr><td class="small nowrap">${esc(thDate(r.at))}</td><td>${r.actor === 'admin' ? 'ผู้ดูแล' : 'ผู้เชี่ยวชาญ'}</td>
          <td>${esc(ACTIONS[r.action] || r.action)}</td><td class="small" style="max-width:520px;overflow-wrap:anywhere">${esc(d)}</td></tr>`;
      })
      .join('')}</tbody></table></div></div>`;
}
