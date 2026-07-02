# Secure Vault Core Plan

## 1. Goal

Implement the local encrypted vault. The vault must be usable offline, stored locally on every device, and protected by one master password. The core must be designed so synchronization can merge encrypted records safely without exposing plaintext to remote providers.

## 2. Vault File Model

Use SQLite as the local container. Store metadata needed to open and migrate the vault separately from encrypted item payloads.

Minimum tables:

- `vault_meta`: schema version, vault id, created time, crypto parameters, KDF salt.
- `templates`: encrypted template definitions plus searchable non-secret metadata where needed.
- `items`: encrypted item payload, template id, title index fields, timestamps, revision.
- `change_log`: append-only local changes.
- `sync_state`: provider configuration metadata and cursors.
- `conflicts`: user-visible conflict records.

Sensitive fields must be stored encrypted. Non-secret indexes may be stored in normalized form only when required for search and must be documented per field.

## 3. Cryptography

Use:

- Argon2id for deriving a vault key from the master password.
- Per-vault random salt.
- Tunable Argon2 parameters stored in `vault_meta`.
- XChaCha20-Poly1305 for authenticated encryption by default.
- Random nonce per encrypted payload.
- Associated data containing vault id, record id, record type, and schema version.

The app must fail closed if authentication fails during decrypt.

## 4. Key Lifecycle

- Master password enters Rust core only for create/open operations.
- Derived key is held in memory only while vault is unlocked.
- `lock_vault()` clears unlocked session state.
- Flutter must receive no long-lived raw key material.
- Biometric unlock may later protect an encrypted copy of a derived unlock token, but it must not weaken the master-password model.

## 5. Vault States

Rust core exposes explicit states:

- `NoVault`: no vault opened.
- `Locked`: vault path known, key unavailable.
- `Unlocked`: vault opened, key available in memory.
- `Busy`: long operation in progress.
- `Error`: recoverable operation failure.

Operations that require secrets must fail with a typed `VaultLocked` error when locked.

## 6. Migrations

- Every vault has a schema version.
- Migrations must be deterministic and idempotent.
- Migrations must run only after successful unlock.
- Migration failures must leave the previous database usable where possible.
- A backup copy before major migrations should be considered post-MVP.

## 7. Error Handling

Expose typed errors to Flutter:

- `InvalidPassword`
- `VaultLocked`
- `VaultNotFound`
- `CryptoError`
- `CorruptVault`
- `MigrationRequired`
- `MigrationFailed`
- `IoError`
- `DatabaseError`

UI maps these errors to user-friendly messages.

## 8. Tests

- Create/open vault with correct password.
- Reject wrong password.
- Reject tampered encrypted payload.
- Confirm no known secret string appears in the SQLite file.
- Lock prevents secret operations.
- Unlock restores access.
- Migration test from the first schema version to current.

## 9. Acceptance Criteria

- Vault creation produces a valid SQLite database.
- Reopening with correct password decrypts data.
- Reopening with wrong password fails.
- Secret payloads are never stored in plaintext.
- API can report locked/unlocked state.
