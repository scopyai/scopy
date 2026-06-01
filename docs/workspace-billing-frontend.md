# Workspace Billing Frontend Handoff

Workspace billing is exposed through the typed Eden Treaty API. Use React Query
for every read and mutation, including loading and error states.

## Queries

- `api.workspaces({ workspaceId }).billing.get()` returns `plans` and `account`.
  `account.tier` is `free`, `premium`, `ultra`, or `enterprise`. A workspace
  without a subscription returns `free` with `creditBalance: 0`.
- `api.workspaces({ workspaceId }).billing.credits.get({ query })` accepts
  `page` and `pageSize` and returns recent credit history entries plus
  pagination metadata.

All workspace members may use these reads.

## Mutations

Only the workspace owner may use these endpoints:

- `billing.checkout.post({ tier, requestId })` starts a Premium or Ultra
  checkout. Generate `requestId` with `crypto.randomUUID()`, then redirect the
  browser to the returned `url`.
- `billing.portal.post()` returns the Creem portal URL for invoice and
  payment-method management. Redirect the browser to the returned `url`.
- `billing.cancel.post()` schedules cancellation at the end of the current
  monthly period.
- `billing["change-plan"].post({ tier })` changes the recurring tier. Premium
  to Ultra applies immediately with Creem proration and refreshes credits.
  Ultra to Premium is scheduled for the next renewal and preserves the current
  Ultra credits until then.

Invalidate the workspace billing and credit-history queries after a completed
mutation. Checkout returns to `/billing/success?workspaceId=...`; that route
should invalidate and refetch billing state before navigating onward.

Enterprise is a contact-sales placeholder. Render the call to action from
`contactSales: true`; it has no checkout endpoint or product ID.

The billing query also exposes `cancelAtPeriodEnd`, `pendingTier`, and
`pendingChangeAt`. Scheduled cancellation may originate from the app or the
Creem portal. Resume is intentionally handled through the portal.
