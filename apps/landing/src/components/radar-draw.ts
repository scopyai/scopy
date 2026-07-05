export type Vec = { x: number; y: number }

export type Pop = {
  pos: Vec
  t: number
}

export const ACCENT = "91, 130, 255"

export const WAVE_SPEED = 360
export const POP_DURATION = 0.7

const TAU = Math.PI * 2

export function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

export type Rect = { x: number; y: number; w: number; h: number }

export function inAnyRect(p: Vec, rects: Rect[]) {
  for (const r of rects) {
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
      return true
    }
  }
  return false
}

function stroke(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  width: number,
  alpha: number
) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.lineWidth = width
  ctx.strokeStyle = `rgba(${ACCENT}, ${alpha})`
  ctx.stroke()
}

export function drawRing(
  ctx: CanvasRenderingContext2D,
  o: Vec,
  r: number,
  alpha: number
) {
  if (alpha <= 0.001 || r <= 0) return

  stroke(ctx, o.x, o.y, r, 22, alpha * 0.06)
  stroke(ctx, o.x, o.y, r, 8, alpha * 0.12)

  if (r - 24 > 0) stroke(ctx, o.x, o.y, r - 24, 1, alpha * 0.3)
  if (r - 50 > 0) stroke(ctx, o.x, o.y, r - 50, 1, alpha * 0.13)

  stroke(ctx, o.x, o.y, r, 1.8, Math.min(1, alpha * 1.2))
}

export function drawDot(
  ctx: CanvasRenderingContext2D,
  pos: Vec,
  alpha: number,
  scale = 1
) {
  ctx.beginPath()
  ctx.arc(pos.x, pos.y, 7 * scale, 0, TAU)
  ctx.fillStyle = `rgba(${ACCENT}, ${alpha * 0.14})`
  ctx.fill()

  stroke(ctx, pos.x, pos.y, 6 * scale, 1, alpha * 0.4)

  ctx.beginPath()
  ctx.arc(pos.x, pos.y, 3 * scale, 0, TAU)
  ctx.fillStyle = `rgba(${ACCENT}, ${alpha})`
  ctx.fill()
}

export function drawPop(ctx: CanvasRenderingContext2D, pos: Vec, p: number) {
  const ease = 1 - Math.pow(1 - p, 3)
  const r = 4 + ease * 26
  const a = 1 - p

  stroke(ctx, pos.x, pos.y, r, 5, a * 0.25)
  stroke(ctx, pos.x, pos.y, r, 1.8, a * 0.95)

  const core = 3.5 * (1 - p)
  if (core > 0.1) {
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, core, 0, TAU)
    ctx.fillStyle = `rgba(${ACCENT}, ${a})`
    ctx.fill()
  }
}
