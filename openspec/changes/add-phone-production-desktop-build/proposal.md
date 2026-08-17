# Add phone production desktop build

## Why

Production desktop packaging currently hard-codes the `staff` build profile. Operators occasionally
need an otherwise identical production package that uses phone-code login, but the available
`make:desktop:phone` command defaults to local endpoints and is explicitly unsafe as a production
entry.

## What changes

- Let the existing production desktop packaging script select `staff` or `phone` while preserving
  all production endpoint, private-CA, environment-permission, and RMS safety checks.
- Add explicit root npm shortcuts for checking, packaging, and making a phone production desktop.
- Document the supported commands, output location, server prerequisite, and signing limitation.

## Success criteria

- The existing production commands continue to build `staff` by default.
- Phone production shortcuts invoke Forge with the `phone` profile and the same validated production
  inputs as staff builds.
- Invalid or duplicate profile options fail before Forge starts.

## Non-goals

- Changing server deployment or enabling a real SMS provider.
- Signing, notarizing, publishing, or deploying an artifact.
