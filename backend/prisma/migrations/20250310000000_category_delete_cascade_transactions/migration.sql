-- AlterTable
-- Change Transaction.categoryId FK from ON DELETE RESTRICT to ON DELETE CASCADE
-- so that deleting a category deletes its transactions (with UI warning).
ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS "Transaction_categoryId_fkey";
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("category_id") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
