# Supabase Project Transfer Assessment

**Date reviewed:** August 21, 2026  
**36 Football Supabase project:** `fjzlwifohkehwymisaoh`

## Current supported path

Supabase supports transferring a project between organizations. The source organization owner starts the transfer in the project’s **General Settings** and selects a target organization. The source owner must be a member of the target organization. The project remains the same project rather than becoming a freshly cloned database.[1]

For a move between personal accounts, the practical path is to create or use an organization under the receiving Supabase account, invite/ensure the source owner is present as necessary, then transfer the project into the receiving organization. The receiving account should be made an organization owner if it needs full long-term control.[2]

## Transfer prerequisites

Supabase lists these blockers for a direct organization-to-organization project transfer:

| Requirement | 36 Football implication |
|---|---|
| Source user is an organization owner | Confirm before starting. |
| Source user is a member of the target organization | Invite the receiving account before initiating transfer. |
| No active GitHub integration | Confirm in Supabase project integrations. |
| No project-scoped roles | Confirm if using Team/Enterprise roles. |
| No log drains | Confirm in Supabase logging configuration. |

## 36 Football impact assessment

Because the direct transfer moves the existing project across organizations, it is the preferable path for 36 Football. The project database, project reference, tables, functions, Row Level Security policies, auth records, and current data stay attached to the same project. The 36 Football application’s connection settings should therefore remain stable, but they must be tested immediately after transfer before relying on the live site.

The public `36football.com` custom domain is hosted by the 36 Football application platform rather than Supabase, so it does not need DNS changes for a direct Supabase project transfer. The project’s server-side Supabase URL and secret configuration should be verified after the transfer; only update them if Supabase displays changed project credentials.

## Recommended low-risk sequence

1. Take a database backup and record the current project reference, Supabase URL, and deployment version.
2. In Supabase, make the receiving account an owner of a target organization.
3. Confirm the direct-transfer prerequisites: no GitHub integration, project-scoped roles, or log drains that block transfer.
4. Transfer the existing project from **Project Settings → General** to the target organization.
5. Sign in under the receiving account and verify database tables, auth users, storage, and the project API settings.
6. Open `36football.com`, sign in as a commissioner and an owner, and confirm the key league reads load before making any further changes.
7. Retain the source account’s access until the receiving account has completed those checks.

## Alternative: create a new project only if direct transfer is impossible

Supabase’s restore-to-new-project capability produces a **database-only** clone, but storage objects/settings, Edge Functions, auth settings/API keys, realtime settings, extensions/settings, and read replicas need manual reconfiguration. It is restricted to paid projects with physical backups enabled.[3] This is a fallback, not the preferred path for the active 36 Football league.

## References

[1] [Supabase Docs — Project Transfers](https://supabase.com/docs/guides/platform/project-transfer)  
[2] [Supabase Docs — Access Control](https://supabase.com/docs/guides/platform/access-control)  
[3] [Supabase Docs — Restore to a New Project](https://supabase.com/docs/guides/platform/clone-project)
