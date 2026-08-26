/**
 * UPC allocation for product variants.
 *
 * Codes are issued sequentially and recorded permanently in the UpcAllocation
 * table. The table's unique constraints — not any application-level lock — are
 * what guarantee a code is never issued twice.
 */

import db from "../db.server.js";
import { CHECK_BARCODE_EXISTS_QUERY } from "../graphql/products.js";
import { buildUpc } from "./upc.js";

/**
 * The vendor prefix for this deployment.
 *
 * There is no default. Each store runs against its own database, and the item
 * code sequence in that database restarts at 1 independently of every other
 * store. The prefix is the ONLY thing that keeps two stores' UPCs from
 * colliding, so a shared or missing prefix means two stores will eventually
 * mint the identical code. Every deployment must set its own `UPC_PREFIX`.
 *
 * @returns {string}
 * @throws {Error} if UPC_PREFIX is unset or empty
 */
export function getUpcPrefix() {
  const prefix = process.env.UPC_PREFIX;
  if (!prefix) {
    throw new Error(
      "UPC_PREFIX is not set. Each store needs its own distinct UPC_PREFIX — " +
        "there is no shared default, because two stores sharing a prefix would " +
        "issue duplicate UPCs (each store allocates from its own database). " +
        "Set UPC_PREFIX in this store's environment before generating barcodes."
    );
  }
  return prefix;
}

/**
 * Check whether any product in the store already carries this barcode.
 *
 * A safety net for barcodes typed in by hand that the ledger has never seen.
 * It is not the uniqueness guarantee — the ledger is.
 *
 * @param {Object} admin - Shopify admin GraphQL client
 * @param {string} barcode
 * @returns {Promise<boolean>}
 */
export async function checkBarcodeExists(admin, barcode) {
  try {
    const response = await admin.graphql(CHECK_BARCODE_EXISTS_QUERY, {
      variables: { query: `barcode:${barcode}` },
    });

    const data = await response.json();
    return data.data.products.edges.length > 0;
  } catch (error) {
    console.error("Error checking barcode existence:", error);
    throw new Error("Failed to verify barcode uniqueness");
  }
}

/**
 * Reserve the next available UPC and record it permanently.
 *
 * The ledger row is written BEFORE the caller updates Shopify. If that update
 * then fails the item code is burned and never reused, which is the correct
 * trade under a once-only rule: burning one code out of 100,000 is harmless,
 * reissuing one is not.
 *
 * @param {Object} params
 * @param {Object} params.dbClient - Prisma client (injected so this is testable)
 * @param {string} params.prefix - Vendor prefix
 * @param {Object} params.allocation - { shop, productId, variantId, replacedBarcode? }
 * @param {(upc: string) => Promise<boolean>} params.barcodeExists
 * @param {number} [params.maxAttempts=10]
 * @returns {Promise<string>} The allocated 12-digit UPC
 */
export async function allocateUpc({
  dbClient,
  prefix,
  allocation,
  barcodeExists,
  maxAttempts = 10,
}) {
  const { shop, productId, variantId, replacedBarcode = null } = allocation;

  // Bumped when a candidate turns out to be in use in Shopify but absent from
  // the ledger; without it we would recompute the same code forever.
  let offset = 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const highest = await dbClient.upcAllocation.findFirst({
      orderBy: { itemCode: "desc" },
      select: { itemCode: true },
    });

    const itemCode = (highest?.itemCode ?? 0) + offset;

    // Throws on capacity exhaustion — deliberately not caught, so running out
    // surfaces as a clear error instead of a silent wrap.
    const upc = buildUpc(prefix, itemCode);

    if (await barcodeExists(upc)) {
      offset += 1;
      continue;
    }

    try {
      await dbClient.upcAllocation.create({
        data: { upc, itemCode, shop, productId, variantId, replacedBarcode },
      });
      return upc;
    } catch (error) {
      if (error.code === "P2002") {
        // Another request took this code between our read and our write.
        // Re-read from the new high-water mark.
        offset = 1;
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Unable to allocate a UPC after ${maxAttempts} attempts. Please try again.`
  );
}

/**
 * Allocate a UPC for a variant, wired to the real database and Shopify.
 *
 * @param {Object} admin - Shopify admin GraphQL client
 * @param {Object} allocation - { shop, productId, variantId, replacedBarcode? }
 * @returns {Promise<string>} The allocated 12-digit UPC
 */
export async function generateUniqueUpc(admin, allocation) {
  return allocateUpc({
    dbClient: db,
    prefix: getUpcPrefix(),
    allocation,
    barcodeExists: (upc) => checkBarcodeExists(admin, upc),
  });
}
