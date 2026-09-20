# Permora prototype implementation

Historical prototype notes. For the current Stage 1 coverage audit and explicit remaining gaps, see [implementation-status.md](implementation-status.md). Future work must follow the [Stage 2 plan](stage-2-plan.md), not expand the demo service.

## Scope and evidence

Implementation was authorized after the design-system documentation. The repository originally contained the two design documents and MCP settings, with no application or dependency manifest. This implementation establishes the requested Next.js 15 / React 19 / TypeScript / Tailwind CSS 4 stack; no existing dependencies or application code were replaced. See `package-lock.json` for reproducible versions. A PostCSS 8.5.28 override addresses transitive advisories without changing the requested framework major version.

Design context **and screenshots** were retrieved from file `eP1FKbWJWPSCL3f34tM0Wt` for the implemented screen families. The original design-system document retains the detailed observed measurements and inconsistencies.

| Observed Figma node                           | Implemented route / shared component        |
| --------------------------------------------- | ------------------------------------------- |
| `42:4` login                                  | `/login`, LoginScreen                       |
| `3:2608` requester dashboard                  | `/dashboard`, role-aware Dashboard          |
| `3:2441` request form                         | `/requests/new`, RequestForm                |
| `3:3033`, `3:435` request list / expanded row | `/requests`, RequestTable, Timeline         |
| `3:1257` request review                       | `/requests/[id]`, RequestDetails            |
| `7:5` administrator dashboard                 | `/dashboard` administrator variant          |
| `7:447` administrator request list            | `/requests`, `/review`, shared RequestsList |
| `7:773` users                                 | `/users`, Users                             |
| `7:1134` resources                            | `/resources`, Resources                     |
| `7:1441` reports                              | `/reports`, Reports                         |
| `3:2061` history                              | `/audit`, Audit                             |
| `7:1998` notifications                        | `/notifications`, Notifications             |

The duplicate login frame shares the login implementation. The hidden flyout does not establish mobile behavior. Original institutional branding and sample identities were replaced with Permora text and fictional demo profiles. Photographs and non-brand SVG exports are local assets, not expiring MCP URLs.

## Applied decisions

**Observed visual language:** yellow primary actions; charcoal shell; white cards; Inter; restrained gray backgrounds/borders; rounded forms, table cards and summary tiles; distinct requester and administrator shells; wide review layout with a decision panel.

**Inferred structure:** common request, resource, user and audit models support all role views. Request detail and timeline components serve requester and reviewer variants. Faculty shares requester layouts; reviewers share administrator shell styling.

**Proposed and implemented:** all mobile/tablet reflow, navigation drawer, demo login/profile switching, permission/expiry management route, help page, renewal prefill, user/resource editors, confirmation dialogs, loading/empty/error/success states and persistence recovery. Their visual and interaction details were not verified in Figma. Reports use actual demo counts instead of reproducing inconsistent sample figures. Printing invokes the browser's print/PDF UI; CSV buttons download real files.

**Normalization and accessibility fixes:** primary yellow is `#FFD700`; card radius 12px, panel 16px and control 8px are the documented normalized scale. Essential captions are at least 12px. Small application body copy remains 14px; larger form content uses 16px where space permits. Yellow actions use dark text; pending, success and danger use the documented darker foreground colors. Form control borders and focus outlines have stronger contrast. Native dialogs provide inert background, Escape, focus containment and restoration. Errors link to fields; statuses include text; charts provide data/labels. Tables scroll within labeled focusable regions, with relative containment to prevent hidden accessible text from expanding the page.

Mobile uses 16px gutters, stacked forms/detail panels, two summary cards where they fit and one at narrow widths. The sidebar becomes a drawer below 1024px. Identity fields stack below 480px; data tables retain their columns with local horizontal scrolling. This behavior is proposed, not extracted mobile evidence.

## Prototype workflow policy

These are explicit demo choices, not confirmed institutional policies:

- Fixed seed clock: September 13, 2026, 09:00 UTC. Administrator clock advancement controls activation, expiry and expiry reminders. No wall-clock scheduler runs.
- Permission levels: Read only, Standard, Administrative. Resource policies restrict levels by role, availability and maximum days. Students cannot request the records database; high-privilege levels require compatible policies.
- Required expiration is strictly after the start, evaluated at 09:00 UTC. Grants use a half-open validity interval. Duplicate overlapping requests for the same user/resource are rejected.
- Justification: 20–2,000 characters. Approval, denial and revocation require a reason of at least 10 characters.
- Pending requests can be approved or denied once; stale versions are rejected. Approval before a future start produces Approved; the demo clock subsequently produces Active and Expired. Denied, revoked and expired are distinct states.
- Renewals create new requests. Existing permissions do not extend automatically. Any other pending/approved/active overlapping grant still blocks renewal.
- Administrators can edit profiles and policies. Deactivation or incompatible policy changes revoke affected pending/scheduled/active access with notifications and history.
- Requesters see their records; reviewers see the review queue; administrator routes expose management controls. These are presentation and demo-service checks, never a production security boundary.

## Architecture and backend handoff

Route wrappers and static help content are Server Components. Interactive screen bodies and the application shell consume a Client Component demo provider because browser storage supplies the data. Shared UI lives in `components/ui.tsx`; domain types live in `lib/model.ts`; mutations run through `transition` in `lib/demo-service.ts`. Token definitions and Tailwind 4 theme mappings live in `app/globals.css`. Grid/Flexbox handle page layout; absolute positioning is limited to decorations, overlays and shell behavior.

Replace the provider adapter with authenticated server reads/mutations for a real backend, retaining shared presentation components and domain contracts. Enforce identity, resource policies, authorization and stale-version checks server-side, with transactional request/notification/audit writes. Add actual provisioning, scheduled expiry, notification delivery and tamper-resistant history. Local storage parsing/version checks and cross-tab synchronization are convenience features; they do not provide trust, atomic multi-user writes or retention guarantees.

Unresolved production decisions: SSO provider, reviewer assignment/escalation, exact resource/role matrix, timezone and maximum-duration policies, notification channels, audit retention, renewal policy, and a supplied Permora logo.

## Verification

- ESLint, TypeScript, the optimized production build (16 generated pages), and six domain tests passed. Domain tests cover transitions, incompatible/overlapping permissions, expiration, stale decisions, revocation, scoped notification reads and renewal.
- Four Chrome browser scenarios passed against both the development server and final production build at `127.0.0.1:3000`: full request-to-expiry flow and reload persistence; denial/validation/filtering/reset; administrator editing/policy revocation/export; route rendering and mobile keyboard/reflow checks.
- Desktop routes were exercised at 1440px; requester reflow was checked at 390px and 320px, and administrator routes at 390px. Desktop dashboard, resources and review screenshots and mobile dashboard/form screenshots were visually inspected.
- Browser assertions captured no uncaught page errors in the connected workflow and route/layout scenarios. Native drawer Tab containment, Escape dismissal and trigger focus restoration passed.
- This is not a WCAG certification. Screen-reader testing, all browser engines, comprehensive zoom/text-spacing checks and exhaustive contrast combinations remain unverified. Production security and background expiration cannot be verified without a backend.
