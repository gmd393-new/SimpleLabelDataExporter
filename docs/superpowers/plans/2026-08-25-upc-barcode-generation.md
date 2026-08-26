# UPC-A Barcode Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the random 8-digit barcode generator with one that issues valid 12-digit UPC-A codes from a sequential, never-reused allocation ledger.

**Architecture:** Three layers. `app/utils/upc.js` holds pure format logic (check digit, validation, building) with no I/O and no environment access — the prefix is always a parameter, so the same functions run on server and client. `app/utils/barcode.js` owns allocation: it reads the next item code from a permanent `UpcAllocation` Postgres table, and the table's unique constraints (not application locking) are what guarantee a code is never issued twice. `app/routes/app._index.jsx` exposes two actions — `generateBarcode` for empty barcodes and a separate confirmed `replaceBarcode` that is the only path allowed to overwrite an existing one.

**Tech Stack:** React Router 7, Prisma 6 + PostgreSQL, Shopify Admin GraphQL API, `node:test` (built in, no new dependencies).

**Spec:** `docs/superpowers/specs/2026-08-25-upc-barcode-generation-design.md`

## Global Constraints

- **UPC prefix**: `065240` (lead digit `0` + vendor code `65240`). Held in env var `UPC_PREFIX`; `065240` is the fallback default when unset.
- **Item code width is derived, never configured**: `11 - prefix.length`. With `065240` that is 5 digits, capacity 100,000.
- **Check digit**: GS1 mod-10. `sum = 3 × (d1+d3+d5+d7+d9+d11) + (d2+d4+d6+d8+d10)`, `check = (10 - (sum mod 10)) mod 10`.
- **Known-good vector**: `012345678905` (the sample printed on the Paradies standards sheet). Any implementation must reproduce that trailing `5`.
- **Never reuse an item code.** Burning a code on failure is correct; reissuing one is not.
- **Never overwrite a non-empty barcode** except through `replaceBarcode` with explicit user confirmation. Shelf tags carrying the old codes are already printed.
- **The UPC goes in Shopify's `barcode` field**, not a metafield — POS only scans that field.
- No new npm dependencies.
- Existing code style: double-quoted strings, 2-space indent, JSDoc block comments on exported functions.

---

### Task 1: Test harness and core check-digit logic

**Files:**
- Modify: `package.json` (add `test` script)
- Create: `app/utils/upc.js`
- Test: `tests/utils/upc.test.js`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `calculateCheckDigit(first11: string) => string` (single digit, throws on non-11-digit input); `isValidUpc(value: unknown) => boolean`

- [ ] **Step 1: Add the test script**

In `package.json`, add to the `"scripts"` block (alongside the existing `"lint"` entry):

```json
"test": "node --test tests/"
```

The project is `"type": "module"` and runs Node ≥22.12, so `node:test` works with ESM and needs no dependency. Test imports must include the `.js` extension.

- [ ] **Step 2: Write the failing test**

Create `tests/utils/upc.test.js`:

```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module .../app/utils/upc.js`

- [ ] **Step 4: Write the implementation**

Create `app/utils/upc.js`:

```js
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all 6 tests

- [ ] **Step 6: Verify lint is clean**

Run: `npm run lint`
Expected: no new errors. If ESLint flags `tests/` for unknown globals, add `tests/` to `.eslintignore` — the test runner is Node's, not the browser bundle's.

- [ ] **Step 7: Commit**

```bash
git add package.json app/utils/upc.js tests/utils/upc.test.js
git commit -m "Add UPC check digit calculation and validation"
```

---

### Task 2: Prefix-aware UPC construction

**Files:**
- Modify: `app/utils/upc.js`
- Test: `tests/utils/upc.test.js`

**Interfaces:**
- Consumes: `calculateCheckDigit`, `isValidUpc` from Task 1
- Produces: `getItemCodeWidth(prefix: string) => number`; `buildUpc(prefix: string, itemCode: number) => string` (12 chars, throws past capacity); `isOurUpc(value: unknown, prefix: string) => boolean`

- [ ] **Step 1: Write the failing test**

Append to `tests/utils/upc.test.js`, and extend the existing import line at the top of the file to read:

```js
import {
  calculateCheckDigit,
  isValidUpc,
  getItemCodeWidth,
  buildUpc,
  isOurUpc,
} from "../../app/utils/upc.js";
```

Then append these tests:

```js
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
```

Note `buildUpc("065240", 99999)` is asserted to equal `065240999995`; if the implementation is correct this holds, and the surrounding `isValidUpc` loop independently proves self-consistency.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `getItemCodeWidth is not a function` (or an import error for the new names)

- [ ] **Step 3: Write the implementation**

Append to `app/utils/upc.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests, Task 1's included

