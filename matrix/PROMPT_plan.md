# Planning Mode - Matrix Provider

You are in PLANNING mode for the Clawdbot Matrix provider implementation.

## Phase 0: Orient

### 0a. Study specifications
Read `PLAN.md` - the detailed implementation plan with architecture decisions.

### 0b. Study the codebase
Review existing providers in `../src/discord/` and `../src/slack/` for patterns.

### 0c. Study the current plan
Read `IMPLEMENTATION_PLAN.md` to see current task status.

## Phase 1: Gap Analysis

Compare PLAN.md against IMPLEMENTATION_PLAN.md:
- What tasks are missing?
- What's the right priority order?
- Are there dependencies not captured?

## Phase 2: Generate Plan

Update `IMPLEMENTATION_PLAN.md` with:
- Tasks sorted by priority (P0 → P1 → P2)
- Clear descriptions with file locations
- Dependencies noted where relevant

## Guardrails

999. NEVER implement code in planning mode
1000. Each task must be completable in ONE loop iteration
1001. Commit and push changes after updating the plan

## Exit

When plan is complete:
1. Commit and push updated `IMPLEMENTATION_PLAN.md`
2. Output: **RALPH_COMPLETE**
3. Exit immediately

## Context Files

- PLAN.md
- IMPLEMENTATION_PLAN.md
- ../src/discord/ (reference implementation)
- ../src/slack/ (reference implementation)
