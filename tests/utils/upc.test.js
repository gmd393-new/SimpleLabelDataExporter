import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calculateCheckDigit,
  isValidUpc,
  getItemCodeWidth,
  buildUpc,
  isOurUpc,
} from "../../app/utils/upc.js";

test("calculateCheckDigit matches the GS1 sample from the Paradies sheet", () => {
  assert.equal(calculateCheckDigit("01234567890"), "5");
});

test("calculateCheckDigit computes our own prefix correctly", () => {
  assert.equal(calculateCheckDigit("06524000001"), "2");
  assert.equal(calculateCheckDigit("06524000042"), "5");
});

test("calculateCheckDigit rejects input that is not exactly 11 digits", () => {
  assert.throws(() => calculateCheckDigit("0123456789"), /11 digits/);
  assert.throws(() => calculateCheckDigit("012345678901"), /11 digits/);
  assert.throws(() => calculateCheckDigit("0123456789a"), /11 digits/);
  assert.throws(() => calculateCheckDigit(12345678901), /11 digits/);
});

test("isValidUpc accepts a well-formed code", () => {
  assert.equal(isValidUpc("012345678905"), true);
  assert.equal(isValidUpc("065240000012"), true);
});

test("isValidUpc rejects a wrong check digit", () => {
  assert.equal(isValidUpc("012345678900"), false);
});

test("isValidUpc rejects anything that is not 12 digits", () => {
  assert.equal(isValidUpc("12345678"), false);
  assert.equal(isValidUpc(""), false);
  assert.equal(isValidUpc("06524000001a"), false);
  assert.equal(isValidUpc(null), false);
  assert.equal(isValidUpc(65240000012), false);
});

test("getItemCodeWidth derives width from prefix length", () => {
  assert.equal(getItemCodeWidth("065240"), 5);
  assert.equal(getItemCodeWidth("0652401"), 4);
  assert.equal(getItemCodeWidth("0"), 10);
});

test("getItemCodeWidth rejects an unusable prefix", () => {
  assert.throws(() => getItemCodeWidth(""), /1-10 digits/);
  assert.throws(() => getItemCodeWidth("06524000001"), /1-10 digits/);
  assert.throws(() => getItemCodeWidth("06524a"), /1-10 digits/);
  assert.throws(() => getItemCodeWidth(65240), /1-10 digits/);
});

test("buildUpc zero-pads the item code and appends the check digit", () => {
  assert.equal(buildUpc("065240", 1), "065240000012");
  assert.equal(buildUpc("065240", 42), "065240000425");
});

test("buildUpc always produces a self-consistent valid UPC", () => {
  for (const itemCode of [0, 1, 7, 99, 12345, 99999]) {
    assert.equal(isValidUpc(buildUpc("065240", itemCode)), true);
  }
});

test("buildUpc throws once the item code space is exhausted", () => {
  // 06524099999 -> odd 0+5+4+9+9+9 = 36 x3 = 108, even 6+2+0+9+9 = 26, total 134,
  // check digit (10 - 4) % 10 = 6
  assert.equal(buildUpc("065240", 99999), "065240999996");
  assert.throws(() => buildUpc("065240", 100000), /exceeds capacity/);
});

test("buildUpc rejects a non-integer item code", () => {
  assert.throws(() => buildUpc("065240", -1), /non-negative integer/);
  assert.throws(() => buildUpc("065240", 1.5), /non-negative integer/);
});

test("isOurUpc distinguishes our codes from legacy and foreign ones", () => {
  assert.equal(isOurUpc("065240000012", "065240"), true);
  // Valid UPC, but a different vendor's prefix
  assert.equal(isOurUpc("012345678905", "065240"), false);
  // Legacy 8-digit code from the old generator
  assert.equal(isOurUpc("12345678", "065240"), false);
  // Our prefix but a broken check digit
  assert.equal(isOurUpc("065240000011", "065240"), false);
  assert.equal(isOurUpc("", "065240"), false);
});
