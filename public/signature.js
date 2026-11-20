'use strict';
/**
 * แผ่นลงลายมือชื่อ (รองรับเมาส์ ปากกา และนิ้ว ผ่าน Pointer Events)
 * toDataURL() คืนภาพ PNG พื้นโปร่งใสที่ตัดขอบว่างออกแล้ว
 */
class SignaturePad {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = 0;
    this.drawing = false;
    this.points = [];
    this.resize();
    this._onResize = () => this.resize(true);
    window.addEventListener('resize', this._onResize);
    canvas.addEventListener('pointerdown', (e) => this.start(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => canvas.addEventListener(t, () => this.end()));
  }
  resize(keep) {
    const data = keep && this.strokes ? this.c.toDataURL() : null;
    const r = this.c.getBoundingClientRect();
    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    this.c.width = Math.round(r.width * dpr);
    this.c.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = '#0b2a6b';
    if (data) {
      const img = new Image();
      img.onload = () => this.ctx.drawImage(img, 0, 0, r.width, r.height);
      img.src = data;
    }
  }
  pos(e) {
    const r = this.c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure && e.pointerType === 'pen' ? e.pressure : 0.5 };
  }
  start(e) {
    e.preventDefault();
    this.c.setPointerCapture?.(e.pointerId);
    this.drawing = true;
    this.points = [this.pos(e)];
    const p = this.points[0];
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
    this.ctx.fillStyle = '#0b2a6b';
    this.ctx.fill();
  }
  move(e) {
    if (!this.drawing) return;
    e.preventDefault();
    const p = this.pos(e);
    const pts = this.points;
    pts.push(p);
    if (pts.length < 3) return;
    const [a, b, c] = pts.slice(-3);
    const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const m2 = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
    this.ctx.lineWidth = 1.6 + b.p * 2.2;
    this.ctx.beginPath();
    this.ctx.moveTo(m1.x, m1.y);
    this.ctx.quadraticCurveTo(b.x, b.y, m2.x, m2.y);
    this.ctx.stroke();
  }
  end() {
    if (!this.drawing) return;
    this.drawing = false;
    if (this.points.length) this.strokes++;
    this.points = [];
    this.onChange?.();
  }
  clear() {
    this.ctx.clearRect(0, 0, this.c.width, this.c.height);
    this.strokes = 0;
    this.onChange?.();
  }
  isEmpty() {
    return this.strokes === 0;
  }
  /** ตัดขอบว่าง แล้วคืน PNG data URL */
  toDataURL() {
    const { width: w, height: h } = this.c;
    const d = this.ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return null;
    const pad = 8;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const out = document.createElement('canvas');
    // จำกัดความกว้างไม่เกิน 800px เพื่อให้ไฟล์เล็ก
    const scale = Math.min(1, 800 / (x1 - x0 + 1));
    out.width = Math.round((x1 - x0 + 1) * scale);
    out.height = Math.round((y1 - y0 + 1) * scale);
    out.getContext('2d').drawImage(this.c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }
  destroy() {
    window.removeEventListener('resize', this._onResize);
  }
}
