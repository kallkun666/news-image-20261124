// Procedural Editorial World News Infographic Generator — Tuesday, 24 November 2026
// Node.js 22 TypeScript (standard library only, zero external dependencies, deterministic output)
// Writes a 1024x1024 lossless RGB PNG to $MAKEFUN_OUTPUT_DIR/entry.png (or /output/entry.png)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const WIDTH = 1024;
const HEIGHT = 1024;

type RGB = readonly [number, number, number];
type Point = readonly [number, number];

interface ClipRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------
function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Analytical Anti-Aliased 2D Canvas
// ---------------------------------------------------------------------------
class Canvas {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
  private clip: ClipRect | null = null;

  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.data[i * 3] = bg[0];
      this.data[i * 3 + 1] = bg[1];
      this.data[i * 3 + 2] = bg[2];
    }
  }

  setClip(rect: ClipRect | null): void {
    this.clip = rect;
  }

  private clipAlpha(px: number, py: number): number {
    if (!this.clip) return 1;
    const { x, y, w, h, r } = this.clip;
    const d = sdRoundedBox(px - (x + w * 0.5), py - (y + h * 0.5), w * 0.5, h * 0.5, r);
    return clamp(0.5 - d, 0, 1);
  }

  blend(ix: number, iy: number, c: RGB, alpha: number): void {
    if (ix < 0 || ix >= this.w || iy < 0 || iy >= this.h || alpha <= 0.001) return;
    let a = alpha > 1 ? 1 : alpha;
    if (this.clip) {
      a *= this.clipAlpha(ix + 0.5, iy + 0.5);
      if (a <= 0.001) return;
    }
    const idx = (iy * this.w + ix) * 3;
    if (a >= 0.999) {
      this.data[idx] = c[0];
      this.data[idx + 1] = c[1];
      this.data[idx + 2] = c[2];
    } else {
      const inv = 1 - a;
      this.data[idx] = Math.round(this.data[idx] * inv + c[0] * a);
      this.data[idx + 1] = Math.round(this.data[idx + 1] * inv + c[1] * a);
      this.data[idx + 2] = Math.round(this.data[idx + 2] * inv + c[2] * a);
    }
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGB, alpha = 1): void {
    this.fillRoundedRect(x, y, w, h, 0, c, alpha);
  }

  fillRectGradV(x: number, y: number, w: number, h: number, top: RGB, bot: RGB, r = 0): void {
    const x0 = Math.max(0, Math.floor(x - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(x + w + 1));
    const y0 = Math.max(0, Math.floor(y - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(y + h + 1));
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const hw = w * 0.5;
    const hh = h * 0.5;
    for (let py = y0; py <= y1; py++) {
      const t = clamp((py + 0.5 - y) / h, 0, 1);
      const col = lerpColor(top, bot, t);
      for (let px = x0; px <= x1; px++) {
        const d = sdRoundedBox(px + 0.5 - cx, py + 0.5 - cy, hw, hh, r);
        const a = clamp(0.5 - d, 0, 1);
        if (a > 0) this.blend(px, py, col, a);
      }
    }
  }

  fillRoundedRect(x: number, y: number, w: number, h: number, r: number, c: RGB, alpha = 1): void {
    const x0 = Math.max(0, Math.floor(x - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(x + w + 1));
    const y0 = Math.max(0, Math.floor(y - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(y + h + 1));
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const hw = w * 0.5;
    const hh = h * 0.5;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const d = sdRoundedBox(px + 0.5 - cx, py + 0.5 - cy, hw, hh, r);
        const a = clamp(0.5 - d, 0, 1) * alpha;
        if (a > 0) this.blend(px, py, c, a);
      }
    }
  }

  strokeRoundedRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    strokeW: number,
    c: RGB,
    alpha = 1
  ): void {
    const pad = strokeW + 2;
    const x0 = Math.max(0, Math.floor(x - pad));
    const x1 = Math.min(this.w - 1, Math.ceil(x + w + pad));
    const y0 = Math.max(0, Math.floor(y - pad));
    const y1 = Math.min(this.h - 1, Math.ceil(y + h + pad));
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const hw = w * 0.5;
    const hh = h * 0.5;
    const halfS = strokeW * 0.5;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const d = Math.abs(sdRoundedBox(px + 0.5 - cx, py + 0.5 - cy, hw, hh, r)) - halfS;
        const a = clamp(0.5 - d, 0, 1) * alpha;
        if (a > 0) this.blend(px, py, c, a);
      }
    }
  }

  drawDropShadow(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    offsetY: number,
    blur: number,
    c: RGB,
    maxAlpha: number
  ): void {
    const pad = Math.ceil(blur * 2 + Math.abs(offsetY) + 2);
    const x0 = Math.max(0, Math.floor(x - pad));
    const x1 = Math.min(this.w - 1, Math.ceil(x + w + pad));
    const y0 = Math.max(0, Math.floor(y + offsetY - pad));
    const y1 = Math.min(this.h - 1, Math.ceil(y + h + offsetY + pad));
    const cx = x + w * 0.5;
    const cy = y + offsetY + h * 0.5;
    const hw = w * 0.5;
    const hh = h * 0.5;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const d = sdRoundedBox(px + 0.5 - cx, py + 0.5 - cy, hw, hh, r);
        if (d < blur * 2) {
          const t = clamp(1 - Math.max(0, d) / (blur * 2), 0, 1);
          const a = t * t * maxAlpha;
          if (a > 0.002) this.blend(px, py, c, a);
        }
      }
    }
  }

  fillCircle(cx: number, cy: number, r: number, c: RGB, alpha = 1): void {
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r + 1));
    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - cy;
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - cx;
        const d = Math.hypot(dx, dy) - r;
        const a = clamp(0.5 - d, 0, 1) * alpha;
        if (a > 0) this.blend(px, py, c, a);
      }
    }
  }

  strokeCircle(cx: number, cy: number, r: number, strokeW: number, c: RGB, alpha = 1): void {
    const outer = r + strokeW * 0.5 + 1.5;
    const x0 = Math.max(0, Math.floor(cx - outer));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + outer));
    const y0 = Math.max(0, Math.floor(cy - outer));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + outer));
    const halfS = strokeW * 0.5;
    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - cy;
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - cx;
        const d = Math.abs(Math.hypot(dx, dy) - r) - halfS;
        const a = clamp(0.5 - d, 0, 1) * alpha;
        if (a > 0) this.blend(px, py, c, a);
      }
    }
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB, alpha = 1): void {
    const x0 = Math.max(0, Math.floor(cx - rx - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ry + 1));
    const minR = Math.min(rx, ry);
    for (let py = y0; py <= y1; py++) {
      const ny = (py + 0.5 - cy) / ry;
      for (let px = x0; px <= x1; px++) {
        const nx = (px + 0.5 - cx) / rx;
        const dist = (Math.hypot(nx, ny) - 1) * minR;
        const a = clamp(0.5 - dist, 0, 1) * alpha;
        if (a > 0) this.blend(px, py, c, a);
      }
    }
  }

  fillRadialGlow(cx: number, cy: number, r: number, c: RGB, maxAlpha: number): void {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - cy;
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - cx;
        const dist = Math.hypot(dx, dy);
        if (dist < r) {
          const t = 1 - dist / r;
          const a = t * t * maxAlpha;
          if (a > 0.002) this.blend(px, py, c, a);
        }
      }
    }
  }

  drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    c: RGB,
    alpha = 1
  ): void {
    const r = width * 0.5;
    const pad = r + 1.5;
    const x0 = Math.max(0, Math.floor(Math.min(x1, x2) - pad));
    const xm = Math.min(this.w - 1, Math.ceil(Math.max(x1, x2) + pad));
    const y0 = Math.max(0, Math.floor(Math.min(y1, y2) - pad));
    const ym = Math.min(this.h - 1, Math.ceil(Math.max(y1, y2) + pad));
    for (let py = y0; py <= ym; py++) {
      for (let px = x0; px <= xm; px++) {
        const d = sdSegment(px + 0.5, py + 0.5, x1, y1, x2, y2) - r;
        const a = clamp(0.5 - d, 0, 1) * alpha;
        if (a > 0) this.blend(px, py, c, a);
      }
    }
  }

  drawPolyline(pts: readonly Point[], width: number, c: RGB, alpha = 1): void {
    if (pts.length < 2) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const r = width * 0.5;
    const pad = r + 1.5;
    const x0 = Math.max(0, Math.floor(minX - pad));
    const x1 = Math.min(this.w - 1, Math.ceil(maxX + pad));
    const y0 = Math.max(0, Math.floor(minY - pad));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY + pad));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        let minD = Infinity;
        for (let i = 0; i < pts.length - 1; i++) {
          const d = sdSegment(px + 0.5, py + 0.5, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
          if (d < minD) minD = d;
        }
        const a = clamp(0.5 - (minD - r), 0, 1) * alpha;
        if (a > 0) this.blend(px, py, c, a);
      }
    }
  }

  drawArc(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    a0: number,
    a1: number,
    width: number,
    c: RGB,
    alpha = 1,
    steps = 28
  ): void {
    const pts: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = a0 + ((a1 - a0) * i) / steps;
      pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
    }
    this.drawPolyline(pts, width, c, alpha);
  }

  // 4x4 supersampled anti-aliased polygon fill
  fillPolygon(pts: readonly Point[], c: RGB, alpha = 1): void {
    if (pts.length < 3) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const x0 = Math.max(0, Math.floor(minX - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(maxX + 1));
    const y0 = Math.max(0, Math.floor(minY - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY + 1));
    const n = pts.length;
    const offsets = [0.125, 0.375, 0.625, 0.875];
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        let hits = 0;
        for (let sy = 0; sy < 4; sy++) {
          const y = py + offsets[sy];
          for (let sx = 0; sx < 4; sx++) {
            const x = px + offsets[sx];
            let inside = false;
            for (let i = 0, j = n - 1; i < n; j = i++) {
              const xi = pts[i][0];
              const yi = pts[i][1];
              const xj = pts[j][0];
              const yj = pts[j][1];
              if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
                inside = !inside;
              }
            }
            if (inside) hits++;
          }
        }
        if (hits > 0) {
          this.blend(px, py, c, (hits / 16) * alpha);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Signed Distance Helpers
// ---------------------------------------------------------------------------
function sdRoundedBox(px: number, py: number, bx: number, by: number, r: number): number {
  const rr = Math.min(r, bx, by);
  const qx = Math.abs(px) - bx + rr;
  const qy = Math.abs(py) - by + rr;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
}

function sdSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const denom = bax * bax + bay * bay;
  const h = denom > 1e-8 ? clamp((pax * bax + pay * bay) / denom, 0, 1) : 0;
  return Math.hypot(pax - bax * h, pay - bay * h);
}

// ---------------------------------------------------------------------------
// Geometric Anti-Aliased Vector Typography Engine
// ---------------------------------------------------------------------------
type Seg4 = readonly [number, number, number, number];

interface GlyphDef {
  w: number; // relative advance width (em units, cap height = 1.0)
  segs: readonly Seg4[];
}

function quadSegs(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  n = 7
): Seg4[] {
  const out: Seg4[] = [];
  let px = x0;
  let py = y0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const nx = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const ny = u * u * y0 + 2 * u * t * cy + t * t * y1;
    out.push([px, py, nx, ny]);
    px = nx;
    py = ny;
  }
  return out;
}

