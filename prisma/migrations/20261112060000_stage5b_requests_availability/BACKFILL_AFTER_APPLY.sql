-- Optional post-apply backfill (run AFTER 20261112060000 is committed).
-- Grants MANAGE_REQUIREMENTS to users who already have CONFIRM_REQUIREMENT
-- so draft edit does not regress for existing STAFF grants.
-- Not part of the Prisma migration (new enum value must be committed first on older PG).

INSERT INTO "StaffPermission" ("id", "userId", "code", "createdAt")
SELECT
  'mig5b_' || substr(md5(sp."userId" || 'MANAGE_REQUIREMENTS'), 1, 20),
  sp."userId",
  'MANAGE_REQUIREMENTS'::"StaffPermissionCode",
  CURRENT_TIMESTAMP
FROM "StaffPermission" sp
WHERE sp."code" = 'CONFIRM_REQUIREMENT'::"StaffPermissionCode"
  AND NOT EXISTS (
    SELECT 1
    FROM "StaffPermission" existing
    WHERE existing."userId" = sp."userId"
      AND existing."code" = 'MANAGE_REQUIREMENTS'::"StaffPermissionCode"
  );
