import { describe, expect, it } from "vitest";
import { eachNight, isIsoDate, isWeekendNight, nightsBetween, parseIsoDate, rangesOverlap, todayInTimeZone, toIsoDate } from "@/lib/dates";
import { estimateDriveHeuristic, estimatePropertyDrive, formatDriveTime, haversineMeters } from "@/lib/geo";

const d = parseIsoDate;

describe("dates", () => {
  it("validates real calendar dates only", () => {
    expect(isIsoDate("2026-10-16")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("16/10/2026")).toBe(false);
    expect(isIsoDate("2026-10-16T00:00:00Z")).toBe(false);
  });

  it("counts nights with an exclusive check-out", () => {
    expect(nightsBetween(d("2026-10-16"), d("2026-10-18"))).toBe(2);
    expect(eachNight(d("2026-10-16"), d("2026-10-18")).map(toIsoDate)).toEqual(["2026-10-16", "2026-10-17"]);
  });

  it("counts nights correctly across the NSW daylight-saving change", () => {
    // DST starts 4 Oct 2026 in NSW; UTC-midnight dates must be unaffected.
    expect(nightsBetween(d("2026-10-03"), d("2026-10-05"))).toBe(2);
  });

  it("treats back-to-back stays as non-overlapping", () => {
    // Guest A checks out on the 18th, guest B checks in on the 18th.
    expect(rangesOverlap(d("2026-10-16"), d("2026-10-18"), d("2026-10-18"), d("2026-10-20"))).toBe(false);
    expect(rangesOverlap(d("2026-10-16"), d("2026-10-18"), d("2026-10-17"), d("2026-10-19"))).toBe(true);
    expect(rangesOverlap(d("2026-10-10"), d("2026-10-20"), d("2026-10-12"), d("2026-10-13"))).toBe(true);
  });

  it("identifies Friday and Saturday nights as weekend nights", () => {
    expect(isWeekendNight(d("2026-10-16"))).toBe(true); // Friday
    expect(isWeekendNight(d("2026-10-17"))).toBe(true); // Saturday
    expect(isWeekendNight(d("2026-10-18"))).toBe(false); // Sunday
  });

  it("computes 'today' in the marketplace timezone, not UTC", () => {
    // 14:30 UTC on 28 Sep = 00:30 on 29 Sep in Sydney (AEST, UTC+10)
    expect(toIsoDate(todayInTimeZone("Australia/Sydney", new Date("2026-09-28T14:30:00Z")))).toBe("2026-09-29");
  });
});

describe("geo & drive time", () => {
  const sydney = { latitude: -33.8688, longitude: 151.2093 };
  const katoomba = { latitude: -33.7125, longitude: 150.3119 };

  it("computes great-circle distance", () => {
    const km = haversineMeters(sydney, katoomba) / 1000;
    expect(km).toBeGreaterThan(80);
    expect(km).toBeLessThan(90);
  });

  it("produces plausible heuristic drive estimates", () => {
    const e = estimateDriveHeuristic(sydney, katoomba);
    expect(e.distanceMeters / 1000).toBeGreaterThan(100); // road distance > straight line
    expect(e.durationMinutes).toBeGreaterThan(80);
    expect(e.durationMinutes).toBeLessThan(120);
  });

  it("adds a local leg to the regional estimate for a specific property", () => {
    const regional = { durationMinutes: 95, distanceMeters: 105_000 };
    const atCentre = estimatePropertyDrive(regional, katoomba, katoomba);
    expect(atCentre).toEqual(regional);
    const blackheath = estimatePropertyDrive(regional, katoomba, { latitude: -33.64, longitude: 150.3 });
    expect(blackheath.durationMinutes).toBeGreaterThan(95);
  });

  it("formats drive times for display", () => {
    expect(formatDriveTime(45)).toBe("45m");
    expect(formatDriveTime(60)).toBe("1h");
    expect(formatDriveTime(132)).toBe("2h 12m");
  });
});
