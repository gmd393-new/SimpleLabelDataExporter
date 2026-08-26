-- CreateTable
CREATE TABLE "UpcAllocation" (
    "id" TEXT NOT NULL,
    "upc" TEXT NOT NULL,
    "itemCode" INTEGER NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "replacedBarcode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpcAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UpcAllocation_upc_key" ON "UpcAllocation"("upc");

-- CreateIndex
CREATE UNIQUE INDEX "UpcAllocation_itemCode_key" ON "UpcAllocation"("itemCode");

-- CreateIndex
CREATE INDEX "UpcAllocation_shop_idx" ON "UpcAllocation"("shop");

-- CreateIndex
CREATE INDEX "UpcAllocation_variantId_idx" ON "UpcAllocation"("variantId");
