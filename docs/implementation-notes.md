# Permora prototype implementation history

This document preserves the Stage 1 browser-prototype decisions. It is historical, not the current runtime architecture. For current status see [Permora Project Progress Checklist](implementation-status.md), [Stage 2 plan](stage-2-plan.md), and [Stage 2B plan](stage-2b-plan.md).

## Original scope and design evidence

The prototype was authorized after the design-system audit and established Next.js 15, React 19, TypeScript, and Tailwind CSS 4. Figma design context and screenshots were inspected for these desktop frames:

| Observed Figma node | Original prototype route or component | Current route status |
| --- | --- | --- |
| `42:4` login | `/login` | Real Better Auth login; original imagery is stored locally. |
| `3:2608` requester dashboard | `/dashboard` | PostgreSQL-backed requester/staff variants. |
| `3:2441` request form | `/requests/new` | Server-filtered policy, scopes, submission, and renewal prefill. |
| `3:3033`, `3:435` requester list/details | `/requests` | Owner-scoped PostgreSQL history/filter/details. |
| `3:1257` review detail | `/review/[id]` | Assignment-scoped review and transactional decisions. |
| `7:5` staff dashboard | `/dashboard` | Responsibility-scoped PostgreSQL summary. |
| `7:447` review queue | `/review` | Assignment-scoped filters/pagination. |
| `7:773` users | `/users` | Guarded deferred page; CLI provisioning remains current. |
| `7:1134` resources | `/resources` | Guarded deferred page. |
| `7:1441` reports | `/reports` | Guarded deferred page. |
| `3:2061` audit | `/audit` | Administrator-only sanitized read-only audit history. |
| `7:1998` notifications | `/notifications` | Requester-owned in-app notification center. |

The duplicate login frame reused the login implementation. The hidden notification flyout supplied no rendered behavior and remains unimplemented. Figma has no verified mobile/tablet variants. Responsive drawers, stacking, errors, empty states, confirmation dialogs, and focus behavior are proposed implementation decisions.

## Preserved visual and accessibility decisions

The current application retains the observed charcoal/yellow/white visual language, Inter body typography, rounded cards and controls, semantic status treatments, and local non-brand imagery. Original institutional branding was replaced with the Permora name; no logo was invented.

Accessibility adjustments include dark text on yellow, stronger control borders, visible focus, semantic headings/forms/tables, labeled overflow regions, text-backed status, modal focus management, input-linked errors, and responsive layouts at narrow widths. Passing automated checks is not a WCAG certification; formal assistive-technology, browser-matrix, zoom, and complete contrast testing remain planned.

## Historical browser-demo policy

The first prototype used a `DemoProvider`, `lib/demo-service.ts`, synthetic profiles, and versioned localStorage. It simulated request decisions, activation/expiry, policy edits, reports, exports, and clock advancement to exercise presentation. Those behaviors were never a security boundary or production policy.

The real mounted application no longer uses demo login, role switching, browser persistence, or demo mutations. Historical demo components and unit tests may remain for regression/reference, but:

- they are not imported as trusted production records;
- no database failure falls back to them;
- simulated approval/activation is not evidence of real access;
- their generic permission levels and fixed seed clock do not define current policy;
- current PostgreSQL records, server services, migrations, and authorization guards are authoritative.

## Current architecture replacing the prototype

- App Router Server Components load trusted identity and protected reads.
- Better Auth and PostgreSQL own accounts, sessions, roles, catalog policy, assignments, entitlements, requests, approval assignments/decisions, notifications, and audit records.
- Server Actions and route handlers perform validated mutations.
- `app/globals.css` contains semantic tokens and Tailwind CSS 4 theme mappings.
- `components/ui.tsx` and focused requester/staff components provide shared presentation.
- `lib/server/request-service.ts` owns requester workflow.
- `lib/server/approval-read-service.ts` and `lib/approval-domain.ts` own approval reads/routing/decisions.
- `lib/server/operations-service.ts` owns requester notifications and administrator audit reads.
- `lib/demo-service.ts` is historical and unmounted.

Current approval ends at `approved_pending_activation`. Activation, provisioning, expiry enforcement, revocation, administrator CRUD, external notifications, audit export/retention, and institutional integrations remain future work.

## Verification history and current evidence

The original prototype passed its contemporary unit/browser checks, but those results prove only historical client behavior. Current acceptance uses real server services and isolated PostgreSQL fixtures.

As of the 2026-09-28 Node 22 audit, 43 unit tests, 43 PostgreSQL integration tests, and 20 Playwright tests pass, together with lint, typecheck, production build, and `git diff --check`. Automated database tests require only a guarded `TEST_DATABASE_URL` whose database name ends in `_test`.
