# Permora

Responsive access-request prototype based on the connected Figma design. Built with Next.js 15 App Router, React 19, TypeScript and Tailwind CSS 4. No backend or credentials are required.

## Run

```sh
npm ci
npm run dev -- --hostname 127.0.0.1
```

Open **http://127.0.0.1:3000**. Choose a demo profile and use the prefilled password `permora-demo`. The email field checks format only; the selected profile controls the simulated identity. Do not enter real credentials.

For a production build, run `npm run build`, then `npm start -- --hostname 127.0.0.1`. Stop the development server first.

## Explore a connected workflow

1. Enter as Student. Open Request Access and select Research VPN Gateway → Standard.
2. Give a purpose of at least 20 characters; choose September 14–15, 2026, and confirm.
3. Switch the clearly labeled Demo role to Approver. Open Review Requests, select the new request, give a decision reason, and approve or deny.
4. Switch back to Student to see the decision, notification and activity history.
5. As Administrator, open Permissions & Expiry and advance the demo clock by one day to activate approved access, then another day to expire it. Audit history records both simulated events.
6. Explore user management, resource policies, reports, search/filtering and CSV exports. Reset demo restores the starting dataset.

The demo starts at **September 13, 2026, 09:00 UTC** so examples stay repeatable. Dates are evaluated at 09:00 UTC; expiration is exclusive. Renewal creates a new request and must not overlap another pending or approved grant. Resource policies define allowed role/permission combinations and maximum duration.

## State and boundaries

`lib/demo-service.ts` owns validation and state transitions; `components/demo-provider.tsx` persists the shared dataset in local storage (`permora-demo-v1`) and selected profile in session storage. Role views derive their requests, notifications, reports and audit entries from that same dataset. Changes sync across tabs, but simultaneous writes are not transactional across browser processes.

This is a local simulation: profile selection is not authentication, role checks are not server authorization, clock advancement does not change real access, and audit entries are editable browser data. A real release needs authenticated sessions, server-enforced read/write/export authorization, transactional persistence, resource provisioning/revocation integrations, scheduled expiry, durable notification delivery and protected audit retention. Do not store sensitive information here.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
# With Permora running at 127.0.0.1:3000 and Google Chrome installed:
npm run test:e2e
```

Browser tests exercise submission, review, denial, saved notifications, expiration, renewal, policy changes, exports, route presentation, responsive reflow and dialog keyboard behavior. Screenshots and failure traces are written to ignored `test-results/`. The browser suite resets only Permora's demo storage.

## Stage 1 audit and next stage

Stage 1 completes the requester list disclosures/summary/filter UI and restores both original login images. [Implementation status](docs/implementation-status.md) separates Figma coverage from service readiness. [Stage 2 plan](docs/stage-2-plan.md) defines real authentication, PostgreSQL persistence and server ownership checks. Existing demo services are preserved for this UI stage; do not expand them for future application work.

To test on a different local port, set `PLAYWRIGHT_BASE_URL` when running `npm run test:e2e`. Stage 1 was checked on port 3100 to avoid an unrelated local listener.

## Design references

- [Design system](docs/design-system.md): observed values, node references and proposed accessibility/responsive rules.
- [Implementation rules](docs/design-system-rules.md): guidance for future work.
- [Implementation notes](docs/implementation-notes.md): screen coverage, resolved prototype decisions and verification limits.

Figma photographs and non-brand icons are stored locally in `public/assets`; fonts are bundled through Fontsource. No logo was supplied, so branding uses product-name text only.
