-- CreateEnum
CREATE TYPE "public"."SubscriptionTier" AS ENUM ('FREE', 'GROWTH', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('OWNER', 'ADMIN', 'USER', 'VIEWER');

-- CreateEnum
CREATE TYPE "public"."CGTMethod" AS ENUM ('FIFO', 'LIFO', 'WEIGHTED_AVERAGE', 'SPECIFIC_ID');

-- CreateTable
CREATE TABLE "public"."tenants" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "subscriptionTier" "public"."SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "schemaName" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "monthlyVolumeLimit" DOUBLE PRECISION NOT NULL DEFAULT 50000,
    "dailyVolumeLimit" DOUBLE PRECISION NOT NULL DEFAULT 5000,
    "maxTransactionLimit" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "maxUsers" INTEGER NOT NULL DEFAULT 2,
    "maxIntegrations" INTEGER NOT NULL DEFAULT 2,
    "contactEmail" TEXT NOT NULL,
    "businessAddress" TEXT,
    "abn" TEXT,
    "cgtMethod" "public"."CGTMethod" NOT NULL DEFAULT 'FIFO',
    "taxYear" INTEGER NOT NULL DEFAULT 2024,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subscription_history" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "previousTier" "public"."SubscriptionTier" NOT NULL,
    "newTier" "public"."SubscriptionTier" NOT NULL,
    "changeReason" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_subdomain_key" ON "public"."tenants"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_schemaName_key" ON "public"."tenants"("schemaName");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscription_history" ADD CONSTRAINT "subscription_history_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
