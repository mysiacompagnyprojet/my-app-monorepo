/*
  Warnings:

  - The primary key for the `User` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled');

-- AlterTable
ALTER TABLE "public"."User" DROP CONSTRAINT "User_pkey",
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "subscriptionEndsAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionStatus" "public"."SubscriptionStatus",
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "User_id_seq";

-- CreateTable
CREATE TABLE "public"."Recipe" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "servings" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "imageUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Ingredients" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "airtableId" TEXT,
    "unitPriceBuy" DOUBLE PRECISION,
    "costRecipe" DOUBLE PRECISION,

    CONSTRAINT "Ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ImportLimit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "breakfasts" INTEGER NOT NULL DEFAULT 0,
    "lunches" INTEGER NOT NULL DEFAULT 0,
    "snacks" INTEGER NOT NULL DEFAULT 0,
    "dinners" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportLimit_userId_key" ON "public"."ImportLimit"("userId");

-- AddForeignKey
ALTER TABLE "public"."Recipe" ADD CONSTRAINT "Recipe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Ingredients" ADD CONSTRAINT "Ingredients_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "public"."Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ImportLimit" ADD CONSTRAINT "ImportLimit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
