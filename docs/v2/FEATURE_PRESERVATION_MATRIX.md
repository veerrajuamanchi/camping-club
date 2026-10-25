# Camping Club 2.0 — Feature Preservation Matrix

## 1. Zero-Feature-Loss Policy

Camping Club 2.0 is an evolutionary UX and navigation enhancement. Under no circumstances may any existing 1.0 capability, database field, API contract, administrative operation, or security policy be deleted, weakened, or bypassed.

This matrix documents every 1.0 capability, its exact 2.0 location, and the automated verification requirement certifying its preservation.

---

## 2. Feature-by-Feature Preservation Inventory

### Domain 1: Authentication, Members & Profiles
| 1.0 Feature | 1.0 Location | 2.0 Location | Verification Method |
| :--- | :--- | :--- | :--- |
| Magic link email login & session persistence | Auth dialog | Unchanged (Supabase Auth) | E2E login & reload test |
| Member profile editing (phone, emergency contact) | `/profile` | `/profile` | E2E persistence after reload |
| Vehicle make, model & seat capacity | `/profile` | `/profile` | Form reload persistence test |
| Dietary preferences & allergies | `/profile` & Trip meals | `/profile` & `/trips/:id?tab=prepare` | E2E meal selector test |
| Encrypted payment handle storage (Zelle/Venmo) | `private.payment_identities` | Unchanged (Encrypted private schema) | Security test & direct API isolation |
| Multi-domain auto-redirect & sign out confirmation | `AppRoutes.tsx` | Unchanged | E2E modal & global revocation |

### Domain 2: Campsites & Rolling Calendar
| 1.0 Feature | 1.0 Location | 2.0 Location | Verification Method |
| :--- | :--- | :--- | :--- |
| 7-site annual rotation logic | `TripCalendarPage.tsx` | `/trips` (Landing) & `/admin/configuration` | Unit test & database verification |
| Campsite photos, directions, host name/phone | Campsite card | `/trips/:id?tab=overview` (Campsite card) | Browser inspection & E2E check |
| Cabin capacity & type (cabin, tent, rv) | Campsite card | `/trips/:id?tab=overview` & Admin Config | Schema check & UI reload |
| Registration cutoff calculation (35 days / buffer) | `calendar.ts` | `/trips` footer & Admin Ops exceptions | Unit test against date boundary |
| Manual deadline override badge & configuration | Trip edit modal | Contextual Admin Drawer & Admin Ops | E2E admin override test |

### Domain 3: Attendance, RSVP & Waitlist
| 1.0 Feature | 1.0 Location | 2.0 Location | Verification Method |
| :--- | :--- | :--- | :--- |
| Binary RSVP (`Going` / `Not Going`) | Calendar & Overview | `/trips` card & `/trips/:id?tab=overview` | E2E RSVP toggle & DB assertion |
| Minimum attendance threshold (default 4) | Calendar scorecard | Trip header badge & Admin Ops exception | Unit test on threshold logic |
| Capacity ceiling & automatic waitlisting | Roster table | `/trips/:id?tab=overview` (Attendees card) | Integration test with waitlist |
| Admin waitlist promotion with spot confirmation | Admin roster button | Contextual Admin Drawer & Admin Ops | E2E waitlist promotion flow |
| Member withdrawal post-confirmation handling | Overview button | `/trips/:id?tab=overview` | State machine invariant test |

### Domain 4: Camping Constitution & Rule Bundles
| 1.0 Feature | 1.0 Location | 2.0 Location | Verification Method |
| :--- | :--- | :--- | :--- |
| Master Constitution rule editing | `/admin/rules` | `/admin/configuration?section=constitution` | E2E rule bundle publication |
| Cryptographic content hashing (`sha256`) | Edge function | Unchanged (Edge function `api-trip`) | Unit test on rule hash |
| Immutable signed acknowledgment storage | Overview modal | `/trips/:id?tab=overview` & Action modal | E2E Constitution sign & reload |
| Historical acknowledgment audit logs | Admin rule view | `/admin/configuration?section=constitution` | Database query assertion |

### Domain 5: Cabin Bookings & Attendee Deposits ($50)
| 1.0 Feature | 1.0 Location | 2.0 Location | Verification Method |
| :--- | :--- | :--- | :--- |
| Mandatory $50 deposit tracking | Overview & Financials | `/trips/:id?tab=payments` | Integer cent assertion (5000 cents) |
| Submitted vs Verified deposit status | Financials table | `/trips/:id?tab=payments` & Admin Ops | E2E deposit verification test |
| Host / Accountant deposit confirmation button | Inline financial button | Admin Ops & Contextual Admin Drawer | E2E accountant confirmation |
| Non-refundable deposit policy on withdrawal | Financial ledger | Unchanged (Settlement engine rules) | State persistence test |
| Cabin booking status (`booked`, `pending`, etc.) | Trip card badge | Header badge & Admin Ops exception | Status machine verification |

### Domain 6: Responsibilities, Workload & Meal Schedule
| 1.0 Feature | 1.0 Location | 2.0 Location | Verification Method |
| :--- | :--- | :--- | :--- |
| Master duty catalog management | `/admin/duties` | `/admin/configuration?section=duties` | E2E duty creation & edit |
| Integer workload weights (1–3 credits per chore) | Duty card | `/trips/:id?tab=prepare` (Accordion 1) | Credit calculation unit test |
| Driver workload offset credit (+1 for driving 3+) | Logistics tab | `/trips/:id?tab=prepare` (Accordion 1) | Credit balance calculation test |
| Daily workload progress bar (Green/Yellow/Red) | `DailyWorkloadProgress` | `/trips/:id?tab=prepare` (Accordion 1) | Visual render & E2E assertion |
| Meal preferences selector (Breakfast, Lunch, Dinner) | Tasks & Meals | `/trips/:id?tab=prepare` (Accordion 1) | E2E preference save & reload |
| Vacating duties on RSVP `Not Going` | Database trigger | Unchanged (Migration 20261023011500) | Integration test on duty release |

