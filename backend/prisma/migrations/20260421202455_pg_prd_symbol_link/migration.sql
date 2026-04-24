-- CreateTable
CREATE TABLE "prd_symbol_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prdId" TEXT NOT NULL,
    "symbolId" TEXT NOT NULL,
    "symbolName" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_symbol_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prd_symbol_links_tenantId_prdId_idx" ON "prd_symbol_links"("tenantId", "prdId");

-- CreateIndex
CREATE INDEX "prd_symbol_links_tenantId_symbolId_idx" ON "prd_symbol_links"("tenantId", "symbolId");

-- CreateIndex
CREATE UNIQUE INDEX "prd_symbol_links_prdId_symbolId_key" ON "prd_symbol_links"("prdId", "symbolId");

-- AddForeignKey
ALTER TABLE "prd_symbol_links" ADD CONSTRAINT "prd_symbol_links_prdId_fkey" FOREIGN KEY ("prdId") REFERENCES "prds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
