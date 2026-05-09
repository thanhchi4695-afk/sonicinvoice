import { describe, it, expect } from "vitest";
import { suggestBrandWebsites } from "@/lib/brand-website-suggester";

describe("suggestBrandWebsites", () => {
  it("prefers email domain over name guess", () => {
    const r = suggestBrandWebsites("Bond Eye", "orders@bond-eye.com.au");
    expect(r[0]).toMatchObject({ host: "bond-eye.com.au", source: "email" });
  });

  it("ignores generic email providers", () => {
    const r = suggestBrandWebsites("Acme Co", "rep@gmail.com");
    expect(r.find(s => s.host === "gmail.com")).toBeUndefined();
    // falls back to name-based guesses
    expect(r[0]?.source).toBe("name");
    expect(r[0]?.host.startsWith("acme-co")).toBe(true);
  });

  it("extracts host from URL hint", () => {
    const r = suggestBrandWebsites("Rhythm", "see https://www.rhythmlivin.com.au/about");
    expect(r[0]).toMatchObject({ host: "rhythmlivin.com.au", source: "url" });
  });

  it("generates name variants when no hint", () => {
    const r = suggestBrandWebsites("OM Designs");
    expect(r.map(s => s.host)).toEqual(
      expect.arrayContaining(["om-designs.com.au", "om-designs.com", "omdesigns.com.au", "omdesigns.com"]),
    );
    expect(r.every(s => s.source === "name")).toBe(true);
  });

  it("returns empty for empty brand and no hint", () => {
    expect(suggestBrandWebsites("", null)).toEqual([]);
  });
});
