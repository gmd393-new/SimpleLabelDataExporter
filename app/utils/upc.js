/**
 * UPC-A format logic.
 *
 * Pure functions only: no I/O, no database, and deliberately no `process.env`.
 * The vendor prefix is always passed in as a parameter so these functions can run
 * in the browser, where `process.env` does not exist, and so tests need no setup.
 */

/**
 * Calculate the GS1 mod-10 check digit for the first 11 digits of a UPC-A code.
 *
 * Positions are 1-based in the GS1 spec, so the 1st, 3rd, 5th... digits (even
 * zero-based indexes) carry the weight of 3.
 *
 * @param {string} first11 - Exactly 11 digits
 * @returns {string} The check digit, as a single character
 */
export function calculateCheckDigit(first11) {
  if (typeof first11 !== "string" || !/^\d{11}$/.test(first11)) {
    throw new Error(
      `calculateCheckDigit expects exactly 11 digits, got: ${JSON.stringify(first11)}`
    );
  }

  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const digit = Number(first11[i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }

  return String((10 - (sum % 10)) % 10);
}

/**
 * Whether a value is a structurally valid UPC-A: 12 digits with a correct check digit.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidUpc(value) {
  if (typeof value !== "string" || !/^\d{12}$/.test(value)) {
    return false;
  }
  return calculateCheckDigit(value.slice(0, 11)) === value[11];
}
