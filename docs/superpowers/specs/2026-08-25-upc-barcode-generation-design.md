# UPC-A Barcode Generation — Design

**Date**: 2026-08-25
**Status**: Designed, not yet implemented
**Driver**: Paradies Lagardère "Ticketing and Bar-coding Standards" vendor requirements

## Problem

The customer ships merchandise to Paradies Lagardère, whose vendor standards require
every item to carry a **12-digit UPC** structured as:

```
lead digit │ vendor code │ item code │ check digit
```

with the rule that **each UPC code can be used only once**.

The current generator (`app/utils/barcode.js`) produces a **random 8-digit number**
between `10000000` and `99999999`. It satisfies none of the requirements:

| Requirement | Current behaviour |
|---|---|
| 12 digits | 8 digits |
| Structured lead + vendor + item | Unstructured random integer |
| Valid mod-10 check digit | No check digit |
| Used only once, ever | Uniqueness checked by querying Shopify for a live product with that barcode — so deleting a product silently returns its code to the pool |

The last row is the subtle one. `checkBarcodeExists()` asks Shopify "does any product
currently have this barcode?" A code belonging to a deleted product answers *no* and
gets reissued, which violates the once-only rule and would put two different items on
the same UPC in Paradies' system.

### Vendor registration

The vendor code is normally a GS1-issued company prefix. The customer confirmed with
Paradies that **GS1 registration is not required** — the standard they must meet is a
well-formed 12-digit code with a correct check digit. The chosen vendor code is
therefore derived from the Centralia zip code: lead digit `0` + vendor code `65240`,
giving the prefix `065240`.

Because that prefix is self-assigned rather than licensed, it is held in configuration
rather than hardcoded, so a real GS1 prefix can replace it later without a code change.

## Requirements

1. Generated barcodes are valid 12-digit UPC-A codes with a correct mod-10 check digit.
2. A UPC, once issued, is never issued again — including after the product is deleted.
3. Barcodes already printed on shelf tags keep working. Nothing overwrites an existing
   barcode without an explicit, confirmed user action.
4. The UPC must live in Shopify's `barcode` field.
5. The vendor prefix is configurable per deployment.

### Why the `barcode` field, and not a metafield

`ProductVariant.barcode` is a single `String` — the Admin API has no list field and no
alternate-barcode concept. A metafield can hold a second code, but **Shopify POS only
scans against the standard `barcode` field**, so a UPC stored in a metafield would not
scan at a register. The customer scans these products in Shopify POS, so the UPC has to
occupy `barcode` itself.

This is what makes requirement 3 load-bearing: replacing a legacy barcode with a UPC
stops the already-printed tag from scanning at the register.

## Decision

Issue UPCs from a **sequential item-code counter backed by a permanent allocation
ledger** in Postgres, keep them in the `barcode` field, and never overwrite an existing
barcode except through a dedicated, confirmed Replace action.

### Options considered — item code allocation

| Option | Summary | Verdict |
|---|---|---|
| **1. Sequential counter + allocation ledger** | Next item code is `max + 1`; every issued UPC is recorded permanently in a `UpcAllocation` table | **Chosen** |
| 2. Random item code, checked against Shopify | Port the existing approach to UPC format | Rejected — cannot satisfy once-only (deleted products free their codes), and collision rate climbs with catalog size, each retry costing a Shopify API round trip |
| 3. Random item code + ledger | Ledger gives once-only, randomness gives unguessable codes | Rejected — the ledger already solves uniqueness; randomness adds retry loops and birthday collisions to buy an unguessability nobody needs |

Option 1 also produces an audit trail: which UPC went to which variant, when, and what
barcode it replaced. That answers "why did this shelf tag stop scanning?" directly.

## Format and configuration

```
0    65240    00042    5
│    │        │        └─ check digit (computed, mod-10)
│    │        └────────── item code (allocated sequentially)
│    └─────────────────── vendor code
└──────────────────────── lead digit
```

A single env var **`UPC_PREFIX`** holds the leading digits, defaulting to `065240`. The
item-code width is *derived*, not configured:

```
itemCodeWidth = 11 - UPC_PREFIX.length
```

