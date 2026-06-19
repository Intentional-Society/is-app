ALTER TABLE "profiles" ADD COLUMN "has_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "profiles"
SET "has_password" = true
WHERE EXISTS (
  SELECT 1 FROM auth.users
  WHERE auth.users.id = profiles.id
    AND auth.users.encrypted_password IS NOT NULL
    AND auth.users.encrypted_password != ''
);
