# Verification

## Verification pass

- OpenSpec strict validation passed.
- Development and production Compose configuration validation passed.
- Production server image built from Docker Hub base images; direct HTTPS container health probe
  with the mounted private CA passed.
- Electron production package completed with the HTTPS origin embedded. The app resources contained
  `private-ca.pem` and no server certificate or private key.
- The real replacement DMS endpoint exposed only the four mapped product read tools after filtering.
  Its operating-summary E2E completed through one deterministic SQL tool call, evidence validation
  and the grounded answer model.

## Test evidence

- Completion `npm run verify`: check and lint passed; unit tests passed (desktop 504, server 124,
  API 23). Desktop E2E passed 7/8 and stopped the command on one stale calendar text-count assertion.
- The calendar failure snapshot showed one successfully saved event and a closed editor. The
  assertion was corrected from two duplicate text nodes to one exact saved event; its focused E2E
  then passed 1/1.
- The server suite, run separately because the completion command stopped at desktop E2E, passed 8/9.
  Retry ownership, checkpoint restoration and idempotency passed. The former DMS E2E assumed an old
  `askDatabase` endpoint and failed after the correct clarification phase.
- After adapting the generic DMS endpoint, focused server checks passed, focused Agent tests passed,
  and the real DMS E2E passed 1/1. Collection used `query_hotel_operating_data_sql` once (about
  4.35 s), evidence assessment was immediate, and answer generation took about 15.43 s.

## Code-review pass

- Retry review found no active-attempt duplication: employee-scoped request idempotency, execution
  CAS and `retry_of_run_id` lineage preserve the original failed attempt.
- Certificate review tightened intermediate CA constraints and confirmed host/IP SAN validation,
  validity dates and exact configured-origin scoping.
- DMS review found the replacement endpoint was a generic catalog containing write/admin tools.
  The adapter now discards those tools, pins database scope with `AI_DMS_DATABASE_ID`, and retains
  the existing single-statement SELECT/CTE firewall and result compaction.
- Dependency review remains open for a separate upgrade: production `npm audit` reports 16 advisories
  (4 high, 6 moderate, 6 low), and suggested automatic fixes include major or destructive changes.