- [ ] **Step 5: Commit**

```bash
git add app/utils/upc.js tests/utils/upc.test.js
git commit -m "Add prefix-aware UPC construction and ownership check"
```

---

### Task 3: The UpcAllocation ledger table

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_upc_allocations/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing
- Produces: Prisma model `UpcAllocation`, accessible as `db.upcAllocation` with fields `id`, `upc`, `itemCode`, `shop`, `productId`, `variantId`, `replacedBarcode`, `createdAt`

- [ ] **Step 1: Add the model**

Append to `prisma/schema.prisma`, after the existing `DownloadToken` model:

```prisma
/// Permanent record of every UPC ever issued.
///
/// Rows are never deleted. This is what makes "each UPC used only once" true even
/// after a product is deleted from Shopify — the old approach asked Shopify whether
/// a barcode was in use, so deleting a product silently freed its code for reuse.
model UpcAllocation {
  id              String   @id @default(uuid())
  upc             String   @unique
  itemCode        Int      @unique
  shop            String
  productId       String
  variantId       String
  replacedBarcode String?
  createdAt       DateTime @default(now())

  @@index([shop])
  @@index([variantId])
}
```

`itemCode` carries its own unique constraint rather than relying on `upc` alone, so the sequence itself is protected and two concurrent allocations cannot both commit.

- [ ] **Step 2: Confirm a database is reachable**

Run: `docker compose up -d`
Then: `npx prisma migrate status`
Expected: reports the 4 existing migrations as applied. If it cannot connect, check `DATABASE_URL` in `.env` against `.env.docker`.

- [ ] **Step 3: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_upc_allocations`
Expected: creates `prisma/migrations/<timestamp>_add_upc_allocations/`, applies it, and regenerates the Prisma client.

- [ ] **Step 4: Verify the generated SQL is additive only**

Run: `cat prisma/migrations/*_add_upc_allocations/migration.sql`
Expected: a single `CREATE TABLE "UpcAllocation"` plus its `CREATE UNIQUE INDEX` / `CREATE INDEX` statements. There must be **no** `ALTER TABLE` or `DROP` against `Session` or `DownloadToken` — this migration must not touch existing data.

- [ ] **Step 5: Verify the client exposes the model**

Run:

```bash
node --input-type=module -e "import db from './app/db.server.js'; console.log(typeof db.upcAllocation.create); await db.\$disconnect();"
```

Expected: prints `function`

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add UpcAllocation ledger table"
```

---

### Task 4: Sequential UPC allocation

**Files:**
- Rewrite: `app/utils/barcode.js`
- Test: `tests/utils/barcode.test.js`

**Interfaces:**
- Consumes: `buildUpc` from Task 2; `db.upcAllocation` from Task 3; `CHECK_BARCODE_EXISTS_QUERY` from `app/graphql/products.js`
- Produces:
  - `getUpcPrefix() => string` — reads `UPC_PREFIX`, falls back to `DEFAULT_UPC_PREFIX`
  - `DEFAULT_UPC_PREFIX = "065240"`
  - `allocateUpc({ dbClient, prefix, allocation, barcodeExists, maxAttempts? }) => Promise<string>`
  - `generateUniqueUpc(admin, { shop, productId, variantId, replacedBarcode? }) => Promise<string>`
  - `checkBarcodeExists(admin, barcode) => Promise<boolean>` (kept from the current file)

`allocateUpc` takes its database client and its existence-check as parameters rather than importing them. That is what makes it testable without a database or a Shopify connection.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/barcode.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { allocateUpc, getUpcPrefix, DEFAULT_UPC_PREFIX } from "../../app/utils/barcode.js";

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

test("getUpcPrefix falls back to the default when UPC_PREFIX is unset", () => {
  const original = process.env.UPC_PREFIX;
  delete process.env.UPC_PREFIX;
  assert.equal(getUpcPrefix(), DEFAULT_UPC_PREFIX);
  assert.equal(getUpcPrefix(), "065240");

  process.env.UPC_PREFIX = "0652401";
  assert.equal(getUpcPrefix(), "0652401");

  if (original === undefined) delete process.env.UPC_PREFIX;
  else process.env.UPC_PREFIX = original;
});
```

`065240000029` in the skip test is item code 2: first-11 `06524000002`, odd-index sum `0+5+4+0+0+2 = 11` × 3 = 33, even-index sum `6+2+0+0+0 = 8`, total 41, check digit `(10 - 1) % 10 = 9`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `allocateUpc is not a function` / import error from `barcode.js`

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `app/utils/barcode.js`:

```js
/**
 * UPC allocation for product variants.
 *
 * Codes are issued sequentially and recorded permanently in the UpcAllocation
 * table. The table's unique constraints — not any application-level lock — are
 * what guarantee a code is never issued twice.
 */

