import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"

export function useSubmitFeedback() {
  return useMutation({
    mutationFn: async (message: string) => {
      const { data, error } = await api.feedback.post({ message })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      toast.success("Thanks for your feedback!")
    },
    onError: () => {
      toast.error("Failed to send feedback. Please try again.")
    },
  })
}
