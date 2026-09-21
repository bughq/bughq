---
title: Issues and triage
description: Understand grouping, issue status, search, and regression behavior.
---

# Issues and triage

BugHQ groups repeated events into issues so the issue list represents distinct failures instead of raw volume.

## Default grouping

The default fingerprint combines the error type, a normalized message, and the top useful stack frame. Normalization reduces noise from volatile ids and values. Send an explicit fingerprint only when the default does not reflect your domain.

```json
{
  "message": "Payment provider rejected order 98321",
  "type": "ProviderError",
  "fingerprint": ["payment-provider", "rejected-order"]
}
```

Changing a fingerprint strategy creates different issue groups. Roll it out deliberately and record the change with a release.

## Issue states

- **Open** means the failure needs investigation or a fix.
- **Resolved** means the team believes the failure is fixed.
- **Ignored** means the team intentionally removed it from active work.

When a resolved issue receives another event, BugHQ reopens it as a regression and can alert the project. Ignored issues remain ignored when another matching event arrives.

## Triage workflow

1. Filter by project, environment, release, or search text.
2. Inspect the latest event and compare earlier occurrences.
3. Check affected users, occurrence count, first seen, and last seen.
4. Use stack, culprit, breadcrumbs, tags, and context to reproduce the failure.
5. Resolve after the fix is deployed, not merely after it is committed.
6. Watch for a regression from the new release.
