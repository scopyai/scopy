import "./sidebar.css"
import { useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { WorkspaceSwitcher } from "./workspace-switcher"
import { MobileNav, SidebarNav } from "./sidebar-nav"
import { SidebarFeedback } from "./sidebar-feedback"
import { SidebarSupport } from "./sidebar-support"
import { UserMenu } from "./user-menu"

const MIN_SIDEBAR_WIDTH = 64
const MAX_SIDEBAR_WIDTH = 360
const DEFAULT_SIDEBAR_WIDTH = 260

export function AppSidebar() {
  const [width, setWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [resizeActive, setResizeActive] = useState(false)
  const [dragging, setDragging] = useState(false)
  const activationTimerRef = useRef<number | undefined>(undefined)
  const draggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH)
  const sidebarStyle: CSSProperties & Record<"--sidebar-width", string> = {
    "--sidebar-width": `${width}px`,
  }

  const clearActivationTimer = () => {
    if (activationTimerRef.current === undefined) return
    window.clearTimeout(activationTimerRef.current)
    activationTimerRef.current = undefined
  }

  useEffect(() => clearActivationTimer, [])

  return (
    <aside
      aria-label="Primary navigation"
      className="app-sidebar relative hidden h-svh shrink-0 flex-col border-r border-border bg-background text-sm md:flex"
      style={sidebarStyle}
    >
      <div className="flex h-14 shrink-0 items-center border-b border-border px-2">
        <WorkspaceSwitcher />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <SidebarNav />
      </div>

      <div className="flex shrink-0 flex-col gap-2 p-2">
        <SidebarFeedback onExpand={() => setWidth(DEFAULT_SIDEBAR_WIDTH)} />
        <SidebarSupport />
        <UserMenu />
      </div>
      <div
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        className="sidebar-resizer absolute inset-y-0 -right-1 z-10 hidden w-2 touch-none focus-visible:outline-none md:block"
        data-active={resizeActive ? "true" : undefined}
        data-dragging={dragging ? "true" : undefined}
        onPointerEnter={() => {
          clearActivationTimer()
          activationTimerRef.current = window.setTimeout(() => {
            setResizeActive(true)
            activationTimerRef.current = undefined
          }, 450)
        }}
        onPointerLeave={() => {
          if (draggingRef.current) return
          clearActivationTimer()
          setResizeActive(false)
        }}
        onPointerDown={(event) => {
          if (!resizeActive) return
          event.currentTarget.setPointerCapture(event.pointerId)
          draggingRef.current = true
          setDragging(true)
          dragStartXRef.current = event.clientX
          dragStartWidthRef.current = width
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          setWidth(
            Math.max(
              MIN_SIDEBAR_WIDTH,
              Math.min(
                MAX_SIDEBAR_WIDTH,
                dragStartWidthRef.current +
                  event.clientX -
                  dragStartXRef.current
              )
            )
          )
        }}
        onPointerUp={(event) => {
          draggingRef.current = false
          setDragging(false)
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          draggingRef.current = false
          setDragging(false)
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
          event.preventDefault()
          setWidth((currentWidth) =>
            Math.max(
              MIN_SIDEBAR_WIDTH,
              Math.min(
                MAX_SIDEBAR_WIDTH,
                currentWidth + (event.key === "ArrowLeft" ? -16 : 16)
              )
            )
          )
        }}
      />
    </aside>
  )
}

export function MobileHeader() {
  return (
    <header className="shrink-0 border-b border-border bg-background md:hidden">
      <div className="flex h-12 items-center gap-1 px-2">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher />
        </div>
        <UserMenu compact />
      </div>
      <MobileNav />
    </header>
  )
}
