Append-only event log, one JSON object per line, newest file per UTC date
(`YYYY-MM-DD-events.jsonl`). Append with a simple `fs.appendFileSync` — never rewrite a past day's
file. Fields: `{ts, agent, task_id, event, detail}`. `event` is typically a lifecycle transition
(`FOUND`, `REPRODUCED`, `ROOT_CAUSED`, `PR_OPENED`, `MERGED`, `DEPLOYED`, `PROD_VERIFIED`,
`CLOSED`, `LEASE_CLAIMED`, `LEASE_RELEASED`, `LEASE_RECLAIMED`) but isn't a closed enum — write
what actually happened.
