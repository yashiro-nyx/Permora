# Permora design system

Design analysis dated 2026-09-13 and implementation-status review dated 2026-09-28. The Figma evidence remains historical source material; current runtime coverage is tracked in [implementation-status.md](implementation-status.md).

## Evidence and repository baseline

- **Observed** means a value returned by Figma design context, checked against its screenshot unless explicitly marked metadata-only. Dimensions are Figma pixels at native frame size, not the scaled screenshot size.
- **Inferred** means an interpretation of repeated visual patterns, not a published Figma token or verified behavior.
- **Proposed** means a recommended implementation decision, including accessibility fixes. Proposed APIs and behavior are not verified Figma interactions.

Source: [Figma Page 1](https://www.figma.com/design/eP1FKbWJWPSCL3f34tM0Wt/University-Access-Request?node-id=0-1), file `eP1FKbWJWPSCL3f34tM0Wt`. The connected MCP lists one page, `0:1`. All 14 visible screen frames below were inspected using `get_design_context` and its returned screenshot. The selected radio card, approval button, approved badge, and login input were also inspected individually. Metadata was used for inventory and native dimensions, not as the sole visual evidence. Node IDs below refer to this file; append `?node-id=3-2441`, for example, to open `3:2441`.

At the time of this design audit, the workspace contained only the design documents and MCP settings. That baseline is retained to explain why the component contracts were proposed from Figma rather than extracted from code. The repository now implements **Next.js 15 App Router, React 19, TypeScript, and Tailwind CSS 4** with semantic tokens in [`app/globals.css`](../app/globals.css), shared primitives in [`components/ui.tsx`](../components/ui.tsx), and role-focused requester/staff components. See `package.json` and the lockfile for installed versions.

**Product constraint:** use **Permora** in navigation, login, page titles, and future product copy. Omit the existing TIP tile, institutional names, institution-specific copyright, and sample identity data. Use plain product-name text; do not invent, redraw, or substitute a logo. Preserve the charcoal/yellow visual language. Photography remains a design reference pending a decision about appropriate Permora imagery.

### Screen inventory

All visible screens are 1440px wide. No mobile/tablet frames or separate interaction-state sheets were found.

| Screen / reference | Native size | Observed content and coverage |
| --- | --- | --- |
| Login `42:4` | 1440 × 1024 | Split photo/form card, email/password, recovery link, login, support/policy links |
| Login duplicate `42:108` | 1440 × 1024 | Visually matches first login; no distinct role selection verified |
| User Dashboard `3:2608` | 1440 × 1128 | Four metrics, recent requests, trend chart, quick actions, help/resource cards |
| My Requests List `3:3033` | 1440 × 1086.75 | Search, two selects, refresh, five rows, pagination, processing notice |
| My Requests Dashboard `3:435` | 1440 × 1360 | Alternate list with metrics, date filter, expanded row, approval timeline, renewal, dismissible notice |
| Simple Request Access Form `3:2441` | 1440 × 1160.5 | Identity summary, resource select, three access-level choices, justification, duration, computed expiration |
| Notifications Screen `7:1998` | 1440 × 1025 | Category filters, new/earlier groups, unread dots, request/renewal links, preferences notice |
| Admin Dashboard `7:5` | 1440 × 1543 | Four metrics, activity chart, quick actions, system alert, recent requests |
| Access Requests List `7:447` | 1440 × 1172 | Requester/resource table, search/status/date, export, pagination |
| Admin Review Request `3:1257` | 1440 × 1207 | Request detail card, comment box, approve/deny, security checks, expiration |
| User Management `7:773` | 1440 × 1274 | User table, role/status filters, advanced filters, add/export, row icon actions |
| Resources Management `7:1134` | 1440 × 1098 | Category navigation, three-column resource cards, sensitivity/availability badges, add-resource tile |
| Reports & Analytics `7:1441` | 1440 × 1482 | Three metrics, date/export controls, line/donut/bar charts, security flags |
| History / Audit Log `3:2061` | 1440 × 1200.5 | Filters, eight-column event table, pagination, export/print |
| Hidden Notifications Flyout `7:2184` | 400 × 653 | **Metadata/context only:** hidden flag; screenshot is blank. Appearance, opening, placement, and focus behavior unverified. This is not evidence of a mobile layout. |

Student requester content and administrator content are visible. Faculty is represented in management data and the form contains a researcher identity, but there is no dedicated faculty journey. Approval is shown inside the administrator shell; a distinct approver shell is not verified. No visible confirmation dialog, validation error, loading skeleton, empty result, or failed submission design was found.

## Design tokens

Token names in this document are **Proposed** semantic names. Figma values are **Observed** raw values, not evidence of a named shared library. `get_variable_defs` for `3:2441` returned `{}`; this does not establish that the entire file has no variables. Repeated elements establish visual reuse, not verified component-instance relationships.

### Color inventory and normalization

| Meaning | Observed value(s) and representative nodes | Proposed mapping / decision |
| --- | --- | --- |
| Primary accent | `#FFD700`: form submit `3:2586`, admin active navigation `3:1278`; `#FFCC00` (returned as `#fc0`): login button `42:76`, dashboard active link `3:2623` | `primary: #FFD700`; retain `#FFCC00` in the source inventory, consolidate only as an explicit normalization |
| Primary foreground | `#1A1A1A` on yellow, `3:2588`, `42:78` | `on-primary: #1A1A1A` |
| Secondary / dark surface | `#1A1A1A` header `42:7`, sidebar `3:1258`; `#2D2D2D` expiration chip `3:1406` | `secondary` and `shell: #1A1A1A`, `surface-inverse-raised: #2D2D2D`, `on-secondary: #FFFFFF` |
| Page backgrounds | `#F3F4F6` login/form `42:4`, `3:2441`; `#F9FAFB` requester main `3:2687`; `#F8FAFC` admin root `3:1257` | Default `background: #F9FAFB`; retain `background-auth: #F3F4F6` and `background-admin: #F8FAFC` as documented shell variants |
| Surfaces | `#FFFFFF` cards; `#F9FAFB` inset/header `3:2481`; `#F3F4F6` expiration `3:2566`; `#F4F4F4` admin resource icon tile `3:1363` | `surface: #FFFFFF`, `surface-muted: #F9FAFB`, `surface-subtle: #F3F4F6`; normalize `#F4F4F4` to subtle |
| Main text | `#1A1A1A` headings; `#111827` resource-select text `3:2517`; `#1F2937` read-only tag `3:2488`; `#2D2D2D` detail title `3:1342` | `foreground: #1A1A1A`; collapse redundant near-black body values unless a hierarchy requires them |
| Supporting text | `#374151` login label `42:55`; `#4B5563` form helper `3:2522`; `#6B7280` descriptions `42:51`; `#9CA3AF` placeholder `42:59` and admin labels `3:1361` | `text-secondary: #4B5563`, `text-muted: #6B7280`; reserve lighter gray for nonessential decoration, not essential text |
| Inverse text | `#FFFFFF` header title; `#D1D5DB` photo copy `42:33`; `#9CA3AF` dark-shell links `3:1271` | `text-inverse`, `text-inverse-muted`; test photo copy against the actual crop |
| Borders | `#E5E7EB` input/card `42:57`, `3:2480`; `#E5E5E5` requester sidebar `3:470`; `#F3F4F6` admin card `3:1336`; `#374151` dark divider `42:13` | `border: #E5E7EB`, `border-subtle: #F3F4F6`, `border-inverse: #374151`; propose `border-control: #6B7280` for identifiable controls |
| Pending | Yellow `#FFD700` text over 10% yellow/white `3:592–595`; dashboard uses `#FFCC00`; admin `#2563EB` / `#EFF6FF` / `#DBEAFE` at `3:1343–1344` | Normalize pending to `#854D0E` text / `#FFFBE6` fill; keep blue for informational messages. Product decision still open |
| Approved / active | `#15803D` / `#DCFCE7` at `3:2770` and its badge; `#047857` / `#D1FAE5` / `#A7F3D0` at `3:613–616`; admin `#10B981` / `#F0FDF4` at `7:332–333` | `success-fg: #047857`, `success-bg: #D1FAE5`, `success-border: #A7F3D0`; distinguish Approved and Active in text and data |
| Denied / error | `#B91C1C` / `#FEE2E2` `3:2805–2806`; `#EF4444` / `#FEF2F2` admin badge `7:354–355`; `#DC2626` logout `7:2068` | `danger-fg: #B91C1C`, `danger-bg: #FEF2F2`, `danger-border: #FEE2E2` |
| Expired / neutral | Gray badge in requester list; `#F3F4F6` timeline marker, `#E5E7EB` border `3:686`; `#9CA3AF` metric edge `3:542` | `neutral-fg: #4B5563`, `neutral-bg: #F3F4F6`; expiration is a lifecycle state, not a disabled UI state |
| Warning / expiring | Orange-tinted `#FFEDD5` icon tile `3:2731`; yellow notification tile `7:2113` | `warning-fg: #854D0E`, `warning-bg: #FFFBE6`; preserve explicit “Expiring soon” label |
| Information | `#2563EB`, `#EFF6FF`, `#DBEAFE`, body `#1E40AF` at `7:263–270` | `info-fg: #1E40AF`, `info-bg: #EFF6FF`, `info-border: #DBEAFE` |
| Session indicator | Dot `#22C55E`, text `#4ADE80`, fill `rgba(20,83,45,.3)`, border `rgba(34,197,94,.3)` at `42:16–19`; alternate emerald at `3:457–460` | Single inverse-session variant; factual server/session state only |
| Resource category accents | `#DBEAFE`, `#F3E8FF`, `#E0E7FF` icon tiles at `3:2760`, `3:2778`, `3:2796` | Decorative category accents, not approval-state tokens |

**Observed opacity treatments:** active requester navigation is yellow at 10% with a solid 4px yellow edge (`3:2652`, `3:477`); security notices use 5% yellow fill and 20% yellow border (`7:2171`); login blueprint image is 10% opacity (`42:6`). Composite translucent colors over the actual surface before measuring contrast.

### Typography

**Observed:** Inter is the primary family, with Regular 400, Medium 500, Semi Bold 600, Bold 700, Extra Bold 800, and Black 900. JetBrains Mono Regular 400 and Bold 700 appear for identity/expiration/session text in the request form (`3:2464`, `3:2499`, `3:2575`). Italic Inter 400 is used for the request justification (`3:1384`). Font assets/licensing and loading strategy have not been verified.

| Role | Observed size / line-height / weight | Representative nodes | Proposed normalized role |
| --- | --- | --- | --- |
| Page heading | 30/36, 700 or 800; 30/45, 700 or 800; alternate 24/32, 700 | `3:2691`, `3:1332`, `42:49`, `7:17`, `3:510` | `heading-page`: 30/36 desktop, 24/32 mobile, 700 |
| Metric value | 24/32 700; 24/36 800; 30/36 900 | `3:2709`, `7:31`, `3:525` | `metric`: 30/36 800; compact 24/32 |
| Detail identity | 20/28 700 | `3:1353` | `heading-section`: 20/28 700 |
| Panel title | 16/24 700; decision title 18/28 800 | `3:2745`, `3:1415` | `heading-card`: 18/28 700; compact 16/24 |
| Body / navigation | 16/24 400–600; admin intro 18/28 400 | `3:2479`, `3:2623`, `3:1334` | `body`: 16/24 400; lead 18/28 |
| Small body / label | 14/20 or 14/21, 400–700 | `3:2494`, `42:55`, `7:233` | `body-sm`: 14/20; labels 600 |
| Badge / helper | 12/16 or 12/18, 400–700 | `3:616`, `3:2522`, `7:26` | `caption`: 12/16; badges 600–700 |
| Microcopy | 10/12.5, 10/15, 11/16.5; admin badges 10/15 800 | `3:2532`, `3:1424`, `3:2645`, `3:1344` | Raise essential content to 12/16 minimum; input text stays 16/24 |
| Mono values | 14/20, 400 or 700; 12/16 and 10/15 labels | `3:2499`, `3:2575`, `3:2464`, `3:2488` | `mono-sm`: 14/20; avoid micro-sized technical copy |

**Observed inconsistencies:** 14/22.75 helper copy (`3:3012`), 16/26 italic justification (`3:1384`), 12/19.5 policy text (`3:1461`), and `normal` login-input line-height (`42:59`). Do not derive line-height from the generated outer `leading-[0]` wrapper: the paragraph defines it. Small uppercase headings use tracking 0.6–1.2px (`7:29`, `3:1361`); the form h1 uses -0.75px (`3:2477`). Other text has fractional per-node tracking (for example 0.0586px on `3:616`).

**Proposed:** normalize line-height to the table above, default tracking to 0, use -0.025em for page headings and 0.05em for short uppercase labels. Use one semantic h1 per page, h2 for major sections and h3 for subsections; visual size does not determine HTML heading level. Figma has card titles labeled Heading 3 without a consistent complete hierarchy.

### Spacing, dimensions, borders, and elevation

| Property | Observed source values | Proposed normalized use |
| --- | --- | --- |
| Spacing | 4px identity gaps (`3:2490`); 8px label gaps (`3:2511`); 12px choice gaps (`3:2526`); 16px choice padding (`3:2527`); 20px metric padding (`3:518`); 24px card padding (`3:2700`); 32px sections (`3:2510`); 40px admin gutter (`7:7`); 48px expanded-detail gap (`3:622`); 64px login inset (`42:45–52`) | Base 4px; scale 4, 8, 12, 16, 20, 24, 32, 40, 48, 64; 2px for fine decoration only |
| Exceptions | Badge gap 6px (`3:613`); form button vertical padding 11px (`3:2586`); expanded area padding 31.5px (`3:621`); fractional 211.333px choice width; 0.01px header gap (`3:2461`) | Keep source evidence; use badge gap 8px, standard control heights, 32px section padding, fractional grid tracks; discard 0.01px as an inferred export artifact |
| Radius | 4px small tiles; 6px compact details button `3:618`; 8px form/select `3:2515`; 12px login controls `42:57`, form card `3:2480`; 16px dashboard cards `3:2700`; 24px login card `42:21`; 9999px badges | `radius-xs: 4`, `radius-control: 8`, `radius-card: 12`, `radius-panel: 16`, `radius-auth: 24`, `radius-pill: 9999` px. Retain 12px login controls as a variant; retire 6px unless needed |
| Border weight | Mostly 1px; selected radio 2px `3:2527`; active top-nav underline 2px; requester active side edge 4px; avatar ring 2px | 1px default, 2px selected/focus decoration, 4px active-nav accent |
| Border style | Solid by default; dashed computed-expiration inset `3:2566` | Dashed is an informational inset style, not evidence of disabled state |
| Low elevation | `0 1px 2px 0 rgba(0,0,0,.05)` at `3:2742`; also exported drop-shadow `0 1px 1px rgba(0,0,0,.05)` | `shadow-card`: first value; normalize differing shadow mechanisms |
| Button elevation | `0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.1)` at `3:2587` | `shadow-action` |
| Raised panel | `0 20px 25px -5px rgba(0,0,0,.1), 0 8px 10px -6px rgba(0,0,0,.1)` at `3:2480`, `3:1410` | `shadow-panel`; reserve for form/decision panels |
| Login elevation | `0 20px 50px 0 rgba(0,0,0,.1)` at `42:21` | `shadow-auth` |
| Sidebar elevation | `0 25px 50px -12px rgba(0,0,0,.25)` at `3:1259` | Optional admin-shell variant, not all cards |
| Colored elevation | Approval: `0 10px 15px -3px rgba(16,185,129,.2), 0 4px 6px -4px rgba(16,185,129,.2)` at `3:1427` | Prefer neutral action shadow after success-color correction |

**Observed icons:** solid utility glyphs (gauge, clipboard, key, bell, folder, clock, check, cross, logout); source references include Font Awesome but no installed icon package is verified. Sidebar slots are typically 20px with 14–16px glyphs (`3:473` is 20×16); form chevron 14×14 (`3:2519`), approval check 16×16 (`3:1429`), badge check 8.75×10 (`3:614`), status dots 6–8px, selected-choice indicator 16px (`3:2534`). Notification icon tiles are 40px (`7:2095`), dashboard icon tiles 48px (`3:2701`), timeline markers 32px (`3:686`), header avatars 40px and requester profile avatar 64px (`3:1348`).

**Proposed:** use 16/20/24px icon boxes, preserve glyph aspect ratio inside each, and keep icon size independent of the 44px minimum recommended interactive target. Reuse matching exported non-brand assets or an existing matching glyph component when a codebase exists; do not redraw guessed SVGs. Decorative icons have empty alt text/`aria-hidden`; icon-only actions need specific accessible names. MCP asset URLs expire; future implementation must store approved assets durably. Do not include any original logo asset.

## Reusable component definitions

All TypeScript contracts and accessibility behaviors below are **Proposed**. “Observed variants/states” describes only the visible static designs. Unless noted, hover, focus, pressed, busy, disabled, error, and empty states were **not** verified. Components are conceptual reuse boundaries, not claims of published Figma components.

Shared contracts:

```ts
type RequestStatus = 'pending' | 'approved' | 'denied' | 'active' | 'expired';
type AsyncState = 'idle' | 'pending' | 'success' | 'error';
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
type NavItem = { id: string; label: string; href: string; icon?: React.ReactNode };
type FieldError = { field: string; message: string };
// Domain values such as accessLevelId come from the server's resource policy.
```

### Shell and action primitives

| Component / purpose | Observed variants and states | Suggested props | Proposed accessibility / missing behavior |
| --- | --- | --- | --- |
| `AppShell`, `AppHeader`: navigation and identity context | Requester dark full-width header; admin white header beside dark sidebar; form without sidebar (`3:2608`, `3:1257`, `3:2441`) | `{ variant: 'requester' \| 'admin' \| 'focused'; navigation: NavItem[]; user: UserSummary; children: ReactNode }` | Header/banner, named navigation, skip link, one main region. Session text reflects real state. Role-filtered navigation is presentation only |
| `Sidebar`: persistent destinations | Light with pale-yellow active row and right edge; dark with solid-yellow active row; support/logout or session at bottom | `{ items; activeHref; tone: 'light' \| 'dark'; footer? }` | Links with `aria-current="page"`; logout is a button/form action. Active state also uses weight/edge. Do not duplicate navigation in the focus order without a clear purpose |
| `MobileNavigation`: compact access to same routes | **Absent; Proposed** | `{ open: boolean; onOpenChange(open): void; items; activeHref }` | Labeled menu toggle with expanded state; modal drawer focus rules below. Remove closed contents from focus/accessibility tree |
| `Button`: submission and actions | Yellow primary, dark secondary/export, white outline/cancel, green approve, red outline deny; primary sizes 44px `3:513`, 46px `3:2586`, 52px `42:76`, approve 56px `3:1426` | `ButtonHTMLAttributes<HTMLButtonElement> & { variant: 'primary' \| 'secondary' \| 'outline' \| 'ghost' \| 'approve' \| 'danger'; size?: 'sm' \| 'md' \| 'lg'; loading?: boolean; leadingIcon?; trailingIcon? }` | Native button, explicit type, keyboard activation. Add visible focus, disabled and busy variants; preserve label/width while busy and prevent duplicate submission |
| `TextLink`: navigation | Yellow “View Details”/recovery links, underlined dark request links, blue admin links (`42:68`, `3:3033`, `7:1998`, `7:276`) | `AnchorHTMLAttributes<HTMLAnchorElement> & { tone?: 'default' \| 'inverse'; children }` | Use real URLs and underline; replace low-contrast yellow text on light surfaces. Distinguish navigation from disclosure buttons. Never copy generated localhost URLs |
| `IconButton`: refresh, row actions, notification trigger | Refresh in requester filter; row overflow and account controls (`3:3033`, `7:773`) | `Omit<ButtonProps, 'children'> & { label: string; icon: ReactNode; expanded?: boolean; controls?: string }` | Accessible name identifies object/action; tooltip works on focus as well as hover. Target 44×44. Exact meanings of ambiguous management icons require confirmation |
| `StatusBadge`: request lifecycle | Pending, Approved, Denied, Active, Expired; dot/check variants; compact uppercase and sentence-case pills (`3:613`, `7:310`) | `{ status: RequestStatus; label?: string; icon?: ReactNode; size?: 'sm' \| 'md' }` | Always visible text; static badge is not a button or live region. Shared status-to-token mapping across roles |
| `EntityBadge`: roles/resource availability/sensitivity | Faculty/Student/Admin, Online/Offline, sensitivity chips (`7:773`, `7:1134`) | `{ label: string; tone: Tone; icon?: ReactNode }` | Separate from request status type; color cannot be the sole classification |

### Forms

| Component / purpose | Observed variants and states | Suggested props | Proposed accessibility / missing behavior |
| --- | --- | --- | --- |
| `FormField`: label/helper/error relationship | Persistent labels, required asterisk, helper copy; **no rendered validation errors** (`3:2511–2522`) | `{ id; label; required?: boolean; hint?: string; error?: string; children }` | Associate label with control; include “required” text; connect hint/error IDs with `aria-describedby`, set `aria-invalid` after validation. Errors identify the problem and correction |
| `TextInput`, `PasswordInput`, `Textarea` | Login email/password; search; empty justification; administrator comments. Input radii 8/12px; login 50px, request textarea 98px (`42:57`, `3:2552`) | Native input/textarea attributes plus `{ error?: string; leadingIcon? }`; password adds `{ reveal?: boolean }` | Real labels, email type/autocomplete, `current-password`; allow paste/password managers. Proposed reveal button has toggled name/state. Textarea resizes vertically; read-only differs from disabled |
| `SelectField`: resource, duration, table filters | Closed selections only, placeholder resource; duration preset displayed (`3:2515`, `3:2560`) | `SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string; disabled?: boolean }[] }` | Prefer native select with keyboard support. Open menu, option list, dependent loading, and unavailable resources are Proposed |
| `DateField`, `DateRangeFilter`, `ExpirationSummary` | Date-range triggers on lists/reports; duration selection plus calculated timestamp. No open calendar verified | `{ value: string; onChange(value): void; min?: string; max?: string; error?: string }`; range `{ from?: string; to?: string }`; summary `{ expiresAt: string; timeZone: string }` | Labeled native date inputs or accessible calendar; format help, start/end validation, visible timezone. Computed expiration is an output, not editable client authority |
| `AccessLevelGroup`: permission selection | Three cards: Read-only selected, Standard, Administrative; 2px yellow selected border, checked marker (`3:2527`, `3:2526`) | `{ name; options: { id; label; description; disabled? }[]; value: string; onChange(value): void; error? }` | Native radios in fieldset/legend; whole card label, arrow-key selection. Add dark selected indicator/focus outline because yellow border alone has insufficient contrast |
| `IdentitySummary`: trusted requester context | Four fields, read-only tag (`3:2481–2509`) | `{ user: UserSummary; fields: ('name' \| 'id' \| 'role' \| 'email')[] }` | Use definition list; values from authenticated server data. Do not use disabled inputs merely to show static text |
| `LoginForm`: authenticate | Email, password, recovery, submit and support; no remembered-session or MFA design | `{ action: (data: FormData) => Promise<LoginResult>; state: AsyncState; error?: string }` | Pending/invalid/expired-session states Proposed. Generic authentication failure, focus error summary, keep email on failure. Do not assume separate student/admin credentials or role selection |
| `AccessRequestForm`: submit permission request | Identity → resource → level → justification → duration/expiration → cancel/submit (`3:2441`) | `{ resources: ResourceOption[]; identity: UserSummary; initialValues?: RequestDraft; action: (data: FormData) => Promise<RequestResult> }` | Validate required fields and duration server-side; focus linked error summary on failed submit. Preserve draft on error. Success page/confirmation, dirty-form warning, resource-loading state are Proposed |

### Data, decisions, and feedback

| Component / purpose | Observed variants and states | Suggested props | Proposed accessibility / missing behavior |
| --- | --- | --- | --- |
| `SummaryCard`: metric plus context | Icon/value, top-label large count, colored left edge, change/new-count annotation (`3:2700`, `3:518`, `7:21`) | `{ label; value: string \| number; icon?; tone?: Tone; delta?: { label: string; direction: 'up' \| 'down' }; href?: string; loading?: boolean }` | Label/value grouped semantically; trend text explains meaning. Link only when actionable. Unknown value is not zero; skeleton/error states Proposed |
| `RequestTable`: compare and open requests | Requester/admin columns; five visible rows; approved, pending, denied, active, expired; alternate expanded row (`3:3033`, `7:447`, `3:435`) | `{ rows: RequestSummary[]; columns: ColumnDef<RequestSummary>[]; sort?: SortSpec; onSortChange?; expandedId?: string; onExpand? }` | Native table/caption/headers; sort button and `aria-sort` only if implemented. Disclosure uses `aria-expanded`/`aria-controls`; expanded content in a full-span cell. Dedicated details link needs request-specific context |
| `FilterBar`, `SearchField`: narrow records | Search, status/resource/role, date, reset/refresh, export (`3:549`, `7:447`, `7:773`) | `{ query; filters: FilterSpec[]; onQueryChange?; onFilterChange?; onReset?; pending?: boolean }` | Search has a label, not only placeholder. Prefer GET form/URL parameters; announce result count after updates. Preserve focus; loading/no matches/reset behavior Proposed |
| `Pagination`: traverse result set | Numbered pages, ellipsis, arrows, count; yellow current page on lists, dark current page on audit (`3:3033`, `3:2061`) | `{ page: number; pageSize: number; total: number; hrefForPage(page): string }` | Named pagination nav; current page announced, “Previous page”/“Next page” labels; unavailable navigation noninteractive. Derive displayed range from actual rows |
| `RequestDetails`: resource/purpose/validity summary | Standalone admin card and inline requester expanded detail (`3:1336`, `3:621`) | `{ request: RequestDetail; variant?: 'panel' \| 'inline' }` | Definition list with readable dates, timezone, status label. Wrap long IDs/purpose. No arbitrary omission of security-relevant fields on mobile |
| `ApprovalControls`: record decision | Optional comment, green approve/red outlined deny, audit checklist (`3:1409–1458`) | `{ requestId; version: string; canDecide: boolean; action: (input: DecisionInput) => Promise<DecisionResult>; state: AsyncState }` | Proposed confirmation, pending/conflict/error/completed states; clearly state comment visibility. Server checks request version, reviewer permission, allowable transition. Reason requirement for denial remains a policy decision |
| `ActivityTimeline`: explain request progression | Requested → Under Review → Approved → Active → Expires; colored markers, timestamps (`3:646–690`) | `{ events: { id; label; occurredAt?: string; scheduledAt?: string; actor?: string; state: 'complete' \| 'current' \| 'scheduled' }[]; timeZone: string }` | Ordered list, `<time datetime>`; label scheduled events explicitly, not as completed audit records. Icons decorative; reading order follows chronology |
| `AuditLogTable`: inspect historical events | Date/time, user, action, resource/data, access, validity, status, performed-by (`3:2061`) | `{ entries: AuditEntry[]; filters: AuditFilters; pagination: PaginationData }` | Native table; separate event action from resulting access status and actor. Server supplies immutable history; no client fabricated events. Export uses same authorized filters |
| `NotificationList`, `NotificationItem`: updates/action links | All/Unread/Requests/System controls; New/Earlier sections; unread dots; mark-all-read (`7:1998`) | `{ items: Notification[]; filter: NotificationFilter; onMarkRead?; onMarkAllRead? }` | Unread expressed in text/screen-reader label as well as dot. Use filter buttons with pressed state or true tabs if panels exist; do not mix patterns. Announce read result politely; optimistic failure restores state |
| `NotificationFlyout`: quick updates | **Hidden/unverified** `7:2184`; visible bell trigger elsewhere. Treat usable overlay specification as Proposed | `{ open; onOpenChange; items; unreadCount: number }` | Recommend nonmodal labeled popover with normal links, Escape and return focus; no unnecessary focus trap. On mobile use full notifications page |
| `Alert`: persistent notice | Security notice with dismiss, processing notice, blue system status, preferences action (`3:435`, `3:3033`, `7:263`, `7:2171`) | `{ tone: Tone; title; children; action?; onDismiss? }` | Static notices are sections, not automatic assertive alerts. New urgent errors may use alert; routine outcomes use status. Dismiss button is named |
| `Toast`: brief outcome | **Absent; Proposed** | `{ id; tone; message; action?; onDismiss }` | Polite status for success; do not hide errors or essential information on a short timer. No forced focus movement |
| `ConfirmDialog`: consequential action confirmation | **Absent; Proposed** | `{ open; title; description; confirmLabel; tone?: 'default' \| 'danger'; pending?: boolean; onConfirm; onCancel }` | Labeled modal dialog, trap focus, inert background, Escape/cancel before commitment, restore trigger focus. Show request/resource, scope, expiration and decision. Focus cancel for destructive actions; prevent double confirmation |
| `ResourceCard`, `AnalyticsPanel` | Resource grid with owner/status/sensitivity; charts and legends (`7:1134`, `7:1441`) | `{ resource: ResourceSummary; actions? }`; `{ title; description; children; dataTable: ReactNode }` | Card heading and named overflow action; chart text summary and accessible underlying values. Series need labels/patterns in addition to color |

**Proposed state contract:** every interactive primitive needs default, hover, focus-visible, active, disabled and pending behavior as applicable. Use a darker border/underline or subtle surface change for hover, not motion alone. Focus is independent of selected state. Async composites need loading, empty, failure/retry and completed outcomes. Disabled controls expose native disabled state and any necessary explanation adjacent to them; do not infer disabled solely from a faded expired row. Respect reduced motion; no animation durations were verified.

## Layout rules

### Observed geometry

| Layout | Exact reference geometry and visual structure |
| --- | --- |
| Requester shell | `3:2609` header 1440×73; `3:436` alternate header 80px high. Sidebar `3:2648` 256px wide. Main has 32px padding; at 1440px, content is 1120px wide. Dark header spans the full viewport; white sidebar begins below it |
| Admin shell | Sidebar `3:1258` 288px wide, 1024px high in this frame. Header `7:371` 80px high, 40px horizontal padding. Main width is 1152px before 40px gutters, producing 1072px content. Dark sidebar begins at top; white header occupies remaining width |
| Requester dashboard | Four metric cards with 24px gaps; below, 736px main column and 352px side column with 32px gap (`3:2740–2741`, `3:2979`). Table and trend chart stack left; quick actions/support stack right |
| Request form | No sidebar. Centered 768px main, 24px horizontal and 40px vertical padding (`3:2474`); 720px card (`3:2480`), 654px internal form (`3:2510`). Identity summary has four columns; choice cards three columns with 12px gaps; duration/expiration pair has 32px gap |
| Login | Outer 1440×1024 frame has a 900px inner canvas and 62px top/bottom space. Card `42:21` 1000×600, two 500px halves; right form 372px wide with 64px left inset. Header 72px; form fields 50px; submit 52px |
| Lists | Title/action row, separate horizontal filter panel, bordered rounded table, count/pagination footer, optional notice. Alternate `3:435` places filters directly above table and inserts a full-width expanded area. Native rows vary with content: 87.5px and 78px in `3:581`, `3:601`; no universal fixed row height |
| Review detail | `3:1335` content grid 1072px, detail 704px (`3:1336`), side decision column 336px (`3:1408`), 32px gap. Detail data fields pair horizontally; decision actions stack vertically |
| Resources / reports | Resources: three cards per row; reports: three summary cards, two chart panels, then unequal chart/table split. Admin dashboard uses four metrics and a wider chart beside quick actions |

**Inferred:** a 4px spacing rhythm and approximately 2:1 primary/secondary content split are consistent across dashboards and details. This is not evidence of a universal 12-column Figma grid. The normal information hierarchy is page title → brief description → summary/actions → task content → help/history.

**Proposed:** share one shell implementation with explicit visual variants and shared navigation data. Keep focused forms as a supported layout variant. Use CSS Grid/Flexbox, `minmax(0, 1fr)`, `min-width: 0`, normal document flow and content-driven height. For the 2:1 split use a three-track grid with the first panel spanning two tracks and 32px gaps to reproduce the observed geometry. Do not reproduce generated `col-0` placement, absolute main positioning, fixed canvas height, artificial blank chart padding, or screenshot offsets.

Start with observed desktop shell widths as variants; propose a 1200px content cap inside the remaining viewport on ultrawide displays. Tables, headings, filters, and cards share a left edge. Put primary actions with their page or panel heading; form actions follow fields in DOM order. Administrator footer/system-node strings are sample content, not implementation instructions. Requester/faculty/approver/admin views reuse the same request model, badges, details and timeline, with authorized actions and relevant columns supplied by the server.

## Responsive rules

**Observed:** only desktop 1440px screen designs. No mobile/tablet appearance, breakpoint, sidebar collapse, sticky behavior, overflow interaction, calendar, menu, or responsive prototype was verified. The 400px hidden flyout is not a mobile screen.

The following are **Proposed mobile-first rules**, to be checked with realistic data during implementation:

| Width | Shell and content |
| --- | --- |
| Base, below 640px | 16px gutters; compact product header with menu and account actions; modal navigation drawer. One-column metrics, cards, form fields, choices, detail and timeline. Put form actions in a vertical group with full-width primary button |
| 640–1023px | 24px gutters; two-column metrics/resource cards when content fits; two-field form groups only if labels and values fit. Drawer navigation remains; wide dashboard/detail panels stay stacked |
| 1024px and up | Persistent sidebar, requester 256px/admin 288px; 32px requester or 40px admin gutters. Four metrics only when individual cards have sufficient width; otherwise two. Enable dashboard/detail split when the main region supports roughly 640px detail + 300px decision + gap |
| 1280px and up | Restore full observed desktop proportions, three resource columns, wide filter bars, 30px page headings. Keep long content wrapping; never force a desktop width onto the viewport |

At intermediate widths, use the sidebar as the primary route navigation and omit redundant top route links; at 1440px the full requester header may match Figma. Desktop manual icon-rail collapse is optional and **not observed**; default recommendation is expanded desktop sidebar plus drawer below 1024px. Preserve names via accessible labels if an icon rail is later adopted.

Keep tables semantic inside a labeled horizontal overflow region; give the region keyboard focus when scrolling is needed. Start with a proposed minimum table width of 720px for requester data and 960px for audit data, then tune to content. Never hide validity, status, or action columns without an equivalent accessible view. Expanded details stack within their cell. Prevent document-level horizontal scrolling. Pagination and filters wrap; search spans full width first. Preserve input labels and 16px entry text.

Login becomes a single-column card at small widths; omit decorative photo panel/blueprint when they crowd the form. Use `width: 100%` with the 1000px desktop maximum; remove 600px fixed height and 62px canvas padding. Request form uses a fluid width capped at 768px; identity summary reflows 1 → 2 → 4 columns. Prefer 44×44px touch targets and 8px separation, including pagination, close buttons, and icon actions. Sticky actions must not obscure focus/content and must account for mobile safe areas.

## Accessibility: original findings and proposed fixes

Target **WCAG 2.2 AA**. Applicable baseline: normal text 4.5:1, large text 3:1 (24px regular or about 18.67px bold), meaningful control/state graphics 3:1; keyboard operation, visible/unobscured focus, labels and errors, reflow, accessible authentication, and minimum target size 24×24px subject to exceptions. The product recommendation of 44×44px targets is deliberately larger. Reference: [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

Ratios below were calculated from the exact sRGB foreground/background values using relative luminance. They are static pair checks, not a complete rendered accessibility audit. Yellow 10% over white composites to approximately `#FFFBE6`; photography and antialiasing were not sampled. No interactive or assistive-technology tests were possible because there is no application.

| Original / candidate pair | Ratio | Finding and Proposed fix |
| --- | --- | --- |
| `#1A1A1A` on `#FFD700`, form button | 12.41:1 | Pass; preserve dark primary text |
| `#1A1A1A` on `#FFCC00`, login button | 11.51:1 | Pass; yellow normalization is consistency work, not required for this pair |
| `#FFCC00` on white, recovery link `42:68` | 1.51:1 | Fail; use underlined `#1A1A1A` or another verified dark link color |
| `#FFD700` on approximately `#FFFBE6`, pending label `3:595` | 1.35:1 | Fail; proposed `#854D0E` on `#FFFBE6` gives 6.59:1 |
| White on `#FFD700` (candidate, not observed primary-button text) | 1.40:1 | Do not introduce white text on yellow |
| `#9CA3AF` on white / `#F9FAFB`, small labels/placeholders | 2.54 / 2.43:1 | Fail for text; use `#6B7280` or darker. `#6B7280` on `#F9FAFB` gives 4.63:1 |
| White on `#10B981`, approve button `3:1426–1431` | 2.54:1 | Fail at 16px bold; proposed `#047857` background gives 5.48:1 |
| `#EF4444` on white, denial button `3:1436` | 3.76:1 | Fail at 16px bold; darken to `#B91C1C` |
| `#10B981` on `#F0FDF4`, admin approved badge `7:333` | 2.42:1 | Fail; use shared dark-green foreground |
| `#15803D` on `#DCFCE7`, requester approved | 4.57:1 | Pass narrowly; do not lighten |
| `#047857` on `#D1FAE5`, approved badge `3:616` | 4.84:1 | Pass; good shared success pair |
| `#2563EB` on `#EFF6FF`, admin pending | 4.75:1 | Pass; semantics still differ from requester pending |
| `#B91C1C` on `#FEF2F2`, proposed denied | 5.91:1 | Pass |
| `#E5E7EB` on `#F9FAFB`, input border | 1.18:1 | Insufficient if required to identify control boundary; use stronger control border. Decorative card dividers may remain subtle |

**Proposed accessibility fixes and behavior:**

- Use a 2px `#1A1A1A` focus outline with 2px light separation on light/yellow surfaces; use a light outline with dark separation on the charcoal shell. Check both against surrounding colors. Do not reuse the yellow selected outline as the only keyboard-focus marker.
- Maintain logical DOM/tab order, skip navigation, and explicit current-page state. All pointer actions must work by keyboard; ordinary tables are not ARIA grids. Avoid clickable generic containers and arbitrary tab indices.
- Labels remain visible. Field errors name the field, explain a correction and link from a focused summary after failed submission. Associate inline messages with controls; do not announce every keystroke as an error. Preserve entered data and allow paste/password-manager use.
- Dialog/drawer opening moves focus inside, traps it while modal, makes background inert, and restores focus to the trigger or a logical successor. Escape cancels before commitment. During a committed request, represent progress clearly and never imply that dismissing the UI reverses a server mutation.
- Use status words plus optional icons. Expose unread state in text. Differentiate planned expiration from completed expiration; never mark a future event as an audit fact. Live regions announce async outcomes, not entire constantly changing tables.
- Increase tiny essential labels/helpers/badges to the proposed 12px minimum. This size recommendation alone does not establish conformance. Allow zoom, text-spacing overrides and long translations; content must reflow at a 320 CSS-pixel viewport except inherently two-dimensional data regions.
- Charts need text summaries and underlying data; yellow strokes on pale backgrounds cannot be the only way to read values. Use darker outlines/direct labels/patterns. Do not turn graph screenshots into the sole reporting UI.
- Use meaningful alternative text only where an image conveys information. Decorative photography has empty alt text. Avatars beside names can be decorative. Verify final photo-overlay contrast at every crop; no image-wide contrast pass is claimed.

## Implementation mapping

**Implemented direction:** reusable typed React components and semantic HTML use tokens defined in CSS. The example below records the intended Tailwind CSS 4 mapping pattern; [`app/globals.css`](../app/globals.css) is the current implementation source. Reference: [Tailwind theme variables](https://tailwindcss.com/docs/theme).

```css
@import "tailwindcss";

:root {
  --permora-primary: #ffd700; /* normalized from two observed yellows */
  --permora-on-primary: #1a1a1a;
  --permora-background: #f9fafb;
  --permora-surface: #ffffff;
  --permora-foreground: #1a1a1a;
  --permora-border: #e5e7eb;
  --permora-control-border: #6b7280; /* proposed accessibility fix */
  --permora-success: #047857;       /* darkened approval action */
}

@theme inline {
  --color-primary: var(--permora-primary);
  --color-on-primary: var(--permora-on-primary);
  --color-background: var(--permora-background);
  --color-surface: var(--permora-surface);
  --color-foreground: var(--permora-foreground);
  --color-border: var(--permora-border);
  --color-control-border: var(--permora-control-border);
  --color-success: var(--permora-success);
}

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --spacing: 0.25rem;
  --radius-control: 0.5rem;
  --radius-card: 0.75rem;
  --text-page-title: 1.875rem;
  --text-page-title--line-height: 2.25rem;
  --shadow-card: 0 1px 2px 0 rgb(0 0 0 / 0.05);
}
/* Example: bg-primary text-on-primary rounded-control px-6 py-3 */
```

This is an illustrative subset, not the complete stylesheet. The implementation also defines semantic status, inverse-surface, typography, elevation, and layout rules. Inter and JetBrains Mono are installed locally through `@fontsource-variable`; it does not depend on an expiring Figma or remote font URL. Do not assume Tailwind's default palette exactly equals the raw Figma hex values.

Use shared App Router layouts for persistent shell and identity; compose role-specific data/actions into shared dashboard, list and detail templates. Default pages, metric cards, read-only details and audit data to Server Components. Client boundaries belong around stateful drawer/popover/dialog controls, disclosure rows, controlled filter enhancements, validation feedback, password reveal and interactive chart features. A form can use native submission/server actions without making the whole page a Client Component. Pass serializable data across boundaries; server actions are explicit mutation entrypoints, not arbitrary callback props.

Server-side authorization must check identity, resource scope, action, ownership/reviewer assignment, access level, validity window, and allowed state transition on every protected read and mutation. Hiding navigation or approval controls grants no security. Recheck expiry on protected resource access; the displayed timestamp is not enforcement. Calculate policy-based expiration on the server, reject stale/duplicate decisions, and write audit events from the server transaction. Session/security checklist copy must be backed by evidence; do not ship mock “secure” or “verified” indicators as guarantees.

## Resolved implementation choices and remaining design decisions

1. The implementation normalizes primary yellow to `#FFD700`, uses dark text on yellow, and distinguishes `approved_pending_activation` from active access. This is an accessibility/domain adaptation, not an edit to Figma.
2. Requester and staff shells use role-specific navigation; the sidebar becomes a modal drawer below the desktop breakpoint. The two request-list frames informed one owner-scoped requester view plus one staff review queue.
3. Generic Figma permission labels were replaced with stable resource-specific permission IDs from the [resource access matrix](resource-access-matrix.md). They are not silently equated.
4. The initial approval workflow uses one fully eligible persisted approver, non-empty denial/return reasons, confirmation dialogs, optimistic versions, and idempotency. Mobile/dialog/error states remain proposed because Figma does not show them.
5. Current policies use versioned default/maximum days and date-only input stored at 09:00 UTC. Final institutional timezone, inclusive/exclusive expiry, and approver date-adjustment rules remain unresolved.
6. The database-backed notification center implements All/Unread filters; the hidden Figma flyout remains unverified and unimplemented. User/resource management icon semantics remain deferred with those pages.
7. Figma-supplied non-brand login assets and local fonts are stored in the project. Permora still has no supplied logo, and no logo recreation is authorized.
8. Formal screen-reader, browser-matrix, 200% zoom, text-spacing, and exhaustive contrast verification remains outstanding. Passing current automated checks is not a WCAG certification.
