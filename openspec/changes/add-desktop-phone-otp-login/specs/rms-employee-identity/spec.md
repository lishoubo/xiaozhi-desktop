# rms-employee-identity Specification Delta

## MODIFIED Requirements

### Requirement: RMS employee is the desktop identity source

The system SHALL resolve desktop user identity from the RMS `employee` table after the phone OTP gateway accepts the login and SHALL NOT maintain a PostgreSQL desktop-user copy.

#### Scenario: Resolve an active employee after OTP

- **WHEN** the OTP gateway accepts a phone and six-digit code belonging to an active RMS employee
- **THEN** the phone-code login mutation returns that employee's safe identity fields

#### Scenario: OTP or employee is unavailable

- **WHEN** the OTP gateway rejects the code, or the phone does not belong to an active RMS employee
- **THEN** the phone-code login mutation fails with the same unauthenticated response

## ADDED Requirements

### Requirement: Phone OTP uses a replaceable gateway

The shared API SHALL expose provider-neutral phone-code request and login mutations, and the server SHALL inject SMS delivery and verification through a gateway that does not expose provider SDK types in the shared contract.

#### Scenario: Request a phone code

- **WHEN** a caller requests a code for a schema-valid phone
- **THEN** the API returns the same accepted response regardless of employee existence
- **AND** it does not return the verification code

#### Scenario: Use the temporary gateway before provider selection

- **WHEN** no SMS provider has been selected
- **THEN** the server's explicitly temporary gateway accepts every schema-valid six-digit code
- **AND** replacing that gateway does not require changing the shared tRPC procedures

### Requirement: Employee lookup cannot bypass OTP

The public tRPC router SHALL NOT expose a direct employee-by-phone lookup.

#### Scenario: Resolve desktop identity

- **WHEN** a desktop caller needs an employee identity
- **THEN** it uses the phone-code login mutation
- **AND** identity lookup occurs only after the OTP gateway accepts the input

