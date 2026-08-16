type ValidationErrorHandler = (context: {
  code: unknown
  status: (...args: any[]) => any
}) => unknown

export const invalidRequest =
  (message: string): ValidationErrorHandler =>
  ({ code, status }) =>
    code === "VALIDATION" ? status(400, { error: message }) : undefined
