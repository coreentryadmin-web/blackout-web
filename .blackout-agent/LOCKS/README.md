Per-task lock files live here as `<task_id>.lock`, created only by
`scripts/agent-ops/claim-task.mjs` (atomic `wx` open — O_EXCL). Never hand-create or hand-edit one;
that defeats the atomicity guarantee the whole lease system depends on. Empty directory is the
normal/healthy state when nothing is actively claimed.