import db from "../db.server";
import { CHECK_BARCODE_EXISTS_QUERY } from "../graphql/products";
import { buildUpc } from "./upc";

/** Lead digit 0 + vendor code 65240 (Centralia). Self-assigned, not GS1-licensed. */
export const DEFAULT_UPC_PREFIX = "065240";

/**
 * The vendor prefix for this deployment.
 * @returns {string}
 */
export function getUpcPrefix() {
  return process.env.UPC_PREFIX || DEFAULT_UPC_PREFIX;
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
```

`generateRandomBarcode` and `generateUniqueBarcode` are gone. Task 5 updates the only caller.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests in both files

Note: `barcode.js` imports `../db.server`, which constructs a Prisma client at import time. This does not require a live connection, so the suite stays offline. If the import fails for lack of a generated client, run `npx prisma generate`.

- [ ] **Step 5: Commit**

```bash
git add app/utils/barcode.js tests/utils/barcode.test.js
git commit -m "Issue UPCs from a sequential allocation ledger"
```

---

### Task 5: Wire up the generate and replace actions

**Files:**
- Modify: `app/routes/app._index.jsx` — imports (`:5-8`), loader return (`:103-108`), action (`:124-171`)

**Interfaces:**
- Consumes: `generateUniqueUpc`, `getUpcPrefix` from Task 4; `isOurUpc` from Task 2
- Produces: loader field `upcPrefix: string`; action handling `actionType` of `"generateBarcode"` and `"replaceBarcode"`, both returning `{ success, actionType, variantId, barcode }` or `{ error }`

- [ ] **Step 1: Update the imports**

In `app/routes/app._index.jsx`, replace line 8:

```js
import { generateUniqueBarcode } from "../utils/barcode";
```

with:

```js
import { generateUniqueUpc, getUpcPrefix } from "../utils/barcode";
import { isOurUpc } from "../utils/upc";
```

- [ ] **Step 2: Expose the prefix to the client**

The UI needs the prefix to tell a current UPC from a legacy code. Replace the loader's return block (currently `:103-108`):

```js
  return {
    variants: variantRows,
    hasNextPage: data.data.products.pageInfo.hasNextPage,
    searchQuery,
    statusFilter: validStatuses.map(s => s.toLowerCase()).join(','),
    upcPrefix: getUpcPrefix(),
  };
```

The prefix is not a secret — it is printed on every label.

- [ ] **Step 3: Replace the action's barcode branch**

Replace the whole `if (actionType === "generateBarcode") { ... }` block (currently `:124-171`) with:

```js
  // Handle barcode generation and replacement.
  //
  // These share an implementation but differ in one important way: generate only
  // ever fills an empty barcode, while replace deliberately overwrites an existing
  // one. Replace is separate precisely so that overwriting is never implicit —
  // shelf tags carrying the old code are already printed and will stop scanning.
  if (actionType === "generateBarcode" || actionType === "replaceBarcode") {
    const variantId = formData.get("variantId");
    const productId = formData.get("productId");
    const currentBarcode = formData.get("currentBarcode") || "";

    if (!variantId || !productId) {
      return { error: "No variant ID or product ID provided" };
    }

    const prefix = getUpcPrefix();

    if (actionType === "generateBarcode" && currentBarcode) {
      return {
        error: "This variant already has a barcode. Use Replace with UPC instead.",
      };
    }

    if (actionType === "replaceBarcode" && isOurUpc(currentBarcode, prefix)) {
      return { error: "This variant already has a current UPC." };
    }

    try {
      const newBarcode = await generateUniqueUpc(admin, {
        shop: session.shop,
        productId,
        variantId,
        replacedBarcode: actionType === "replaceBarcode" ? currentBarcode : null,
      });

      const response = await admin.graphql(UPDATE_VARIANT_BARCODE_MUTATION, {
        variables: {
          productId: productId,
          variants: [{ id: variantId, barcode: newBarcode }],
        },
      });

      const data = await response.json();

      if (data.data.productVariantsBulkUpdate.userErrors.length > 0) {
        const errorMessages = data.data.productVariantsBulkUpdate.userErrors
          .map((e) => e.message)
          .join(", ");
        return { error: `Failed to update barcode: ${errorMessages}` };
      }

      return {
        success: true,
        actionType,
        variantId,
        barcode: newBarcode,
      };
    } catch (error) {
      console.error("UPC generation error:", error);
      return { error: error.message || "Failed to generate barcode" };
    }
  }
```

- [ ] **Step 4: Update the action's doc comment**

Replace the comment block at `:111-117`:

```js
/**
 * Action: Handles export, barcode generation, and barcode replacement
 *
 * Actions:
 * 1. "export" - Creates a one-time download token for mobile-compatible file exports
 * 2. "generateBarcode" - Allocates a UPC for a variant that has no barcode
 * 3. "replaceBarcode" - Allocates a UPC to overwrite a non-UPC barcode, on request
 */
```

- [ ] **Step 5: Verify nothing still references the removed function**

Run: `grep -rn "generateUniqueBarcode\|generateRandomBarcode" app/ tests/`
Expected: no output

- [ ] **Step 6: Verify the build and lint are clean**

Run: `npm run lint && npm run build`
Expected: both succeed. (`npm run typecheck` also passes but the routes are plain JSX, so it proves less here.)

- [ ] **Step 7: Commit**

```bash
git add app/routes/app._index.jsx
git commit -m "Add replaceBarcode action and issue UPCs from the route"
```

---

### Task 6: Legacy marker and confirmed replace in the UI

**Files:**
- Create: `app/components/barcodeCell.jsx`
- Modify: `app/routes/app._index.jsx` — loader destructure (`:212`), barcode response effect (`:380-398`), handlers (`:441-449`), mobile card cell (`:1019-1052`), desktop table cell (`:1234-1256`)

**Interfaces:**
- Consumes: `isOurUpc` from Task 2; loader field `upcPrefix` and the `replaceBarcode` action from Task 5
- Produces: `barcodeActionStyle(busy: boolean) => object`; `<LegacyBadge />` React component

There are two barcode cells — a mobile card and a desktop table cell — with different surrounding layout. They share only the button styling and the badge, so those are extracted and the two call sites keep their own structure. The mobile layout has had dedicated fixes before; restructuring it is out of scope here.

- [ ] **Step 1: Create the shared pieces**

Create `app/components/barcodeCell.jsx`:

```jsx
/**
 * Shared bits of the barcode cell, used by both the mobile card and the desktop
 * table. The two layouts differ enough that only these pieces are worth sharing.
 */

/**
 * Styling for the Generate / Replace / confirm buttons.
 * @param {boolean} busy
 */
export function barcodeActionStyle(busy) {
  return {
    padding: "6px 12px",
    fontSize: "13px",
    fontWeight: "600",
    color: busy ? "#6d7175" : "#008060",
    background: busy ? "#f6f6f7" : "#f1f8f5",
    border: `1px solid ${busy ? "#c9cccf" : "#008060"}`,
    borderRadius: "6px",
    cursor: busy ? "not-allowed" : "pointer",
    transition: "all 0.15s ease",
  };
}

/** Marks a barcode that is not a UPC and so cannot ship to Paradies. */
export function LegacyBadge() {
  return (
    <span
      title="Not a UPC — this item cannot ship to Paradies until it is replaced"
      style={{
        padding: "1px 6px",
        fontSize: "11px",
        fontWeight: "600",
        color: "#8a6116",
        background: "#fff5ea",
        border: "1px solid #e1b878",
        borderRadius: "10px",
        whiteSpace: "nowrap",
      }}
    >
      Legacy
    </span>
  );
}
```

- [ ] **Step 2: Import the shared pieces and the prefix**

In `app/routes/app._index.jsx`, add after the existing import block:

```js
import { barcodeActionStyle, LegacyBadge } from "../components/barcodeCell";
```

Then update the loader destructure at `:212`:

```js
  const { variants: initialVariants, searchQuery, statusFilter, upcPrefix } = useLoaderData();
```

- [ ] **Step 3: Add confirmation state**

After the `generatingBarcodeFor` state declaration at `:225`, add:

```js
  const [confirmingReplaceFor, setConfirmingReplaceFor] = useState(null);
```

- [ ] **Step 4: Handle the replace response**

Replace the effect at `:380-398` so it accepts both action types and clears the confirmation:

```js
  // Handle barcode generation / replacement response
  useEffect(() => {
    const result = barcodeFetcher.data;
    const isBarcodeAction =
      result?.actionType === "generateBarcode" || result?.actionType === "replaceBarcode";

    if (result && result.success && isBarcodeAction) {
      const { variantId, barcode, actionType } = result;

      setVariants((prevVariants) =>
        prevVariants.map((v) => (v.id === variantId ? { ...v, barcode } : v))
      );

      setGeneratingBarcodeFor(null);
      setConfirmingReplaceFor(null);
      shopify.toast.show(
        actionType === "replaceBarcode"
          ? `Barcode replaced with UPC: ${barcode}`
          : `UPC generated: ${barcode}`
      );
    } else if (result && result.error) {
      setGeneratingBarcodeFor(null);
      setConfirmingReplaceFor(null);
      shopify.toast.show(result.error, { isError: true });
    }
  }, [barcodeFetcher.data, shopify]);
```

- [ ] **Step 5: Add the replace handler**

Replace `handleGenerateBarcode` at `:441-449` with both handlers:

```js
  const handleGenerateBarcode = (variantId, productId) => {
    setGeneratingBarcodeFor(variantId);

    const formData = new FormData();
    formData.append("actionType", "generateBarcode");
    formData.append("variantId", variantId);
    formData.append("productId", productId);
    barcodeFetcher.submit(formData, { method: "post" });
  };

  const handleReplaceBarcode = (variantId, productId, currentBarcode) => {
    setGeneratingBarcodeFor(variantId);
    setConfirmingReplaceFor(null);

    const formData = new FormData();
    formData.append("actionType", "replaceBarcode");
    formData.append("variantId", variantId);
    formData.append("productId", productId);
    formData.append("currentBarcode", currentBarcode);
    barcodeFetcher.submit(formData, { method: "post" });
  };
```

- [ ] **Step 6: Update the desktop table cell**

Replace the `<td>` body at `:1234-1256` (the `{variant.barcode ? ... }` expression) with:

```jsx
                        <td style={{ padding: "12px 8px" }}>
                          {!variant.barcode ? (
                            <button
                              onClick={() => handleGenerateBarcode(variant.id, variant.productId)}
                              disabled={generatingBarcodeFor === variant.id}
                              style={barcodeActionStyle(generatingBarcodeFor === variant.id)}
                            >
                              {generatingBarcodeFor === variant.id ? "Generating..." : "Generate"}
                            </button>
                          ) : isOurUpc(variant.barcode, upcPrefix) ? (
                            <span style={{ fontVariantNumeric: "tabular-nums" }}>
                              {variant.barcode}
                            </span>
                          ) : confirmingReplaceFor === variant.id ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              <span style={{ fontSize: "12px", color: "#8a6116" }}>
                                Replace {variant.barcode}? Any tag already printed with it
                                will stop scanning.
                              </span>
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                  onClick={() =>
                                    handleReplaceBarcode(
                                      variant.id,
                                      variant.productId,
                                      variant.barcode
                                    )
                                  }
                                  style={barcodeActionStyle(false)}
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setConfirmingReplaceFor(null)}
                                  style={{ ...barcodeActionStyle(false), color: "#6d7175", background: "#fff", border: "1px solid #c9cccf" }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                                {variant.barcode}
                              </span>
                              <LegacyBadge />
                              <button
                                onClick={() => setConfirmingReplaceFor(variant.id)}
                                disabled={generatingBarcodeFor === variant.id}
                                style={barcodeActionStyle(generatingBarcodeFor === variant.id)}
                              >
                                {generatingBarcodeFor === variant.id ? "Replacing..." : "Replace with UPC"}
                              </button>
                            </div>
                          )}
                        </td>
