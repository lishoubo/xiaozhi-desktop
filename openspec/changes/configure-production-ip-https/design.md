# Design: Production IP HTTPS

## Certificate model

The deployment continues to use the existing private-CA trust boundary. A repository script invokes
OpenSSL to generate a dedicated CA and a server leaf certificate whose SAN contains only
`IP:121.199.29.74`. The leaf is constrained to server authentication and is signed with SHA-256.
Generated material is written under ignored `output/production-tls/121.199.29.74/` with restrictive
directory and private-key permissions. Generation refuses to overwrite existing material unless the
operator first moves or removes it deliberately.

The server consumes `server/cert.pem`, `server/key.pem` and `server/ca.pem` through the existing
read-only production Compose mount. The CA signing key remains in the output root for controlled
renewal and must be stored as a production secret.

## Desktop packaging

A production packaging wrapper validates the complete certificate set before invoking the existing
auth-profile packaging path. It checks the leaf SAN, chain, current validity, key pairing, CA basic
constraint and absence of private keys from the desktop resource directory. It then sets:

- `HOTEL_BUTLER_SERVER_URL=https://121.199.29.74:35443`
- `HOTEL_BUTLER_PRIVATE_CA_PATH=<generated desktop/private-ca.pem>`

Electron Forge copies that single public CA file into resources. The existing scoped verification
hook applies private-CA trust only when Chromium reports an unknown authority for the configured
backend hostname; normal public trust and unrelated hosts are unchanged.

## Operations and failure handling

The generation and packaging wrappers fail closed on missing OpenSSL, incomplete certificate
material, mismatched keys, wrong SAN, expired/not-yet-valid certificates or an unexpected CA. The
scripts never print private-key contents. Remote installation, Compose startup and release remain
explicit operator actions outside this change.

The production network boundary publishes the server HTTPS endpoint at host port 35443. The Node
process remains on container port 3443. PostgreSQL listens on port 35432 and maps the same host port
for operator GUI access; cloud and host firewalls must restrict its source addresses. A guarded
environment generator copies the checked-in template, fills the fixed origin/ports, and creates a
256-bit random hexadecimal PostgreSQL password in the ignored `.env.production` with mode `0600`;
it refuses to overwrite an existing operator file.

## Server source archive and host layout

The deployment archive is generated from `HEAD`, not arbitrary workspace files. The command requires
a clean worktree and archives an explicit allowlist: root npm manifests and lockfile,
`.dockerignore`, `apps/server/` and `packages/api/`. Git export attributes exclude the tracked local
development `.env`; ignored production configuration and TLS material are never archive candidates.
Before publication under ignored `output/deploy/`, the command rejects environment files other than
the placeholder production example, key/certificate files, generated paths and embedded PEM private
keys. It verifies required Docker inputs and emits a SHA-256 sidecar.

The new-host preparation command creates `/opt/hotel-butler/app`,
`/opt/hotel-butler/tls/server` and `/var/lib/hotel-butler/postgresql` with explicit deploy, server and
database ownership. It must run as root because these paths cross system-owned filesystem trees. If
the invoking identity resolves to root or no deploy owner is supplied, the command idempotently
creates a dedicated `hotelbutler` local account with a non-login shell and uses it as the
application/TLS owner. Its default UID is 2000 and must remain distinct from the PostgreSQL and
server container UIDs; an operator can override it when the host already uses that UID. A valid
existing non-root account can still be selected explicitly. An automatically selected existing
`hotelbutler` account is reused only when its UID and non-login shell match the managed account;
the script fails before changing ownership when the name belongs to an incompatible account. Paths,
account names and numeric container IDs are validated before mutation and are never inferred from
environment-file contents. The command does not upload secrets, modify firewall rules, start
Compose or deploy remotely. Runtime `.env.production` and server TLS files remain separate,
permission-restricted transfers. The dedicated owner is not granted Docker access and is not an
interactive deployment identity; the authorized root operator remains responsible for subsequent
Compose commands.

The safe source archive remains credential-free. A separate, explicitly named production deployment
command creates one sensitive bundle containing the clean committed source, the ignored
`.env.production`, and only the three server runtime TLS files (`ca.pem`, `cert.pem`, `key.pem`). It
rejects placeholders, missing required values, permissive private-file modes, invalid IP certificate
chains and any unexpected runtime key. The bundle itself is mode `0600`; it never contains the CA
signing key or desktop sources. This distinction prevents a normal source artifact from silently
becoming a secret-bearing file while still allowing a single production upload.

## Production observability

The RMS staff identity lookup is an outbound service boundary. Each attempted `/api/v1/me` call
records structured start and completion events with the incoming request ID, operation name, safe
endpoint origin/path, HTTP status, outcome and elapsed time. Transport and contract failures record
an error event with a redacted error description before preserving the existing failure behavior.
Authorization values, request/response bodies and returned identity fields are never logged.

Pino continues writing JSON to stdout for `docker compose logs` and additionally writes the same
records to `/var/log/hotel-butler/server/server.jsonl` inside the container. Production Compose bind
mounts that path from the configurable host directory `SERVER_LOG_DIR`, whose template default is
`/var/log/hotel-butler/server`. The host preparation script creates it for container user/group
`1000:1000`. Docker's stdout logging is size-limited and rotated separately so it remains a safe
operational fallback; host file rotation remains an operator responsibility.

## Desktop log storage

The desktop main process explicitly initializes Electron's platform-native application log path,
then appends the compile-time authentication profile (`staff` or `phone`) so co-installed packages
do not share a file. `electron-log` resolves its file transport to `<logs>/<profile>/main.log`.
Packaged builds retain `info` and above, redact sensitive data before transport, and rotate the
current file at 10 MiB using the library's `main.old.log` archive. Development keeps `debug` output.

The root README is the operator-facing map for production paths. It documents the server source,
private environment, TLS, PostgreSQL and log paths; the desktop logs and user-data roots on macOS,
Windows and Linux; and identifies which files contain credentials or user data and therefore must
not be attached to tickets without review.