function arcSegs(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0Deg: number,
  a1Deg: number,
  n = 10
): Seg4[] {
  const out: Seg4[] = [];
  const a0 = (a0Deg * Math.PI) / 180;
  const a1 = (a1Deg * Math.PI) / 180;
  let px = cx + Math.cos(a0) * rx;
  let py = cy + Math.sin(a0) * ry;
  for (let i = 1; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const nx = cx + Math.cos(a) * rx;
    const ny = cy + Math.sin(a) * ry;
    out.push([px, py, nx, ny]);
    px = nx;
    py = ny;
  }
  return out;
}

function L(x0: number, y0: number, x1: number, y1: number): Seg4 {
  return [x0, y0, x1, y1];
}

// Clean geometric neo-grotesque vector font (cap-height 0.0 -> 1.0, x-height 0.30 -> 1.0)
const GLYPHS: Record<string, GlyphDef> = {
  ' ': { w: 0.34, segs: [] },

  // UPPERCASE
  A: { w: 0.74, segs: [L(0.06, 1.0, 0.37, 0.0), L(0.37, 0.0, 0.68, 1.0), L(0.17, 0.68, 0.57, 0.68)] },
  B: {
    w: 0.68,
    segs: [
      L(0.10, 0.0, 0.10, 1.0),
      L(0.10, 0.0, 0.38, 0.0),
      ...arcSegs(0.38, 0.24, 0.22, 0.24, -90, 90, 8),
      L(0.38, 0.48, 0.10, 0.48),
      L(0.10, 0.48, 0.40, 0.48),
      ...arcSegs(0.40, 0.74, 0.24, 0.26, -90, 90, 8),
      L(0.40, 1.0, 0.10, 1.0),
    ],
  },
  C: { w: 0.70, segs: [...arcSegs(0.38, 0.50, 0.30, 0.50, 42, 318, 16)] },
  D: {
    w: 0.72,
    segs: [
      L(0.10, 0.0, 0.10, 1.0),
      L(0.10, 0.0, 0.32, 0.0),
      ...arcSegs(0.32, 0.50, 0.32, 0.50, -90, 90, 12),
      L(0.32, 1.0, 0.10, 1.0),
    ],
  },
  E: {
    w: 0.62,
    segs: [L(0.10, 0.0, 0.10, 1.0), L(0.10, 0.0, 0.56, 0.0), L(0.10, 0.49, 0.50, 0.49), L(0.10, 1.0, 0.56, 1.0)],
  },
  F: { w: 0.58, segs: [L(0.10, 0.0, 0.10, 1.0), L(0.10, 0.0, 0.54, 0.0), L(0.10, 0.50, 0.48, 0.50)] },
  G: {
    w: 0.74,
    segs: [
      ...arcSegs(0.38, 0.50, 0.30, 0.50, 12, 322, 16),
      L(0.68, 0.56, 0.68, 0.96),
      L(0.42, 0.56, 0.68, 0.56),
    ],
  },
  H: { w: 0.70, segs: [L(0.10, 0.0, 0.10, 1.0), L(0.60, 0.0, 0.60, 1.0), L(0.10, 0.49, 0.60, 0.49)] },
  I: { w: 0.30, segs: [L(0.15, 0.0, 0.15, 1.0)] },
  J: {
    w: 0.56,
    segs: [L(0.44, 0.0, 0.44, 0.74), ...arcSegs(0.25, 0.74, 0.19, 0.26, 0, 165, 9)],
  },
  K: { w: 0.68, segs: [L(0.10, 0.0, 0.10, 1.0), L(0.60, 0.0, 0.12, 0.54), L(0.25, 0.42, 0.62, 1.0)] },
  L: { w: 0.58, segs: [L(0.10, 0.0, 0.10, 1.0), L(0.10, 1.0, 0.54, 1.0)] },
  M: {
    w: 0.86,
    segs: [L(0.10, 1.0, 0.10, 0.0), L(0.10, 0.0, 0.43, 0.66), L(0.43, 0.66, 0.76, 0.0), L(0.76, 0.0, 0.76, 1.0)],
  },
  N: { w: 0.72, segs: [L(0.10, 1.0, 0.10, 0.0), L(0.10, 0.0, 0.62, 1.0), L(0.62, 1.0, 0.62, 0.0)] },
  O: { w: 0.76, segs: [...arcSegs(0.38, 0.50, 0.30, 0.50, 0, 360, 20)] },
  P: {
    w: 0.66,
    segs: [
      L(0.10, 0.0, 0.10, 1.0),
      L(0.10, 0.0, 0.38, 0.0),
      ...arcSegs(0.38, 0.27, 0.22, 0.27, -90, 90, 9),
      L(0.38, 0.54, 0.10, 0.54),
    ],
  },
  Q: { w: 0.76, segs: [...arcSegs(0.38, 0.50, 0.30, 0.50, 0, 360, 20), L(0.46, 0.72, 0.70, 1.04)] },
  R: {
    w: 0.68,
    segs: [
      L(0.10, 0.0, 0.10, 1.0),
      L(0.10, 0.0, 0.38, 0.0),
      ...arcSegs(0.38, 0.27, 0.22, 0.27, -90, 90, 9),
      L(0.38, 0.54, 0.10, 0.54),
      L(0.38, 0.54, 0.62, 1.0),
    ],
  },
  S: {
    w: 0.66,
    segs: [
      ...arcSegs(0.34, 0.25, 0.24, 0.25, -28, -248, 12),
      ...quadSegs(0.25, 0.48, 0.34, 0.50, 0.43, 0.52, 6),
      ...arcSegs(0.33, 0.75, 0.25, 0.25, -68, 158, 12),
    ],
  },
  T: { w: 0.64, segs: [L(0.04, 0.0, 0.60, 0.0), L(0.32, 0.0, 0.32, 1.0)] },
  U: {
    w: 0.72,
    segs: [L(0.10, 0.0, 0.10, 0.68), ...arcSegs(0.36, 0.68, 0.26, 0.32, 180, 0, 12), L(0.62, 0.68, 0.62, 0.0)],
  },
  V: { w: 0.70, segs: [L(0.06, 0.0, 0.35, 1.0), L(0.35, 1.0, 0.64, 0.0)] },
  W: {
    w: 0.94,
    segs: [L(0.06, 0.0, 0.24, 1.0), L(0.24, 1.0, 0.47, 0.26), L(0.47, 0.26, 0.70, 1.0), L(0.70, 1.0, 0.88, 0.0)],
  },
  X: { w: 0.68, segs: [L(0.08, 0.0, 0.60, 1.0), L(0.60, 0.0, 0.08, 1.0)] },
  Y: { w: 0.66, segs: [L(0.06, 0.0, 0.33, 0.52), L(0.60, 0.0, 0.33, 0.52), L(0.33, 0.52, 0.33, 1.0)] },
  Z: { w: 0.66, segs: [L(0.08, 0.0, 0.58, 0.0), L(0.58, 0.0, 0.08, 1.0), L(0.08, 1.0, 0.58, 1.0)] },

  // LOWERCASE
  a: {
    w: 0.58,
    segs: [
      ...arcSegs(0.28, 0.48, 0.19, 0.18, 200, 360, 8),
      L(0.47, 0.48, 0.47, 1.0),
      ...arcSegs(0.27, 0.80, 0.20, 0.20, 0, 360, 14),
    ],
  },
  b: { w: 0.60, segs: [L(0.10, 0.0, 0.10, 1.0), ...arcSegs(0.31, 0.66, 0.21, 0.34, 0, 360, 16)] },
  c: { w: 0.54, segs: [...arcSegs(0.29, 0.66, 0.21, 0.34, 42, 318, 14)] },
  d: { w: 0.60, segs: [L(0.50, 0.0, 0.50, 1.0), ...arcSegs(0.29, 0.66, 0.21, 0.34, 0, 360, 16)] },
  e: {
    w: 0.58,
    segs: [L(0.08, 0.64, 0.50, 0.64), ...arcSegs(0.29, 0.66, 0.21, 0.34, 35, 360, 16)],
  },
  f: {
    w: 0.38,
    segs: [...arcSegs(0.28, 0.16, 0.12, 0.16, 180, 315, 7), L(0.16, 0.16, 0.16, 1.0), L(0.04, 0.36, 0.34, 0.36)],
  },
  g: {
    w: 0.60,
    segs: [
      ...arcSegs(0.29, 0.64, 0.21, 0.32, 0, 360, 16),
      L(0.50, 0.32, 0.50, 1.06),
      ...arcSegs(0.29, 1.06, 0.21, 0.22, 0, 155, 9),
    ],
  },
  h: {
    w: 0.58,
    segs: [L(0.10, 0.0, 0.10, 1.0), ...arcSegs(0.29, 0.54, 0.19, 0.22, 180, 360, 9), L(0.48, 0.54, 0.48, 1.0)],
  },
  i: { w: 0.26, segs: [L(0.13, 0.34, 0.13, 1.0), L(0.13, 0.10, 0.13, 0.14)] },
  j: {
    w: 0.28,
    segs: [
      L(0.16, 0.34, 0.16, 1.08),
      ...arcSegs(0.05, 1.08, 0.11, 0.16, 0, 140, 7),
      L(0.16, 0.10, 0.16, 0.14),
    ],
  },
  k: { w: 0.54, segs: [L(0.10, 0.0, 0.10, 1.0), L(0.46, 0.34, 0.12, 0.68), L(0.22, 0.58, 0.48, 1.0)] },
  l: { w: 0.26, segs: [L(0.13, 0.0, 0.13, 1.0)] },
  m: {
    w: 0.84,
    segs: [
      L(0.10, 0.32, 0.10, 1.0),
      ...arcSegs(0.26, 0.52, 0.16, 0.20, 180, 360, 8),
      L(0.42, 0.52, 0.42, 1.0),
      ...arcSegs(0.58, 0.52, 0.16, 0.20, 180, 360, 8),
      L(0.74, 0.52, 0.74, 1.0),
    ],
  },
  n: {
    w: 0.58,
    segs: [L(0.10, 0.32, 0.10, 1.0), ...arcSegs(0.29, 0.54, 0.19, 0.22, 180, 360, 9), L(0.48, 0.54, 0.48, 1.0)],
  },
  o: { w: 0.60, segs: [...arcSegs(0.30, 0.66, 0.22, 0.34, 0, 360, 16)] },
  p: { w: 0.60, segs: [L(0.10, 0.32, 0.10, 1.26), ...arcSegs(0.31, 0.66, 0.21, 0.34, 0, 360, 16)] },
  q: { w: 0.60, segs: [L(0.50, 0.32, 0.50, 1.26), ...arcSegs(0.29, 0.66, 0.21, 0.34, 0, 360, 16)] },
  r: { w: 0.38, segs: [L(0.10, 0.32, 0.10, 1.0), ...arcSegs(0.26, 0.50, 0.16, 0.18, 180, 295, 7)] },
  s: {
    w: 0.52,
    segs: [
      ...arcSegs(0.26, 0.48, 0.17, 0.16, -24, -248, 10),
      ...quadSegs(0.20, 0.63, 0.26, 0.66, 0.33, 0.68, 5),
      ...arcSegs(0.26, 0.84, 0.18, 0.16, -65, 162, 10),
    ],
  },
  t: {
    w: 0.38,
    segs: [L(0.16, 0.08, 0.16, 0.86), ...arcSegs(0.26, 0.86, 0.10, 0.14, 180, 75, 6), L(0.04, 0.34, 0.33, 0.34)],
  },
  u: {
    w: 0.58,
    segs: [L(0.10, 0.32, 0.10, 0.78), ...arcSegs(0.29, 0.78, 0.19, 0.22, 180, 0, 9), L(0.48, 0.32, 0.48, 1.0)],
  },
  v: { w: 0.54, segs: [L(0.06, 0.32, 0.27, 1.0), L(0.27, 1.0, 0.48, 0.32)] },
  w: {
    w: 0.78,
    segs: [L(0.05, 0.32, 0.20, 1.0), L(0.20, 1.0, 0.39, 0.42), L(0.39, 0.42, 0.58, 1.0), L(0.58, 1.0, 0.73, 0.32)],
  },
  x: { w: 0.52, segs: [L(0.07, 0.32, 0.45, 1.0), L(0.45, 0.32, 0.07, 1.0)] },
  y: { w: 0.54, segs: [L(0.07, 0.32, 0.27, 0.96), L(0.47, 0.32, 0.17, 1.24)] },
  z: { w: 0.52, segs: [L(0.08, 0.32, 0.44, 0.32), L(0.44, 0.32, 0.08, 1.0), L(0.08, 1.0, 0.44, 1.0)] },

  // DIGITS
  '0': { w: 0.66, segs: [...arcSegs(0.33, 0.50, 0.25, 0.50, 0, 360, 18)] },
  '1': { w: 0.46, segs: [L(0.11, 0.20, 0.28, 0.0), L(0.28, 0.0, 0.28, 1.0), L(0.12, 1.0, 0.42, 1.0)] },
  '2': {
    w: 0.64,
    segs: [...arcSegs(0.32, 0.26, 0.23, 0.26, 195, 395, 11), L(0.51, 0.41, 0.09, 1.0), L(0.09, 1.0, 0.56, 1.0)],
  },
  '3': {
    w: 0.64,
    segs: [
      ...arcSegs(0.31, 0.25, 0.22, 0.25, 210, 450, 10),
      ...arcSegs(0.31, 0.75, 0.24, 0.25, -90, 155, 10),
    ],
  },
  '4': { w: 0.66, segs: [L(0.44, 1.0, 0.44, 0.0), L(0.44, 0.0, 0.07, 0.68), L(0.07, 0.68, 0.58, 0.68)] },
  '5': {
    w: 0.64,
    segs: [
      L(0.52, 0.0, 0.14, 0.0),
      L(0.14, 0.0, 0.11, 0.45),
      ...arcSegs(0.31, 0.69, 0.24, 0.31, -120, 155, 12),
    ],
  },
  '6': {
    w: 0.64,
    segs: [
      ...arcSegs(0.34, 0.46, 0.24, 0.46, 178, 326, 12),
      L(0.10, 0.46, 0.10, 0.70),
      ...arcSegs(0.32, 0.70, 0.22, 0.30, 0, 360, 18),
    ],
  },
  '7': { w: 0.60, segs: [L(0.08, 0.0, 0.54, 0.0), L(0.54, 0.0, 0.22, 1.0)] },
  '8': {
    w: 0.64,
    segs: [...arcSegs(0.32, 0.24, 0.21, 0.24, 0, 360, 14), ...arcSegs(0.32, 0.74, 0.24, 0.26, 0, 360, 14)],
  },
  '9': {
    w: 0.64,
    segs: [
      ...arcSegs(0.32, 0.30, 0.22, 0.30, 0, 360, 18),
      L(0.54, 0.30, 0.54, 0.54),
      ...arcSegs(0.30, 0.54, 0.24, 0.46, 0, 146, 12),
    ],
  },

  // PUNCTUATION & SYMBOLS
  '.': { w: 0.24, segs: [L(0.12, 0.94, 0.12, 0.99)] },
  ',': { w: 0.26, segs: [L(0.14, 0.92, 0.08, 1.14)] },
  ':': { w: 0.26, segs: [L(0.13, 0.38, 0.13, 0.43), L(0.13, 0.92, 0.13, 0.97)] },
  ';': { w: 0.26, segs: [L(0.13, 0.38, 0.13, 0.43), L(0.14, 0.92, 0.08, 1.14)] },
  '-': { w: 0.42, segs: [L(0.08, 0.58, 0.34, 0.58)] },
  '–': { w: 0.54, segs: [L(0.06, 0.58, 0.48, 0.58)] },
  '+': { w: 0.60, segs: [L(0.08, 0.56, 0.52, 0.56), L(0.30, 0.32, 0.30, 0.80)] },
  '%': {
    w: 0.82,
    segs: [
      L(0.12, 1.0, 0.70, 0.0),
      ...arcSegs(0.20, 0.22, 0.13, 0.18, 0, 360, 12),
      ...arcSegs(0.62, 0.78, 0.13, 0.18, 0, 360, 12),
    ],
  },
  '&': {
    w: 0.74,
    segs: [
      ...arcSegs(0.30, 0.22, 0.16, 0.20, -40, 260, 11),
      L(0.20, 0.38, 0.64, 1.0),
      ...arcSegs(0.30, 0.76, 0.21, 0.24, 30, 260, 11),
      L(0.46, 0.94, 0.62, 0.56),
    ],
  },
  "'": { w: 0.22, segs: [L(0.11, 0.02, 0.09, 0.26)] },
  '"': { w: 0.38, segs: [L(0.11, 0.02, 0.10, 0.26), L(0.27, 0.02, 0.26, 0.26)] },
  '/': { w: 0.44, segs: [L(0.38, 0.0, 0.06, 1.04)] },
  '·': { w: 0.34, segs: [L(0.17, 0.49, 0.17, 0.51)] },
  '•': { w: 0.38, segs: [...arcSegs(0.19, 0.50, 0.07, 0.07, 0, 360, 8)] },
  '(': { w: 0.34, segs: [...arcSegs(0.32, 0.52, 0.22, 0.56, 125, 235, 10)] },
  ')': { w: 0.34, segs: [...arcSegs(0.02, 0.52, 0.22, 0.56, -55, 55, 10)] },
  '!': { w: 0.26, segs: [L(0.13, 0.0, 0.13, 0.68), L(0.13, 0.94, 0.13, 0.99)] },
};

