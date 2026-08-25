ALTER TABLE "error_events" DROP CONSTRAINT IF EXISTS "error_events_project_id_fk";
ALTER TABLE "error_events" DROP CONSTRAINT IF EXISTS "error_events_project_id_fkey";
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
ALTER TABLE "error_events" DROP CONSTRAINT IF EXISTS "error_events_issue_id_fk";
ALTER TABLE "error_events" DROP CONSTRAINT IF EXISTS "error_events_issue_id_fkey";
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "issues"("id");
