/**
 * Barcode generation utilities for product variants
 */

import { CHECK_BARCODE_EXISTS_QUERY } from "../graphql/products";

/**
 * Generate a random 8-digit barcode
 * Range: 10000000 to 99999999
 */
export function generateRandomBarcode() {
  const min = 10000000;
  const max = 99999999;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Check if a barcode already exists in the Shopify store
 * @param {Object} admin - Shopify admin GraphQL client
 * @param {string} barcode - The barcode to check
 * @returns {Promise<boolean>} - true if barcode exists, false otherwise
 */
export async function checkBarcodeExists(admin, barcode) {
  try {
    const response = await admin.graphql(CHECK_BARCODE_EXISTS_QUERY, {
      variables: {
        query: `barcode:${barcode}`,
      },
    });

    const data = await response.json();

    // Check if any products were found with this barcode
    return data.data.products.edges.length > 0;
  } catch (error) {
    console.error("Error checking barcode existence:", error);
    throw new Error("Failed to verify barcode uniqueness");
  }
}

/**
 * Generate a unique barcode that doesn't exist in the store
 * @param {Object} admin - Shopify admin GraphQL client
 * @param {number} maxAttempts - Maximum number of generation attempts
 * @returns {Promise<string>} - A unique 8-digit barcode
 * @throws {Error} - If unable to generate unique barcode after maxAttempts
 */
export async function generateUniqueBarcode(admin, maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const barcode = generateRandomBarcode().toString();

    const exists = await checkBarcodeExists(admin, barcode);

    if (!exists) {
      return barcode;
    }

    // Log collision (rare, but good for debugging)
    console.log(`Barcode collision detected: ${barcode} (attempt ${attempt + 1}/${maxAttempts})`);
  }

  throw new Error(
    `Unable to generate unique barcode after ${maxAttempts} attempts. Please try again or contact support.`
  );
}
