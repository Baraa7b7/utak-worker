# Design note — future staff self-registration flow

*Written 2026-09-12. Deferred deliberately; do not implement until after the
first sim/team dry-runs land.*

## Current state (as of this note)

- New contacts auto-created from an incoming WhatsApp message get the
  **`customer` role only** — enforced in `createCustomer` in `src/odoo.ts`.
  The role row is looked up (or created once) in `x_employee_role` with
  `x_code = "customer"`.
- The Worker **never** infers a staff role from message content. There is
  no path in the codebase that promotes a partner to `driver`, `warehouse`,
  `collector`, or `admin` automatically.
- Team members are onboarded manually today: an operator with Odoo access
  edits the partner and adds a staff role id to `x_role_ids`.
- Team lookup: `findTeamMemberByWhatsApp` in `src/odoo.ts` matches on
  `x_whatsapp_number` **and** requires `x_role_ids != false`. So a
  customer-only partner never resolves as a team member, even if a driver
  reuses the same phone by mistake.

## Why we ban auto-staff-promotion

Operational messages (purchase list, driver route, collection request,
delivery-done) carry **customer PII**: names, neighborhoods, order line
items, and — after 2026-09-08 — precise WhatsApp locations. A partner who
tricks the system into being promoted to `driver` would start receiving
that data.

Text-based intent classification is not a trust boundary. Anyone can type
"أنا سواق UTAK". The role assignment must go through an out-of-band
approval — outside the message channel that would leak the data.

## Design constraints for the future flow

Any future team-role self-registration MUST satisfy all of these:

1. **Owner approval is required.** The requester's message triggers only
   a *pending* record. An approval step by Baraa (or a delegated admin
   in `x_role = admin`) is what activates the role.
2. **Records start disabled.** Until approved, the partner is either
   `active=false` or has `x_role_ids = []`. Either way, they are excluded
   by `findTeamMemberByWhatsApp` and by `getTeamMembersByRole`.
3. **No operational messages until approved.** The Worker must not send
   any of `PURCHASE_LIST`, `DRIVER_DISPATCH`, `DRIVER_STOP`,
   `DRIVER_COLLECTION`, `COLLECTION_REQUEST`, `COLLECTION_SUMMARY`, or
   any other staff-facing template to a partner whose role is pending.
4. **Approval is a WhatsApp button tap by Baraa**, not a text reply — so
   the approval is durable and traceable in the message log. Payload
   scheme: `approve_role_{partnerId}_{role}` / `reject_role_{partnerId}_{role}`.
5. **Audit trail.** Every state transition (requested / approved /
   rejected) writes to a new `x_role_change_log` model with:
   `x_partner_id`, `x_requested_role`, `x_state`, `x_actor_id`, `x_at`,
   `x_source_message_id`. Read-only from the Worker.
6. **Rate limit.** One pending request per partner. A second request
   silently replaces the pending state but keeps the log.

## Non-goals

- Automated verification (SMS code / QR / photo). Baraa's approval IS the
  verification.
- Role changes for existing team members via WhatsApp. Those keep going
  through Odoo directly.
- Customer role removal. A partner can hold both `customer` and a staff
  role concurrently; this is fine because operational templates are gated
  by staff-role lookups, not by absence of customer role.

## When to build

After:
1. The sim worker has run a full-team dry-run (drivers, warehouse,
   collector, admin) with manually-onboarded partners.
2. The team confirms the approval UX in Odoo works well enough that a
   WhatsApp-driven flow is even needed.
3. Baraa has a personal WhatsApp payload flow for approval buttons that
   he actually uses.

Until then: onboarding stays manual, and the safeguard in `createCustomer`
guarantees no staff role slips in through the auto-create path.
