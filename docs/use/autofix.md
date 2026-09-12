---
title: AI Autofix
description: Connect GitHub and create a guarded draft pull request from an issue.
---

# AI Autofix

AI Autofix can analyze an issue, inspect an approved portion of a connected GitHub repository, propose edits, and create a pull request. It is an optional owner-only workflow, not an automatic production deployment.

## Requirements

- The project owner connects a GitHub repository and branch.
- The BugHQ server has `GITHUB_TOKEN` configured with access to that repository.
- `AI_AUTOFIX_ENABLED` is not set to `false`.
- The selected AI driver is configured. OpenAI and Anthropic require API keys; Ollama requires a reachable host.
- A queue worker can run the Autofix job.

## Run Autofix

Open an issue and start Autofix. BugHQ records a run through the queued, analyzing, planning, editing, and pull request stages. Only one active run is allowed for an issue.

The result includes the root-cause analysis, plan, proposed changes, branch name, pull request URL, and any failure details.

## Safety boundaries

The workflow limits how many source files and bytes it can inspect, restricts edits to approved source files, uses a configured branch prefix, and creates draft pull requests by default. Review the diff and run the repository's test suite before merging.

Configure the guardrails with:

- `AI_AUTOFIX_DRAFT`
- `AI_AUTOFIX_MAX_FILES`
- `AI_AUTOFIX_MAX_SOURCE_BYTES`
- `AI_AUTOFIX_BRANCH_PREFIX`

Autofix should support a human review process. It should not replace ownership, testing, access control, or deployment review.
