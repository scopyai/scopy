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
  {
    label: "Review settings",
    icon: Settings2Icon,
    to: "/$workspaceSlug/settings",
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
]

const resourceItems = [
  {
    label: "CLI",
    icon: TerminalIcon,
    href: "https://docs.example.com/cli",
  },
  {
    label: "Docs",
    icon: BookOpenIcon,
    href: "https://docs.example.com",
    external: true as const,
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
      <span className="px-3 py-2 text-sm font-medium text-muted-foreground">
        {title}
      </span>
      <div className="px-2">
        {items.map((item) => {
          const hrefSuffix = item.to.replace("/$workspaceSlug", "")
          const isActive =
            !!workspaceSlug && currentPath.startsWith(`/${workspaceSlug}${hrefSuffix}`)
          const Icon = item.icon

          if (item.disabled || !workspaceSlug) {
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

          return (
            <Link
              key={item.label}
              to={item.to}
              params={{ workspaceSlug }}
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

function ResourceSection({ currentPath }: { currentPath: string }) {
  void currentPath
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-3 py-2 text-sm font-medium text-muted-foreground">
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
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {"external" in item && item.external && (
                <ArrowUpRight className="size-4 shrink-0 opacity-60" />
              )}
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
      <ResourceSection currentPath={currentPath} />
    </div>
  )
}
