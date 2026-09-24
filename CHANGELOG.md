# Changelog

## 1.0.0 — 2026-09-24

First release of `@alindawou/baileys`, forked from [`@itsliaaa/baileys`](https://github.com/itsliaaa/baileys) 0.3.18 (itself based on [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys)).

### Added
- `sock.createForm()`: conversational forms (text, number, phone, email, date, choice, yes/no, location and media fields) with validation, back/cancel/skip keywords, conditional fields, timeout and summary confirmation. Also `sock.isFormReply()`, `sock.cancelForm()` and `sock.getActiveForms()`.
- `liveLocation` message content.
- Regression test suite (`npm test`).

### Fixed
- Default WhatsApp Web version bumped to `2.3000.1043857760`, and `fetchLatestBaileysVersion` now reads the version validated by upstream maintainers (it used to 404).
- Windows browsers advertise `WIN_HYBRID` instead of the rejected `WIN32` sub-platform.
- Message ids no longer contain the `STARFALL` fork signature.
- `getCatalog` / `getCollections` throw a 408 error instead of silently returning an empty catalog when WhatsApp does not answer.
- Profile picture tc token nesting, shared `AsyncLocalStorage` (memory leak) and Android browser support (ported from itsliaaa/baileys).

### Removed
- Payment features that do not work in Africa: payment invite, request payment, invoice and order messages, `review_and_pay` / `payment_info` native flows.
- Hidden newsletter annotation added to every sent image and video.
- Rich response messages (code blocks, tables, links).

### Changed
- Package renamed to `@alindawou/baileys`; default product currency is `XOF`.
