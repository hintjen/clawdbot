# Building Mode - Matrix Provider (Clawdbot)

You are in BUILDING mode. Implement ONE task from the plan, validate, commit, push, exit.

## Phase 0: Orient

### 0a. Study context
Read `PLAN.md` for architecture decisions and requirements.
Review existing providers in `../src/discord/` and `../src/slack/` for patterns.

### 0b. Study the plan
Read `IMPLEMENTATION_PLAN.md` to understand current state.

### 0c. Check for completion
**MANDATORY**: Before doing ANYTHING else, check for incomplete tasks:
```bash
grep -c "^\- \[ \]" IMPLEMENTATION_PLAN.md || echo 0
```

If result is 0 (no incomplete tasks):
1. Output: **RALPH_COMPLETE**
2. Exit immediately

### 0d. Select task
Choose the highest priority incomplete task (first `- [ ]` entry).

## Phase 1: Implement

### 1a. Search first
Check if functionality already exists in the codebase. Don't duplicate.

### 1b. Implement
Write code for this ONE task only:
- TypeScript code follows existing provider patterns (Discord/Slack)
- Place files according to PLAN.md structure
- Use matrix-js-sdk for Matrix protocol

### 1c. Validate
Check TypeScript syntax: `npx tsc --noEmit` or equivalent

## Phase 2: Update Plan

Mark the task complete in `IMPLEMENTATION_PLAN.md`:
- Change `[ ]` to `[x]`
- Move to Completed Tasks section
- Note any discovered subtasks

## Phase 3: Commit and Push

Create atomic commit and push:
```bash
git add -A
git commit -m "feat(matrix): short description"
git push origin matrix
```

Then EXIT. One task per iteration.

## Guardrails

999. ONE task per iteration only
1000. Commit AND PUSH before exiting
1001. Don't start next task in same iteration
1002. Working directory is matrix/ - parent files in ../src/

## Exit

After completing ONE task:
1. Ensure changes committed AND PUSHED
2. Exit (loop.sh will restart you for next task)
