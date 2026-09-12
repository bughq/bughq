---
title: PHP and Laravel
description: Report PHP exceptions and Laravel application failures to BugHQ.
---

# PHP and Laravel

BugHQ maintains a framework-neutral PHP client and a Laravel integration.

## PHP

Install the client with Composer:

```bash
composer require bughq/bughq-php
```

Initialize the client with your project key, collector host, environment, and release. Capture exceptions inside existing catch blocks when the application handles them locally.

```php
try {
    processOrder($order);
} catch (Throwable $error) {
    $bughq->captureException($error, ['order_id' => $order->id]);
    throw $error;
}
```

## Laravel

```bash
composer require bughq/bughq-laravel
```

Publish or set the package configuration, then place the public ingest key and collector URL in environment variables. The Laravel integration connects BugHQ to the framework exception lifecycle while retaining manual capture for handled failures.

## Production checklist

- Use a non-blocking transport where supported.
- Set a release that maps to a deployed commit or build.
- Redact request credentials and sensitive input.
- Confirm the application can reach the collector over HTTPS.
- Test an exception after every material integration upgrade.
