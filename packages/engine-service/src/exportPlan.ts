import { createHash } from "node:crypto";

import { getNormalizedTitle } from "@llm-midi/abc-core";

import type { DeterministicExportPlan } from "./types.js";

export function buildDeterministicExportPlan(normalizedAbc: string): DeterministicExportPlan {
  const title = getNormalizedTitle(normalizedAbc);
  const slug = slugify(title);
  const contentHash = createContentHash(normalizedAbc);

  return {
    title,
    slug,
    contentHash,
    suggestedFileName: `${slug}-${contentHash}.mid`,
  };
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "imported-fragment";
}

function createContentHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}
