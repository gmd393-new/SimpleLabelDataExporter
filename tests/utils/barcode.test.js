import { test } from "node:test";
import assert from "node:assert/strict";

import { allocateUpc, getUpcPrefix } from "../../app/utils/barcode.js";

/**
 * Minimal in-memory stand-in for db.upcAllocation.
 * `failCreateOnce` simulates another request winning the race.
 */
function fakeDb({ rows = [], failCreateOnce = false } = {}) {
  let pending = failCreateOnce;
  const store = [...rows];

  return {
    created: store,
    upcAllocation: {
      async findFirst() {
        if (store.length === 0) return null;
        return store.reduce((a, b) => (a.itemCode > b.itemCode ? a : b));
      },
      async create({ data }) {
        if (pending) {
          pending = false;
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        if (store.some((r) => r.itemCode === data.itemCode)) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        store.push(data);
        return data;
      },
    },
  };
}

const never = async () => false;
const allocation = {
  shop: "test.myshopify.com",
  productId: "gid://shopify/Product/1",
  variantId: "gid://shopify/ProductVariant/1",
};

test("first allocation starts the sequence at item code 1", async () => {
  const db = fakeDb();
  const upc = await allocateUpc({
    dbClient: db,
    prefix: "065240",
    allocation,
    barcodeExists: never,
  });

  assert.equal(upc, "065240000012");
  assert.equal(db.created[0].itemCode, 1);
  assert.equal(db.created[0].upc, "065240000012");
  assert.equal(db.created[0].replacedBarcode, null);
});

test("subsequent allocations continue from the highest item code", async () => {
  const db = fakeDb({ rows: [{ itemCode: 41, upc: "065240000418" }] });
  const upc = await allocateUpc({
    dbClient: db,
    prefix: "065240",
    allocation,
    barcodeExists: never,
  });

  assert.equal(upc, "065240000425");
});

test("replacedBarcode is recorded when supplied", async () => {
  const db = fakeDb();
  await allocateUpc({
    dbClient: db,
    prefix: "065240",
    allocation: { ...allocation, replacedBarcode: "12345678" },
    barcodeExists: never,
  });

  assert.equal(db.created[0].replacedBarcode, "12345678");
});

test("a concurrent winner (P2002) is retried, not surfaced", async () => {
  const db = fakeDb({ failCreateOnce: true });
  const upc = await allocateUpc({
    dbClient: db,
    prefix: "065240",
    allocation,
    barcodeExists: never,
  });

  assert.equal(upc, "065240000012");
  assert.equal(db.created.length, 1);
});

test("a code already present in Shopify is skipped, never handed out", async () => {
  const db = fakeDb();
  const taken = new Set(["065240000012"]);
  const upc = await allocateUpc({
    dbClient: db,
    prefix: "065240",
    allocation,
    barcodeExists: async (candidate) => taken.has(candidate),
  });

  assert.equal(upc, "065240000029");
  assert.equal(db.created[0].itemCode, 2);
});

test("a non-P2002 database error propagates", async () => {
  const db = fakeDb();
  db.upcAllocation.create = async () => {
    throw new Error("connection refused");
  };

  await assert.rejects(
    allocateUpc({ dbClient: db, prefix: "065240", allocation, barcodeExists: never }),
    /connection refused/
  );
});

test("giving up after maxAttempts throws a clear error", async () => {
  const db = fakeDb();
  await assert.rejects(
    allocateUpc({
      dbClient: db,
      prefix: "065240",
      allocation,
      barcodeExists: async () => true, // everything looks taken
      maxAttempts: 3,
    }),
    /after 3 attempts/
  );
});

test("exhausting the item code space throws rather than wrapping", async () => {
  const db = fakeDb({ rows: [{ itemCode: 99999, upc: "065240999996" }] });
  await assert.rejects(
    allocateUpc({ dbClient: db, prefix: "065240", allocation, barcodeExists: never }),
    /exceeds capacity/
  );
});

test("getUpcPrefix throws when UPC_PREFIX is unset or empty", () => {
  const original = process.env.UPC_PREFIX;

  delete process.env.UPC_PREFIX;
  assert.throws(() => getUpcPrefix(), /UPC_PREFIX is not set/);

  process.env.UPC_PREFIX = "";
  assert.throws(() => getUpcPrefix(), /UPC_PREFIX is not set/);

  process.env.UPC_PREFIX = "0652401";
  assert.equal(getUpcPrefix(), "0652401");

  if (original === undefined) delete process.env.UPC_PREFIX;
  else process.env.UPC_PREFIX = original;
});
