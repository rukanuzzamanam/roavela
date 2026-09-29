import { LISTING_SECTIONS, type SectionKey } from "./listing-checklist";

export const SECTION_COPY: Record<SectionKey, { title: string; intro: string }> = {
  basics: { title: "Property basics", intro: "The essentials guests filter by." },
  location: { title: "Location", intro: "Your exact address stays private. Guests see the suburb and an approximate area until a booking is confirmed." },
  details: { title: "Describe your place", intro: "A short summary for search results and a fuller description for your listing page." },
  amenities: { title: "Amenities", intro: "Select everything guests can use. Only list what's genuinely available." },
  photos: { title: "Photos", intro: "Bright, honest photos help guests choose. The first photo is your cover." },
  pricing: { title: "Pricing", intro: "Set your nightly rates and fees. You can change them at any time." },
  availability: { title: "Availability", intro: "Your calendar is open unless you block dates." },
  rules: { title: "House rules & cancellation", intro: "Set expectations so guests know what to expect." },
  compliance: { title: "Compliance", intro: "Short-term rental rules vary by state and council. Tell us about your registrations and permissions." },
};

export const SECTION_KEYS = LISTING_SECTIONS.map((s) => s.key);

export function isSectionKey(v: string): v is SectionKey {
  return (SECTION_KEYS as string[]).includes(v);
}

export function nextSection(current: string): SectionKey | null {
  const i = SECTION_KEYS.indexOf(current as SectionKey);
  return i >= 0 && i < SECTION_KEYS.length - 1 ? SECTION_KEYS[i + 1]! : null;
}
