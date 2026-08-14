import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  constitutionalInvariants,
  governmentThresholds,
  validateRuleMapping,
} from "../src/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(await readFile(url, "utf8")) as unknown;
}

describe("inherited rule classifications", () => {
  it("classifies every official NBA rule and comments section", async () => {
    const mapping = validateRuleMapping(
      await readJson("../../../docs/rules/nba-rule-mapping.json"),
    );
    expect(mapping.entries).toHaveLength(15);
    expect(mapping.entries.map((entry) => entry.id)).toEqual([
      "NBA-RULE-1",
      "NBA-RULE-2",
      "NBA-RULE-3",
      "NBA-RULE-4",
      "NBA-RULE-5",
      "NBA-RULE-6",
      "NBA-RULE-7",
      "NBA-RULE-8",
      "NBA-RULE-9",
      "NBA-RULE-10",
      "NBA-RULE-11",
      "NBA-RULE-12",
      "NBA-RULE-13",
      "NBA-RULE-14",
      "NBA-COMMENTS",
    ]);
  });

  it("classifies all 42 CBA articles and all 17 exhibits", async () => {
    const mapping = validateRuleMapping(
      await readJson("../../../docs/rules/cba-mapping.json"),
    );
    expect(mapping.entries).toHaveLength(59);
    expect(
      mapping.entries.filter((entry) => /^CBA-(?:[IVXLCDM]+)$/.test(entry.id)),
    ).toHaveLength(42);
    expect(
      mapping.entries.filter((entry) => entry.id.startsWith("CBA-EX-")),
    ).toHaveLength(17);
    expect(mapping.source.sha256).toBe(
      "bf178ca0f2d64f9dfe6fde095d3ae43d576b12e19ce7a679618d632584f7ab32",
    );
  });

  it("gives every not-applicable section an explicit test and rationale", async () => {
    const mapping = validateRuleMapping(
      await readJson("../../../docs/rules/cba-mapping.json"),
    );
    for (const entry of mapping.entries.filter(
      (candidate) => candidate.classification === "NOT_APPLICABLE",
    )) {
      expect(entry.rationale.length, entry.id).toBeGreaterThan(20);
      expect(entry.tests, entry.id).toContain(
        "cba/not-applicable-has-rationale",
      );
    }
  });
});

describe("constitutional constants", () => {
  it("keeps every non-negotiable invariant explicit", () => {
    expect(Object.keys(constitutionalInvariants)).toHaveLength(12);
  });

  it("pins the higher foundational and expiring emergency thresholds", () => {
    expect(governmentThresholds.foundational.activePlayersBps).toBe(9_000);
    expect(governmentThresholds.foundational.premierCouncilBps).toBe(10_000);
    expect(governmentThresholds.foundational.tribunalBps).toBe(10_000);
    expect(governmentThresholds.emergencyExpiryHours).toBe(72);
    expect(governmentThresholds.safetyActionExpiryHours).toBe(24);
  });
});
