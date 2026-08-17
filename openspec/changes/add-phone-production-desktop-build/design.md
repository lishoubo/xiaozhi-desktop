# Design

Extend `apps/desktop/scripts/package-production.ts` instead of creating a second packaging
implementation. The command parser accepts one optional `--auth-variant=staff|phone` flag, removes it
from Forge arguments, defaults to `staff`, and rejects invalid or repeated flags. After the existing
production input validation, the runner dispatches to `package:desktop:<variant>` or
`make:desktop:<variant>`.

Root npm scripts expose `check:desktop:production:phone`, `package:desktop:production:phone`, and
`make:desktop:production:phone`. Existing command names remain unchanged and therefore preserve staff
behavior. Both variants embed the same production backend origin, RMS origin, and private CA.

No packaging command is executed as part of this change: creating distribution artifacts is kept as
an operator action, and publishing remains outside the script.
