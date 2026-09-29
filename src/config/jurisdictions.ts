/**
 * Jurisdiction-aware compliance requirements.
 *
 * Short-term-rental rules differ by state, territory and country, so requirements are data keyed by
 * jurisdiction code ("AU-NSW", "AU-VIC", …) rather than columns on Property. Adding a jurisdiction
 * is a config change here, not a schema change.
 *
 * IMPORTANT: this describes what Roavela *collects* for review. Roavela does not provide legal advice
 * and does not verify registrations with government registers unless and until that is built.
 */

export interface JurisdictionRequirements {
  code: string;
  name: string;
  /** Whether a short-term-rental registration number must be provided (or an exemption declared). */
  registrationRequired: boolean;
  registrationLabel?: string;
  registrationHelp?: string;
  /** Soft format hint shown to hosts; not used to reject input (formats change). */
  registrationExample?: string;
  obligationsSummary: string;
}

const AU_GENERIC_SUMMARY =
  "Check your local council, state and strata/body-corporate rules for short-term rentals before listing.";

export const JURISDICTIONS: Record<string, JurisdictionRequirements> = {
  "AU-NSW": {
    code: "AU-NSW",
    name: "New South Wales",
    registrationRequired: true,
    registrationLabel: "STRA registration number",
    registrationHelp:
      "Short-term rental accommodation in NSW generally needs to be registered on the NSW STRA Register before it is advertised. Enter your registration number, or tell us why an exemption applies.",
    registrationExample: "PID-STRA-12345",
    obligationsSummary:
      "NSW has a Short-term Rental Accommodation framework (including a register, a code of conduct and fire-safety requirements), and some councils set day limits for unhosted stays.",
  },
  "AU-VIC": { code: "AU-VIC", name: "Victoria", registrationRequired: false, obligationsSummary: AU_GENERIC_SUMMARY },
  "AU-QLD": { code: "AU-QLD", name: "Queensland", registrationRequired: false, obligationsSummary: AU_GENERIC_SUMMARY },
  "AU-ACT": { code: "AU-ACT", name: "Australian Capital Territory", registrationRequired: false, obligationsSummary: AU_GENERIC_SUMMARY },
  "AU-SA": { code: "AU-SA", name: "South Australia", registrationRequired: false, obligationsSummary: AU_GENERIC_SUMMARY },
  "AU-WA": { code: "AU-WA", name: "Western Australia", registrationRequired: false, obligationsSummary: AU_GENERIC_SUMMARY },
  "AU-TAS": { code: "AU-TAS", name: "Tasmania", registrationRequired: false, obligationsSummary: AU_GENERIC_SUMMARY },
  "AU-NT": { code: "AU-NT", name: "Northern Territory", registrationRequired: false, obligationsSummary: AU_GENERIC_SUMMARY },
};

/** Australian states/territories offered in the location form, with the timezone used for stays. */
export const AU_STATES = [
  { code: "NSW", name: "New South Wales", timezone: "Australia/Sydney" },
  { code: "VIC", name: "Victoria", timezone: "Australia/Melbourne" },
  { code: "QLD", name: "Queensland", timezone: "Australia/Brisbane" },
  { code: "ACT", name: "Australian Capital Territory", timezone: "Australia/Sydney" },
  { code: "SA", name: "South Australia", timezone: "Australia/Adelaide" },
  { code: "WA", name: "Western Australia", timezone: "Australia/Perth" },
  { code: "TAS", name: "Tasmania", timezone: "Australia/Hobart" },
  { code: "NT", name: "Northern Territory", timezone: "Australia/Darwin" },
] as const;

export function jurisdictionFor(countryCode: string, adminArea: string | null | undefined): JurisdictionRequirements | null {
  if (!adminArea) return null;
  return JURISDICTIONS[`${countryCode}-${adminArea}`] ?? null;
}
