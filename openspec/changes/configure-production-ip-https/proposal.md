# Proposal: Configure production IP HTTPS

## Why

The production server address is now fixed at `121.199.29.74`, but the repository does not yet
provide a repeatable way to issue an IP-SAN certificate for that address or package the matching
public CA into a production desktop build. Operators otherwise risk using a hostname-mismatched
certificate, shipping a private key, or building a desktop client that still targets localhost.

## What Changes

- Add a guarded production TLS generation command for `121.199.29.74` that creates a private CA and
  an IP-SAN server leaf certificate outside version control.
- Add a production desktop packaging command that embeds `https://121.199.29.74:35443` and packages
  only the matching public CA certificate.
- Validate certificate purpose, address, chain, validity and private-file permissions before a
  production package is built.
- Fix the public API port at 35443, publish PostgreSQL on host port 35432 for operator GUI access,
  and generate an ignored production environment file with a high-entropy database password.
- Add a clean-revision server source archive command and a new-host directory preparation command
  that provisions a dedicated non-login deployment owner when a root operator has not prepared one.
- Add structured logging around every outbound RMS HTTP call and persist production server logs in
  a host-mounted directory for incident diagnosis.
- Make desktop production logs use Electron's OS-native logs directory with an auth-profile-specific
  subdirectory and document operational paths and critical files in the repository README.
- Document the exact server certificate directory and desktop packaging handoff.

## Success Criteria

- The generated leaf certificate is valid for IP address `121.199.29.74` and verifies against the
  generated private CA.
- The production desktop package targets `https://121.199.29.74:35443` and contains
  `private-ca.pem`.
- Neither the CA private key nor the server private key is copied into the desktop package or
  tracked by Git.
- PostgreSQL is published on the host for restricted operator access, and generated database
  credentials are stored only in the ignored production environment file.
- A commit-addressed source archive and checksum can be generated without desktop sources, runtime
  environments, TLS files, private keys or generated artifacts.
- RMS calls can be correlated to the incoming request without logging credentials, response bodies
  or returned staff identity, and production JSON logs remain available on the host.
- Packaged desktop logs have documented macOS, Windows and Linux locations, bounded rotation and
  separate staff/phone directories.
- Existing development HTTPS and generic desktop packaging commands retain their behavior.

## Non-goals

- Installing the certificate or starting services on the remote host.
- Publishing or remotely deploying a desktop installer.
- Obtaining a publicly trusted IP-address certificate from a commercial CA.
