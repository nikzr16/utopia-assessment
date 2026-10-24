# 0019 - Live Check Starts From Vercel's repository_dispatch

> **Date:** 2026-10-24 | **Status:** Accepted

<!-- AI Context
Role: This is an append-only record of a single implementation divergence.
Each entry captures why the deviation happened and what it affects.
Never edit an existing decision log entry. To reverse a previous decision,
create a new entry that references the original. After adding an entry,
check the impact checklist below and update affected workflow or reference
docs before the session ends.
-->

## Context

Feature 0010 (decision 0018) planned the GitHub `live-check` robot visit on
the `deployment_status` event "after each production deploy" (plan
"GitHub Actions"). After the 0010 release (pull request #2) Vercel deployed
`main`, but no `live-check` run started: the repository has no GitHub
Deployments, because Vercel does not send `deployment_status` events for
this project. Vercel's current integration sends `repository_dispatch`
events instead (`vercel.deployment.success` and others), whose
`client_payload` carries the deployment's `environment` and `url`. Started
by hand, `live-check` and `keep-awake` both passed on the live app.

## Decision

`.github/workflows/live-check.yml` runs on `repository_dispatch` of type
`vercel.deployment.success` when `client_payload.environment` is
`production` (GitHub compares strings without case), and on
`workflow_dispatch`. A first step prints the deployment URL from the
payload. `deployment_status` is no longer used.

## Reason

Vercel's documented way to start GitHub Actions after a deployment; it
needs no extra Vercel setting and also tells preview from production.

## Impact

- [x] Workflow doc updated (`docs/0010-production-deployment-workflow.md`,
  stage 3 and constraints)
- [x] Reference doc: no structure change
- [x] Tests: `tests/scripts/deploy-config.test.ts` checks the new trigger
  (and reads files with line endings normalised)
