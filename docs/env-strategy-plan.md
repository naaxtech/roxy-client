# Roxy Environment & Data Safety Strategy
## Goal: Transition from "Production-only Development" to a Lean Dev/Prod Model

This document outlines the roadmap for isolating user data and ensuring production stability as Roxy scales toward tester onboarding.

---

## 1. The Two-Tier Architecture
We will move from a single project to a strict two-tier isolation model.

| Tier | Supabase Project | App Profile | Purpose | Access |
| :--- | :--- | :--- | :--- | :--- |
| **Development** | `roxy-dev` | `development` / `preview` | Breaking things, testing migrations, AI prompt tuning. | Full Read/Write |
| **Production** | `roxy-prod` | `production` | Live users, sacred data. | Read-only for Devs |

---

## 2. Implementation Roadmap

### Phase 1: Infrastructure Isolation (Immediate)
- [ ] **Project Creation**: Create `roxy-dev` in Supabase.
- [ ] **Schema Sync**: Run `npx supabase db push` to mirror the production schema in Dev.
- [ ] **Seeding**: Implement `supabase/seed.sql` to populate Dev with mock users, posts, and matches.
- [ ] **Secret Separation**: 
    - Local `.env` $\rightarrow$ points to `roxy-dev`.
    - EAS/Vercel Production Secrets $\rightarrow$ point to `roxy-prod`.

### Phase 2: Code-Level Guardrails (Implemented)
- [x] **Environment Guards**: Added `validateEnvironment()` to `apps/mobile` and `apps/studio` to block mismatched URL/Env combinations.
- [x] **Soft-Delete Architecture**: Migration `058` implemented to replace physical `DELETE` with `deleted_at` timestamps.
- [x] **RLS Enforcement**: Updated all core policies to automatically filter out soft-deleted records.

### Phase 3: Workflow Standardization (Pending)
- [ ] **Migration Gate**: Enforce the flow: `Dev Migration` $\rightarrow$ `Verify` $\rightarrow$ `Prod Migration`.
- [ ] **CI/CD Integration**: Update EAS build profiles to inject the correct Supabase keys based on the build profile (`preview` vs `production`).
- [ ] **Audit Logs**: Ensure all destructive actions in the Studio app are logged to the `audit_log` table.

---

## 3. The "Sacred Space" Rules (Production)
To prevent data loss in `roxy-prod`, the following rules are absolute:
1. **No Manual Edits**: Never change a table or column via the Supabase UI in Prod.
2. **Migration-Only**: All schema changes must be a `.sql` file in `supabase/migrations/`.
3. **No `db reset`**: Never run `supabase db reset` against the Production project.
4. **PII Masking**: No production user PII (emails, phone numbers) may ever be copied into the Dev environment.

---

## 4. Recovery Plan
- **PITR**: Enable Point-in-Time Recovery on the Production project.
- **Backups**: Scheduled weekly snapshots of the production database.
- **Rollback**: Keep a documented path for reverting a migration via a "down" migration or PITR restore.
