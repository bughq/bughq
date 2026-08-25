ALTER TABLE "issues" DROP CONSTRAINT IF EXISTS "issues_project_id_fk";
ALTER TABLE "issues" DROP CONSTRAINT IF EXISTS "issues_project_id_fkey";
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
