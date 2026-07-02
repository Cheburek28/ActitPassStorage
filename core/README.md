# Rust Core

Это production workspace для ядра из `plans/01_stack_and_architecture.md`.

Структура:

```text
core/
  crates/
    vault_core/
    sync_core/
    ffi_api/
```

Проверка после установки Rust:

```bash
cd core
cargo test
```

Целевой crypto/storage слой:

- Argon2id for key derivation.
- XChaCha20-Poly1305 for authenticated encryption.
- SQLite for the local encrypted vault container.

Текущий workspace фиксирует доменные типы, встроенные русские шаблоны и last-write-wins merge API, чтобы Flutter/Rust интеграция имела стабильную точку входа.