function measureText(text: string, size: number, tracking = 0.05): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const g = GLYPHS[text[i]] ?? GLYPHS[' '];
    w += g.w * size;
    if (i < text.length - 1) w += tracking * size;
  }
  return w;
}

interface TextOpts {
  size: number;
  weight?: number; // stroke thickness ratio relative to size (0.10 regular, 0.135 bold, 0.165 heavy)
  tracking?: number;
  align?: 'left' | 'center' | 'right';
  alpha?: number;
}

function drawText(
  cv: Canvas,
  text: string,
  x: number,
  y: number,
  color: RGB,
  opts: TextOpts
): void {
  const size = opts.size;
  const weight = opts.weight ?? 0.125;
  const tracking = opts.tracking ?? 0.055;
  const align = opts.align ?? 'left';
  const alpha = opts.alpha ?? 1;

  const totalW = measureText(text, size, tracking);
  let curX = x;
  if (align === 'center') curX = x - totalW * 0.5;
  else if (align === 'right') curX = x - totalW;

  const r = Math.max(0.75, size * weight * 0.5);
  const aa = 0.95;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    if (g.segs.length > 0) {
      const gx0 = Math.max(0, Math.floor(curX - r - 2));
      const gx1 = Math.min(cv.w - 1, Math.ceil(curX + g.w * size + r + 2));
      const gy0 = Math.max(0, Math.floor(y - r - 2));
      const gy1 = Math.min(cv.h - 1, Math.ceil(y + size * 1.32 + r + 2));

      // Pre-transform segments for speed
      const segs = g.segs;
      const sx0 = new Float32Array(segs.length);
      const sy0 = new Float32Array(segs.length);
      const sx1 = new Float32Array(segs.length);
      const sy1 = new Float32Array(segs.length);
      for (let k = 0; k < segs.length; k++) {
        sx0[k] = curX + segs[k][0] * size;
        sy0[k] = y + segs[k][1] * size;
        sx1[k] = curX + segs[k][2] * size;
        sy1[k] = y + segs[k][3] * size;
      }

      for (let py = gy0; py <= gy1; py++) {
        const fy = py + 0.5;
        for (let px = gx0; px <= gx1; px++) {
          const fx = px + 0.5;
          let minD = 1e9;
          for (let k = 0; k < segs.length; k++) {
            const d = sdSegment(fx, fy, sx0[k], sy0[k], sx1[k], sy1[k]);
            if (d < minD) minD = d;
          }
          const a = clamp(0.5 + (r - minD) / aa, 0, 1) * alpha;
          if (a > 0.005) cv.blend(px, py, color, a);
        }
      }
    }
    curX += (g.w + tracking) * size;
  }
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const PAL = {
  paper: hex('#F2EEE4'),
  cardBg: hex('#FFFFFF'),
  cardBorder: hex('#D8D0C1'),
  navyDark: hex('#0D1628'),
  navyMid: hex('#1B2942'),
  crimson: hex('#C82333'),
  gold: hex('#E2B04A'),
  ink: hex('#0F172A'),
  slate: hex('#334155'),
  muted: hex('#64748B'),
  white: hex('#FFFFFF'),
  cream: hex('#FEF9E7'),
};

