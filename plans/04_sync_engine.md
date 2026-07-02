# Sync Engine Plan

## 1. Goal

Implement local-first synchronization across multiple devices. Every device keeps a complete encrypted local database. Synchronization exchanges encrypted changes through providers and merges them into the local vault.

## 2. Core Principles

- Local writes never require network access.
- Every write operation appends a change record.
- Sync transport never receives plaintext secrets.
- Merge is deterministic.
- Conflicts are logged for the user.
- Final value uses last-write-wins.

## 3. Device Identity

Each vault installation has:

- `vault_id`: shared by all copies of the same vault.
- `device_id`: unique per device.
- `device_name`: user-visible label.
- `sync_generation`: optional counter for future reset workflows.

`device_id` must be generated locally and never reused after reinstall unless restored from an encrypted backup.

## 4. Change Records

Each change contains:

- `change_id`
- `vault_id`
- `device_id`
- `item_id` or `template_id`
- Change type: create, update, delete, template_create, template_update, template_delete
- `base_revision`
- `new_revision`
- `modified_at`
- Encrypted patch or encrypted full snapshot
- Hash of canonical encrypted payload

Use append-only storage locally. Compaction can be added after MVP.

## 5. Merge Policy

For each incoming change:

- Ignore if `change_id` already applied.
- Validate vault id and crypto envelope.
- Decrypt after local vault is unlocked.
- If change applies cleanly to the current base revision, apply it.
- If current revision differs from `base_revision`, detect conflict.
- Resolve conflict by comparing `modified_at`; latest wins.
- If timestamps are equal, break ties by lexicographic `device_id` and then `change_id`.
- Write a conflict record whenever a conflict is detected, even when the remote change loses.

## 6. Conflict Records

Conflict log contains:

- `conflict_id`
- Object type and object id.
- Field-level summary where possible.
- Winning change id.
- Losing change id.
- Winning device and timestamp.
- Losing device and timestamp.
- Provider used during sync.
- Created timestamp.
- User dismissed flag.

Conflict records must not expose secret plaintext unless the vault is unlocked and the user explicitly opens the conflict details.

## 7. Deletions

Deletes use tombstones:

- Deleted records remain as tombstones for sync.
- Tombstones have `deleted_at`, `deleted_by_device_id`, and revision.
- Tombstone cleanup is post-MVP and requires safe retention windows.

## 8. Sync State Machine

States:

- `Idle`
- `PendingLocalChanges`
- `Connecting`
- `Uploading`
- `Downloading`
- `Merging`
- `Completed`
- `Failed`
- `AuthRequired`

Flutter should display compact status and last sync time.

## 9. Tests

- Apply same change once even if received multiple times.
- Sync two devices with non-overlapping changes.
- Sync two devices editing the same card offline.
- Last-write-wins chooses later timestamp.
- Equal timestamp tie-breaker is deterministic.
- Conflict record is written.
- Delete wins or loses according to the same revision/timestamp policy.
- Interrupted sync can resume without duplication.

## 10. Acceptance Criteria

- Two local vault copies can exchange changes through a file-based test provider.
- Concurrent edits produce one final value and one conflict record.
- Remote provider never sees plaintext payloads.
