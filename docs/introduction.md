---
title: What is BugHQ?
description: Understand BugHQ projects, events, issues, and the workflow they support.
---

# What is BugHQ

BugHQ turns individual error events into a manageable issue queue. Each event belongs to one project. Events with the same fingerprint are grouped into one issue so repeated failures do not overwhelm the team.

## Core concepts

### Project

A project represents one application or service. It owns an ingest key, issues, events, members, notification channels, and an optional GitHub repository connection.

### Event

An event is one observed failure. It can include the message, exception type, stack trace, URL, environment, release, user, tags, contexts, breadcrumbs, session details, and SDK metadata.

### Issue

An issue is the triage unit. It aggregates related events and tracks first seen, last seen, occurrence count, affected users, culprit, environment, release, category, and status.

### Fingerprint

The fingerprint decides which issue receives an event. By default BugHQ derives it from the error type, a normalized message, and the top useful stack frame. A client can send an explicit fingerprint when domain-specific grouping is needed.

## Hosted or self-hosted

The hosted dashboard is available at [bughq.org](https://bughq.org). The complete application is MIT licensed and can also run on your own Bun, database, mail, queue, and proxy infrastructure.
