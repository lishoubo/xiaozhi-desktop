# Tasks

## 1. Production certificate material

- [x] 1.1 Add a guarded OpenSSL generator for a private CA and IP-SAN leaf certificate.
- [x] 1.2 Ignore generated production TLS material and generate the certificate set locally.

## 2. Desktop production package

- [x] 2.1 Add a fail-closed certificate validator and production packaging wrapper.
- [x] 2.2 Add root commands that generate TLS material and package the production staff desktop.

## 3. Production ports and database credentials

- [x] 3.1 Publish API HTTPS on TCP 35443 and PostgreSQL on host TCP 35432.
- [x] 3.2 Generate an ignored mode-0600 production environment with a random database password.

## 4. Verification and specification convergence

- [x] 4.1 Verify SAN, chain, dates, key pairing, packaged resources and embedded server origin.
- [x] 4.2 Run the affected checks/tests and record exact evidence.
- [x] 4.3 Synchronize the stable server-container deployment specification.

## 5. Production source distribution

- [x] 5.1 Add a clean-revision, allowlisted source archive with secret/artifact guards and checksum.
- [x] 5.2 Add an idempotent new-host directory preparation script with validated paths and ownership.
- [x] 5.3 Audit development and production environment key usage and remove confirmed redundancy.
- [x] 5.4 Add focused tests and synchronize deployment verification/specification.

## 6. Production observability

- [x] 6.1 Add correlation-aware structured logs to the outbound RMS identity request boundary.
- [x] 6.2 Persist server JSON logs through a production host bind mount and prepare its directory.
- [x] 6.3 Verify redaction, RMS outcomes, Compose wiring and host preparation behavior.

## 7. Desktop production diagnostics

- [x] 7.1 Resolve desktop file logs through Electron's OS-native logs path and isolate auth profiles.
- [x] 7.2 Document production server/desktop directories, key files and diagnostic commands.
- [x] 7.3 Verify desktop path selection, file rotation configuration and documentation.

## 8. Single-upload deployment bundle

- [x] 8.1 Add an explicitly sensitive deployment bundle containing source, `.env.production` and server TLS.
- [x] 8.2 Fail closed on placeholders, unsafe permissions, invalid certificates or unexpected private keys.
- [x] 8.3 Document secure transfer, extraction, host preparation and Compose startup.

## 9. Production bundle upload

- [x] 9.1 Add a guarded SSH/SCP uploader fixed to `121.199.29.74` and the local RMS agent key.
- [x] 9.2 Verify the local and remote checksum without extracting or starting production services.
- [x] 9.3 Document SSH user input, host fingerprint verification and the remote staging directory.

## 10. Root-operated host bootstrap

- [x] 10.1 Make host preparation idempotently create a dedicated non-login deployment owner when root has no non-root deploy identity.
- [x] 10.2 Document the root deployment path and verify account provisioning, directory ownership and shell syntax.
