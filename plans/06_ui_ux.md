# UI and UX Plan

## 1. Goal

Build a calm, modern, efficient interface for daily password and secret management. The app should feel secure and practical rather than decorative.

## 2. Visual Direction

- Neutral base colors.
- Muted accent palette.
- No flashy gradients or oversized marketing-style hero layouts.
- Dense but readable lists on desktop.
- Touch-friendly spacing on mobile.
- Card colors are moderated and accessible.
- Dark and light themes from the start if practical.

## 3. Navigation

Primary areas:

- Vault unlock/create screen.
- Card list.
- Card detail.
- Card editor.
- Template manager.
- Template editor.
- Sync settings.
- Conflict log.
- App settings.

Desktop layout should use a sidebar plus detail pane where width allows. Mobile layout should use stacked navigation.

## 4. Main Card List

Features:

- Search input.
- Filter by category, tag, template, and favorites if favorites are added.
- Sort by title, modified time, created time, and template.
- Compact sync status.
- Add-card action.
- Lock action.

Cards display:

- Title.
- Template/icon.
- Non-secret subtitle.
- Tags/category if space allows.
- Modified time.
- Moderated color accent.

## 5. Card Detail

Features:

- Secret fields hidden by default.
- Reveal/copy buttons per secret field.
- Edit action.
- Delete action with confirmation.
- Last modified metadata.
- Template information.

Password fields should support:

- Reveal temporarily.
- Copy without reveal.
- Generate new password in editor after password generator is added.

## 6. Card Editor

Features:

- Dynamic form based on template fields.
- Required field validation.
- Color selector from moderated palette.
- Tags/category input.
- Save/cancel.
- Dirty-state confirmation on leaving.

## 7. Template Manager

Features:

- List built-in and custom templates.
- Duplicate built-in template.
- Create custom template.
- Edit custom template.
- Reorder fields.
- Add/remove fields.
- Validate field ids and types.

## 8. Sync Settings

Features:

- Enable/disable sync.
- Provider selection.
- Provider-specific configuration.
- Test connection.
- Manual sync now.
- Last sync time.
- Last sync result.
- Pending changes count.

Warnings:

- Plain FTP security warning.
- Lost master password cannot be recovered.
- Remote provider stores encrypted data only.

## 9. Conflict Log

Features:

- List conflicts by time.
- Show object name, provider, devices, and winner.
- Detail screen with field-level differences where safe.
- Secret values remain hidden until explicit reveal.
- Dismiss conflict record without deleting audit history in MVP, or mark as reviewed.

## 10. Accessibility

- Keyboard navigation on desktop.
- Screen-reader labels for secret reveal/copy buttons.
- Sufficient color contrast.
- Text should not rely only on color.
- Touch targets must be large enough on mobile.

## 11. Tests

- Widget tests for unlock screen, card list, card detail, card editor, sync settings, and conflict log.
- Golden tests for light/dark themes after visual system stabilizes.
- Manual responsive checks on mobile and desktop widths.

## 12. Acceptance Criteria

- User can complete create vault -> create card -> lock -> unlock -> edit card through UI.
- Secret display behavior is clear and controlled.
- Sync status and conflicts are visible without overwhelming the user.
