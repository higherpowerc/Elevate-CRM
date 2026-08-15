import { createContext, useContext } from "react";

/* Global privacy eye (owner request 2026-08-14): one top-nav toggle that
 * blurs every piece of personally-identifying info — client/company names,
 * phone numbers, emails, addresses — across the whole app, in every workspace
 * (owner sales cockpit and each client account alike, each blurring its OWN
 * data). Purely client-side presentation: the server, DB and API are
 * untouched, so row-level isolation and every API behavior stay as-is.
 *
 * The money eye (Dashboard.tsx, 3m) remains a separate, Dashboard-only
 * toggle — this is a second, independent switch with its own localStorage
 * key.
 *
 * Usage:
 *   const pii = usePii();                       // true while blurring is ON
 *   <span className={`cell-name${blurPii(pii)}`}>{c.companyName}</span>
 *   <input className={pii ? "pii-blur" : undefined} ... />
 */

export const PiiContext = createContext<boolean>(false);

/** True while the global privacy eye is on (blurring active). */
export function usePii(): boolean {
  return useContext(PiiContext);
}

/** localStorage key — mirrors the money eye's "crm:money-hidden" pattern so
 *  the choice persists per browser across reloads. */
export const PII_HIDDEN_KEY = "crm:pii-hidden";

/** Appends the blur class to an element while the eye is on. Use with an
 *  existing class: `className={`cell-name${blurPii(pii)}`}`. */
export function blurPii(on: boolean): string {
  return on ? " pii-blur" : "";
}

/** Form-field keys whose values are PII. Used by the adaptive intake modal to
 *  blur exactly the name / phone / email / address / website / tax-id inputs
 *  without hardcoding the whole form. Covers the fixed record fields plus the
 *  prebuilt adaptive-intake contact fields (AP contact, property manager, HOA,
 *  DBA, EIN/SSN) — anything that names a person/company or identifies them. */
export const PII_FIELD_KEYS: ReadonlySet<string> = new Set([
  "companyName",
  "contactName",
  "email",
  "phone",
  "website",
  "address",
  "city",
  "state",
  "zip",
  "billingAddress",
  "billingCity",
  "billingState",
  "billingZip",
  "dbaName",
  "taxIdEin",
  "einSsn",
  "apContact",
  "propertyManagerName",
  "propertyManagerContact",
  "hoaName",
  "hoaContact",
]);

/* Eye icons — same stroke style as the money-eye icons on the Dashboard so
 * the two toggles feel like one family. */
export function PiiEyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function PiiEyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
