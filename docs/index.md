---
title: BugHQ Documentation
description: Capture production errors, group duplicates, understand impact, and move from issue to fix.
layout: home
hero:
  name: BugHQ
  text: Turn production errors into fixes
  tagline: Group duplicate failures, preserve the context that matters, alert the right team, and close the loop from regression to resolution.
  actions:
    - theme: brand
      text: Capture your first error
      link: /getting-started
    - theme: alt
      text: Choose an SDK
      link: /capture/browser
features:
  - title: Stable issue grouping
    details: Normalize volatile messages and stack data so repeated failures become one issue instead of a wall of events.
  - title: Debugging context
    details: Keep releases, environments, users, tags, breadcrumbs, sessions, and structured context beside each failure.
  - title: From alert to pull request
    details: Notify email, Slack, or Discord, then optionally prepare a guarded GitHub Autofix pull request.
---

## Choose a path

- Follow the [quick start](/getting-started) to create a project and send a test error.
- Choose an integration for [browser JavaScript](/capture/browser), [Stacks and stx](/capture/stacks-stx), [Vue and Nuxt](/capture/vue-nuxt), or [PHP and Laravel](/capture/php-laravel).
- Learn how grouping, status, and regressions work in [issues and triage](/use/issues-triage).
- Use the [HTTP API reference](/reference/api) for custom clients and automation.

## The error lifecycle

1. An SDK sends an event to `POST /errors` with the project's public ingest key.
2. BugHQ validates limits and calculates a stable fingerprint.
3. The event creates a new issue or increments an existing issue.
4. New issues and regressions can notify email, Slack, or Discord.
5. Owners and project members investigate, assign context, and resolve or ignore the issue.
6. An owner can optionally connect GitHub and run a guarded AI Autofix workflow.

BugHQ is under active development. Verify deployment and SDK behavior against the version you run before relying on it for a production incident process.
