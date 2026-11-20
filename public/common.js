'use strict';
/* eslint-disable no-unused-vars */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `เกิดข้อผิดพลาด (${res.status})`);
    err.status = res.status;
    err.data = data || {};
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg, isErr = false) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), isErr ? 5000 : 2500);
}

/** วันที่แบบไทย (พ.ศ.) */
function thDate(iso, withTime = true) {
  if (!iso) return '-';
  const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return iso;
  const opt = { year: 'numeric', month: 'long', day: 'numeric' };
  if (withTime) Object.assign(opt, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('th-TH', opt);
}

function fmt2(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return '-';
  return (Math.round((x + Number.EPSILON) * 100) / 100).toFixed(2);
}

function modal(html, { onMount, wide } = {}) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${wide ? 'max-width:900px' : ''}">${html}</div>`;
    document.body.appendChild(back);
    const close = (v) => {
      back.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => e.key === 'Escape' && close(null);
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', (e) => e.target === back && close(null));
    $$('[data-close]', back).forEach((b) => b.addEventListener('click', () => close(null)));
    onMount?.(back.firstElementChild, close);
    back.querySelector('input,textarea,select')?.focus();
  });
}

function confirmBox(message, { okText = 'ยืนยัน', danger = false } = {}) {
  return modal(
    `<h2>ยืนยัน</h2><p style="white-space:pre-wrap">${esc(message)}</p>
     <div class="actions"><button data-close>ยกเลิก</button><button class="${danger ? 'danger' : 'primary'}" id="ok">${esc(okText)}</button></div>`,
    { onMount: (m, close) => $('#ok', m).addEventListener('click', () => close(true)) }
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('คัดลอกแล้ว');
  } catch {
    prompt('คัดลอกลิงก์นี้', text);
  }
}

// ======================= ส่วนประกอบหน้าเข้าสู่ระบบ =======================
const ICON = {
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
};

/** ช่องกรอกพร้อมไอคอน (และปุ่มแสดง/ซ่อนรหัสผ่าน) */
function ifield({ id, label, icon, type = 'text', value = '', placeholder = '', autocomplete = '', hint = '', attrs = '' }) {
  const isPw = type === 'password';
  return `<div class="ifield"><label for="${id}">${esc(label)}</label>
    <div class="ibox">${ICON[icon] || ''}<input id="${id}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"
      ${autocomplete ? `autocomplete="${autocomplete}"` : ''} ${attrs}>
      ${isPw ? `<button type="button" class="eye" data-eye="${id}" aria-label="แสดงรหัสผ่าน">${ICON.eye}</button>` : ''}</div>
    ${hint ? `<div class="ihint" id="${id}-hint">${hint}</div>` : ''}</div>`;
}
function bindEyes(root = document) {
  $$('[data-eye]', root).forEach((b) =>
    b.addEventListener('click', () => {
      const inp = $('#' + b.dataset.eye, root);
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.innerHTML = show ? ICON.eyeOff : ICON.eye;
      b.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
    })
  );
}
/** แถบความแข็งแรงของรหัสผ่าน */
function bindPwMeter(input, bar, label) {
  const colors = ['#d92d20', '#f79009', '#eab308', '#12b76a', '#079455'];
  const words = ['สั้นเกินไป', 'พอใช้', 'ปานกลาง', 'ดี', 'แข็งแรงมาก'];
  input.addEventListener('input', () => {
    const p = input.value;
    let s = 0;
    if (p.length >= 8) {
      s = 1;
      if (p.length >= 12) s++;
      if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
      if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
      s = Math.min(4, s);
    }
    bar.style.width = p ? `${(s + 1) * 20}%` : '0';
    bar.style.background = colors[s];
    if (label) label.textContent = p ? `ความปลอดภัย: ${words[s]}` : 'อย่างน้อย 8 ตัวอักษร';
  });
}
function showErr(el, msg) {
  el.textContent = msg || '';
  el.classList.toggle('show', !!msg);
}

