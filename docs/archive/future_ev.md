# SME Ops — SaaS Evolution Plan

## Vision

Turn sme-ops from an internal ERP into a multi-tenant SaaS product sold to F&B businesses
(restaurants, cafés, chains) with modules toggled by subscription tier.

The architecture is already multi-tenant (organization_id + RLS). This plan builds the
commercial and operational layer on top of what exists.

---

## Tier Structure

### Starter — single outlet, <20 staff
Modules: POS, HR, Finance, Org, Process, System

### Growth — multi-outlet, CRM-driven
Modules: everything in Starter + CRM, Sales, Analytics, Purchase, WMS

### Enterprise — chain operations, full automation
Modules: everything in Growth + Manufacturing, LMS, AI, Integration

### Add-ons (available on any tier)
- **Membership** — customer loyalty, points, tier cards, LINE integration (member-app)

---

## Build Phases

### Phase 1 — Module Gate Foundation

Goal: any module can be shown/hidden per tenant based on their subscription.

**1.1 — `tenant_subscriptions` table**

```sql
CREATE TABLE tenant_subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id),
  tier                     TEXT NOT NULL CHECK (tier IN ('starter', 'growth', 'enterprise')),
  addons                   TEXT[] NOT NULL DEFAULT '{}',
  status                   TEXT NOT NULL CHECK (status IN ('trial', 'active', 'suspended', 'cancelled')),
  trial_ends_at            timestamptz,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  billing_cycle            TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  stripe_customer_id       TEXT,
  stripe_subscription_id   TEXT,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX ON tenant_subscriptions(organization_id);

ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members read own subscription"
  ON tenant_subscriptions FOR SELECT
  USING (organization_id = (
    SELECT organization_id FROM user_organizations WHERE user_id = auth.uid()
  ));
```

**1.2 — Module-to-tier mapping**

File: `src/lib/subscription/moduleTiers.js`

```js
export const MODULE_TIERS = {
  // Starter
  pos:          'starter',
  hr:           'starter',
  finance:      'starter',
  org:          'starter',
  process:      'starter',
  system:       'starter',
  // Growth
  crm:          'growth',
  sales:        'growth',
  analytics:    'growth',
  purchase:     'growth',
  wms:          'growth',
  // Enterprise
  manufacturing: 'enterprise',
  lms:           'enterprise',
  ai:            'enterprise',
  integration:   'enterprise',
  // Add-ons
  membership:   'addon',
}

const TIER_RANK = { starter: 0, growth: 1, enterprise: 2 }

export function canAccessModule(subscription, moduleKey) {
  if (!subscription || subscription.status === 'suspended') return false
  const required = MODULE_TIERS[moduleKey]
  if (required === 'addon') return subscription.addons?.includes(moduleKey)
  return TIER_RANK[subscription.tier] >= TIER_RANK[required]
}
```

**1.3 — `useTenantModule` hook**

File: `src/lib/subscription/useTenantModule.js`

```js
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { canAccessModule } from './moduleTiers'
import { useTenant } from '../../contexts/TenantContext'

export function useTenantSubscription() {
  const { organizationId } = useTenant()
  return useQuery({
    queryKey: ['tenant_subscription', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenant_subscriptions')
        .select('*')
        .eq('organization_id', organizationId)
        .single()
      if (error) throw error
      return data
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useTenantModule(moduleKey) {
  const { data: subscription } = useTenantSubscription()
  return canAccessModule(subscription, moduleKey)
}
```

**1.4 — Gate modules in sidebar nav**

Wrap each nav item with the hook. Also gate at the route level — redirect to `/upgrade`
if the module is not in the tenant's subscription.

---

### Phase 2 — Self-Serve Onboarding

Goal: a new tenant can sign up, pick a tier, and start a 14-day trial without manual
intervention.

**2.1 — Public signup flow**

Pages (outside authenticated layout):
- `/signup` — org name, contact email, phone, F&B sub-type
- `/signup/plan` — tier picker with feature comparison table
- `/signup/confirm` — summary + start trial CTA

