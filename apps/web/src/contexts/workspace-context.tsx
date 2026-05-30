import { createContext, useContext } from "react"

type WorkspaceContextType = {
  selectedWorkspaceId: string | null
  setSelectedWorkspaceId: (id: string | null) => void
}

export const WorkspaceContext = createContext<WorkspaceContextType>({
  selectedWorkspaceId: null,
  setSelectedWorkspaceId: () => {},
})

export const useWorkspaceContext = () => useContext(WorkspaceContext)
