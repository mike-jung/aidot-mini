# aidot-mini development

Read `docs/AI_API_RULES.md` for the existing Note/runtime contracts. For Product work also read `docs/AI_API_RULES_PRODUCT.md`, `docs/AI_FRONTEND_RULES.md` and `docs/TUTORIAL_PRODUCT_KO.md`.

- Keep general mini defaults (`workspace`, `data`) and existing Note APIs. Product is an explicit example (`npm run start:product`), not a replacement for all applications.
- Keep portable Product business code in controller/service/sql. Use the common `@aidot/core/...`, `@aidot/database/...` host imports; do not introduce a Product-specific workspace helper or a second pagination engine.
- Common upload behavior belongs in `src/core`; both hosts must agree on the image upload and validation contract.
- Preserve public API contracts, method-level authentication and input validation. Note and Product have different missing-record policies.
- Let the loader generate metadata. Preserve all applied migration bytes and existing user data; add migrations for schema changes.
- Keep Vue api/stores/views/components/router/assets responsibilities.
- Run `npm run verify` (original regressions plus Product HTTP) and client `format:check`/`build`. For cross-host changes run `EXPRESS_PROJECT_ROOT=<patched server> node scripts/verify-product.mjs` and the contract verifier.
- Report actual host, OS, Node and database tested. Keep credentials, local .env, databases, uploads, node_modules and runtime caches out of source archives.