```

- [ ] **Step 7: Update the mobile card cell**

Replace the value `<span>` and the button block at `:1022-1051` with:

```jsx
                      <span style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                        {variant.barcode ? (
                          <>
                            <span style={{ fontVariantNumeric: "tabular-nums" }}>
                              {variant.barcode}
                            </span>
                            {!isOurUpc(variant.barcode, upcPrefix) && <LegacyBadge />}
                          </>
                        ) : (
                          <>
                            <span style={{ fontSize: "14px", color: "#bf0711" }}>🚫</span>
                            <span style={{ color: "#6d7175", fontStyle: "italic" }}>None</span>
                          </>
                        )}
                      </span>
                    </div>
                    {!variant.barcode && (
                      <button
                        onClick={() => handleGenerateBarcode(variant.id, variant.productId)}
                        disabled={generatingBarcodeFor === variant.id}
                        style={barcodeActionStyle(generatingBarcodeFor === variant.id)}
                      >
                        {generatingBarcodeFor === variant.id ? "Generating..." : "Generate"}
                      </button>
                    )}
                    {variant.barcode && !isOurUpc(variant.barcode, upcPrefix) && (
                      confirmingReplaceFor === variant.id ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 100%" }}>
                          <span style={{ fontSize: "12px", color: "#8a6116" }}>
                            Replace {variant.barcode}? Any tag already printed with it
                            will stop scanning.
                          </span>
                          <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            onClick={() =>
                              handleReplaceBarcode(variant.id, variant.productId, variant.barcode)
                            }
                            style={barcodeActionStyle(false)}
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmingReplaceFor(null)}
                            style={{ ...barcodeActionStyle(false), color: "#6d7175", background: "#fff", border: "1px solid #c9cccf" }}
                          >
                            Cancel
                          </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmingReplaceFor(variant.id)}
                          disabled={generatingBarcodeFor === variant.id}
                          style={barcodeActionStyle(generatingBarcodeFor === variant.id)}
                        >
                          {generatingBarcodeFor === variant.id ? "Replacing..." : "Replace"}
                        </button>
                      )
                    )}
