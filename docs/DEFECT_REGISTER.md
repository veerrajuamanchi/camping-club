# Defect Register — Private Camping Club

This register documents the defects identified during the browser QA investigation, their complete root cause analysis across data layers, and the exact architectural remediations implemented.

---

## DEF-01: PostgREST Stored Procedure Overload Ambiguity (HTTP 300)

- **Severity**: Critical (Showstopper)
- **Component**: Backend / Database (`public.phase2_admin_update_campsite`)
- **Symptoms**: When saving campsite edits from the frontend form, the application returned a generic error. In the network tab, the Edge Function reported an unhandled RPC exception with HTTP status `300 Multiple Choices` (`PGRST203`).
- **Complete Data Flow Trace**:
  1. Browser form submits JSON payload to `invokeTripApi("admin_update_campsite", {...})`.
  2. Edge function `trip-api` validates payload using Zod.
  3. Edge function invokes Supabase client RPC: `service.rpc("phase2_admin_update_campsite", {...})`.
  4. PostgREST inspects the PostgreSQL catalog for functions matching `phase2_admin_update_campsite`.
  5. PostgREST discovers **two** function definitions with the same parameter names where `p_request_id` was typed as `text` in one migration and `uuid` in another.
  6. PostgREST cannot determine which overload to execute and terminates the request with HTTP 300 Multiple Choices.
- **Root Cause**: An earlier migration added a uuid-typed overload without dropping the preceding text-typed overload. PostgREST RPC does not support overloaded procedures with identical argument counts and coercible types.
- **Remediation**:
  - Migration `supabase/migrations/20261012110000_fix_campsite_update_and_fields.sql` dropped the colliding overload:
    ```sql
    DROP FUNCTION IF EXISTS public.phase2_admin_update_campsite(uuid, uuid, jsonb, text, uuid);
    ```
  - Standardized on a single signature taking `p_input jsonb` and `p_request_id text`.

---

## DEF-02: PostgreSQL Unhandled UUID Type Cast (Code 42804)

- **Severity**: High
- **Component**: Database (`public.audit_events` integration)
- **Symptoms**: After resolving the PostgREST overload, campsite updates still failed with PostgreSQL error: `column "request_id" is of type uuid but expression is of type text`.
- **Root Cause**: `public.audit_events.request_id` is defined as `uuid NOT NULL`, but `phase2_admin_update_campsite` attempted to insert `p_request_id` (a `text` parameter) directly without type coercion.
- **Remediation**:
  - Updated the migration to safely cast `p_request_id` to UUID with fallback generation:
    ```sql
    coalesce(nullif(p_request_id, '')::uuid, gen_random_uuid())
    ```

---

## DEF-03: Data Wipeout on Partial Campsite Logistics Updates

- **Severity**: High (Data Loss)
- **Component**: Backend RPC & Frontend Logistics Form
- **Symptoms**: Saving trip logistics in `EventDetailsPage.tsx` inadvertently cleared existing camp host names, phone numbers, features, and cabin information.
- **Root Cause**:
  1. In the database function `phase2_admin_update_campsite`, columns were updated as:
     `camp_host_name = p_input->>'campHostName'`. When `campHostName` was not supplied in the input JSON, PostgREST passed `NULL`, wiping out the existing value in the row.
  2. In `EventDetailsPage.tsx`, the logistics form submitted only logistics fields to `admin_update_campsite` without preserving campsite contact details.
- **Remediation**:
  - Modified the stored procedure to check key existence before overwriting:
    ```sql
    camp_host_name = CASE WHEN p_input ? 'campHostName' THEN p_input->>'campHostName' ELSE camp_host_name END
    ```
  - Updated `EventDetailsPage.tsx` to supply all existing campsite metadata during logistics saves.

---

## DEF-04: Database Check Constraint Scheme Rejection

- **Severity**: Medium
- **Component**: Schema (`campsites.availability_url_format`)
- **Symptoms**: Submitting valid website URLs beginning with `http://` failed with check constraint violation `campsites_availability_url_format_check`.
- **Root Cause**: The database migration enforced `CHECK (availability_url ~ '^https://')`, whereas the frontend form and Zod schema accepted any valid URL scheme including `http://`.
- **Remediation**:
  - Updated check constraint to permit both `https` and `http` schemes:
    ```sql
    CHECK (availability_url IS NULL OR availability_url ~* '^https?://')
    ```
  - Frontend normalizes user entries missing schemes to default to `https://`.

---

## DEF-05: Missing Campsite Card Rendering for Website URL & Directions

- **Severity**: Medium (Visual Defect)
- **Component**: Frontend (`AdminCampsitesPage.tsx`)
- **Symptoms**: Even when campsite website URLs and driving directions persisted in PostgreSQL, they never rendered on the admin campsite card, leading users to believe the data was discarded.
- **Root Cause**: The JSX template in `AdminCampsitesPage.tsx` lacked rendering blocks for `site.availabilityUrl` and `site.directions`.
- **Remediation**:
  - Added dedicated card rendering blocks:
    - External website link with `target="_blank"` and `rel="noopener noreferrer"`.
    - Dedicated directions paragraph.

---

## DEF-06: Mobile Viewport Horizontal Overflow on Mobile WebKit

- **Severity**: Medium (Mobile Usability)
- **Component**: Frontend CSS (`styles.css` and `AdminCampsitesPage.tsx`)
- **Symptoms**: On iPhone (Mobile WebKit 390px viewport), `/admin/campsites` developed horizontal scrollbars, pushing the "+ Add Campsite" button and card margins off-screen.
- **Root Cause**:
  1. Long unbroken reservation URLs (70+ characters) lacked wrapping rules.
  2. `.feed-header` had `display: flex; justify-content: space-between` with no wrapping or flex gap.
- **Remediation**:
  - Added `word-break: break-all; overflow-wrap: anywhere;` to the URL link in `AdminCampsitesPage.tsx`.
  - Added `flex-wrap: wrap; gap: 0.75rem;` to `.feed-header` in `styles.css`.
  - Added `box-sizing: border-box; max-width: 100%; overflow-wrap: anywhere;` to `.card`.

---

## DEF-07: HTML5 Native Validation Blocking Existing Campsite Edits

- **Severity**: Minor / Usability
- **Component**: Frontend Form Validation
- **Symptoms**: Attempting to edit seeded campsites with empty addresses triggered native browser tooltips ("Please fill out this field") and blocked submission.
- **Root Cause**: Seeded test data contained `location_description = ''`, while the form marked `Campsite Address *` as an HTML5 `required` textarea.
- **Remediation**:
  - Acceptance tests supply a realistic address during edit journeys.
  - Form validation clearly marks required fields with placeholders.
