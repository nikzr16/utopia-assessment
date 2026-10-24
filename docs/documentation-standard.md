# Documentation Standard

Every file in `docs/` belongs to one of six types. Each type has a freshness rule that determines when it must be updated.

## Document Types and Freshness Rules

| Type | Purpose | Must Stay Current | Update When |
|---|---|---|---|
| **Roadmap** | Phase sequencing, PRD registry, cross-feature priorities | Yes | New PRD added, phase graduates, priorities shift |
| **Intent** (PRD) | Product goals, constraints, scope | No | Product direction changes |
| **Plan** | Implementation path, phasing, architecture | No (after coding starts) | Deliberate re-planning session |
| **Workflow** | How the system works today | Yes | Behavior, flow, or error handling changes |
| **Reference** | Structural facts (files, routes, schemas, config) | Yes | Files, modules, routes, or schemas change |
| **Decision log** | Deviations from the plan | Append-only | Implementation diverges, bug forces redesign, assumption invalidated |

Key rules:

- The roadmap is the top-level sequencing document. When a new PRD is created, register it in the roadmap under the appropriate phase.
- Intent docs and plans are not rewritten during coding. Record divergences in the decision log.
- Workflow and reference docs must be updated before the coding session ends when behavior or structure changes.
- Decision log entries are never edited. Reverse a decision by adding a new entry.

## Naming Convention

Feature documents carry a four-digit **feature number** so a feature's PRD, plan, and workflow doc sort together in the IDE. Name them `NNNN-[feature]-[type].md` where type matches the document's role:

| Suffix | Document Type | Location | Example |
|---|---|---|---|
| `-prd.md` | Intent (PRD) | `docs/prd/` | `0001-ops-portal-prd.md` |
| `-plan.md` | Plan | `docs/plan/` | `0001-ops-portal-plan.md` |
| `-workflow.md` | Workflow | `docs/` | `0001-ops-portal-workflow.md` |

Numbering rules:

- The PRD claims the number: take the next unused number in `docs/prd/`, always zero-padded to four digits. `0000` is reserved for the system foundation PRD (shared data model, roles, statuses, cross-cutting rules); features start at `0001`.
- The feature's plan and workflow doc reuse the PRD's number and feature slug. They never get a number of their own.
- Numbers are never reused or renumbered. A dropped feature keeps its number and is marked `dropped` in the roadmap.
- Source material behind a PRD (client briefs, specs, spreadsheets) sits next to it with the same number and a `-brief` suffix, such as `docs/prd/0000-programmer-assessment-brief.docx`. A brief that feeds several PRDs takes the lowest number it feeds.
- The roadmap's PRD Registry is the index of feature numbers.

Decision log entries use `NNNN-short-title.md` with their own independent sequence: decision `0003` is unrelated to PRD `0003`. When a decision concerns one feature, name its feature number in the entry body.

The product roadmap is `product-roadmap.md` (one per project). Reference docs live in `docs/reference/` with descriptive names such as `folder-structure.md`.

A feature may have a combined Intent/Plan document or separate PRD and plan files. The templates support the split approach.

## Document Inventory

| Document | Type |
|---|---|
| `docs/product-roadmap.md` | Roadmap |
| `docs/documentation-standard.md` | Standard |
| `docs/NNNN-*-workflow.md` | Workflow |
| `docs/prd/NNNN-*-prd.md` | Intent (PRD) |
| `docs/plan/NNNN-*-plan.md` | Plan |
| `docs/reference/*.md` | Reference |
| `docs/decisions/*.md` | Decision log |
| `docs/templates/*.md` | Templates |

## Folder Layout

```text
docs/
├── product-roadmap.md
├── documentation-standard.md
├── NNNN-[feature]-workflow.md
├── prd/
├── plan/
├── reference/
├── decisions/
├── draft/
└── templates/
```

`docs/` stays at the repository root so it can document every part of the codebase.
`docs/draft/` is personal scratch space — agents never read or act on it unless explicitly referenced.

## Session-Close Checklist

Run at the end of every substantial coding session.

- [ ] New PRD created? Give it the next feature number and register it in the product roadmap under the correct phase.
- [ ] Feature shipped or phase graduated? Update the roadmap status.
- [ ] Behavior changed? Update the workflow doc.
- [ ] Files, routes, or schemas changed? Update the reference doc.
- [ ] Diverged from the plan? Add a decision log entry.
- [ ] Design trade-off made? Add a decision log entry.
- [ ] Scan the workflow doc: does it match what the code does today?