// ---------------------------------------------------------------------------
// Custom Vector Illustrations for Each Story (148 x 216 panels)
// ---------------------------------------------------------------------------

// 1. STRAIT OF HORMUZ: Oil tanker with blaze, radar sweep, sea waves
function drawHormuzArt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.setClip({ x, y, w, h, r: 9 });
  cv.fillRectGradV(x, y, w, h, hex('#0A1C33'), hex('#113556'), 9);

  // Subtle radar arcs in night sky
  cv.fillRadialGlow(x + w * 0.52, y + 72, 74, hex('#F97316'), 0.28);
  cv.strokeCircle(x + w * 0.5, y + 66, 26, 1.4, hex('#38BDF8'), 0.22);
  cv.strokeCircle(x + w * 0.5, y + 66, 46, 1.2, hex('#38BDF8'), 0.16);
  cv.strokeCircle(x + w * 0.5, y + 66, 66, 1.0, hex('#38BDF8'), 0.10);

  // Distant coastline silhouette (Strait narrows)
  cv.fillPolygon(
    [
      [x - 2, y + 114],
      [x + 28, y + 96],
      [x + 62, y + 104],
      [x + 98, y + 92],
      [x + 150, y + 108],
      [x + 150, y + 128],
      [x - 2, y + 128],
    ],
    hex('#0F2B47'),
    0.9
  );

  // Rising dark smoke plume
  cv.fillCircle(x + 76, y + 58, 16, hex('#475569'), 0.55);
  cv.fillCircle(x + 92, y + 42, 20, hex('#64748B'), 0.45);
  cv.fillCircle(x + 112, y + 28, 24, hex('#94A3B8'), 0.30);

  // Bright multi-layered fire blaze midship
  cv.fillPolygon(
    [
      [x + 56, y + 110],
      [x + 52, y + 86],
      [x + 64, y + 70],
      [x + 71, y + 52],
      [x + 81, y + 72],
      [x + 91, y + 64],
      [x + 88, y + 92],
      [x + 84, y + 110],
    ],
    hex('#EA580C'),
    0.96
  );
  cv.fillPolygon(
    [
      [x + 61, y + 110],
      [x + 60, y + 88],
      [x + 71, y + 68],
      [x + 82, y + 88],
      [x + 79, y + 110],
    ],
    hex('#FACC15'),
    0.95
  );
  cv.fillCircle(x + 71, y + 100, 8, hex('#FEF9C3'), 0.9);

  // Oil tanker ship silhouette
  // Bridge superstructure (stern right)
  cv.fillRect(x + 102, y + 84, 24, 24, hex('#E2E8F0'));
  cv.fillRect(x + 106, y + 76, 16, 10, hex('#CBD5E1'));
  cv.fillRect(x + 106, y + 88, 16, 4, hex('#0F172A')); // bridge windows
  cv.fillRect(x + 116, y + 66, 5, 12, hex('#DC2626')); // funnel

  // Deck pipe line
  cv.drawLine(x + 26, y + 106, x + 102, y + 106, 3, hex('#94A3B8'));
  // Main dark hull
  cv.fillPolygon(
    [
      [x + 14, y + 108],
      [x + 132, y + 108],
      [x + 126, y + 126],
      [x + 24, y + 126],
    ],
    hex('#1E293B')
  );
  // Crimson lower hull band
  cv.fillPolygon(
    [
      [x + 20, y + 120],
      [x + 128, y + 120],
      [x + 125, y + 128],
      [x + 24, y + 128],
    ],
    hex('#C82333')
  );

  // Stylized naval sea mine icon lower-left water
  const mx = x + 32;
  const my = y + 148;
  cv.fillCircle(mx, my, 9, hex('#0F172A'));
  cv.strokeCircle(mx, my, 9, 1.5, hex('#F97316'), 0.9);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    cv.drawLine(mx + Math.cos(a) * 8, my + Math.sin(a) * 8, mx + Math.cos(a) * 14, my + Math.sin(a) * 14, 2, hex('#F97316'));
  }

  // Layered sea waves
  cv.fillRectGradV(x, y + 126, w, h - 126, hex('#0E4F7A'), hex('#07233B'), 0);
  // Re-draw mine partially visible on top of water glow
  cv.fillCircle(mx, my, 8, hex('#0F172A'));
  cv.strokeCircle(mx, my, 8, 1.6, hex('#FB923C'), 0.95);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    cv.drawLine(mx + Math.cos(a) * 7, my + Math.sin(a) * 7, mx + Math.cos(a) * 12, my + Math.sin(a) * 12, 2, hex('#FB923C'));
  }

  for (let row = 0; row < 3; row++) {
    const wy = y + 132 + row * 14;
    const pts: Point[] = [];
    for (let i = 0; i <= 24; i++) {
      const px = x - 2 + (w + 4) * (i / 24);
      const py = wy + Math.sin(i * 0.95 + row * 1.4) * 3.2;
      pts.push([px, py]);
    }
    cv.drawPolyline(pts, 2.2, row === 0 ? hex('#7DD3FC') : hex('#38BDF8'), 0.55 - row * 0.12);
  }

  // Bottom callout strip
  cv.fillRoundedRect(x + 10, y + h - 34, w - 20, 24, 5, hex('#071324'), 0.86);
  drawText(cv, 'HORMUZ STRAIT', x + w * 0.5, y + h - 27, hex('#FDBA74'), {
    size: 11.5,
    weight: 0.15,
    align: 'center',
    tracking: 0.06,
  });
  cv.setClip(null);
}

