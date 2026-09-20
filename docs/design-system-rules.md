# Permora implementation rules

Use [design-system.md](design-system.md) for exact source values, node references, component contracts, and accessibility findings. These rules guide future work. Implementation was subsequently authorized; see [implementation-notes.md](implementation-notes.md) for prototype decisions and verification.

## Evidence and scope

- Use **Permora** as the product name. Remove TIP/institutional branding and sample identities; use plain product-name text. Never invent, recreate or substitute a logo.
- Target Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 4. The prototype now uses the requested major versions; consult package-lock.json. Record version mismatches before changing dependencies; do not upgrade silently.
- Preserve the distinction between **Observed** Figma values, **Inferred** patterns and **Proposed** decisions. All mobile behavior and unshown interaction states are Proposed. The hidden 400px flyout is not verified mobile evidence.
- Inspect both design context and screenshots for new Figma work. Generated markup, layer names, sample URLs, fixed heights and absolute coordinates are reference material, not production architecture.

## Tokens and presentation

- Define semantic CSS variables once and map them with Tailwind 4's CSS-first `@theme` / `@theme inline`. Use `bg-primary`, `text-on-primary`, `border-control-border` and shared status variants instead of repeated raw values. See the short mapping example in the full document.
- Proposed baseline: yellow `#FFD700`, on-yellow `#1A1A1A`, white surfaces, charcoal shell, Inter body text, JetBrains Mono only for suitable identifiers/timestamps. Figma also uses `#FFCC00`; record normalization explicitly.
- Use status foreground/background/border triplets shared across roles. Proposed pending is dark amber on pale yellow; success is dark green on pale green; denied dark red on pale red. Approved, Active and Expired remain different domain states.
- Follow the proposed 4px spacing rhythm; primary scale 4/8/12/16/20/24/32/40/48/64px. Use 8px controls, 12px cards, 16px panels, 24px auth card and pill badges. Keep observed variants and normalization history in the source document.
- Body 16/24, small body 14/20, essential captions at least 12/16; page title 30/36 desktop and 24/32 mobile. One h1, logical section headings. Font declarations do not load assets.
- Reuse matching non-brand icons with explicit 16/20/24px boxes and appropriate accessible treatment. Do not draw guessed vectors or commit expiring MCP asset URLs as durable assets.

## Components and layouts

- Build typed reusable shell, action, field, badge, card, filter, table, pagination, details, decision and timeline components. Use explicit variants and shared request data models; avoid duplicated role-specific implementations.
- Default to Server Components for shell data, pages and read-only content. Place client boundaries around interactions that need local state/browser APIs. Do not mark a whole page client merely for one dialog or filter.
- Use semantic elements: links navigate, buttons act, forms submit, native inputs/selects collect data, fieldsets group radio choices, tables compare records, lists express timelines, definition lists display request attributes.
- Use shared layouts with requester/admin/focused variants. Observed sidebars are 256/288px; desktop gutters 32/40px. Focused form cap is 768px; login card cap 1000px. Content height follows content.
- Use Grid/Flexbox and `min-width: 0`; do not reproduce Figma absolute page positioning or fixed canvas heights. About 2:1 content/side-panel splits describe wide layouts only.
- Mobile first: 16px base gutters, 24px tablet, drawer below 1024px, stacked cards/forms/details; introduce columns as content fits. Full desktop proportions at 1280px+. No responsive behavior was verified in Figma.
- Keep wide tables in labeled, keyboard-scrollable overflow regions; never silently omit important columns. Wrap filters/pagination. Login loses its decorative image panel when space is constrained.
- Implement applicable default/hover/focus/active/disabled/pending states and loading/empty/error/success composites. These are proposed specifications. Show retry paths and preserve input on failure; do not display missing metrics as zero.

## Accessibility and correctness

- Target WCAG 2.2 AA. Apply the documented contrast fixes: no yellow text on white, no white text on bright green approval buttons, no light-gray essential labels. Retain dark text on yellow. Verify final composite colors, not token names.
- Make focus visible on light, yellow and dark surfaces; keep it unobscured. Use a skip link and logical keyboard order. Recommend 44×44px targets, including icon actions and pagination.
- Always label inputs and icon buttons. Associate hints/errors, set invalid state, focus a linked error summary after failed submission, preserve values, and allow password-manager/paste use.
- Modal dialogs/drawers need a name, initial focus, focus containment, inert background, Escape/cancel and focus restoration. Nonmodal notification popovers should not trap focus. Never claim dismissal cancels an already committed server action.
- Status requires words or icons beyond color. Scheduled expiration is not a completed audit event. Charts need accessible summaries/data and distinguishable series. Announce async outcomes politely without moving focus unnecessarily.
- Validate requests, permission levels, resource availability, expiry and decision transitions on the server. Role-based visibility is presentation only: enforce authorization on every protected read, mutation and export.
- Use authenticated identity for requester fields, server-calculated expiration and server-recorded audit events. Reject stale/duplicate approval decisions. Do not copy fabricated “secure session” or security-check claims into live UI.
- Keep date/timezone policy explicit. Do not infer rules from inconsistent example dates, permission labels, identities or pagination counts. Resolve the open decisions in the full document when their implementation becomes necessary.

## Future verification

When implementation is authorized, verify requester submission → review → status/history → expiry/renewal, role restrictions, denied access and stale decisions. Check 320px reflow, tablet/desktop layouts, keyboard-only navigation, modal focus, zoom/text spacing and actual contrast. Use meaningful automated checks plus manual browser/assistive-technology inspection; static Figma screenshots do not establish accessibility conformance.
