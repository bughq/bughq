---
title: Projects and teams
description: Manage BugHQ projects, access, invitations, keys, and deletion.
---

# Projects and teams

## Project ownership

Every project has one owner. The owner can change the ingest key, manage members and notification channels, connect a repository, run Autofix, archive the project, and delete it.

Invited members can view project issues and perform issue triage. Administrative actions remain owner-only.

## Invitations

Invite a member by email from project settings. BugHQ records invitation delivery state and provides a join link. Membership matching is case-insensitive by email.

Remove access when a teammate changes responsibilities or leaves the organization. Review project members and webhook channels during regular access audits.

## Rotate an ingest key

Rotate the public key if a project receives abusive traffic or you want to invalidate old clients. The old key stops working immediately. Update every active SDK deployment after rotation.

## Archive or delete

Archiving makes a project inactive while preserving its data. An archived project still counts toward hosted plan project limits.

Deletion permanently removes project events, Autofix runs, issues, channels, members, and the project itself. Export or back up anything you need before deleting.