// 2. ASIAN CHIP RALLY: Rising green stock surge, semiconductor die, +9% callout
function drawAsianMarketArt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.setClip({ x, y, w, h, r: 9 });
  cv.fillRectGradV(x, y, w, h, hex('#072320'), hex('#0D3B35'), 9);
  cv.fillRadialGlow(x + w * 0.72, y + 66, 86, hex('#22C55E'), 0.22);

  // Subtle financial grid
  for (let gx = x + 24; gx < x + w; gx += 26) {
    cv.drawLine(gx, y, gx, y + h, 1, hex('#2DD4BF'), 0.08);
  }
  for (let gy = y + 28; gy < y + h - 36; gy += 28) {
    cv.drawLine(x, gy, x + w, gy, 1, hex('#2DD4BF'), 0.08);
  }

  // Stylized semiconductor microchip icon (upper left)
  const cx = x + 16;
  const cy = y + 16;
  const cs = 38;
  // Gold chip pins
  for (let i = 0; i < 4; i++) {
    const off = 7 + i * 8;
    cv.drawLine(cx - 6, cy + off, cx, cy + off, 2.2, hex('#FACC15'));
    cv.drawLine(cx + cs, cy + off, cx + cs + 6, cy + off, 2.2, hex('#FACC15'));
    cv.drawLine(cx + off, cy - 6, cx + off, cy, 2.2, hex('#FACC15'));
    cv.drawLine(cx + off, cy + cs, cx + off, cy + cs + 6, 2.2, hex('#FACC15'));
  }
  cv.fillRoundedRect(cx, cy, cs, cs, 5, hex('#134E4A'));
  cv.strokeRoundedRect(cx, cy, cs, cs, 5, 2, hex('#5EEAD4'));
  cv.fillRoundedRect(cx + 9, cy + 9, cs - 18, cs - 18, 3, hex('#2DD4BF'), 0.85);
  cv.fillCircle(cx + cs * 0.5, cy + cs * 0.5, 4, hex('#064E3B'));

  // Big bold "+9%" hero callout top-right (well above trend arrow)
  drawText(cv, '+9%', x + w - 12, y + 14, hex('#4ADE80'), {
    size: 26,
    weight: 0.175,
    align: 'right',
    tracking: 0.03,
  });
  drawText(cv, 'TAIEX', x + w - 12, y + 43, hex('#A7F3D0'), {
    size: 10.5,
    weight: 0.145,
    align: 'right',
    tracking: 0.08,
  });

  // 3 Regional index vertical bars (JP +4%, KR +6%, TW +9%)
  const baseY = y + 174;
  const bars: readonly { label: string; pct: string; bh: number; col: RGB }[] = [
    { label: 'JP', pct: '+4', bh: 38, col: hex('#14B8A6') },
    { label: 'KR', pct: '+6', bh: 58, col: hex('#10B981') },
    { label: 'TW', pct: '+9', bh: 86, col: hex('#22C55E') },
  ];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const bx = x + 18 + i * 40;
    cv.fillRoundedRect(bx, baseY - b.bh, 28, b.bh, 4, b.col, 0.92);
    drawText(cv, b.label, bx + 14, baseY - 16, hex('#052E16'), {
      size: 11,
      weight: 0.16,
      align: 'center',
    });
  }

  // Dramatic upward surge line + arrowhead cleanly below TAIEX label
  const trend: Point[] = [
    [x + 14, y + 162],
    [x + 48, y + 148],
    [x + 76, y + 128],
    [x + 104, y + 98],
    [x + 128, y + 74],
  ];
  cv.drawPolyline(trend, 4.2, hex('#FEF08A'), 0.96);
  cv.fillPolygon(
    [
      [x + 135, y + 67],
      [x + 115, y + 71],
      [x + 130, y + 86],
    ],
    hex('#FEF08A')
  );

  // Bottom callout strip
  cv.fillRoundedRect(x + 10, y + h - 34, w - 20, 24, 5, hex('#041715'), 0.86);
  drawText(cv, 'TW +9 · KR +6 · JP +4', x + w * 0.5, y + h - 27, hex('#86EFAC'), {
    size: 9.8,
    weight: 0.15,
    align: 'center',
    tracking: 0.03,
  });
  cv.setClip(null);
}

// 3. UN WARNS ON AI WEAPONS: UN globe + olive branches + barred autonomous drone reticle
function drawUNWeaponsArt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.setClip({ x, y, w, h, r: 9 });
  cv.fillRectGradV(x, y, w, h, hex('#0D1E45'), hex('#173673'), 9);
  cv.fillRadialGlow(x + w * 0.5, y + 86, 78, hex('#3B82F6'), 0.30);

  const gcx = x + w * 0.5;
  const gcy = y + 84;
  const gr = 40;

  // Stylized UN Globe meridians & parallels
  cv.fillCircle(gcx, gcy, gr, hex('#1D4ED8'), 0.55);
  cv.strokeCircle(gcx, gcy, gr, 2.2, hex('#93C5FD'), 0.9);
  cv.strokeCircle(gcx, gcy, gr * 0.62, 1.3, hex('#93C5FD'), 0.55);
  cv.strokeCircle(gcx, gcy, gr * 0.28, 1.2, hex('#93C5FD'), 0.45);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 4;
    cv.drawLine(
      gcx - Math.cos(a) * gr,
      gcy - Math.sin(a) * gr,
      gcx + Math.cos(a) * gr,
      gcy + Math.sin(a) * gr,
      1.2,
      hex('#93C5FD'),
      0.45
    );
  }

  // Stylized UN olive-branch laurel arcs flanking the globe
  cv.drawArc(gcx, gcy + 2, 54, 52, 0.48 * Math.PI, 1.28 * Math.PI, 3.2, hex('#BAE6FD'), 0.85);
  cv.drawArc(gcx, gcy + 2, 54, 52, -0.28 * Math.PI, 0.52 * Math.PI, 3.2, hex('#BAE6FD'), 0.85);
  // Small leaf ticks along laurel
  for (let i = 0; i < 6; i++) {
    const aL = (0.62 + i * 0.11) * Math.PI;
    cv.fillCircle(gcx + Math.cos(aL) * 58, gcy + 2 + Math.sin(aL) * 56, 3.2, hex('#E0F2FE'), 0.85);
    const aR = (0.38 - i * 0.11) * Math.PI;
    cv.fillCircle(gcx + Math.cos(aR) * 58, gcy + 2 + Math.sin(aR) * 56, 3.2, hex('#E0F2FE'), 0.85);
  }

  // Foreground Autonomous Drone / AI Reticle + Prohibition Ban Sign
  const bx = x + w * 0.5;
  const by = y + 116;
  const br = 33;
  cv.fillCircle(bx, by, br + 4, hex('#0D1E45'), 0.88);

  // Stylized military drone silhouette inside circle
  cv.fillPolygon(
    [
      [bx, by - 16],
      [bx + 6, by - 4],
      [bx + 24, by + 4],
      [bx + 24, by + 9],
      [bx + 5, by + 5],
      [bx + 3, by + 16],
      [bx + 10, by + 20],
      [bx - 10, by + 20],
      [bx - 3, by + 16],
      [bx - 5, by + 5],
      [bx - 24, by + 9],
      [bx - 24, by + 4],
      [bx - 6, by - 4],
    ],
    hex('#E2E8F0')
  );
  // Glowing AI red eye sensor on drone
  cv.fillCircle(bx, by - 2, 3.5, hex('#FACC15'));

  // Crisp Crimson Prohibition Ring & Diagonal Slash
  cv.strokeCircle(bx, by, br, 5.5, hex('#EF4444'));
  cv.drawLine(bx - 22, by - 22, bx + 22, by + 22, 5.5, hex('#EF4444'));

  // Bottom callout strip
  cv.fillRoundedRect(x + 10, y + h - 34, w - 20, 24, 5, hex('#09132B'), 0.86);
  drawText(cv, 'UN SECURITY COUNCIL', x + w * 0.5, y + h - 26.5, hex('#93C5FD'), {
    size: 9.2,
    weight: 0.15,
    align: 'center',
    tracking: 0.03,
  });
  cv.setClip(null);
}