### Domain 7: Transportation & Carpools
| 1.0 Feature | 1.0 Location | 2.0 Location | Verification Method |
| :--- | :--- | :--- | :--- |
| Vehicle registration (make, model, seat capacity) | Logistics tab | `/trips/:id?tab=prepare` (Accordion 2) | E2E carpool registration |
| Carpool rider assignment & pickup locations | Logistics tab | `/trips/:id?tab=prepare` (Accordion 2) | Passenger assignment reload |
| Passenger swap requests | Carpool card | `/trips/:id?tab=prepare` (Accordion 2) | E2E passenger swap flow |
| Seat capacity warnings (under/over capacity) | Logistics header | Admin Ops Logistics exception card | Capacity calculation test |

### Domain 8: Camping Gear & Groceries
| 1.0 Feature | 1.0 Location | 2.0 Location | Verification Method |
| :--- | :--- | :--- | :--- |
| Master gear catalog (individual vs shared items) | `/admin/gear` | `/admin/configuration?section=gear` | E2E gear catalog test |
| Master grocery catalog & trip sync | `/admin/groceries` | `/admin/configuration?section=groceries` | Catalog synchronization test |
| Shared gear claiming (`✓ I'll Bring This`) | Gear tab | `/trips/:id?tab=prepare` (Accordion 3) | Claim persistence after reload |
| Personal packing checklist (private per member) | Packing checklist | `/trips/:id?tab=prepare` (Accordion 3) | Checkbox persistence test |
| Critical item alerting (unclaimed essential items) | Gear/Grocery badge | Admin Ops Logistics exception card | Unclaimed item detection test |

### Domain 9: Activities, Vouchers & Waivers
| 1.0 Feature | 1.0 Location | 2.0 Location | Verification Method |
| :--- | :--- | :--- | :--- |
| Master activity catalog & typical duration | `/admin/activities` | `/admin/configuration?section=activities` | Master activity creation test |
| Trip activity opt-in / opt-out toggle | Activities tab | `/trips/:id?tab=activities` | Opt-in persistence test |
| Vehicle / tour partner auto-shuffle & pairing | Activities tab | `/trips/:id?tab=activities` | Vehicle pairing E2E test |
| Voucher redemption code input & masking | Activities modal | `/trips/:id?tab=activities` (Masked input) | Masking & reveal E2E test |
| Tour Operator Call Sheet roster & notes | Activities footer | `/trips/:id?tab=activities` & Admin Ops | Tour call sheet review test |
| Dual-state waiver compliance (Member vs Operator) | Activities banner | `/trips/:id?tab=activities` & Admin Ops | Waiver verification test |

### Domain 10: Financial Ledger & Settlement Engine
| 1.0 Feature | 1.0 Location | 2.0 Location | Verification Method |
| :--- | :--- | :--- | :--- |
| Integer cent expense entry & allocations | Financials tab | `/trips/:id?tab=payments` | Exact-cent ledger test |
| Receipt photo upload & storage in private bucket | Financials modal | `/trips/:id?tab=payments` | Storage upload & view test |
| Pure deterministic settlement solver | `SettlementEngine` | Unchanged (`src/domain/settlement/`) | 100% unit test coverage |
| Cryptographic run content hash (`sha256`) | Settlement run | `/trips/:id?tab=payments` | Hash verification test |
| Clear transfer graph (who owes whom, exact amount) | Financials run | `/trips/:id?tab=payments` | Transfer list assertion |
| Payer `Mark Sent` & Payee `Confirm Received` | Financials buttons | `/trips/:id?tab=payments` | E2E payment confirmation test |
| Admin settlement finalization with idempotency | Admin button | Contextual Admin Drawer & Payments tab | Finalization lock test |

### Domain 11: Administration & Configuration Hubs
| 1.0 Feature | 1.0 Location | 2.0 Location | Verification Method |
| :--- | :--- | :--- | :--- |
| Master Constitution management | Modal / Sub-page | `/admin/configuration?section=constitution` | E2E configuration test |
| Campsite Directory management | Modal / Sub-page | `/admin/configuration?section=campsites` | E2E configuration test |
| Master Responsibilities management | Modal / Sub-page | `/admin/configuration?section=duties` | E2E configuration test |
| Camping Gear Catalog management | Modal / Sub-page | `/admin/configuration?section=gear` | E2E configuration test |
| Grocery Catalog management | Modal / Sub-page | `/admin/configuration?section=groceries` | E2E configuration test |
| Master Activities management | Modal / Sub-page | `/admin/configuration?section=activities` | E2E configuration test |
| Club Schedule Defaults & rotation rules | Modal / Sub-page | `/admin/configuration?section=defaults` | E2E configuration test |
| Member access requests & role management | Member admin page | `/admin/members` | Role update persistence test |

---

## 3. Preservation Governance

Before any branch merge or release candidate certification:
1. Every item in this matrix must be evaluated in automated browser tests (`npm run test:e2e`).
2. Any discrepancy where a 1.0 button, field, or contract is missing in 2.0 will immediately block Gate certification.
