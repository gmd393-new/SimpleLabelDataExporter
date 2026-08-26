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

/**
 * How many digits are available for the item code, given the vendor prefix.
 *
 * A UPC-A is 12 digits: prefix + item code + 1 check digit. Deriving the width
 * rather than configuring it means swapping in a real GS1 prefix of a different
 * length needs no code change.
 *
 * @param {string} prefix - Lead digit plus vendor code, e.g. "065240"
 * @returns {number}
 */
export function getItemCodeWidth(prefix) {
  if (typeof prefix !== "string" || !/^\d{1,10}$/.test(prefix)) {
    throw new Error(
      `UPC prefix must be 1-10 digits, got: ${JSON.stringify(prefix)}`
    );
  }
  return 11 - prefix.length;
}

/**
 * Build a complete 12-digit UPC-A from a vendor prefix and an item code.
 *
 * @param {string} prefix - Lead digit plus vendor code, e.g. "065240"
 * @param {number} itemCode - Non-negative integer within the derived capacity
 * @returns {string} A 12-digit UPC
 */
export function buildUpc(prefix, itemCode) {
  const width = getItemCodeWidth(prefix);
  const capacity = 10 ** width;

  if (!Number.isInteger(itemCode) || itemCode < 0) {
    throw new Error(
      `Item code must be a non-negative integer, got: ${JSON.stringify(itemCode)}`
    );
  }
  if (itemCode >= capacity) {
    throw new Error(
      `Item code ${itemCode} exceeds capacity for prefix ${prefix} ` +
        `(max ${capacity - 1}). A shorter prefix is needed for more codes.`
    );
  }

  const first11 = prefix + String(itemCode).padStart(width, "0");
  return first11 + calculateCheckDigit(first11);
}

/**
 * Whether a barcode is a valid UPC issued under our own vendor prefix.
 *
 * Stricter than isValidUpc on purpose: a genuine UPC carrying someone else's
 * prefix is not ours, and should still be offered for replacement.
 *
 * @param {unknown} value
 * @param {string} prefix
 * @returns {boolean}
 */
export function isOurUpc(value, prefix) {
  return isValidUpc(value) && value.startsWith(prefix);
}
