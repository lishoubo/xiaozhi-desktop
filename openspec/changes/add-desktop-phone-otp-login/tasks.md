# Tasks: Desktop phone OTP login API

## 1. Shared contract (TDD)

- [x] 1.1 Add focused router tests for code request acceptance, successful temporary-code login, generic rejection for invalid OTP/unavailable employee, and removal of direct identity lookup; run them and confirm Red.
- [x] 1.2 Add strict phone OTP schemas, the `PhoneOtpGateway` context port, and the two `auth` mutations; make focused API tests Green.
- [x] 1.3 Export the new shared schemas/types required by server implementations without exporting server-specific details.

## 2. Server adapter and injection (TDD)

- [x] 2.1 Add a focused server unit test that documents the temporary gateway's five-minute request lifetime and schema-valid-code acceptance; confirm Red.
- [x] 2.2 Implement the explicitly named temporary gateway and inject it into the SvelteKit tRPC context; make focused server tests Green.
- [x] 2.3 Update the focused tRPC E2E test from public identity lookup to request/login mutations and assert that credentials are absent from the response.

## 3. Verification

- [x] 3.1 Run focused API and server tests plus affected TypeScript/SvelteKit checks during iteration.
- [x] 3.2 Run the completion-scope API/server unit suites and server E2E suite once.
- [x] 3.3 Perform a separate verification pass and record commands/results in `verification.md`.
- [x] 3.4 Perform a separate code-review pass focused on authentication bypass, input disclosure, provider coupling, and contract compatibility.
- [x] 3.5 After verification, merge the delta into `openspec/specs/rms-employee-identity/spec.md` before archiving.