// 4. ZAPORIZHZHIA STRIKE: 5-story residential apartment block, breach glow, rescue spotlight
function drawZaporizhzhiaArt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.setClip({ x, y, w, h, r: 9 });
  cv.fillRectGradV(x, y, w, h, hex('#131926'), hex('#232D42'), 9);
  cv.fillRadialGlow(x + 104, y + 66, 62, hex('#F97316'), 0.34);

  // Rescue searchlight cone sweeping upward from lower left
  cv.fillPolygon(
    [
      [x + 18, y + 174],
      [x + 76, y + 36],
      [x + 126, y + 54],
      [x + 28, y + 176],
    ],
    hex('#FEF3C7'),
    0.16
  );

  // Smoke cloud billowing from upper-right breach
  cv.fillCircle(x + 104, y + 48, 17, hex('#64748B'), 0.55);
  cv.fillCircle(x + 120, y + 34, 21, hex('#94A3B8'), 0.42);
  cv.fillCircle(x + 136, y + 20, 22, hex('#CBD5E1'), 0.25);

  // 5-Story Apartment Building Silhouette (damaged top-right corner)
  const bx = x + 32;
  const by = y + 46;
  const bw = 86;
  const bh = 128;
  const bldgPts: Point[] = [
    [bx, by],
    [bx + 54, by],
    [bx + 58, by + 18],
    [bx + 70, by + 22],
    [bx + 72, by + 38],
    [bx + bw, by + 44],
    [bx + bw, by + bh],
    [bx, by + bh],
  ];
  cv.fillPolygon(bldgPts, hex('#334155'));
  // Crisp structural edge highlight for 300px readability
  cv.drawLine(bx, by, bx + 54, by, 2, hex('#64748B'), 0.85);
  cv.drawLine(bx, by, bx, by + bh, 1.8, hex('#475569'), 0.85);
  // Side architectural shadow panel
  cv.fillRect(bx + 1, by + 1, 13, bh - 1, hex('#1E293B'), 0.72);

  // 5 Floors of apartment windows
  for (let floor = 0; floor < 5; floor++) {
    const wy = by + 10 + floor * 23;
    for (let col = 0; col < 4; col++) {
      // Skip damaged top-right windows
      if ((floor === 0 && col >= 2) || (floor === 1 && col === 3)) continue;
      const wx = bx + 18 + col * 16;
      const lit = (floor === 2 && col === 1) || (floor === 3 && col === 0) || (floor === 4 && col === 2);
      cv.fillRect(wx, wy, 10, 14, lit ? hex('#FBBF24') : hex('#0F172A'), lit ? 0.92 : 0.88);
    }
  }

  // Glowing blast breach edges on top-right
  cv.fillPolygon(
    [
      [bx + 54, by + 2],
      [bx + 66, by + 18],
      [bx + 82, by + 34],
      [bx + 70, by + 38],
      [bx + 56, by + 22],
    ],
    hex('#F97316'),
    0.94
  );
  cv.fillCircle(bx + 66, by + 24, 7, hex('#FEF08A'), 0.9);

  // Rubble mound at base right
  cv.fillPolygon(
    [
      [bx + 54, by + bh],
      [bx + 78, by + bh - 16],
      [bx + 106, by + bh - 6],
      [bx + 114, by + bh],
    ],
    hex('#475569')
  );

  // Emergency vehicle beacon dots (red + blue) at street level
  cv.fillRadialGlow(x + 22, y + 170, 16, hex('#EF4444'), 0.55);
  cv.fillRadialGlow(x + 36, y + 170, 16, hex('#3B82F6'), 0.55);
  cv.fillCircle(x + 22, y + 170, 4, hex('#FCA5A5'));
  cv.fillCircle(x + 36, y + 170, 4, hex('#93C5FD'));

  // Bottom callout strip
  cv.fillRoundedRect(x + 10, y + h - 34, w - 20, 24, 5, hex('#0B0F1A'), 0.88);
  drawText(cv, '2 DEAD · 44+ INJURED', x + w * 0.5, y + h - 26.5, hex('#FCA5A5'), {
    size: 9.4,
    weight: 0.15,
    align: 'center',
    tracking: 0.03,
  });
  cv.setClip(null);
}

// 5. UK HEAT DEATHS: Scorching sun, spiking red thermometer, 2022 vs 2026 bar chart
function drawHeatDeathsArt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.setClip({ x, y, w, h, r: 9 });
  cv.fillRectGradV(x, y, w, h, hex('#45100D'), hex('#240908'), 9);
  cv.fillRadialGlow(x + 44, y + 44, 66, hex('#F97316'), 0.42);

  // Radiant summer sun (upper-left)
  const sx = x + 44;
  const sy = y + 43;
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI * 2) / 12;
    cv.drawLine(sx + Math.cos(a) * 21, sy + Math.sin(a) * 21, sx + Math.cos(a) * 29, sy + Math.sin(a) * 29, 2.8, hex('#FBBF24'), 0.92);
  }
  cv.fillCircle(sx, sy, 16.5, hex('#F97316'));
  cv.fillCircle(sx, sy, 12, hex('#FDE047'));

  // Sleek Thermometer (upper-right, positioned cleanly above the 5,258 label)
  const tx = x + 112;
  const tyTop = y + 14;
  const tyBulb = y + 67;
  cv.fillRoundedRect(tx - 6.5, tyTop, 13, tyBulb - tyTop + 3, 6.5, hex('#F8FAFC'), 0.96);
  cv.fillCircle(tx, tyBulb, 11.5, hex('#F8FAFC'), 0.96);
  // Red mercury column near maximum
  cv.fillRoundedRect(tx - 3.8, tyTop + 7, 7.6, tyBulb - tyTop - 3, 3.8, hex('#DC2626'));
  cv.fillCircle(tx, tyBulb, 7.8, hex('#DC2626'));
  cv.fillCircle(tx - 2.4, tyBulb - 2.4, 2.2, hex('#FCA5A5'), 0.85);
  // Temperature ticks
  for (let i = 0; i < 4; i++) {
    const ty = tyTop + 11 + i * 10;
    cv.drawLine(tx + 9, ty, tx + 15, ty, 1.8, hex('#FDBA74'), 0.85);
  }

  // Record-Breaking Bar Comparison (2022: 2,985 vs 2026: 5,258)
  const baseY = y + 174;
  cv.drawLine(x + 14, baseY, x + w - 14, baseY, 1.6, hex('#FCA5A5'), 0.45);
  // 2022 bar (height 33px)
  const b1H = 33;
  cv.fillRoundedRect(x + 22, baseY - b1H, 42, b1H, 4, hex('#F59E0B'), 0.88);
  drawText(cv, '2,985', x + 43, baseY - b1H - 17, hex('#FDE68A'), {
    size: 11.5,
    weight: 0.15,
    align: 'center',
  });
  drawText(cv, '2022', x + 43, baseY - 15, hex('#451A03'), {
    size: 10.5,
    weight: 0.16,
    align: 'center',
  });

  // Dashed previous-record line
  for (let dx = x + 66; dx < x + w - 16; dx += 8) {
    cv.drawLine(dx, baseY - b1H, dx + 4, baseY - b1H, 1.4, hex('#FDE047'), 0.72);
  }

  // 2026 bar (height 58px -> 5,258 label at y+99, 20px clear below thermometer bulb!)
  const b2H = 58;
  cv.fillRoundedRect(x + 84, baseY - b2H, 42, b2H, 4, hex('#EF4444'));
  drawText(cv, '5,258', x + 105, baseY - b2H - 18, hex('#FFFFFF'), {
    size: 12.5,
    weight: 0.175,
    align: 'center',
  });
  drawText(cv, '2026', x + 105, baseY - 15, hex('#FFFFFF'), {
    size: 10.5,
    weight: 0.16,
    align: 'center',
  });

  // Bottom callout strip
  cv.fillRoundedRect(x + 10, y + h - 34, w - 20, 24, 5, hex('#1B0605'), 0.88);
  drawText(cv, 'ENGLAND · UKHSA', x + w * 0.5, y + h - 26.5, hex('#FCA5A5'), {
    size: 10.2,
    weight: 0.15,
    align: 'center',
    tracking: 0.05,
  });
  cv.setClip(null);
}

