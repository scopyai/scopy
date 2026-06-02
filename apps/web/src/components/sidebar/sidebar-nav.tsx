"use client"

import {
  BookOpenIcon,
  BarChart3Icon,
  CreditCardIcon,
  ArrowUpRight,
  GitForkIcon,
  Settings2Icon,
  TerminalIcon,
  UsersIcon,
} from "lucide-react"
import { Link, useRouterState } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"

interface NavItem {
  label: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  external?: boolean
  disabled?: boolean
}

const workspaceItems: NavItem[] = [
  {
    label: "Repositories",
    icon: GitForkIcon,
    href: "/repositories",
  },
  {
    label: "Analytics",
    icon: BarChart3Icon,
    href: "/analytics",
  },
  {
    label: "Review settings",
    icon: Settings2Icon,
    href: "/settings",
  },
]

const managementItems: NavItem[] = [
  {
    label: "Billing",
    icon: CreditCardIcon,
    href: "/billing",
  },
  {
    label: "Team",
    icon: UsersIcon,
    href: "/manage-team",
  },
]

const resourceItems: NavItem[] = [
  {
    label: "CLI",
    icon: TerminalIcon,
    href: "https://docs.example.com/cli",
    external: true,
  },
  {
    label: "Docs",
    icon: BookOpenIcon,
    href: "https://docs.example.com",
    external: true,
  },
]

function NavSection({
  title,
  items,
  currentPath,
}: {
  title: string
  items: NavItem[]
  currentPath: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-3 py-2 text-sm font-medium text-muted-foreground">
        {title}
      </span>
      <div className="px-2">
        {items.map((item) => {
          const isActive = !item.external && currentPath.startsWith(item.href)
          const Icon = item.icon

          if (item.disabled) {
            return (
              <div
                key={item.label}
                className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/50"
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </div>
            )
          }

          if (item.external) {
            return (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                <ArrowUpRight className="size-4 shrink-0 opacity-60" />
              </a>
            )
          }

          return (
            <Link
              key={item.label}
              to={item.href as never}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50 hover:text-foreground",
                isActive ? "bg-accent text-foreground" : "text-muted-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
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

  return (
    <div className="flex flex-col gap-1 py-2">
      <NavSection
        title="Workspace"
        items={workspaceItems}
        currentPath={currentPath}
      />
      <NavSection
        title="Management"
        items={managementItems}
        currentPath={currentPath}
      />
      <NavSection
        title="Resources"
        items={resourceItems}
        currentPath={currentPath}
      />
    </div>
  )
}
