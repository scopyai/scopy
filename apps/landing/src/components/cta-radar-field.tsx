import { useEffect, useRef } from "react"
import {
  type Pop,
  type Vec,
  WAVE_SPEED,
  POP_DURATION,
  dist,
  drawDot,
  drawPop,
  drawRing,
  rand,
} from "#/components/radar-draw"

type Dot = {
  pos: Vec
  appear: number
}

type Wave = {
  origin: Vec
  radius: number
  maxRadius: number
  phase: "expand" | "fade"
  fadeT: number
}

const FADE_DURATION = 0.7
const DOT_COUNT = 10
const APPEAR_SPEED = 3
const REGROW_DELAY = 1.2
const REGROW_EVERY = 0.5
const BLEED = 110
const HFADE = 90

export function CtaRadarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce) return

    const section = canvas.parentElement
    const inner = section?.querySelector<HTMLElement>(".l-cta-inner")

    let width = 0
    let height = 0
    let dpr = 1
    let keepOut = { x: 0, y: 0, w: 0, h: 0 }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      if (inner) {
        const ir = inner.getBoundingClientRect()
        const pad = 26
        keepOut = {
          x: ir.left - rect.left - pad,
          y: ir.top - rect.top - pad,
          w: ir.width + pad * 2,
          h: ir.height + pad * 2,
        }
      }
    }
    resize()
    window.addEventListener("resize", resize)
    const ro = new ResizeObserver(resize)
    if (section) ro.observe(section)

    const inKeepOut = (p: Vec) =>
      p.x >= keepOut.x &&
      p.x <= keepOut.x + keepOut.w &&
      p.y >= keepOut.y &&
      p.y <= keepOut.y + keepOut.h

    const makeDot = (): Dot => {
      let pos: Vec = { x: 0, y: 0 }
      for (let i = 0; i < 16; i++) {
        pos = {
          x: rand(HFADE, width - HFADE),
          y: rand(BLEED, height - BLEED),
        }
        if (!inKeepOut(pos)) break
      }
      return { pos, appear: 0 }
    }

    let dots: Dot[] = []
    let waves: Wave[] = []
    let pops: Pop[] = []
    let growAt = 0
    let elapsed = 0
    let last = performance.now()
    let raf = 0
    let seeded = false

    const spawnWave = (origin: Vec) => {
      const corners: Vec[] = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: 0, y: height },
        { x: width, y: height },
      ]
      waves.push({
        origin,
        radius: 0,
        maxRadius: Math.max(...corners.map((c) => dist(origin, c))),
        phase: "expand",
        fadeT: 0,
      })
    }

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      spawnWave({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    section?.addEventListener("pointerdown", onPointerDown)

    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      elapsed += dt

      ctx.clearRect(0, 0, width, height)

      if (!seeded && width > 0) {
        for (let i = 0; i < DOT_COUNT; i++) {
          const d = makeDot()
          d.appear = 1
          dots.push(d)
        }
        seeded = true
      }

      let ate = false
      for (const wave of waves) {
        if (wave.phase === "expand") {
          wave.radius += WAVE_SPEED * dt
          const fadeIn = Math.min(wave.radius / 90, 1)
          drawRing(ctx, wave.origin, wave.radius, 0.58 * fadeIn)

          dots = dots.filter((dot) => {
            if (dist(wave.origin, dot.pos) <= wave.radius) {
              pops.push({ pos: dot.pos, t: 0 })
              ate = true
              return false
            }
            return true
          })

          if (wave.radius >= wave.maxRadius) {
            wave.phase = "fade"
            wave.fadeT = 0
          }
        } else {
          wave.fadeT += dt
          wave.radius += WAVE_SPEED * 0.5 * dt
          const k = 1 - wave.fadeT / FADE_DURATION
          drawRing(ctx, wave.origin, wave.radius, 0.58 * Math.max(0, k))
        }
      }
      if (ate) growAt = elapsed + REGROW_DELAY
      waves = waves.filter(
        (w) => w.phase === "expand" || w.fadeT < FADE_DURATION
      )

      const anyExpanding = waves.some((w) => w.phase === "expand")
      if (!anyExpanding && dots.length < DOT_COUNT && elapsed >= growAt) {
        dots.push(makeDot())
        growAt = elapsed + REGROW_EVERY
      }

      const pulse = 0.45 + 0.25 * Math.sin(elapsed * 6)
      for (const dot of dots) {
        if (dot.appear < 1)
          dot.appear = Math.min(1, dot.appear + APPEAR_SPEED * dt)
        const ease = 1 - Math.pow(1 - dot.appear, 3)
        drawDot(ctx, dot.pos, pulse * ease, 0.4 + 0.6 * ease)
      }

      if (pops.length > 0) {
        for (const pop of pops) {
          pop.t += dt
          const p = pop.t / POP_DURATION
          if (p >= 1) continue
          drawPop(ctx, pop.pos, p)
        }
        pops = pops.filter((pop) => pop.t < POP_DURATION)
      }

      raf = requestAnimationFrame(draw)
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !raf) {
          last = performance.now()
          raf = requestAnimationFrame(draw)
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
      section?.removeEventListener("pointerdown", onPointerDown)
    }
  }, [])

  return <canvas ref={canvasRef} className="l-cta-radar" aria-hidden="true" />
}
