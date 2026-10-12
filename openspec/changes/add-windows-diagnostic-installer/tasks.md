## 1. Diagnostic launcher

- [x] 1.1 Add a focused test for generated script content and missing-installer failure.
- [x] 1.2 Add the reusable Windows diagnostic launcher template.
- [x] 1.3 Implement a generator that writes the versioned launcher beside the unchanged Setup.exe.

## 2. Build integration

- [x] 2.1 Invoke diagnostic packaging after Windows x64 `make` in `desktop-make.mjs`, without affecting other targets.
- [x] 2.2 Include the diagnostic `.cmd` in the GitHub Windows workflow artifact.

## 3. Verification

- [x] 3.1 Run targeted packaging tests and build-script validation using fixture artifacts.
- [x] 3.2 Run the required completion checks, perform separate verification and code-review passes, and record evidence in `verification.md` (with the server check failure and Windows smoke limitation recorded).
- [x] 3.3 Sync the validated release-artifact capability into `openspec/specs/`.
