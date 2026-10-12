# Browser QA Strategy — Private Camping Club

## 1. Executive Summary & Purpose

In previous iterations, automated testing for the Private Camping Club platform focused on unit tests (129 component/Vitest tests) and database assertions (223 pgTAP tests). While these tests proved that individual components mounted and SQL functions executed in isolation, they failed to catch basic user-facing defects in production workflows—such as the inability to persist campsite website URLs, camp host names, phone numbers, and features.

To prevent regressions and ensure release quality, this strategy introduces a mandatory **Browser-Based Quality Assurance (QA) Certification Gate** powered by Playwright. No feature branch may be certified or merged into `main` without passing comprehensive end-to-end browser journeys executed against live Supabase backend services.

---

## 2. Testing Simulator Architecture

We utilize [Playwright](https://playwright.dev/) as a multi-browser website testing simulator. This launches real browser engines (not headless DOM emulators or mocked fetch clients) to interact with the application exactly as human members and administrators do.

### 2.1 Multi-Browser Configurations

The acceptance suite executes across three primary device profiles:

1. **Desktop Chromium**: Full desktop viewport (1280×720) simulating standard Chrome/Edge browser sessions.
2. **iPhone (Mobile WebKit)**: Emulates iPhone 14 viewport (390×844, deviceScaleFactor 3, touch enabled) on the WebKit engine. Tests mobile typography, button tap targets, and WebKit-specific layout constraints.
3. **Android (Mobile Chromium)**: Emulates Google Pixel 7 viewport (412×915, touch enabled) on Chromium. Tests Android touch interaction, mobile keyboard scrolling, and flexbox behavior.

> [!NOTE]
> For local development on macOS 13 (Ventura) on Apple Silicon (M1/M2/M3), `@playwright/test` is pinned to `v1.48.0` to preserve native binary compatibility with the OS kernel.

---

## 3. Environment & Memory Optimization (8 GB Apple Silicon M1)

Running a full local development stack (Vite dev server, Supabase PostgreSQL, GoTrue Auth, PostgREST, Mailpit, and Deno Edge Runtime) alongside browser test runners can strain machines with 8 GB of unified memory.

To guarantee zero memory crashes and absolute determinism:
- **Worker Concurrency**: Hard-pinned to `workers: 1`. Tests run strictly sequentially.
- **Process Isolation**: Playwright's `webServer` automatically manages the Vite server (`http://127.0.0.1:5173`).
- **Edge Functions Lifecycle Harness**: `scripts/run-e2e.mjs` starts the local Supabase Edge Functions runtime with ephemeral HMAC and encryption keys, waits for healthy API readiness, invokes Playwright, and terminates process trees cleanly via `scripts/terminate-process.mjs`.
- **Synthetic Data Isolation**: Tests never mutate production or seed data. Each test run generates unique synthetic accounts (`e2e-*-<uuid>@example.test`) and cleans up created identities upon completion.
- **Local Mailpit OTP Integration**: Authentication tests do not mock JWT tokens. Supabase Auth emails are captured locally by Mailpit (`http://127.0.0.1:54324/api/v1/messages`), parsed by test helpers, and verified through the real browser UI.

---

## 4. End-to-End Verification Protocol

Passing a test requires meeting the following strict criteria:

### 4.1 Real Browser Inputs & Realistic Data
Test fixtures must never rely on trivial strings like `test` or `test@example.com`. Form inputs must include:
- Spaces, parentheses, hyphens, and extension formats in phone numbers: `(831) 389-4485 ext. 12`
- Complex URLs with parameters and secure protocols: `https://www.recreation.gov/camping/campgrounds/234059?tab=campsite&view=map`
- Multi-line descriptions and punctuation in textareas: `"Community propane grill, charcoal not provided\nWi-Fi (limited)"`
- Real date boundaries respecting month constraints: `2026-11-20` to `2026-11-22`

### 4.2 Durable Reload Persistence Protocol
A test must NEVER certify success solely because a form submission returns HTTP 200 or displays a temporary toast.
Every form modification test MUST execute:
1. Form fill and submission.
2. Verification of UI success notification and card update.
3. **Forced full browser reload (`await page.reload()`)**.
4. Re-querying and assertion of every submitted field on the freshly reloaded DOM.

If any field reverts to empty or missing after reload, the test fails immediately.

### 4.3 Mobile Viewport Overflow Inspection
Every critical page and modal dialog is evaluated against viewport boundaries:
```typescript
const hasHorizontalOverflow = await page.evaluate(() => {
  return document.documentElement.scrollWidth > window.innerWidth;
});
expect(hasHorizontalOverflow).toBe(false);
```
Any element (such as an un-wrapped URL or un-responsive header) that creates horizontal scrollbars fails acceptance.

---

## 5. Automated Defect Capture on Failure

Playwright is configured with automated diagnostic attachments:
- **Screenshots**: Automatically captured on failure (`screenshot: "only-on-failure"`).
- **Traces**: Full event timelines including network requests, DOM snapshots, and console logs (`trace: "retain-on-failure"`).
- **Video Recording**: High-resolution video recording of failed test sessions (`video: "retain-on-failure"`).
- **Artifact Sanitization**: Test runners scrub secret keys, auth tokens, and encrypted payment identifiers from logs and reports.

---

## 6. Physical Device Smoke Test Recommendation

Automated Playwright WebKit testing provides high confidence, but physical touch characteristics (such as iOS Safari bottom navigation bars, virtual keyboard popups, and pinch-to-zoom) differ slightly from emulators.

Before deploying releases to production:
1. Deploy to the Render staging environment.
2. Open the staging URL on a physical iPhone using Mobile Safari.
3. Execute a 2-minute smoke test:
   - Sign in via OTP email.
   - Open campsite directory and tap Edit.
   - Confirm Going RSVP on the active trip.
