## ADDED Requirements

### Requirement: Desktop returns to sign-in when the active staff session is absent

The desktop SHALL leave the authenticated workspace and show its own sign-in page when it confirms that the local RMS session is absent or no longer usable. The desktop MUST NOT treat a temporary network or service failure as confirmation that the session has ended.

#### Scenario: Stored credentials are absent during an authenticated operation
- **WHEN** an authenticated desktop operation finds no stored staff credentials
- **THEN** the desktop shows its sign-in page and stops work tied to the ended session

#### Scenario: Refresh credentials have expired
- **WHEN** the desktop confirms that the stored refresh credential has expired and removes it
- **THEN** the desktop shows its sign-in page and closes the internal RMS page

#### Scenario: RMS confirms that the session has ended
- **WHEN** the identity check confirms that a refreshed session is invalid
- **THEN** the desktop clears local credentials and shows its sign-in page

#### Scenario: Identity check cannot reach RMS
- **WHEN** the identity check fails because of a temporary transport or response failure
- **THEN** the desktop keeps the current sign-in state and credentials
