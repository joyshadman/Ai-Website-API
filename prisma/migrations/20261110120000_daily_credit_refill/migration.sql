-- Daily free credit refill (spec 0014).
-- Every existing account counts as already refilled today, with a start count of 0 (AC-14).
ALTER TABLE "user"
    ADD COLUMN "creditsRefilledOn" DATE NOT NULL DEFAULT (now() at time zone 'utc')::date,
    ADD COLUMN "generationStartsToday" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "normalizedEmail" TEXT;

-- Backfill the cleaned up email with the same rules as `normalizeEmail` in lib/signupGuard.ts.
-- The oldest account for each cleaned up address keeps it, the others stay empty.
WITH lowered AS (
    SELECT id, "createdAt", lower(trim(email)) AS e FROM "user"
), parts AS (
    SELECT id, "createdAt",
           regexp_replace(regexp_replace(e, '@[^@]*$', ''), '\+.*$', '') AS local_part,
           substring(e from '[^@]*$') AS domain
    FROM lowered
), cleaned AS (
    SELECT id, "createdAt",
           CASE WHEN domain IN ('gmail.com', 'googlemail.com')
                THEN replace(local_part, '.', '') || '@gmail.com'
                ELSE local_part || '@' || domain
           END AS normalized
    FROM parts
), ranked AS (
    SELECT id, normalized,
           row_number() OVER (PARTITION BY normalized ORDER BY "createdAt", id) AS row_num
    FROM cleaned
)
UPDATE "user" AS u
SET "normalizedEmail" = ranked.normalized
FROM ranked
WHERE u.id = ranked.id AND ranked.row_num = 1;

-- CreateIndex
CREATE UNIQUE INDEX "user_normalizedEmail_key" ON "user"("normalizedEmail");
