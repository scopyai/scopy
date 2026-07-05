import { useEffect, useRef } from "react"
import {
  type Pop,
  type Rect,
  type Vec,
  WAVE_SPEED,
  POP_DURATION,
  dist,
  drawDot,
  drawPop,
  drawRing,
  inAnyRect,
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
const FADE_BAND = 300
const DOT_COUNT = 10
const APPEAR_SPEED = 3
const REGROW_DELAY = 0.9
const REGROW_EVERY = 0.38
const FIRE_DELAY = 1.0
const EDGE_MARGIN = 30

export function RadarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce) return

    let width = 0
    let height = 0
    let heroBottom = 0
    let dpr = 1

    const hero = document.querySelector<HTMLElement>(".l-hero")
    const keepOutEls = [
      ".l-nav",
      ".l-hero-title",
      ".l-hero-sub",
      ".l-hero-ctas",
    ].map((sel) => document.querySelector<HTMLElement>(sel))

    const keepOutRects = (): Rect[] => {
      const pad = 24
      const rects: Rect[] = []
      for (const el of keepOutEls) {
        if (!el) continue
        const r = el.getBoundingClientRect()
        rects.push({
          x: r.left - pad,
          y: r.top + window.scrollY - pad,
          w: r.width + pad * 2,
          h: r.height + pad * 2,
        })
      }
      return rects
    }

    const resize = () => {
      width = document.documentElement.clientWidth
      const heroRect = hero?.getBoundingClientRect()
      heroBottom = heroRect
        ? heroRect.bottom + window.scrollY
        : window.innerHeight
      height = heroBottom + FADE_BAND
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener("resize", resize)

    const ro = new ResizeObserver(resize)
    if (hero) ro.observe(hero)

    // A fresh bug in the empty space of the hero.
    const makeDot = (): Dot => {
      const blocked = keepOutRects()
      let pos: Vec = { x: 0, y: 0 }
      for (let i = 0; i < 24; i++) {
        pos = {
          x: rand(EDGE_MARGIN, width - EDGE_MARGIN),
          y: rand(EDGE_MARGIN, heroBottom - EDGE_MARGIN),
        }
        if (!inAnyRect(pos, blocked)) break
      }
      return { pos, appear: 0 }
    }

    const spawnWave = () => {
      const origin: Vec = { x: rand(0, width), y: rand(0, heroBottom) }
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

    let dots: Dot[] = []
    let waves: Wave[] = []
    let pops: Pop[] = []
    let growAt = 0.4
    let fireAt = Infinity
    let elapsed = 0
    let last = performance.now()
    let raf = 0

    const inView = () => window.scrollY < heroBottom * 0.6

    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      elapsed += dt

      ctx.clearRect(0, 0, width, height)

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
      if (
        !anyExpanding &&
        dots.length < DOT_COUNT &&
        elapsed >= growAt &&
        width > 0
      ) {
        dots.push(makeDot())
        growAt = elapsed + REGROW_EVERY
      }

      const pulse = 0.45 + 0.25 * Math.sin(elapsed * 6)
      let allSettled = dots.length >= DOT_COUNT
      for (const dot of dots) {
        if (dot.appear < 1) {
          dot.appear = Math.min(1, dot.appear + APPEAR_SPEED * dt)
        }
        if (dot.appear < 1) allSettled = false
        const ease = 1 - Math.pow(1 - dot.appear, 3)
        drawDot(ctx, dot.pos, pulse * ease, 0.4 + 0.6 * ease)
      }

      if (waves.length === 0 && allSettled && inView()) {
        if (fireAt === Infinity) fireAt = elapsed + FIRE_DELAY
        else if (elapsed >= fireAt) {
          spawnWave()
          fireAt = Infinity
        }
      } else {
        fireAt = Infinity
      }

      // Resolution bursts.
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
    }
  }, [])

  return <canvas ref={canvasRef} className="l-radar" aria-hidden="true" />
}
