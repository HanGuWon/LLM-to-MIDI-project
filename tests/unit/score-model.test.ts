import { describe, expect, it } from "vitest";

import {
  addRational,
  createRational,
  multiplyRational,
  rationalEquals,
} from "@llm-midi/score-model";

describe("score-model rational helpers", () => {
  it("normalizes rationals into simplest form with positive denominators", () => {
    expect(createRational(2, 4)).toEqual({ num: 1, den: 2 });
    expect(createRational(-2, -4)).toEqual({ num: 1, den: 2 });
    expect(createRational(0, 8)).toEqual({ num: 0, den: 1 });
  });

  it("adds and multiplies rationals deterministically", () => {
    const quarter = createRational(1, 4);
    const eighth = createRational(1, 8);

    expect(addRational(quarter, eighth)).toEqual({ num: 3, den: 8 });
    expect(multiplyRational(quarter, createRational(3, 2))).toEqual({ num: 3, den: 8 });
    expect(rationalEquals(createRational(3, 6), createRational(1, 2))).toBe(true);
  });
});
