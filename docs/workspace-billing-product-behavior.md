# Workspace Billing Product Behavior

This document describes how billing should appear and behave from the user's
perspective. It intentionally avoids backend and API implementation details.

## Billing Scope

Billing belongs to a workspace, not to an individual user account.

All reviews, actions, credits, subscriptions, and billing communication are
associated with the currently selected workspace. A user who belongs to
multiple workspaces may see a different plan and credit balance in each one.

All workspace members may view billing information. Only the workspace owner
may start checkout, manage billing, cancel a subscription, or change plans.

## Plans

The billing page presents these plans:

| Plan       | Billing period  | Monthly credits | User action                         |
| ---------- | --------------- | --------------: | ----------------------------------- |
| Free       | No subscription |               0 | Default for unsubscribed workspaces |
| Premium    | Monthly         |             100 | Subscribe or downgrade from Ultra   |
| Ultra      | Monthly         |             500 | Subscribe or upgrade from Premium   |
| Enterprise | Custom          |          Custom | Contact sales                       |

The listed prices and credit allowances are temporary launch defaults and may
change before release.

Enterprise is not purchased through the app. It should always be presented as
a contact-sales option.

## Credit Balance

The billing page shows the workspace's current credit balance and monthly
allowance.

Credits reset to the active plan's full monthly allowance when a payment is
successfully completed. Unused credits do not roll over into the next billing
period.

The user may view a recent credit history for the workspace. This should make
changes such as monthly grants, usage, and removals understandable.

Reviews are not blocked by credit balance yet. Credit enforcement will be
introduced later.

## Subscribing

An owner may subscribe a Free workspace to Premium or Ultra.

Starting a subscription redirects the owner to the Creem checkout. After a
successful payment, the user returns to the app and the billing page refreshes
to show the active plan and available credits.

Members who are not owners may see the plans and current billing information,
but paid actions should be presented as owner-only.

## Managing Billing

Paid workspaces show a **Manage billing** action. This opens the Creem billing
portal.

The portal is the place for invoices, payment-method management, and resuming
a subscription after cancellation has been scheduled.

## Upgrading

An owner may upgrade Premium to Ultra.

Before confirming, explain that:

- the upgrade takes effect immediately;
- Creem charges the prorated difference for the remaining billing period;
- the workspace credit balance refreshes immediately to the Ultra allowance.

After confirmation, the workspace should display Ultra as the active plan and
show the refreshed credit balance.

## Downgrading

An owner may downgrade Ultra to Premium.

Before confirming, explain that:

- the downgrade is scheduled for the next renewal;
- Ultra remains the active plan until the current billing period ends;
- the current Ultra credit balance remains available until renewal;
- Premium pricing and the Premium credit allowance begin at renewal.

After confirmation, continue displaying Ultra as the active plan and show a
clear banner such as:

> Downgrade to Premium scheduled for July 1, 2026.

The Premium plan should be marked as scheduled so the owner cannot submit the
same downgrade repeatedly.

## Cancellation

An owner may cancel a paid subscription from the app. A subscription may also
be canceled through the Creem portal or Creem dashboard.

Cancellation is scheduled for the end of the current billing period. Before
confirmation, explain that the subscription, credits, and access remain active
until that date.

After cancellation is scheduled:

- keep the current plan visible as active until the billing period ends;
- preserve the current credit balance;
- show the scheduled cancellation date clearly;
- prevent additional plan changes;
- direct owners to **Manage billing** if they want to resume.

There is no separate resume action inside the app.

If a downgrade was already scheduled, scheduling cancellation replaces it.
Cancellation takes precedence.

When the subscription reaches its cancellation date, remove the remaining
credits immediately and show the workspace as no longer actively subscribed.

## Failed Payments

If a payment is past due or unpaid while Creem is retrying payment, preserve
the workspace's existing credits. The user should not lose the balance during
the retry window.

If the subscription becomes paused or expires, remove the remaining credits.

Refunds and disputes also remove the remaining credits.
