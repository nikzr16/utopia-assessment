# 0001 - Zero-Amount Order Payment Status

> **Date:** 2026-10-22 | **Status:** Accepted

<!-- AI Context
Role: This is an append-only record of a single implementation divergence.
Each entry captures why the deviation happened and what it affects.
Never edit an existing decision log entry. To reverse a previous decision,
create a new entry that references the original. After adding an entry,
check the impact checklist below and update affected workflow or reference
docs before the session ends.
-->

## Context

The PRD defines payment status as `unpaid` (0 paid), `partial` (0 < paid < final)
and `paid` (paid >= final). For an order whose final amount is 0 (quoted price 0
and no extra charges) with no payments, "0 paid" and "paid >= final" both apply.
Read literally with `unpaid` checked first, such an order could never be closed,
because payments must be greater than zero.

## Decision

`paid >= final` is evaluated first. A zero-amount order is therefore `paid`
(nothing is owed) and Finance can close it. Orders with a positive final amount
behave exactly as the PRD describes. Implemented identically in the
`order_summary` view and in `paymentStatus()` in `src/domain/money.ts`, with tests
in `tests/domain/money.test.ts` and `tests/db/money.test.ts`.

## Reason

Avoids a dead-end state for free / warranty jobs without adding a manual override.

## Impact

- [ ] Workflow doc updated
- [ ] Reference doc updated
- [x] No upstream doc update needed
