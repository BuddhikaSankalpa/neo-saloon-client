-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "durationMinutes" INTEGER NOT NULL,
    "feeMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'LKR',
    "status" "ServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "listed" BOOLEAN NOT NULL DEFAULT true,
    "requiresConsultation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceVariant" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ServiceVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffService" (
    "staffId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "StaffService_pkey" PRIMARY KEY ("staffId","serviceId")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "key" TEXT NOT NULL,
    "staffId" TEXT,
    "weekly" JSONB NOT NULL,
    "exceptions" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "StaffTimeOff" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "StaffTimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationRecord" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL,
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationClearance" (
    "consultationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "ConsultationClearance_pkey" PRIMARY KEY ("consultationId","serviceId")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "preferredStaffId" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "reservedUntil" TIMESTAMPTZ(3) NOT NULL,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "actualStartedAt" TIMESTAMPTZ(3),
    "actualEndedAt" TIMESTAMPTZ(3),
    "cancellationReason" TEXT,
    "customerNotes" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentService" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "variantId" TEXT,
    "consultationId" TEXT,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "variantName" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "feeMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,

    CONSTRAINT "AppointmentService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentHistory" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceVariant_serviceId_name_key" ON "ServiceVariant"("serviceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_staffId_key" ON "Schedule"("staffId");

-- CreateIndex
CREATE INDEX "StaffTimeOff_staffId_startsAt_endsAt_idx" ON "StaffTimeOff"("staffId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ConsultationRecord_customerId_completedAt_idx" ON "ConsultationRecord"("customerId", "completedAt");

-- CreateIndex
CREATE INDEX "Appointment_staffId_startsAt_reservedUntil_idx" ON "Appointment"("staffId", "startsAt", "reservedUntil");

-- CreateIndex
CREATE INDEX "Appointment_customerId_startsAt_reservedUntil_idx" ON "Appointment"("customerId", "startsAt", "reservedUntil");

-- CreateIndex
CREATE INDEX "Appointment_createdAt_id_idx" ON "Appointment"("createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_customerId_idempotencyKey_key" ON "Appointment"("customerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AppointmentService_serviceId_appointmentId_idx" ON "AppointmentService"("serviceId", "appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentService_appointmentId_position_key" ON "AppointmentService"("appointmentId", "position");

-- CreateIndex
CREATE INDEX "AppointmentHistory_appointmentId_createdAt_idx" ON "AppointmentHistory"("appointmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ServiceVariant" ADD CONSTRAINT "ServiceVariant_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTimeOff" ADD CONSTRAINT "StaffTimeOff_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationRecord" ADD CONSTRAINT "ConsultationRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationRecord" ADD CONSTRAINT "ConsultationRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationClearance" ADD CONSTRAINT "ConsultationClearance_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "ConsultationRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationClearance" ADD CONSTRAINT "ConsultationClearance_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ServiceVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "ConsultationRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentHistory" ADD CONSTRAINT "AppointmentHistory_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentHistory" ADD CONSTRAINT "AppointmentHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks supplement request validation. Existing tables/data are unchanged.
ALTER TABLE "Service" ADD CONSTRAINT "Service_positive_duration_fee" CHECK ("durationMinutes" > 0 AND "feeMinor" >= 0);
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_owner" CHECK (("key" = 'business' AND "staffId" IS NULL) OR ("staffId" IS NOT NULL AND "key" = "staffId"));
ALTER TABLE "StaffTimeOff" ADD CONSTRAINT "StaffTimeOff_interval" CHECK ("startsAt" < "endsAt");
ALTER TABLE "ConsultationRecord" ADD CONSTRAINT "ConsultationRecord_interval" CHECK ("completedAt" < "validUntil");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_interval" CHECK ("startsAt" < "endsAt" AND "endsAt" <= "reservedUntil" AND "bufferMinutes" >= 0 AND "version" > 0);
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_execution" CHECK (
    ("status" = 'BOOKED' AND "actualStartedAt" IS NULL AND "actualEndedAt" IS NULL AND "cancellationReason" IS NULL)
    OR ("status" = 'IN_PROGRESS' AND "actualStartedAt" IS NOT NULL AND "actualEndedAt" IS NULL AND "cancellationReason" IS NULL)
    OR ("status" = 'COMPLETED' AND "actualStartedAt" IS NOT NULL AND "actualEndedAt" >= "actualStartedAt" AND "actualEndedAt" IS NOT NULL AND "cancellationReason" IS NULL)
    OR ("status" = 'CANCELLED' AND "actualStartedAt" IS NULL AND "actualEndedAt" IS NULL AND "cancellationReason" = 'CUSTOMER_ABSENT' AND "cancellationReason" IS NOT NULL)
);
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_positive_values" CHECK ("position" >= 0 AND "durationMinutes" > 0 AND "feeMinor" >= 0);