With the 6-digit prefix that yields a 5-digit item code and a capacity of **100,000
codes**. A future 7-digit GS1 prefix would yield a 4-digit item code (10,000 codes)
with no code change. `UPC_PREFIX` is validated at use: digits only, length 1–10.

### Check digit

Standard GS1 mod-10 over the first 11 digits:

```
sum   = 3 × (d1 + d3 + d5 + d7 + d9 + d11) + (d2 + d4 + d6 + d8 + d10)
check = (10 - (sum mod 10)) mod 10
```

Verified against the GS1 sample printed on the Paradies standards sheet,
`012345678905`: odd-position sum 20 × 3 = 60, even-position sum 25, total 85, check
digit 5. ✅

Worked example for this deployment — item code 42 gives first-11 `06524000042`:
odd 11 × 3 = 33, even 12, total 45, check digit **5** → `065240000425`.
The first allocation, item code 1, gives `065240000012`.

## Architecture

Three layers, each independently testable:

```
app/utils/upc.js          pure format logic — no I/O, no database, no Shopify
        ↑
app/utils/barcode.js      allocation — ledger transaction + Shopify safety check
        ↑
app/routes/app._index.jsx actions and UI
```

### `app/utils/upc.js` (new)

Pure functions with no imports and no environment access. **The prefix is always passed
in as a parameter**, never read from `process.env` inside this module — that keeps the
module testable without environment setup and lets the same functions run on the client,
where `process.env` is unavailable.

| Function | Purpose |
|---|---|
| `calculateCheckDigit(first11)` | mod-10 check digit; throws on input that is not exactly 11 digits |
| `buildUpc(prefix, itemCode)` | zero-pads the item code to the derived width, appends the check digit; throws if the item code exceeds capacity |
| `isValidUpc(value)` | 12 digits **and** a correct check digit |
| `isOurUpc(value, prefix)` | `isValidUpc` **and** begins with `prefix` |
| `getItemCodeWidth(prefix)` | `11 - prefix.length`, validated |

Reading `UPC_PREFIX` from the environment happens in `app/utils/barcode.js` (server
side) and in the loader (for the client), never here.

`isOurUpc` is what distinguishes a legacy 8-digit code from a current one in the UI. It
is deliberately stricter than `isValidUpc`: a valid UPC from some other vendor's prefix
is not one of ours and should still be flagged as replaceable.

### `app/utils/barcode.js` (rewritten)

Exports `generateUniqueUpc(admin, { shop, productId, variantId, replacedBarcode })`.

Allocation sequence:

1. Read the highest `itemCode` in `UpcAllocation`; the candidate is `max + 1` (starting
   at 1 when the table is empty).
2. Build the UPC via `buildUpc`.
3. Query Shopify for an existing product with that barcode — a cheap safety net against
   codes typed in by hand that the ledger has never seen.
4. Insert the `UpcAllocation` row. The unique constraints on `upc` and `itemCode` are
   the real guarantee: two simultaneous Generate clicks cannot both succeed.
5. On a unique-constraint violation (Prisma `P2002`), retry from step 1, up to 10
   attempts.

The row is written **before** the Shopify mutation. If the mutation then fails, the
item code is burned and never reused — which is the correct trade under a once-only
rule. Burning a code from a 100,000-wide space is harmless; reissuing one is not.

Exhausting the item-code space raises an explicit error naming the prefix and the
capacity, rather than looping or wrapping.

`generateRandomBarcode()` is deleted. Nothing outside this module used it.

### Data model

