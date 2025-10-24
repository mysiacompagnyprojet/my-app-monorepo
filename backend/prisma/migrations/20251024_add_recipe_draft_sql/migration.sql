-- Migration manuelle : création de la table RecipeDraft
-- Date : 2025-10-24
-- Auteur : toi 💪

CREATE TABLE "RecipeDraft" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" uuid NOT NULL,
    "sourceUrl" text,
    "title" text,
    "imageUrl" text,
    "rawText" text,
    "parsed" jsonb,
    "status" text DEFAULT 'new',
    "createdat" timestamptz(6) DEFAULT now(),
    "updatedat" timestamptz(6) DEFAULT now()
);

-- Index pour optimiser la recherche des drafts par utilisateur
CREATE INDEX "idx_recipedraft_user" ON "RecipeDraft"("userId");

-- Clé étrangère vers User (même logique que Recipe → User)
ALTER TABLE "RecipeDraft"
ADD CONSTRAINT "RecipeDraft_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE NO ACTION;