```

Keep the surrounding `<div className="card-metadata-item" ...>` wrapper and its closing tags exactly as they are — only the inner value span and the button region change. The confirmation carries the same warning text as the desktop cell; on the narrow card it wraps to full width via `flex: "1 1 100%"`.

- [ ] **Step 8: Verify build and lint**

Run: `npm run lint && npm run build`
Expected: both succeed with no new warnings

- [ ] **Step 9: Verify by hand in the running app**

Run: `npm run dev`, then open the app in the dev store and check:

1. A variant with no barcode shows **Generate**; clicking it produces a 12-digit code starting `065240`, and the toast reads `UPC generated: …`.
2. That variant now renders as plain text with no Legacy badge and no Replace button.
3. A variant with an old 8-digit barcode shows the code, a **Legacy** badge, and **Replace with UPC**.
4. Clicking Replace shows the confirm prompt; **Cancel** restores the previous state and issues no code.
5. **Confirm** replaces the barcode and the toast reads `Barcode replaced with UPC: …`.
6. Confirm the ledger recorded the replacement:
   ```bash
   npx prisma studio
   ```
   The `UpcAllocation` row for that UPC has `replacedBarcode` set to the old 8-digit code.
7. Narrow the browser to mobile width and repeat steps 1 and 3-5 against the card layout.

- [ ] **Step 10: Commit**

```bash
git add app/components/barcodeCell.jsx app/routes/app._index.jsx
git commit -m "Flag legacy barcodes and add confirmed UPC replacement"
```

---

### Task 7: Configuration and documentation

**Files:**
- Modify: `.env-store.example`
- Modify: `scripts/set-store-secrets.sh:22`
- Modify: `docs/customer-onboarding.md` (Step 6 secrets table, customer handoff section, troubleshooting)

**Interfaces:**
- Consumes: `UPC_PREFIX` / `DEFAULT_UPC_PREFIX` from Task 4
- Produces: nothing consumed by later tasks

`set-store-secrets.sh` iterates a hard-coded `REQUIRED_KEYS` array to build its `flyctl secrets set` arguments. Adding the variable to the env template alone would silently never reach Fly.

- [ ] **Step 1: Add the variable to the store env template**

In `.env-store.example`, add before the `NODE_ENV=production` line:

```
# Lead digit + vendor code for generated UPCs. Item codes are allocated
# sequentially in the remaining digits, so the length matters: a 6-digit prefix
# leaves 5 digits (100,000 codes), a 7-digit prefix leaves 4 (10,000).
# Only change this to move to a GS1-licensed prefix — changing it mid-catalog
# restarts the item code sequence and orphans the existing ledger entries.
UPC_PREFIX=065240
```

- [ ] **Step 2: Add the key to the secrets script**

In `scripts/set-store-secrets.sh`, change line 22 from:

```bash
REQUIRED_KEYS=(FLY_APP SHOPIFY_API_KEY SHOPIFY_API_SECRET SHOPIFY_APP_URL SCOPES NODE_ENV)
```

to:

```bash
REQUIRED_KEYS=(FLY_APP SHOPIFY_API_KEY SHOPIFY_API_SECRET SHOPIFY_APP_URL SCOPES UPC_PREFIX NODE_ENV)
```

The script prints non-secret values in its summary, which is correct here — the prefix is printed on every label.

- [ ] **Step 3: Verify the script picks it up without touching production**

```bash
cp .env-store.example /tmp/.env-upctest
sed -i 's|^FLY_APP=|FLY_APP=example-app|; s|^SHOPIFY_API_KEY=|SHOPIFY_API_KEY=k|; s|^SHOPIFY_API_SECRET=|SHOPIFY_API_SECRET=s|; s|^SHOPIFY_APP_URL=|SHOPIFY_APP_URL=https://example.fly.dev|' /tmp/.env-upctest
bash scripts/set-store-secrets.sh /tmp/.env-upctest --dry-run
rm /tmp/.env-upctest
```

Expected: the dry-run summary lists `UPC_PREFIX = 065240`. It may exit earlier complaining that the Fly app does not exist or that the file is not gitignored — that is fine, as long as `UPC_PREFIX` appears in the printed key list before it stops. If it fails on the gitignore check, run it against a copy inside the repo named `.env-upctest` instead, and delete it afterwards.

- [ ] **Step 4: Document the variable in the onboarding guide**

In `docs/customer-onboarding.md`, in the Step 6 secrets section, after the paragraph beginning "All five secrets are required", change that sentence to read "All six secrets are required" and add:

```markdown
`UPC_PREFIX` sets the lead digit and vendor code for generated UPCs (default
`065240` — lead digit `0` plus the Centralia zip as the vendor code). It is not a
credential. Two stores that both generate UPCs must be given **different** prefixes,
because the item code sequence lives in each store's own database and would
otherwise hand out the same codes twice.
```

- [ ] **Step 5: Update the customer handoff section**

In the **Customer handoff** section, replace the "Usage" bullet with:

```markdown
2. **Usage**: search by name, SKU, barcode, or vendor; select products; click
   **Generate** for variants missing barcodes; click **Export Selected to Excel**;
   open the file in Excel or label-printing software.

   Barcodes are 12-digit UPCs. A barcode marked **Legacy** predates the UPC
   scheme and cannot ship to Paradies — use **Replace with UPC** on that row,
   remembering that any shelf tag already printed with the old code will stop
   scanning once it is replaced.
