interface SettingsSectionProps {
  title: string
  description: string
  children: React.ReactNode
}

export function SettingsSection({
  title,
  description,
  children,
}: SettingsSectionProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-zinc-100 px-5 py-4 dark:bg-muted">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="flex flex-col gap-5 bg-white px-5 py-5 dark:bg-card">
        {children}
      </div>
    </section>
  )
}