// 6. DR CONGO EBOLA VACCINE: Stylized Africa silhouette + DRC pulse + vaccine vial & shield
function drawEbolaVaccineArt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.setClip({ x, y, w, h, r: 9 });
  cv.fillRectGradV(x, y, w, h, hex('#082628'), hex('#0F3D3E'), 9);
  cv.fillRadialGlow(x + 60, y + 96, 74, hex('#14B8A6'), 0.28);

  // Stylized Africa continent silhouette (clean geometric polygon)
  const af: Point[] = [
    [x + 26, y + 28],
    [x + 54, y + 24],
    [x + 74, y + 34],
    [x + 84, y + 56],
    [x + 96, y + 68],
    [x + 88, y + 94],
    [x + 78, y + 126],
    [x + 64, y + 156],
    [x + 50, y + 156],
    [x + 44, y + 124],
    [x + 40, y + 98],
    [x + 20, y + 88],
    [x + 14, y + 68],
    [x + 16, y + 46],
  ];
  cv.fillPolygon(af, hex('#115E59'), 0.92);
  cv.drawPolyline([...af, af[0]], 1.8, hex('#5EEAD4'), 0.72);

  // Pulsing location marker on DR Congo (central Africa)
  const dx = x + 60;
  const dy = y + 96;
  cv.strokeCircle(dx, dy, 14, 1.5, hex('#FBBF24'), 0.45);
  cv.strokeCircle(dx, dy, 9, 1.8, hex('#FBBF24'), 0.85);
  cv.fillCircle(dx, dy, 4.5, hex('#FDE047'));

  // Sleek Vaccine Vial (right foreground, cleanly separated below DOSES label)
  const vx = x + 94;
  const vy = y + 66;
  // Metallic cap
  cv.fillRoundedRect(vx + 6, vy, 24, 9, 3, hex('#CBD5E1'));
  cv.fillRect(vx + 9, vy + 9, 18, 7, hex('#94A3B8'));
  // Glass vial body
  cv.fillRoundedRect(vx, vy + 16, 36, 70, 7, hex('#E2E8F0'), 0.95);
  // Teal vaccine serum inside lower half
  cv.fillRoundedRect(vx + 4, vy + 50, 28, 32, 4, hex('#0D9488'));
  // White label band + crisp medical cross
  cv.fillRect(vx + 3, vy + 29, 30, 25, hex('#FFFFFF'));
  cv.fillRect(vx + 15, vy + 34, 6, 15, hex('#0D9488'));
  cv.fillRect(vx + 10.5, vy + 38.5, 15, 6, hex('#0D9488'));
  // Subtle glass reflection highlight
  cv.drawLine(vx + 6, vy + 21, vx + 6, vy + 80, 2.2, hex('#FFFFFF'), 0.65);

  // Hero "1.5M" callout top-right (well above vial cap)
  drawText(cv, '1.5M', x + w - 12, y + 14, hex('#5EEAD4'), {
    size: 22,
    weight: 0.175,
    align: 'right',
    tracking: 0.03,
  });
  drawText(cv, 'DOSES', x + w - 12, y + 38, hex('#CCFBF1'), {
    size: 10,
    weight: 0.145,
    align: 'right',
    tracking: 0.08,
  });

  // Bottom callout strip
  cv.fillRoundedRect(x + 10, y + h - 34, w - 20, 24, 5, hex('#041A1B'), 0.88);
  drawText(cv, 'GAVI · DR CONGO', x + w * 0.5, y + h - 26.5, hex('#5EEAD4'), {
    size: 10.2,
    weight: 0.15,
    align: 'center',
    tracking: 0.05,
  });
  cv.setClip(null);
}

// ---------------------------------------------------------------------------
// Story Cards Data (All verified to Tuesday, 24 November 2026)
// ---------------------------------------------------------------------------
interface StoryCard {
  category: string;
  accent: RGB;
  pillBg: RGB;
  headline: readonly [string, string];
  lines: readonly string[];
  drawArt: (cv: Canvas, x: number, y: number, w: number, h: number) => void;
}

const STORIES: readonly StoryCard[] = [
  {
    category: 'MARITIME · MIDDLE EAST',
    accent: hex('#C2410C'),
    pillBg: hex('#FFEDD5'),
    headline: ['STRAIT OF HORMUZ', 'TANKER ALERTS'],
    lines: [
      "Iran's IRGC reports 3 oil",
      'tankers hit mines; UK sea',
      'monitors log ship strikes',
      'amid US naval blockade',
    ],
    drawArt: drawHormuzArt,
  },
  {
    category: 'MARKETS · EAST ASIA',
    accent: hex('#0F766E'),
    pillBg: hex('#CCFBF1'),
    headline: ['ASIAN CHIP', 'STOCKS SURGE'],
    lines: [
      'Taiwan +9%, Kospi +6%,',
      'Nikkei +4% in Tuesday',
      'semiconductor rally after',
      'Nvidia reinstates its CEO',
    ],
    drawArt: drawAsianMarketArt,
  },
  {
    category: 'DIPLOMACY · UN / GLOBAL',
    accent: hex('#1D4ED8'),
    pillBg: hex('#DBEAFE'),
    headline: ['UN WARNS ON', 'AI WEAPONS'],
    lines: [
      'Security Council debates',
      'tech in warfare; Guterres',
      'urges ban on autonomous',
      '"killer robots"',
    ],
    drawArt: drawUNWeaponsArt,
  },
  {
    category: 'CONFLICT · EUROPE',
    accent: hex('#B91C1C'),
    pillBg: hex('#FEE2E2'),
    headline: ['ZAPORIZHZHIA', 'APARTMENT HIT'],
    lines: [
      'Russian nighttime strike',
      'hits 5-story apartment in',
      'Ukraine; 2 killed, 44+',
      'wounded in rescue search',
    ],
    drawArt: drawZaporizhzhiaArt,
  },
  {
    category: 'CLIMATE · UNITED KINGDOM',
    accent: hex('#DC2626'),
    pillBg: hex('#FEF3C7'),
    headline: ['RECORD 5,258', 'HEAT DEATHS'],
    lines: [
      "UKHSA reports England's",
      'worst summer heat toll',
      'in 2026, surpassing',
      "2022's record of 2,985",
    ],
    drawArt: drawHeatDeathsArt,
  },
  {
    category: 'SCIENCE & HEALTH · AFRICA',
    accent: hex('#0D9488'),
    pillBg: hex('#CCFBF1'),
    headline: ['1.5M EBOLA', 'VACCINE DEAL'],
    lines: [
      'Gavi commits to buy up to',
      '1.5M experimental Oxford',
      '& Serum Inst. doses for',
      'DR Congo Ebola outbreak',
    ],
    drawArt: drawEbolaVaccineArt,
  },
];

