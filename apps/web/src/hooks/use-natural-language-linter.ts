import { useCallback, useEffect, useState } from "react"

export type NaturalLanguageLinterState = {
  rules: string[]
}

const STORAGE_PREFIX = "scopy:natural-language-linter"

const defaultState = (): NaturalLanguageLinterState => ({
  rules: [],
})

const storageKey = (workspaceId: string, repositoryId: string) =>
  `${STORAGE_PREFIX}:${workspaceId}:${repositoryId}`

const loadState = (key: string): NaturalLanguageLinterState => {
  if (typeof window === "undefined") return defaultState()

  try {
    const raw = localStorage.getItem(key)
    if (!raw) return defaultState()

    const parsed = JSON.parse(raw) as { rules?: unknown }
    return {
      rules: Array.isArray(parsed.rules)
        ? parsed.rules.filter(
            (rule): rule is string =>
              typeof rule === "string" && rule.trim().length > 0,
          )
        : [],
    }
  } catch {
    return defaultState()
  }
}

const persistState = (key: string, state: NaturalLanguageLinterState) => {
  localStorage.setItem(key, JSON.stringify(state))
}

export function useNaturalLanguageLinter(
  workspaceId: string,
  repositoryId: string,
) {
  const key = storageKey(workspaceId, repositoryId)
  const [state, setState] = useState<NaturalLanguageLinterState>(() =>
    loadState(key),
  )

  useEffect(() => {
    setState(loadState(key))
  }, [key])

  const update = useCallback(
    (updater: (current: NaturalLanguageLinterState) => NaturalLanguageLinterState) => {
      setState((current) => {
        const next = updater(current)
        try {
          persistState(key, next)
        } catch {
          // Ignore quota or private mode errors.
        }
        return next
      })
    },
    [key],
  )

  const addRule = useCallback(
    (rule: string) => {
      const trimmed = rule.trim()
      if (!trimmed) return
      update((current) => {
        if (current.rules.includes(trimmed)) return current
        return { rules: [...current.rules, trimmed] }
      })
    },
    [update],
  )

  const removeRule = useCallback(
    (rule: string) => {
      update((current) => ({
        rules: current.rules.filter((item) => item !== rule),
      }))
    },
    [update],
  )

  return {
    rules: state.rules,
    addRule,
    removeRule,
  }
}
