# Testing and Release Plan

## 1. Goal

Build confidence in security, data integrity, synchronization, and cross-platform behavior before shipping. Testing should focus first on Rust core correctness, then integration through Flutter UI.

## 2. Rust Unit Tests

Cover:

- Vault creation and opening.
- Wrong password rejection.
- Encryption authentication failure on tampered data.
- CRUD for templates and items.
- Template migration behavior.
- Change log generation.
- Merge policy.
- Conflict record creation.
- Tombstone handling.

These tests should run without network and without platform UI.

## 3. Rust Integration Tests

Cover:

- Two vault copies syncing through mounted-folder test provider.
- Interrupted sync resume.
- Duplicate package processing.
- Last-write-wins conflict.
- Equal timestamp tie-breaker.
- Delete/update conflict.
- Migration from previous schema fixtures.

Use temporary directories and deterministic clocks where possible.

## 4. Flutter Tests

Cover:

- Unlock/create vault screen.
- Main card list.
- Card detail with hidden secrets.
- Card editor validation.
- Template editor.
- Sync settings.
- Conflict log.

Widget tests can use a mocked Rust API until the FFI layer is stable.

## 5. Security Checks

Minimum security validation:

- Search the vault file bytes for known secret strings after saving.
- Verify logs do not contain secret values.
- Verify wrong password and tamper failures are indistinguishable enough for UX and do not leak internals.
- Verify sync packages do not contain plaintext card values.
- Review dependency advisories before release.

## 6. Manual Acceptance Scenarios

Run before MVP release:

1. Create vault.
2. Add password card.
3. Add custom template.
4. Add card from custom template.
5. Lock and unlock.
6. Configure mounted-folder sync.
7. Sync to second local vault copy.
8. Create offline conflict.
9. Sync and confirm last-write-wins plus conflict log.
10. Delete card and sync tombstone.

## 7. Release Milestones

### Milestone 1: Planning Complete

- All `plans/` documents exist.
- MVP and post-MVP are explicit.

### Milestone 2: Scaffold Complete

- Flutter app builds.
- Rust workspace builds.
- Flutter calls one Rust function.
- CI runs basic checks.

### Milestone 3: Local Vault Alpha

- Create/open/lock vault.
- Store encrypted templates and cards.
- Basic Flutter UI for local CRUD.

### Milestone 4: Sync Alpha

- Mounted-folder sync works.
- Change log and conflict log work.
- Conflict UI displays records.

### Milestone 5: Provider Beta

- Email, WebDAV, SFTP, and FTP/FTPS providers implemented.
- Provider setup UI exists.
- Error handling and retry behavior are usable.

### Milestone 6: Cross-platform Beta

- Linux, Android, Windows, macOS, and iOS smoke-tested.
- Secure storage integrated.
- Lifecycle lock integrated.

### Milestone 7: MVP Release

- Security review completed.
- Main acceptance scenarios pass.
- Release packages documented.

## 8. CI Requirements

Start with:

- `cargo fmt --check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test`
- `flutter analyze`
- `flutter test`

Add platform-specific build jobs as platforms become active.

## 9. Acceptance Criteria

- Core security and sync tests are automated.
- Manual MVP scenario is documented and repeatable.
- Release milestones clearly show what is ready and what remains.