```

- [ ] **Step 6: Add a troubleshooting entry**

In the **Troubleshooting** section, after the existing *Barcode "Generate" button fails* entry, add:

```markdown
### "Unable to allocate a UPC" or "exceeds capacity"

The item code space for the configured `UPC_PREFIX` is exhausted — with the default
6-digit prefix that is 100,000 items. Check how many have been issued:

```bash
flyctl postgres connect --app <production-db>
\c <store database>
SELECT count(*), max("itemCode") FROM "UpcAllocation";
```

Moving to a shorter prefix widens the item code space, but note that codes already
issued under the old prefix stay in the ledger and remain valid on printed labels.
```

- [ ] **Step 7: Verify the security check passes**

Run: `bash scripts/verify-security.sh`
Expected: passes. The prefix is not a credential, but this confirms nothing in the doc edits tripped the secret scanner.

- [ ] **Step 8: Commit**

```bash
git add .env-store.example scripts/set-store-secrets.sh docs/customer-onboarding.md
git commit -m "Document and wire the UPC_PREFIX setting"
```

---

## Deployment note

The `UpcAllocation` migration applies automatically: `.docker/Dockerfile` runs
`npm run docker-start`, which is `npm run setup && npm run start`, and `setup` runs
`prisma migrate deploy`. So `./scripts/deploy-all.sh` brings both stores up to date with
no manual migration step.

Set `UPC_PREFIX` **before** deploying. If it is missing the code falls back to `065240`
rather than failing, so a forgotten secret shows up as a store quietly issuing codes
under the default prefix — which is only a problem if a second store ever starts
generating UPCs too.
