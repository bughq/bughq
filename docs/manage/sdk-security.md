---
title: SDK security
description: Secure public ingest keys and minimize sensitive error data.
---

# SDK security

## The ingest key is public

A BugHQ ingest key identifies a project and authorizes event submission. Browser applications must ship it to users, so it is not a secret. It does not grant dashboard access or permission to read issues.

The collector limits payload size and applies per-project and per-IP quotas. You can rotate the key at any time to invalidate older clients.

## Protect private credentials

Dashboard bearer tokens, database passwords, mail credentials, GitHub tokens, AI provider keys, and environment decryption keys are secrets. Never put them in browser code, event metadata, screenshots, or public support tickets.

## Collector proxy configuration

`TRUSTED_PROXY_HOPS` controls which `X-Forwarded-For` entry the collector treats as the client address. Set it to the actual number of trusted proxies in front of BugHQ, or `0` when the collector is exposed directly. An incorrect value weakens per-IP rate limiting or attributes events to a proxy.

## Data handling checklist

- Redact sensitive fields before sending.
- Use opaque user ids when an email address is unnecessary.
- Keep breadcrumbs short and relevant.
- Limit repository token permissions for Autofix.
- Use HTTPS for public collection.
- Restrict dashboard and database access.
- Define retention and deletion procedures for your organization.
