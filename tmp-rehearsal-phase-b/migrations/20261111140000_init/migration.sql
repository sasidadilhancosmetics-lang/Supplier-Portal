-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'STAFF', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "StaffPermissionCode" AS ENUM ('MANAGE_SUPPLIERS', 'MANAGE_BRANDS', 'MANAGE_PRODUCTS', 'CONFIRM_REQUIREMENT', 'SEND_SUPPLIER_REQUEST', 'ALLOCATE_ORDER', 'VERIFY_DELIVERY', 'ISSUE_GRN', 'REVIEW_PRODUCT_OFFER', 'APPROVE_PERFORMANCE_EXCEPTION', 'VIEW_REPORTS');

-- CreateEnum
CREATE TYPE "ProductPriorityStatus" AS ENUM ('NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "OsfImportStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierRequestStatus" AS ENUM ('NEW', 'PARTIALLY_RESPONDED', 'RESPONDED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AvailabilityOfferStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'NOT_AVAILABLE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AvailabilityChangeType" AS ENUM ('DRAFT_SAVED', 'SUBMITTED', 'QUANTITY_DECREASED', 'QUANTITY_INCREASED', 'DATE_CHANGED', 'PRICE_CHANGED', 'MARKED_NOT_AVAILABLE', 'RESERVE_CANCELLED', 'ORDER_ALLOCATION_INCREASED', 'ORDER_ALLOCATION_RELEASED', 'EXPIRED', 'WARNING_BELOW_ORDERED');

-- CreateEnum
CREATE TYPE "PerformanceAdjustmentUnit" AS ENUM ('PENALTY_POINTS');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'PARTIALLY_CANCELLED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('ACTIVE', 'PARTIALLY_CANCELLED', 'CANCELLED', 'FULFILLED');

-- CreateEnum
CREATE TYPE "ProductMasterStatus" AS ENUM ('PROVISIONAL', 'ERP_LINKED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GrnStatus" AS ENUM ('ISSUED');

-- CreateEnum
CREATE TYPE "ProductOfferStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'STAFF_INTERESTED', 'STAFF_NOT_INTERESTED', 'SUPPLIER_RECONFIRMED', 'CONVERTED_TO_ORDER', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ');

-- CreateEnum
CREATE TYPE "PerformanceExceptionType" AS ENUM ('COMPANY_CAUSED_DELAY', 'CANCELLATION_PENALTY_REDUCTION');

-- CreateEnum
CREATE TYPE "PerformanceExceptionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT,
    "role" "UserRole" NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" "StaffPermissionCode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SupplierStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "supportsAllBrands" BOOLEAN NOT NULL DEFAULT false,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "notes" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBrand" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "erpItemId" TEXT,
    "cosmoItemId" TEXT,
    "unitOfMeasure" TEXT,
    "priorityStatus" "ProductPriorityStatus" NOT NULL DEFAULT 'NORMAL',
    "masterStatus" "ProductMasterStatus" NOT NULL DEFAULT 'PROVISIONAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OsfImport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "OsfImportStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsfImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "osfImportId" TEXT,
    "brandId" TEXT NOT NULL,
    "status" "RequirementStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "notes" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementItem" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityPlanned" DECIMAL(18,4) NOT NULL,
    "externalLineId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "status" "SupplierRequestStatus" NOT NULL DEFAULT 'NEW',
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestItem" (
    "id" TEXT NOT NULL,
    "supplierRequestId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "requirementItemId" TEXT,
    "productId" TEXT NOT NULL,
    "quantityRequested" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityOffer" (
    "id" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "AvailabilityOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "quantityDeclared" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quantityOrderedActive" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(18,2),
    "currencyCode" TEXT,
    "availableDate" TIMESTAMP(3),
    "reservedAt" TIMESTAMP(3),
    "reserveExpiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilityOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityChange" (
    "id" TEXT NOT NULL,
    "availabilityOfferId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "changeType" "AvailabilityChangeType" NOT NULL,
    "quantityDeclaredBefore" DECIMAL(18,4),
    "quantityDeclaredAfter" DECIMAL(18,4),
    "quantityOrderedActiveBefore" DECIMAL(18,4),
    "quantityOrderedActiveAfter" DECIMAL(18,4),
    "unitPriceBefore" DECIMAL(18,2),
    "unitPriceAfter" DECIMAL(18,2),
    "availableDateBefore" TIMESTAMP(3),
    "availableDateAfter" TIMESTAMP(3),
    "statusBefore" "AvailabilityOfferStatus",
    "statusAfter" "AvailabilityOfferStatus",
    "reason" TEXT,
    "warningBelowOrdered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productOfferId" TEXT,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderNumber" TEXT,
    "currencyCode" TEXT,
    "originalExpectedDeliveryAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "availabilityOfferId" TEXT,
    "productOfferItemId" TEXT,
    "productId" TEXT NOT NULL,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "quantityOrdered" DECIMAL(18,4) NOT NULL,
    "quantityCancelled" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quantityVerifiedReceived" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(18,2),
    "originalExpectedDeliveryAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'SUBMITTED',
    "idempotencyKey" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "notes" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryItem" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantityDelivered" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grn" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "status" "GrnStatus" NOT NULL DEFAULT 'ISSUED',
    "grnNumber" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "erpDocumentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Grn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrnItem" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityReceived" DECIMAL(18,4) NOT NULL,
    "productName" TEXT,
    "erpItemId" TEXT,

    CONSTRAINT "GrnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOffer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "ProductOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "staffReviewedAt" TIMESTAMP(3),
    "staffReviewedById" TEXT,
    "supplierReconfirmedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOfferItem" (
    "id" TEXT NOT NULL,
    "productOfferId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT,
    "proposedName" TEXT,
    "proposedSku" TEXT,
    "proposedErpItemId" TEXT,
    "proposedBrandId" TEXT,
    "quantityOffered" DECIMAL(18,4),
    "unitPrice" DECIMAL(18,2),
    "currencyCode" TEXT,
    "availableDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOfferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceException" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "PerformanceExceptionType" NOT NULL,
    "status" "PerformanceExceptionStatus" NOT NULL DEFAULT 'PENDING',
    "purchaseOrderId" TEXT,
    "orderItemId" TEXT,
    "affectedQuantity" DECIMAL(18,4),
    "originalExpectedDeliveryAt" TIMESTAMP(3),
    "adjustmentValue" DECIMAL(18,4),
    "adjustmentUnit" "PerformanceAdjustmentUnit",
    "reason" TEXT NOT NULL,
    "requestedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "responseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_companyId_role_idx" ON "User"("companyId", "role");

-- CreateIndex
CREATE INDEX "User_supplierId_idx" ON "User"("supplierId");

-- CreateIndex
CREATE INDEX "StaffPermission_code_idx" ON "StaffPermission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StaffPermission_userId_code_key" ON "StaffPermission"("userId", "code");

-- CreateIndex
CREATE INDEX "Supplier_companyId_status_idx" ON "Supplier"("companyId", "status");

-- CreateIndex
CREATE INDEX "Supplier_companyId_supportsAllBrands_idx" ON "Supplier"("companyId", "supportsAllBrands");

-- CreateIndex
CREATE INDEX "Supplier_externalId_idx" ON "Supplier"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_id_companyId_key" ON "Supplier"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_companyId_name_key" ON "Brand"("companyId", "name");

-- CreateIndex
CREATE INDEX "SupplierBrand_brandId_idx" ON "SupplierBrand"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBrand_supplierId_brandId_key" ON "SupplierBrand"("supplierId", "brandId");

-- CreateIndex
CREATE INDEX "Product_companyId_brandId_idx" ON "Product"("companyId", "brandId");

-- CreateIndex
CREATE INDEX "Product_companyId_cosmoItemId_idx" ON "Product"("companyId", "cosmoItemId");

-- CreateIndex
CREATE INDEX "Product_companyId_priorityStatus_idx" ON "Product"("companyId", "priorityStatus");

-- CreateIndex
CREATE INDEX "Product_companyId_masterStatus_idx" ON "Product"("companyId", "masterStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Product_companyId_erpItemId_key" ON "Product"("companyId", "erpItemId");

-- CreateIndex
CREATE INDEX "OsfImport_companyId_status_idx" ON "OsfImport"("companyId", "status");

-- CreateIndex
CREATE INDEX "OsfImport_externalId_idx" ON "OsfImport"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "OsfImport_companyId_idempotencyKey_key" ON "OsfImport"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Requirement_companyId_status_idx" ON "Requirement"("companyId", "status");

-- CreateIndex
CREATE INDEX "Requirement_brandId_status_idx" ON "Requirement"("brandId", "status");

-- CreateIndex
CREATE INDEX "Requirement_osfImportId_idx" ON "Requirement"("osfImportId");

-- CreateIndex
CREATE INDEX "RequirementItem_requirementId_idx" ON "RequirementItem"("requirementId");

-- CreateIndex
CREATE INDEX "RequirementItem_productId_idx" ON "RequirementItem"("productId");

-- CreateIndex
CREATE INDEX "SupplierRequest_supplierId_status_idx" ON "SupplierRequest"("supplierId", "status");

-- CreateIndex
CREATE INDEX "SupplierRequest_requirementId_supplierId_idx" ON "SupplierRequest"("requirementId", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierRequest_brandId_status_idx" ON "SupplierRequest"("brandId", "status");

-- CreateIndex
CREATE INDEX "SupplierRequest_companyId_status_idx" ON "SupplierRequest"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierRequest_id_supplierId_key" ON "SupplierRequest"("id", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierRequest_id_companyId_key" ON "SupplierRequest"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierRequest_id_supplierId_companyId_key" ON "SupplierRequest"("id", "supplierId", "companyId");

-- CreateIndex
CREATE INDEX "RequestItem_supplierRequestId_idx" ON "RequestItem"("supplierRequestId");

-- CreateIndex
CREATE INDEX "RequestItem_supplierId_idx" ON "RequestItem"("supplierId");

-- CreateIndex
CREATE INDEX "RequestItem_companyId_idx" ON "RequestItem"("companyId");

-- CreateIndex
CREATE INDEX "RequestItem_productId_idx" ON "RequestItem"("productId");

-- CreateIndex
CREATE INDEX "RequestItem_requirementItemId_idx" ON "RequestItem"("requirementItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestItem_id_supplierId_key" ON "RequestItem"("id", "supplierId");

-- CreateIndex
CREATE INDEX "AvailabilityOffer_supplierId_status_idx" ON "AvailabilityOffer"("supplierId", "status");

-- CreateIndex
CREATE INDEX "AvailabilityOffer_reserveExpiresAt_status_idx" ON "AvailabilityOffer"("reserveExpiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityOffer_requestItemId_supplierId_key" ON "AvailabilityOffer"("requestItemId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityOffer_id_supplierId_key" ON "AvailabilityOffer"("id", "supplierId");

-- CreateIndex
CREATE INDEX "AvailabilityChange_availabilityOfferId_createdAt_idx" ON "AvailabilityChange"("availabilityOfferId", "createdAt");

-- CreateIndex
CREATE INDEX "AvailabilityChange_actorUserId_idx" ON "AvailabilityChange"("actorUserId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_status_idx" ON "PurchaseOrder"("companyId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_status_idx" ON "PurchaseOrder"("supplierId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_productOfferId_idx" ON "PurchaseOrder"("productOfferId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_id_supplierId_key" ON "PurchaseOrder"("id", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_id_companyId_key" ON "PurchaseOrder"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_id_supplierId_companyId_key" ON "PurchaseOrder"("id", "supplierId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_orderNumber_key" ON "PurchaseOrder"("companyId", "orderNumber");

-- CreateIndex
CREATE INDEX "OrderItem_purchaseOrderId_status_idx" ON "OrderItem"("purchaseOrderId", "status");

-- CreateIndex
CREATE INDEX "OrderItem_supplierId_status_idx" ON "OrderItem"("supplierId", "status");

-- CreateIndex
CREATE INDEX "OrderItem_companyId_idx" ON "OrderItem"("companyId");

-- CreateIndex
CREATE INDEX "OrderItem_availabilityOfferId_status_idx" ON "OrderItem"("availabilityOfferId", "status");

-- CreateIndex
CREATE INDEX "OrderItem_productOfferItemId_idx" ON "OrderItem"("productOfferItemId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "Delivery_purchaseOrderId_status_idx" ON "Delivery"("purchaseOrderId", "status");

-- CreateIndex
CREATE INDEX "Delivery_supplierId_status_idx" ON "Delivery"("supplierId", "status");

-- CreateIndex
CREATE INDEX "Delivery_companyId_idx" ON "Delivery"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_purchaseOrderId_idempotencyKey_key" ON "Delivery"("purchaseOrderId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "DeliveryItem_orderItemId_idx" ON "DeliveryItem"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryItem_deliveryId_orderItemId_key" ON "DeliveryItem"("deliveryId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Grn_deliveryId_key" ON "Grn"("deliveryId");

-- CreateIndex
CREATE INDEX "Grn_issuedAt_idx" ON "Grn"("issuedAt");

-- CreateIndex
CREATE INDEX "Grn_grnNumber_idx" ON "Grn"("grnNumber");

-- CreateIndex
CREATE INDEX "GrnItem_grnId_idx" ON "GrnItem"("grnId");

-- CreateIndex
CREATE INDEX "ProductOffer_supplierId_status_idx" ON "ProductOffer"("supplierId", "status");

-- CreateIndex
CREATE INDEX "ProductOffer_companyId_status_idx" ON "ProductOffer"("companyId", "status");

-- CreateIndex
CREATE INDEX "ProductOffer_validUntil_idx" ON "ProductOffer"("validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOffer_id_supplierId_key" ON "ProductOffer"("id", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOffer_id_companyId_key" ON "ProductOffer"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOffer_id_supplierId_companyId_key" ON "ProductOffer"("id", "supplierId", "companyId");

-- CreateIndex
CREATE INDEX "ProductOfferItem_productOfferId_idx" ON "ProductOfferItem"("productOfferId");

-- CreateIndex
CREATE INDEX "ProductOfferItem_supplierId_idx" ON "ProductOfferItem"("supplierId");

-- CreateIndex
CREATE INDEX "ProductOfferItem_companyId_idx" ON "ProductOfferItem"("companyId");

-- CreateIndex
CREATE INDEX "ProductOfferItem_productId_idx" ON "ProductOfferItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOfferItem_id_supplierId_key" ON "ProductOfferItem"("id", "supplierId");

-- CreateIndex
CREATE INDEX "PerformanceException_companyId_type_status_idx" ON "PerformanceException"("companyId", "type", "status");

-- CreateIndex
CREATE INDEX "PerformanceException_purchaseOrderId_idx" ON "PerformanceException"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PerformanceException_orderItemId_idx" ON "PerformanceException"("orderItemId");

-- CreateIndex
CREATE INDEX "Notification_userId_status_createdAt_idx" ON "Notification"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_scope_key_key" ON "IdempotencyKey"("scope", "key");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_supplierId_companyId_fkey" FOREIGN KEY ("supplierId", "companyId") REFERENCES "Supplier"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPermission" ADD CONSTRAINT "StaffPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBrand" ADD CONSTRAINT "SupplierBrand_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBrand" ADD CONSTRAINT "SupplierBrand_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImport" ADD CONSTRAINT "OsfImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_osfImportId_fkey" FOREIGN KEY ("osfImportId") REFERENCES "OsfImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementItem" ADD CONSTRAINT "RequirementItem_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementItem" ADD CONSTRAINT "RequirementItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRequest" ADD CONSTRAINT "SupplierRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRequest" ADD CONSTRAINT "SupplierRequest_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRequest" ADD CONSTRAINT "SupplierRequest_supplierId_companyId_fkey" FOREIGN KEY ("supplierId", "companyId") REFERENCES "Supplier"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRequest" ADD CONSTRAINT "SupplierRequest_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_supplierRequestId_supplierId_companyId_fkey" FOREIGN KEY ("supplierRequestId", "supplierId", "companyId") REFERENCES "SupplierRequest"("id", "supplierId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_requirementItemId_fkey" FOREIGN KEY ("requirementItemId") REFERENCES "RequirementItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityOffer" ADD CONSTRAINT "AvailabilityOffer_requestItemId_supplierId_fkey" FOREIGN KEY ("requestItemId", "supplierId") REFERENCES "RequestItem"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityOffer" ADD CONSTRAINT "AvailabilityOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityChange" ADD CONSTRAINT "AvailabilityChange_availabilityOfferId_fkey" FOREIGN KEY ("availabilityOfferId") REFERENCES "AvailabilityOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityChange" ADD CONSTRAINT "AvailabilityChange_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_companyId_fkey" FOREIGN KEY ("supplierId", "companyId") REFERENCES "Supplier"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_productOfferId_supplierId_companyId_fkey" FOREIGN KEY ("productOfferId", "supplierId", "companyId") REFERENCES "ProductOffer"("id", "supplierId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_purchaseOrderId_supplierId_companyId_fkey" FOREIGN KEY ("purchaseOrderId", "supplierId", "companyId") REFERENCES "PurchaseOrder"("id", "supplierId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_availabilityOfferId_supplierId_fkey" FOREIGN KEY ("availabilityOfferId", "supplierId") REFERENCES "AvailabilityOffer"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productOfferItemId_supplierId_fkey" FOREIGN KEY ("productOfferItemId", "supplierId") REFERENCES "ProductOfferItem"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_purchaseOrderId_supplierId_companyId_fkey" FOREIGN KEY ("purchaseOrderId", "supplierId", "companyId") REFERENCES "PurchaseOrder"("id", "supplierId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItem" ADD CONSTRAINT "DeliveryItem_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItem" ADD CONSTRAINT "DeliveryItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grn" ADD CONSTRAINT "Grn_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grn" ADD CONSTRAINT "Grn_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnItem" ADD CONSTRAINT "GrnItem_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "Grn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOffer" ADD CONSTRAINT "ProductOffer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOffer" ADD CONSTRAINT "ProductOffer_supplierId_companyId_fkey" FOREIGN KEY ("supplierId", "companyId") REFERENCES "Supplier"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOffer" ADD CONSTRAINT "ProductOffer_staffReviewedById_fkey" FOREIGN KEY ("staffReviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOfferItem" ADD CONSTRAINT "ProductOfferItem_productOfferId_supplierId_companyId_fkey" FOREIGN KEY ("productOfferId", "supplierId", "companyId") REFERENCES "ProductOffer"("id", "supplierId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOfferItem" ADD CONSTRAINT "ProductOfferItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceException" ADD CONSTRAINT "PerformanceException_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceException" ADD CONSTRAINT "PerformanceException_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceException" ADD CONSTRAINT "PerformanceException_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceException" ADD CONSTRAINT "PerformanceException_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceException" ADD CONSTRAINT "PerformanceException_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
