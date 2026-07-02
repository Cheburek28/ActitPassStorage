# Cards, Templates, and Fields Plan

## 1. Goal

Implement configurable cards where each card is based on a template. Templates define field structure, display behavior, validation, and which values are secret.

## 2. Built-in Templates

Create built-in templates during vault initialization:

- Password
- Secure note
- Payment card
- Identity document
- Bank account
- Software license
- Server credential
- Wi-Fi credential

Built-in templates must be editable only where safe. Users may duplicate them to customize freely.

## 3. Template Model

A template contains:

- Stable `template_id`.
- Name.
- Optional icon id.
- Default card color.
- Ordered field definitions.
- Created/modified timestamps.
- Built-in/custom flag.

Each field definition contains:

- Stable `field_id`.
- Label.
- Field type.
- Required flag.
- Secret flag.
- Multiline flag where applicable.
- Searchable flag for non-secret fields.
- Copyable flag.
- Display priority.
- Validation rules.

## 4. Field Types

Supported MVP field types:

- `text`
- `password`
- `multiline_note`
- `url`
- `email`
- `phone`
- `username`
- `number`
- `date`
- `totp`
- `custom_secret`

`password`, `totp`, and `custom_secret` are secret by default. The UI can allow secret mode on other text-like fields.

## 5. Card Model

A card contains:

- Stable `item_id`.
- `template_id`.
- Title.
- Optional subtitle.
- Category.
- Tags.
- Moderated color id.
- Field values keyed by `field_id`.
- Created/modified timestamps.
- Revision.
- Deleted/tombstone state for sync.

Field values should preserve unknown fields when a template changes, so older cards do not lose data.

## 6. Template Changes

Rules:

- Renaming a field changes only the label, not `field_id`.
- Deleting a field should hide it from normal editing but keep historical values until user chooses cleanup.
- Reordering fields must not affect stored values.
- Changing field type requires validation and may be blocked if existing values cannot migrate safely.

## 7. Secret Display Behavior

- Secret fields are hidden by default.
- Reveal is explicit per field or per card.
- Revealed fields auto-hide after timeout or when leaving the screen.
- Copy action should be available for secret fields without forcing reveal.
- Clipboard should be cleared after timeout where supported.

## 8. Card Colors

Use a moderated palette:

- Neutral gray
- Deep blue
- Forest green
- Slate teal
- Muted violet
- Warm red
- Amber

Each palette entry must define light and dark mode foreground/background pairs with accessible contrast.

## 9. Tests

- Create card from built-in template.
- Create custom template and card from it.
- Edit template label without losing values.
- Delete field from template without deleting stored value.
- Secret fields hide by default.
- Secret values can be copied.
- Card color id is validated against palette.

## 10. Acceptance Criteria

- Users can create and edit cards from built-in and custom templates.
- Template edits preserve existing card data.
- Secret values are protected in UI and storage.
- Cards remain searchable through allowed metadata.
