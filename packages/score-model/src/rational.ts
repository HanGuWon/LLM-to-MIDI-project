import type { Rational } from "./types.js";

export function createRational(num: number, den: number = 1): Rational {
  if (!Number.isInteger(num) || !Number.isInteger(den)) {
    throw new Error("Rational parts must be integers.");
  }

  if (den === 0) {
    throw new Error("Rational denominator must not be zero.");
  }

  if (num === 0) {
    return { num: 0, den: 1 };
  }

  const normalizedDen = den < 0 ? -den : den;
  const normalizedNum = den < 0 ? -num : num;
  const divisor = greatestCommonDivisor(Math.abs(normalizedNum), normalizedDen);

  return {
    num: normalizedNum / divisor,
    den: normalizedDen / divisor,
  };
}

export function addRational(left: Rational, right: Rational): Rational {
  return createRational(
    left.num * right.den + right.num * left.den,
    left.den * right.den,
  );
}

export function multiplyRational(left: Rational, right: Rational): Rational {
  return createRational(left.num * right.num, left.den * right.den);
}

export function rationalEquals(left: Rational, right: Rational): boolean {
  return left.num === right.num && left.den === right.den;
}

export function compareRational(left: Rational, right: Rational): number {
  const difference = left.num * right.den - right.num * left.den;

  if (difference === 0) {
    return 0;
  }

  return difference < 0 ? -1 : 1;
}

export function rationalToNumber(value: Rational): number {
  return value.num / value.den;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;

  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a;
}
