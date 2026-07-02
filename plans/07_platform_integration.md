# Platform Integration Plan

## 1. Goal

Make the app feel native enough on Linux, Windows, macOS, Android, and iOS while keeping the core vault behavior shared and testable.

## 2. Target Platforms

Support order:

1. Linux desktop for early development.
2. Android for early mobile validation.
3. Windows.
4. macOS.
5. iOS.

This order keeps iteration fast while preserving the final cross-platform goal.

## 3. Local File Storage

Use platform-appropriate app data directories:

- Linux: XDG data directory.
- Windows: AppData.
- macOS: Application Support.
- Android: app-private storage.
- iOS: app container storage.

Users should also be able to open/import/export vault files through a file picker where platform policy allows it.

## 4. Secure Credential Storage

Use platform secure storage for sync provider credentials and optional biometric unlock material:

- Linux: Secret Service/KWallet where available.
- Windows: Credential Manager or DPAPI.
- macOS: Keychain.
- Android: Android Keystore.
- iOS: Keychain.

If secure storage is unavailable, the app must either ask every time or store credentials encrypted with the vault key and show a clear warning.

## 5. Biometric Unlock

Biometric unlock is optional:

- It may unlock a local encrypted unlock token.
- It must not replace the master password as the root of trust.
- User must re-enter master password after app reinstall, vault migration, or biometric reset.
- User can disable biometric unlock.

## 6. App Lifecycle and Locking

The app must lock:

- After idle timeout.
- When entering background, unless a short grace period is enabled.
- On explicit lock.
- After too many failed unlock attempts, with temporary delay.

The UI must hide sensitive fields immediately when locked or backgrounded.

## 7. Clipboard Handling

- Copy secret values through explicit user action.
- Auto-clear clipboard after timeout where platform APIs allow.
- Avoid logging copied values.
- Warn if platform prevents reliable clipboard clearing.

## 8. Packaging

Desktop:

- Linux AppImage or deb/rpm later.
- Windows MSIX or installer later.
- macOS signed app bundle later.

Mobile:

- Android APK/AAB.
- iOS archive/TestFlight.

Packaging hardening is post-MVP after core features stabilize.

## 9. Platform Permissions

Request only necessary permissions:

- Network access for sync.
- File picker/storage access for selected sync folders or imports.
- Biometric permission only when user enables biometric unlock.

## 10. Tests

- Validate app data path per platform.
- Validate lifecycle lock events.
- Validate secure storage read/write/delete per platform.
- Validate clipboard clear where supported.
- Smoke-test vault open/create on each platform.

## 11. Acceptance Criteria

- App stores vaults in the correct local directory by default.
- App locks on lifecycle events.
- Provider credentials are not stored as plaintext app preferences.
- Linux and Android are validated before wider platform rollout.
