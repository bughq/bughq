-- Invite email delivery tracking.
--
-- The invite route sent mail fire-and-forget and reported success to the owner
-- regardless of what happened. Worse, the failure it *did* try to catch could
-- never fire: `mail.send()` resolves with `{ success: false }` for a suppressed
-- address or a driver-reported failure and only throws on an exception, so the
-- `.catch()` guarding the send was dead code for the actual failure mode. An
-- owner saw "invited" whether or not anything left the building.
--
-- These three columns are what the owner needs to tell the two cases apart, and
-- what the Resend button acts on. `pending` is the honest initial state: the row
-- exists before the transport has answered.
ALTER TABLE "project_invites" ADD COLUMN IF NOT EXISTS "delivery_status" varchar(20) NOT NULL DEFAULT 'pending';
-- Capped rather than TEXT: this holds a provider's rejection message, which is
-- shown to the owner. Anything longer is a stack trace we do not want to render.
ALTER TABLE "project_invites" ADD COLUMN IF NOT EXISTS "delivery_error" varchar(500);
ALTER TABLE "project_invites" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp;

-- Invites that predate this migration land on 'pending', and are deliberately
-- NOT backfilled to 'sent': nothing recorded whether those emails arrived, and
-- asserting they did would be the same invention this column exists to prevent.
-- The Members list words that state as "delivery not confirmed" and offers a
-- resend, which is the only thing that can actually settle it.
