import { useEffect, useRef } from "react"
import {
  POP_DURATION,
  drawDot,
  drawPop,
  inAnyRect,
  rand,
} from "#/components/radar-draw"
import type { Pop, Rect, Vec } from "#/components/radar-draw"

type Dot = {
  angle: number
  appear: number
  radius: number
  scale: number
  state: "appearing" | "alive" | "caught"
  t: number
}

const TAU = Math.PI * 2
const ACCENT = "91, 130, 255"
const DOT_LIMIT = 13
const DOT_INTERVAL = 0.62
const APPEAR_SPEED = 2.35
const SWEEP_SPEED = 0.58
const SWEEP_WIDTH = 0.74
const SWEEP_SEGMENTS = 30
const TOP_BLEED = 72
const BOTTOM_BLEED = 170
const EDGE_MARGIN = 26
const RING_STEPS = [0.24, 0.38, 0.52, 0.66, 0.8, 0.94]

function normAngle(angle: number) {
  return ((angle % TAU) + TAU) % TAU
}

function angleDelta(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
}

function polar(center: Vec, radius: number, angle: number): Vec {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  }
}

function strokeCircle(
  ctx: CanvasRenderingContext2D,
  center: Vec,
  radius: number,
  width: number,
  alpha: number
) {
  ctx.beginPath()
  ctx.arc(center.x, center.y, radius, 0, TAU)
  ctx.lineWidth = width
  ctx.strokeStyle = `rgba(${ACCENT}, ${alpha})`
  ctx.stroke()
}

