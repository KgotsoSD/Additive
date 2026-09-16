-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "platform" TEXT NOT NULL DEFAULT 'instagram',
ADD COLUMN     "productImages" JSONB,
ADD COLUMN     "style" TEXT NOT NULL DEFAULT 'ugc';