// ---------------------------------------------------------------------------
// Main Poster Composition (1024 x 1024)
// ---------------------------------------------------------------------------
function renderPoster(): Canvas {
  const cv = new Canvas(WIDTH, HEIGHT, PAL.paper);

  // Subtle warm archival top-to-bottom vignette on background canvas
  cv.fillRectGradV(0, 148, WIDTH, HEIGHT - 148, hex('#F4F0E6'), hex('#EAE4D6'), 0);

  // === MASTHEAD BANNER (y = 0..148) ===
  cv.fillRectGradV(0, 0, WIDTH, 114, PAL.navyDark, hex('#16233B'), 0);
  // Top crimson news stripe
  cv.fillRect(0, 0, WIDTH, 7, PAL.crimson);

  // Stylized editorial globe emblem on masthead left
  const gx = 60;
  const gy = 62;
  const gr = 28;
  cv.fillCircle(gx, gy, gr, hex('#1E3A5F'), 0.85);
  cv.strokeCircle(gx, gy, gr, 2.2, PAL.gold, 0.92);
  cv.drawArc(gx, gy, gr * 0.52, gr, -Math.PI * 0.5, Math.PI * 0.5, 1.5, PAL.gold, 0.7);
  cv.drawArc(gx, gy, gr * 0.52, gr, Math.PI * 0.5, Math.PI * 1.5, 1.5, PAL.gold, 0.7);
  cv.drawLine(gx - gr, gy, gx + gr, gy, 1.5, PAL.gold, 0.75);
  cv.drawLine(gx - gr * 0.84, gy - gr * 0.5, gx + gr * 0.84, gy - gr * 0.5, 1.3, PAL.gold, 0.55);
  cv.drawLine(gx - gr * 0.84, gy + gr * 0.5, gx + gr * 0.84, gy + gr * 0.5, 1.3, PAL.gold, 0.55);

  // Masthead title block
  drawText(cv, 'GLOBAL EDITION · DAILY BRIEFING', 104, 21, PAL.gold, {
    size: 13.5,
    weight: 0.15,
    tracking: 0.08,
  });
  drawText(cv, 'WORLD NEWS', 102, 44, PAL.white, {
    size: 50,
    weight: 0.175,
    tracking: 0.045,
  });

  // Prominent Crimson Date Block (top-right, immediately legible at 300px!)
  const dateBoxX = 682;
  const dateBoxY = 17;
  const dateBoxW = 316;
  const dateBoxH = 84;
  cv.fillRoundedRect(dateBoxX, dateBoxY, dateBoxW, dateBoxH, 8, PAL.crimson);
  cv.fillRect(dateBoxX + 12, dateBoxY + dateBoxH - 4, dateBoxW - 24, 4, PAL.gold);
  drawText(cv, 'TUESDAY', dateBoxX + dateBoxW * 0.5, dateBoxY + 10, hex('#FDE68A'), {
    size: 14,
    weight: 0.16,
    align: 'center',
    tracking: 0.16,
  });
  drawText(cv, '24 NOV 2026', dateBoxX + dateBoxW * 0.5, dateBoxY + 32, PAL.white, {
    size: 35,
    weight: 0.175,
    align: 'center',
    tracking: 0.04,
  });

  // Masthead sub-bar with full formal date & beat summary (y = 114..148)
  cv.fillRect(0, 114, WIDTH, 34, PAL.navyMid);
  cv.fillRect(0, 114, WIDTH, 2, PAL.gold);
  drawText(
    cv,
    'TUESDAY, 24 NOVEMBER 2026  ·  MIDDLE EAST · ASIA · UN · EUROPE · UK · AFRICA',
    WIDTH * 0.5,
    125,
    hex('#E2E8F0'),
    {
      size: 13.5,
      weight: 0.14,
      align: 'center',
      tracking: 0.055,
    }
  );

  // === 2 x 3 EDITORIAL STORY GRID (y = 166..972) ===
  const marginX = 24;
  const gapX = 20;
  const cardW = (WIDTH - marginX * 2 - gapX) / 2; // 478
  const cardH = 256;
  const gapY = 18;
  const gridY = 166;

  for (let idx = 0; idx < STORIES.length; idx++) {
    const story = STORIES[idx];
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cx = marginX + col * (cardW + gapX);
    const cy = gridY + row * (cardH + gapY);

    // Soft editorial paper drop shadow
    cv.drawDropShadow(cx, cy, cardW, cardH, 12, 4, 8, PAL.navyDark, 0.12);

    // Card white surface & crisp border
    cv.fillRoundedRect(cx, cy, cardW, cardH, 12, PAL.cardBg);
    cv.strokeRoundedRect(cx, cy, cardW, cardH, 12, 1.5, PAL.cardBorder);

    // Colored top beat accent bar (clipped cleanly to card rounded top)
    cv.setClip({ x: cx, y: cy, w: cardW, h: cardH, r: 12 });
    cv.fillRect(cx, cy, cardW, 7, story.accent);
    cv.setClip(null);

    // Left custom vector illustration panel
    const artX = cx + 15;
    const artY = cy + 21;
    const artW = 148;
    const artH = 220;
    story.drawArt(cv, artX, artY, artW, artH);
    cv.strokeRoundedRect(artX, artY, artW, artH, 9, 1.2, hex('#CBD5E1'), 0.45);

    // Right typography column
    const tx = cx + 178;

    // Category + Region pill badge
    const catSize = 11.5;
    const catW = measureText(story.category, catSize, 0.06) + 18;
    cv.fillRoundedRect(tx, cy + 21, catW, 23, 5, story.pillBg);
    drawText(cv, story.category, tx + 9, cy + 27, story.accent, {
      size: catSize,
      weight: 0.16,
      tracking: 0.06,
    });

    // Bold 2-line Headline (large & heavy for 300px legibility, generous right margin)
    drawText(cv, story.headline[0], tx, cy + 56, PAL.ink, {
      size: 23.5,
      weight: 0.175,
      tracking: 0.032,
    });
    drawText(cv, story.headline[1], tx, cy + 86, PAL.ink, {
      size: 23.5,
      weight: 0.175,
      tracking: 0.032,
    });

    // Editorial accent rule
    cv.fillRoundedRect(tx, cy + 121, 48, 3.5, 1.5, story.accent);

    // Crisp 4-line factual summary (high contrast ink for 300px legibility)
    for (let li = 0; li < story.lines.length; li++) {
      drawText(cv, story.lines[li], tx, cy + 136 + li * 25, hex('#1E293B'), {
        size: 16.5,
        weight: 0.138,
        tracking: 0.036,
      });
    }
  }

  // === FOOTER EDITION STRIP (y = 988..1024) ===
  cv.fillRect(0, 988, WIDTH, 36, PAL.navyDark);
  cv.fillRect(0, 988, WIDTH, 2, PAL.gold);
  drawText(
    cv,
    'WORLD NEWS SUMMARY  ·  TUESDAY, 24 NOVEMBER 2026  ·  POLITICS · MARKETS · CLIMATE · SCIENCE · CONFLICT',
    WIDTH * 0.5,
    1000,
    hex('#CBD5E1'),
    {
      size: 12,
      weight: 0.135,
      align: 'center',
      tracking: 0.05,
    }
  );

  return cv;
}

// ---------------------------------------------------------------------------
// Deterministic Pure-Node Lossless RGB PNG Encoder (with optimal row filters)
// ---------------------------------------------------------------------------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const len = data.length;
  const out = Buffer.allocUnsafe(len + 12);
  out.writeUInt32BE(len, 0);
  out.write(type, 4, 4, 'ascii');
  out.set(data, 8);
  const crc = crc32(out.subarray(4, len + 8));
  out.writeUInt32BE(crc, len + 8);
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function encodePNG(cv: Canvas): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0);
  ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB (opaque, smaller than RGBA)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = cv.w * 3;
  const raw = Buffer.allocUnsafe((stride + 1) * cv.h);
  const candidates = [
    new Uint8Array(stride),
    new Uint8Array(stride),
    new Uint8Array(stride),
    new Uint8Array(stride),
  ];

  for (let y = 0; y < cv.h; y++) {
    const rowOff = y * stride;
    const prevOff = (y - 1) * stride;

    let sum0 = 0;
    let sum1 = 0;
    let sum2 = 0;
    let sum4 = 0;

    for (let x = 0; x < stride; x++) {
      const cur = cv.data[rowOff + x];
      const left = x >= 3 ? cv.data[rowOff + x - 3] : 0;
      const up = y > 0 ? cv.data[prevOff + x] : 0;
      const upLeft = y > 0 && x >= 3 ? cv.data[prevOff + x - 3] : 0;

      const f0 = cur;
      const f1 = (cur - left) & 0xff;
      const f2 = (cur - up) & 0xff;
      const f4 = (cur - paeth(left, up, upLeft)) & 0xff;

      candidates[0][x] = f0;
      candidates[1][x] = f1;
      candidates[2][x] = f2;
      candidates[3][x] = f4;

      sum0 += f0 < 128 ? f0 : 256 - f0;
      sum1 += f1 < 128 ? f1 : 256 - f1;
      sum2 += f2 < 128 ? f2 : 256 - f2;
      sum4 += f4 < 128 ? f4 : 256 - f4;
    }

    let bestFilter = 0;
    let bestBuf = candidates[0];
    let bestSum = sum0;
    if (sum1 < bestSum) {
      bestSum = sum1;
      bestFilter = 1;
      bestBuf = candidates[1];
    }
    if (sum2 < bestSum) {
      bestSum = sum2;
      bestFilter = 2;
      bestBuf = candidates[2];
    }
    if (sum4 < bestSum) {
      bestFilter = 4;
      bestBuf = candidates[3];
    }

    const outOff = y * (stride + 1);
    raw[outOff] = bestFilter;
    raw.set(bestBuf, outOff + 1);
  }

  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const png = encodePNG(renderPoster());
writeFileSync(join(outDir, 'entry.png'), png);