On completion:
1. Create `organizations` record
2. Insert `tenant_subscriptions` with `status = 'trial'`, `trial_ends_at = now() + 14 days`
3. Create owner user + `user_organizations` with `super_admin` role
4. Redirect to app with welcome modal

**2.2 — Trial banner**

Persistent banner when `status = 'trial'`:
- Shows days remaining
- CTA: "升級方案" → billing page
- Disappears when `status = 'active'`

**2.3 — Upgrade / module locked state**

When a user navigates to a locked module:
- Show upgrade prompt page (not a blank redirect)
- Explain which tier unlocks it
- CTA to billing page

---

### Phase 3 — Stripe Billing Integration

Goal: connect subscription tier to real payments; automate status transitions.

**3.1 — Stripe products**

Create in Stripe dashboard:
- 3 products (Starter / Growth / Enterprise), each with monthly + annual prices
- 1 add-on product (Membership) with monthly + annual prices

**3.2 — Checkout flow**

On upgrade CTA:
1. Call Supabase Edge Function `create-checkout-session`
2. Edge function creates Stripe Checkout Session with `customer_email` and
   `metadata.organization_id`
3. Redirect to Stripe-hosted checkout
4. On success → Stripe webhook fires

**3.3 — Stripe webhook handler**

Supabase Edge Function `stripe-webhook`:

| Event | Action |
|---|---|
| `checkout.session.completed` | Set status = 'active', store Stripe IDs, set period dates |
| `invoice.paid` | Extend `current_period_end` |
| `customer.subscription.updated` | Handle tier upgrade / downgrade |
| `customer.subscription.deleted` | Set status = 'cancelled' |

**3.4 — Billing portal**

Link to Stripe Customer Portal for self-serve:
- Change plan
- Add/remove Membership add-on
- Update payment method
- Download invoices

---

### Phase 4 — Membership Add-on

Goal: package the existing member-app as a purchasable add-on.

**4.1 — Subscription gate**

- member-app checks `useTenantModule('membership')` on load
- If not subscribed → show add-on upsell page
- If subscribed → normal flow

**4.2 — Tenant-scoped membership data**

Verify all member-app tables have `organization_id` and matching RLS policies.
Add where missing.

**4.3 — Membership nav entry**

Add Membership to sidebar nav with add-on badge indicator. Available on any tier
when the add-on is purchased.

---

### Phase 5 — Super-Admin Tenant Dashboard

Goal: internal tooling to manage all tenants, monitor usage, handle support.

Extends the existing `/super-admin` module with new pages:

| Page | Purpose |
|---|---|
| `/super-admin/tenants` | List all orgs: tier, status, trial end dates |
| `/super-admin/tenants/[id]` | Org detail: subscription, user count, last active, manual overrides |
| `/super-admin/revenue` | MRR, churn, trial conversion rate |
| `/super-admin/usage` | Module usage heatmap per tier |

**Manual controls:**
- Extend trial for specific org
- Force-activate subscription (pilots / enterprise deals)
- Suspend org
- Read-only impersonation (view app as that tenant)

---

## Data Architecture Summary

No new Supabase project needed. All new tables live in the existing project, scoped
by `organization_id` with RLS.

| New Table | Purpose |
|---|---|
| `tenant_subscriptions` | Tier, status, billing IDs, trial/period dates |

Module access enforced at two layers:
1. **Frontend** — `useTenantModule()` hides nav and redirects locked routes
2. **Backend** — RLS on sensitive tables verifies subscription before returning rows

---

## Open Decisions

| Decision | Options |
|---|---|
| Pricing ($ per tier) | Decide based on market research and target margins |
| Annual discount | Typical SaaS: 15–20% off monthly |
| Trial length | 14 days recommended; adjust per sales motion |
| Enterprise onboarding | Self-serve vs. manual for largest accounts |
| Own restaurant plan | Permanent internal tier or grandfathered free plan |

---

## Out of Scope (separate plan)

- Reservation module — public-facing booking engine (document separately when ready)