/** ส่วนซ้ายของหน้า (ข้อมูลงานวิจัย + ขั้นตอน) */
function authHero(info, { chip = 'ระบบประเมินเครื่องมือวิจัยโดยผู้เชี่ยวชาญ', heading = 'การประเมินเครื่องมือ', extra = '' } = {}) {
  const people = [
    info.researcher && `<div><b>ผู้วิจัย</b> ${esc(info.researcher)}</div>`,
    info.advisor && `<div><b>อาจารย์ที่ปรึกษาหลัก</b> ${esc(info.advisor)}</div>`,
    info.coAdvisor && `<div><b>อาจารย์ที่ปรึกษาร่วม</b> ${esc(info.coAdvisor)}</div>`,
  ].filter(Boolean).join('');
  return `<section class="auth-hero">
    <span class="auth-chip"><span class="live-dot"></span> Smart Campus · Internet of Behaviors</span>
    <h1>${esc(heading)}</h1>
    ${info.thesisTitle ? `<p class="thesis">${esc(info.thesisTitle)}</p>` : ''}
    ${extra}
    ${people ? `<div class="auth-people">${people}</div>` : ''}
    <div class="auth-steps">
      <div class="auth-step"><span class="n">1</span><b>เข้าสู่ระบบ</b><span>ด้วยอีเมลหรือเบอร์โทรศัพท์ และรหัสผ่านของท่าน</span></div>
      <div class="auth-step"><span class="n">2</span><b>ประเมินและให้ความเห็น</b><span>ให้คะแนนรายข้อ เขียนข้อเสนอแนะ ระบบบันทึกร่างอัตโนมัติ</span></div>
      <div class="auth-step"><span class="n">3</span><b>ลงนามอิเล็กทรอนิกส์</b><span>ลงลายมือชื่อบนหน้าจอ แล้วส่งแบบประเมิน</span></div>
    </div>
    <div class="auth-foot">ข้อมูลของท่านใช้เพื่อการวิจัยเท่านั้น และได้รับการคุ้มครองตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562</div>
  </section>`;
}
/** แผนภาพการไหลของข้อมูลตามกรอบงานวิจัย: IoT → IoB → AI Avatar → องค์กรแห่งความสุข */
const IOB_ICON = {
  sense: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.2"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4"/></svg>',
  behav: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><circle cx="12" cy="10" r="2.4"/><path d="M6.7 7.1 10 9M17.3 7.1 14 9M12 12.4V16"/></svg>',
  avatar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><circle cx="9" cy="10.5" r=".9" fill="currentColor"/><circle cx="15" cy="10.5" r=".9" fill="currentColor"/><path d="M9.5 13.3c1.4 1 3.6 1 5 0"/></svg>',
  happy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.5V20h14V9.5"/><path d="M12 17.5s-3.2-1.9-3.2-4a1.7 1.7 0 0 1 3.2-.8 1.7 1.7 0 0 1 3.2.8c0 2.1-3.2 4-3.2 4z"/></svg>',
};
function iobFlow() {
  const nodes = [
    ['sense', 'IoT Sensing', 'กล้อง · เซนเซอร์'],
    ['behav', 'IoB Analytics', 'วิเคราะห์พฤติกรรม'],
    ['avatar', 'AI Avatar', 'อวตารโอภาปราศรัย'],
    ['happy', 'Happy Org', 'องค์กรแห่งความสุข'],
  ];
  return `<div class="iob-flow" aria-label="กรอบแนวคิด: IoT → IoB → AI Avatar → องค์กรแห่งความสุข">${nodes
    .map(([k, en, th], i) => `${i ? '<span class="iob-link" aria-hidden="true"><i></i></span>' : ''}<div class="iob-node"><span class="ic">${IOB_ICON[k]}</span><b>${en}</b><small>${th}</small></div>`)
    .join('')}</div>`;
}

/** อวตารโอภาปราศรัย — ตัวละคร AI ที่ทักทายผู้ใช้อย่างเป็นมิตร (สื่อถึงองค์กรแห่งความสุข) */
const AVATAR_SVG = `<svg class="avatar-svg" viewBox="0 0 120 120" aria-hidden="true">
  <defs>
    <linearGradient id="avg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cff"/><stop offset="1" stop-color="#00b4ff"/></linearGradient>
    <linearGradient id="avf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef0ff"/></linearGradient>
  </defs>
  <circle cx="60" cy="64" r="50" fill="url(#avg)" opacity=".18"/>
  <line x1="60" y1="14" x2="60" y2="26" stroke="url(#avg)" stroke-width="4" stroke-linecap="round"/>
  <circle class="av-ping" cx="60" cy="11" r="6" fill="#ff4fd8"/>
  <rect x="22" y="26" width="76" height="66" rx="30" fill="url(#avg)"/>
  <rect x="30" y="36" width="60" height="44" rx="20" fill="url(#avf)"/>
  <g class="av-eyes" fill="#2a1f66"><ellipse cx="47" cy="55" rx="5" ry="6"/><ellipse cx="73" cy="55" rx="5" ry="6"/></g>
  <circle cx="39" cy="66" r="4.5" fill="#ff8ad8" opacity=".55"/><circle cx="81" cy="66" r="4.5" fill="#ff8ad8" opacity=".55"/>
  <path d="M50 67c5 5 15 5 20 0" fill="none" stroke="#2a1f66" stroke-width="3.2" stroke-linecap="round"/>
  <rect x="14" y="50" width="10" height="20" rx="5" fill="#00b4ff"/><rect x="96" y="50" width="10" height="20" rx="5" fill="#00b4ff"/>
  <path class="av-heart" d="M92 98c-6-4-10-7.5-10-11.5a4.6 4.6 0 0 1 10-2 4.6 4.6 0 0 1 10 2c0 4-4 7.5-10 11.5z" fill="#ff4fd8"/>
</svg>`;
/** อวตารพร้อมกล่องข้อความทักทาย */
function avatarGreet(text, { size = 64, dark = false } = {}) {
  return `<div class="av-greet ${dark ? 'dark' : ''}"><div class="av-wrap" style="width:${size}px;height:${size}px">${AVATAR_SVG}</div>
    <div class="av-bubble">${text}</div></div>`;
}

function authLayout(root, heroHtml, panelHtml) {
  document.body.classList.add('auth');
  root.innerHTML = `<div class="auth-wrap">${heroHtml}<section class="auth-panel"><div class="auth-card">${panelHtml}</div></section></div>`;
}
function initials(name) {
  const n = String(name || '').replace(/^(ศ\.|รศ\.|ผศ\.|ดร\.|คุณ|นาย|นางสาว|นาง|ว่าที่|ร้อยตรี|\s)+/g, '').trim();
  return n.slice(0, 1) || '?';
}
