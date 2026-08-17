# Delta: production phone desktop build

## Requirement: Production build profile selection

The production desktop packaging entry SHALL support an explicit `phone` build profile while
defaulting existing production commands to `staff`. Both profiles SHALL use the same validated
production backend origin, RMS origin, and packaged private CA.

### Scenario: Build a phone production distribution

- **WHEN** an operator invokes the phone production make shortcut
- **THEN** the production input gate runs before Forge
- **AND** Forge builds only the phone authentication variant

### Scenario: Preserve existing production behavior

- **WHEN** an operator invokes an existing production desktop command
- **THEN** the command selects the staff authentication variant

### Scenario: Reject an invalid profile

- **WHEN** the production packaging script receives an unknown or repeated authentication variant
- **THEN** it fails before starting Forge
