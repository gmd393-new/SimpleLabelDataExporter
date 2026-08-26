import { test } from "node:test";
import assert from "node:assert/strict";

import { calculateCheckDigit, isValidUpc } from "../../app/utils/upc.js";

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
