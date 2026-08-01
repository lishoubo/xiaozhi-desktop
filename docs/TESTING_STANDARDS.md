# Testing Standards

## Mandatory TDD Workflow

All observable behavior changes follow Red → Green → Refactor.

### Red

- Write or update a test that precisely describes the required behavior before changing production code.
- Run the smallest relevant test and confirm it fails for the expected behavioral reason.
- For a bug fix, first add a regression test that reliably reproduces the defect.
- A failure caused by syntax, setup, or an incorrect assertion does not satisfy Red.

### Green

- Implement only the minimum production change needed to pass the failing test.
- Do not add speculative extension points, unrelated cleanup, or unrequested behavior.
- Run the focused test again and confirm it passes.

### Refactor

- Improve names, structure, duplication, and boundaries while keeping tests green.
- Refactoring must not silently change behavior. Return to Red before any further behavior change.

When test-first development is objectively impractical, such as a purely visual adjustment or certain operating-system integrations:

- state why an automated test cannot reasonably lead the change;
- extract and test all separable logic;
- provide deterministic manual verification steps;
- do not use the small size of a change as a reason to skip validation.

## Test Design

- Prefer the testing pyramid: many unit tests, focused integration/component tests, and a small number of critical end-to-end tests.
- Test behavior and public contracts rather than private implementation details.
- Cover success paths, boundaries, invalid input, failures, and security-sensitive cases.
- Keep tests independent, deterministic, and fast.
- Do not depend on test order, real network services, wall-clock timing, random data, developer-machine state, or data left by another test.
- Mock time, randomness, filesystem access, network access, and Electron APIs only at clear boundaries. Restore mocks, timers, and global state after each test.
- Avoid excessive mocking and snapshots that reviewers cannot meaningfully inspect.
- Never weaken assertions, skip tests, or hide errors merely to obtain a passing suite.
- Apply the same type-safety and readability standards to test code as production code.
- Logging tests must assert useful event names and safe metadata, and must verify that sensitive values are absent when applicable.
