import {
  BookOpenIcon,
  BarChart3Icon,
  CreditCardIcon,
  ArrowUpRight,
  GitForkIcon,
  Settings2Icon,
  UsersIcon,
} from "lucide-react"
import { useEffect, useRef } from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"
import { useWorkspaceSlug } from "@/hooks/use-workspace-slug"

type AppRoute =
  | "/$workspaceSlug/repositories"
  | "/$workspaceSlug/analytics"
  | "/$workspaceSlug/settings"
  | "/$workspaceSlug/billing"
  | "/$workspaceSlug/manage-team"

interface NavItem {
  label: string
  icon: React.ComponentType<{ className?: string }>
  to: AppRoute
  external?: boolean
  disabled?: boolean
}

const workspaceItems: NavItem[] = [
  {
    label: "Repositories",
    icon: GitForkIcon,
    to: "/$workspaceSlug/repositories",
  },
  {
    label: "Analytics",
    icon: BarChart3Icon,
    to: "/$workspaceSlug/analytics",
  },
]

const managementItems: NavItem[] = [
  {
    label: "Billing",
    icon: CreditCardIcon,
    to: "/$workspaceSlug/billing",
  },
  {
    label: "Team",
    icon: UsersIcon,
    to: "/$workspaceSlug/manage-team",
  },
  {
    label: "Settings",
    icon: Settings2Icon,
    to: "/$workspaceSlug/settings",
  },
]

const resourceItems = [
  {
    label: "Docs",
    icon: BookOpenIcon,
    href: "https://docs.scopy.dev",
  },
]

function NavSection({
  title,
  items,
  currentPath,
  workspaceSlug,
}: {
  title: string
  items: NavItem[]
  currentPath: string
  workspaceSlug: string | undefined
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="sidebar-section-title px-3 py-2 text-sm font-medium text-muted-foreground">
        {title}
      </span>
      <div className="px-2">
        {items.map((item) => {
          const hrefSuffix = item.to.replace("/$workspaceSlug", "")
          const isActive =
            !!workspaceSlug &&
            currentPath.startsWith(`/${workspaceSlug}${hrefSuffix}`)
          const Icon = item.icon

          if (item.disabled || !workspaceSlug) {
            return (
              <div
                key={item.label}
                title={item.label}
                className="sidebar-item flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/50"
              >
                <Icon className="size-4 shrink-0" />
                <span className="sidebar-copy">{item.label}</span>
              </div>
            )
          }

          return (
            <Link
              key={item.label}
              to={item.to}
              params={{ workspaceSlug }}
              title={item.label}
              className={cn(
                "sidebar-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50 hover:text-foreground",
                isActive
                  ? "bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary"
                  : "text-muted-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="sidebar-copy">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function ResourceSection() {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="sidebar-section-title px-3 py-2 text-sm font-medium text-muted-foreground">
        Resources
      </span>
      <div className="px-2">
        {resourceItems.map((item) => {
          const Icon = item.icon
          return (
            <a
              key={item.label}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              title={item.label}
              className="sidebar-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              <Icon className="size-4 shrink-0" />
              <span className="sidebar-copy flex-1">{item.label}</span>
              <ArrowUpRight className="sidebar-end-icon size-4 shrink-0 opacity-60" />
            </a>
          )
        })}
      </div>
    </div>
  )
}

export function SidebarNav() {
  const currentPath = useRouterState({
    select: (s) => s.location.pathname,
  })
  const { workspaceSlug } = useWorkspaceSlug()

  return (
    <div className="flex flex-col gap-1 py-2">
      <NavSection
        title="Workspace"
        items={workspaceItems}
        currentPath={currentPath}
        workspaceSlug={workspaceSlug}
      />
      <NavSection
        title="Management"
        items={managementItems}
        currentPath={currentPath}
        workspaceSlug={workspaceSlug}
      />
      <ResourceSection />
    </div>
  )
}

export function MobileNav() {
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { workspaceSlug } = useWorkspaceSlug()
  const navRef = useRef<HTMLElement>(null)
  const activeItemRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    let animationFrame: number | undefined
    const nav = navRef.current
    if (!nav) return

    const scrollActiveItemIntoView = () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame)
      }

      animationFrame = window.requestAnimationFrame(() => {
        const activeItem = activeItemRef.current
        if (!activeItem) return

        const navBounds = nav.getBoundingClientRect()
        const navStyles = window.getComputedStyle(nav)
        const itemBounds = activeItem.getBoundingClientRect()
        const visibleLeft = navBounds.left + Number.parseFloat(navStyles.paddingLeft)
        const visibleRight =
          navBounds.right - Number.parseFloat(navStyles.paddingRight)

        if (itemBounds.left < visibleLeft) {
          nav.scrollLeft += itemBounds.left - visibleLeft
        } else if (itemBounds.right > visibleRight) {
          nav.scrollLeft += itemBounds.right - visibleRight
        }
      })
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) scrollActiveItemIntoView()
    })

    observer.observe(nav)
    if (activeItemRef.current) observer.observe(activeItemRef.current)
    scrollActiveItemIntoView()

    return () => {
      observer.disconnect()
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame)
      }
    }
  }, [currentPath, workspaceSlug])

  return (
    <nav
      ref={navRef}
      aria-label="Workspace navigation"
      className="flex gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {[...workspaceItems, ...managementItems].map((item) => {
        const Icon = item.icon
        const hrefSuffix = item.to.replace("/$workspaceSlug", "")
        const isActive =
          !!workspaceSlug &&
          currentPath.startsWith(`/${workspaceSlug}${hrefSuffix}`)

        if (!workspaceSlug) return null

        return (
          <Link
            key={item.label}
            ref={isActive ? activeItemRef : undefined}
            to={item.to}
            params={{ workspaceSlug }}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors",
              isActive && "bg-primary/10 font-medium text-primary"
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        )
      })}
      {resourceItems.map((item) => {
        const Icon = item.icon
        return (
          <a
            key={item.label}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground"
          >
            <Icon className="size-4" />
            {item.label}
          </a>
        )
      })}
    </nav>
  )
}
