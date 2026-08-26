-- Repair issue counts that the old read-then-write ingest lost.
--
-- Before the atomic upsert, the ingest read `count`, added one in application
-- code and wrote it back, so concurrent events overwrote each other. Live data
-- carried issues storing 3 against 21 real events. The upsert stopped new drift
-- but could not repair what had already been lost, and every surface in the
-- product renders that number: the list, the issue page, the alert emails, the
-- stats row and the unread deltas.
--
-- Safe to run because bughq has no retention policy — error_events rows are
-- never pruned, so COUNT(*) over them is the true occurrence count rather than
-- a lower bound. If retention is ever added this migration must NOT be re-run,
-- since it would then revise counts downward to whatever survived pruning.
UPDATE "issues" i
   SET "count" = c.n
  FROM (SELECT issue_id, COUNT(*) AS n FROM "error_events" GROUP BY issue_id) c
 WHERE c.issue_id = i.id
   AND COALESCE(i."count", 0) <> c.n;

-- Then the read watermarks, or the repair itself creates a wall of bold.
--
-- issue_reads.seen_count was seeded from the counts that were wrong. Raising a
-- count above its watermark is exactly how "unread" is derived, so fixing the
-- numbers would mark every previously-read issue unread — and the bold would
-- mean "we corrected a number", not "this fired since you looked", which is the
-- one thing it must never mean.
--
-- Only watermarks that were already level with the old count are advanced: a
-- genuinely unread issue stays unread.
UPDATE "issue_reads" r
   SET "seen_count" = i."count"
  FROM "issues" i
 WHERE i.id = r.issue_id
   AND r."seen_count" > 0
   AND r."seen_count" < i."count"
   AND r."seen_at" >= COALESCE(i."updated_at", i."created_at");