function drawRadarPlane(
  ctx: CanvasRenderingContext2D,
  center: Vec,
  radius: number,
  angle: number
) {
  ctx.save()
  ctx.globalCompositeOperation = "lighter"

  const glow = ctx.createRadialGradient(
    center.x,
    center.y,
    radius * 0.05,
    center.x,
    center.y,
    radius
  )
  glow.addColorStop(0, `rgba(${ACCENT}, 0.03)`)
  glow.addColorStop(0.54, `rgba(${ACCENT}, 0.055)`)
  glow.addColorStop(1, `rgba(${ACCENT}, 0)`)
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(center.x, center.y, radius, 0, TAU)
  ctx.fill()

  for (const step of RING_STEPS) {
    strokeCircle(ctx, center, radius * step, 1, 0.12)
  }
  strokeCircle(ctx, center, radius, 1.5, 0.16)

  ctx.lineWidth = 1
  ctx.strokeStyle = `rgba(${ACCENT}, 0.07)`
  for (let a = 0; a < TAU; a += Math.PI / 6) {
    const end = polar(center, radius, a)
    ctx.beginPath()
    ctx.moveTo(center.x, center.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
  }

  for (let i = 0; i < SWEEP_SEGMENTS; i += 1) {
    const t0 = i / SWEEP_SEGMENTS
    const t1 = (i + 1) / SWEEP_SEGMENTS
    const a0 = angle - SWEEP_WIDTH + SWEEP_WIDTH * t0
    const a1 = angle - SWEEP_WIDTH + SWEEP_WIDTH * t1
    const strength = Math.pow(t1, 2.1)
    const sweepGradient = ctx.createRadialGradient(
      center.x,
      center.y,
      radius * 0.06,
      center.x,
      center.y,
      radius
    )
    sweepGradient.addColorStop(0, `rgba(${ACCENT}, ${0.014 * strength})`)
    sweepGradient.addColorStop(0.56, `rgba(${ACCENT}, ${0.18 * strength})`)
    sweepGradient.addColorStop(1, `rgba(${ACCENT}, 0)`)

    ctx.fillStyle = sweepGradient
    ctx.beginPath()
    ctx.moveTo(center.x, center.y)
    ctx.arc(center.x, center.y, radius, a0, a1)
    ctx.closePath()
    ctx.fill()
  }

  const lead = polar(center, radius, angle)

  ctx.beginPath()
  ctx.moveTo(center.x, center.y)
  ctx.lineTo(lead.x, lead.y)
  ctx.lineWidth = 7
  ctx.strokeStyle = `rgba(${ACCENT}, 0.12)`
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(center.x, center.y)
  ctx.lineTo(lead.x, lead.y)
  ctx.lineWidth = 2.4
  ctx.strokeStyle = `rgba(${ACCENT}, 0.62)`
  ctx.stroke()

  strokeCircle(ctx, center, 5, 2, 0.28)
  strokeCircle(ctx, center, 17, 1, 0.12)

  ctx.restore()
}

function fadeUnderContent(ctx: CanvasRenderingContext2D, rects: Rect[]) {
  ctx.save()
  ctx.globalCompositeOperation = "destination-out"
  for (const rect of rects) {
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    const radius = Math.max(rect.w * 0.58, rect.h * 1.7, 120)
    const fade = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    fade.addColorStop(0, "rgba(0, 0, 0, 0.88)")
    fade.addColorStop(0.55, "rgba(0, 0, 0, 0.62)")
    fade.addColorStop(1, "rgba(0, 0, 0, 0)")
    ctx.fillStyle = fade
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
  }
  ctx.restore()
}

export function RadarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    let width = 0
    let height = 0
    let radarRadius = 0
    let center: Vec = { x: 0, y: 0 }
    let dpr = 1

    const hero = canvas.closest<HTMLElement>(".l-hero")
    const keepOutEls = [".l-hero-title", ".l-hero-sub", ".l-hero-ctas"].map(
      (sel) => document.querySelector<HTMLElement>(sel)
    )

    const keepOutRects = (): Rect[] => {
      const host = hero?.getBoundingClientRect()
      const pad = 20
      const rects: Rect[] = []
      if (!host) return rects
      for (const el of keepOutEls) {
        if (!el) continue
        const r = el.getBoundingClientRect()
        rects.push({
          x: r.left - host.left - pad,
          y: r.top - host.top + TOP_BLEED - pad,
          w: r.width + pad * 2,
          h: r.height + pad * 2,
        })
      }
      return rects
    }

    const resize = () => {
      const rect =
        hero?.getBoundingClientRect() ?? canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height + TOP_BLEED + BOTTOM_BLEED
      center = {
        x: width / 2,
        y: TOP_BLEED + rect.height * (width < 820 ? 0.57 : 0.56),
      }
      radarRadius = Math.max(width * 0.54, height * 0.9)
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      canvas.style.top = `${-TOP_BLEED}px`
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener("resize", resize)

    const ro = new ResizeObserver(resize)
    if (hero) ro.observe(hero)

    let ringIndex = 0
    let angleCursor = rand(-0.25, 0.25)

    // Targets appear one by one on radar rings, then wait for the sweep.
    const makeDot = (): Dot => {
      const blocked = keepOutRects()
      let angle = 0
      let radius = 0
      for (let i = 0; i < 24; i++) {
        const ring = RING_STEPS[ringIndex % RING_STEPS.length]
        ringIndex += 1
        angleCursor = normAngle(angleCursor + rand(0.58, 1.08))
        angle = angleCursor
        radius = radarRadius * ring + rand(-10, 10)
        const pos = polar(center, radius, angle)
        const inBounds =
          pos.x > EDGE_MARGIN &&
          pos.x < width - EDGE_MARGIN &&
          pos.y > EDGE_MARGIN &&
          pos.y < height - EDGE_MARGIN
        if (inBounds && !inAnyRect(pos, blocked)) break
      }
      return {
        angle,
        radius,
        appear: 0,
        scale: rand(0.72, 1.05),
        state: "appearing",
        t: 0,
      }
    }

    let dots: Dot[] = []
    let pops: Pop[] = []
    let nextDotAt = 0.45
    let elapsed = 0
    let last = performance.now()
    let raf = 0

    const render = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      elapsed += dt

      ctx.clearRect(0, 0, width, height)

      const sweepAngle = normAngle(-Math.PI / 2 + elapsed * SWEEP_SPEED)
      drawRadarPlane(ctx, center, radarRadius, sweepAngle)

      if (dots.length < DOT_LIMIT && elapsed >= nextDotAt && width > 0) {
        dots.push(makeDot())
        nextDotAt = elapsed + DOT_INTERVAL + rand(-0.1, 0.18)
      }

      const pulse = 0.6 + 0.28 * Math.sin(elapsed * 6)
      for (const dot of dots) {
        dot.t += dt
        const pos = polar(center, dot.radius, dot.angle)

        if (dot.state === "appearing") {
          dot.appear = Math.min(1, dot.appear + APPEAR_SPEED * dt)
          if (dot.appear >= 1) dot.state = "alive"
        } else if (
          dot.state === "alive" &&
          dot.t > 0.4 &&
          angleDelta(dot.angle, sweepAngle) < 0.035
        ) {
          dot.state = "caught"
          dot.t = 0
          pops.push({ pos, t: 0 })
        }

        if (dot.state !== "caught") {
          const ease = 1 - Math.pow(1 - dot.appear, 3)
          drawDot(
            ctx,
            pos,
            Math.min(1, pulse * ease),
            dot.scale * (0.68 + 0.4 * ease)
          )
        }
      }
      dots = dots.filter((dot) => dot.state !== "caught")

      if (pops.length > 0) {
        for (const pop of pops) {
          pop.t += dt
          const p = pop.t / POP_DURATION
          if (p >= 1) continue
          drawPop(ctx, pop.pos, p)
        }
        pops = pops.filter((pop) => pop.t < POP_DURATION)
      }

      fadeUnderContent(ctx, keepOutRects())

      if (!reduce) raf = requestAnimationFrame(render)
    }

    if (reduce) render(performance.now())

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!reduce && entry.isIntersecting && !raf) {
          last = performance.now()
          raf = requestAnimationFrame(render)
        } else if (!entry.isIntersecting && raf) {
          cancelAnimationFrame(raf)
          raf = 0
        }
      },
      { rootMargin: "150px" }
    )
    io.observe(canvas)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
      ro.disconnect()
      io.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="l-radar" aria-hidden="true" />
}