```prisma
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

`itemCode` is unique on its own so the sequence itself is protected, not just the
formatted string. `replacedBarcode` is null for a fresh Generate and holds the previous
value for a Replace. Rows are never deleted — that is the point of the table.

The uniqueness scope is the store's own database. Each deployment serves exactly one
store and only one store issues UPCs for Paradies, so a per-database sequence is
sufficient. Should a second store ever need its own UPCs, it gets a different
`UPC_PREFIX` rather than a shared counter.

## Route and UI changes — `app/routes/app._index.jsx`

### `generateBarcode` action

Unchanged trigger and unchanged UI placement — still only offered for variants with no
barcode. It now passes `shop`, `productId` and `variantId` to `generateUniqueUpc` and
writes a UPC. The success toast shows the formatted code.

### `replaceBarcode` action (new)

The only path that overwrites a non-empty barcode.

- Refuses when the current barcode already satisfies `isOurUpc` — prevents pointless
  churn and accidental double-clicks burning codes.
- Records the previous value in `UpcAllocation.replacedBarcode`.
- Otherwise identical to `generateBarcode`.

### UI

The component calls `isOurUpc(barcode, prefix)` to decide what to render, so the loader
must include the configured prefix in its returned data alongside `variants`. It is not
a secret — it is printed on every label.

- Variants whose barcode fails `isOurUpc` show a subtle **Legacy** marker, so it is
  visible at a glance which items cannot yet ship to Paradies.
- Those variants get a **Replace with UPC** control that requires a confirmation step
  showing the current code and an explicit warning that any printed tag carrying it will
  stop scanning.

  The confirmation shows the **old** code only. The new UPC cannot be displayed before
  confirming, because allocating it is what makes it exist — offering a preview would
  burn an item code every time someone cancelled. The new code appears in the success
  toast instead.

  Confirmation is inline (the cell swaps to a confirm/cancel prompt), not
  `window.confirm`, which renders poorly inside the embedded admin iframe.
- Both the desktop table (`app._index.jsx:1023-1050`) and the mobile card layout
  (`:1235-1253`) render the barcode cell and need the same treatment.

## Export — no change required

`app/routes/download.jsx:85-92` already forces the barcode column to string type before
writing the workbook, so a leading-zero UPC such as `065240000425` survives into Excel
without being coerced to a number. Verified by reading the code; no modification is
part of this work.

## Testing

The repository has no test framework today. The check-digit calculation is printed onto
physical labels and cannot be silently wrong, so this work introduces one.

**Node's built-in `node:test`** — zero new dependencies on the project's Node 20+
engine — plus a `"test": "node --test"` script in `package.json`.

Coverage:

| Area | Cases |
|---|---|
| `calculateCheckDigit` | GS1 sample `012345678905`; the two worked examples above; rejects non-11-digit input |
| `isValidUpc` / `isOurUpc` | valid code, wrong check digit, 8-digit legacy code, empty string, non-numeric, valid UPC on a foreign prefix |
| `buildUpc` | zero-padding, capacity overflow throws |
| `getItemCodeWidth` | 6-digit and 7-digit prefixes; rejects an over-long prefix |
| Allocation | sequence starts at 1; increments; `P2002` triggers retry; exhaustion throws |

Allocation tests use a mocked Prisma client — this suite stays a fast unit suite with
no database dependency.

## Rollout

1. Prisma migration creating `UpcAllocation`. `scripts/deploy-all.sh` runs
   `prisma migrate deploy` via `npm run setup`, so both store deployments pick up the
   table on the next release.
2. Add `UPC_PREFIX` to `.env-store.example` and to the secrets step in
   `docs/customer-onboarding.md`.
3. Update the customer handoff section of `docs/customer-onboarding.md` to describe
   Generate versus Replace and what the Legacy marker means.

The migration is additive — no existing column changes and no data is rewritten — so
deploying it does not touch any current barcode.

## Risks and limits

| Risk | Mitigation |
|---|---|
| `065240` is self-assigned, not GS1-licensed | Confirmed acceptable with Paradies; held in `UPC_PREFIX` so a licensed prefix is a config change, not a code change |
| Capacity of 100,000 item codes | Error names the limit explicitly on exhaustion; far beyond the catalog size |
| Replace breaks already-printed tags | Never automatic — explicit action, confirmation dialog showing old → new, and a warning |
| A failed Shopify mutation burns an item code | Accepted deliberately; burning is safe under a once-only rule, reissuing is not |

## Out of scope

- Bulk conversion of the existing catalog to UPCs. Printed tags make this a per-item
  decision, so it stays a per-variant action.
- Rendering barcode images. The app exports data; label software draws the barcodes.
- Backfilling `UpcAllocation` with the existing 8-digit barcodes. They are not UPCs and
  do not participate in the item-code sequence.
