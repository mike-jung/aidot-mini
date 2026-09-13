# aidot-mini API work

Read `docs/AI_API_RULES.md` first. It is self-contained and includes complete
Controller, Service, SQL, migration and executable HTTP verification examples.
No prior conversation or knowledge of another framework is required.

- Use the selected `APP_WORKSPACE`. Keep business code in controller, service
  and sql folders. Add new migrations for schema changes; preserve existing data
  and applied migration checksums.
- Keep default class exports and the annotation syntax shown in the guide:
  `@Controller`, `@Service`, `@Autowired`, `@Sql`, `@Log`, and method-level `@Auth()`.
  Preserve the standard `../../src/...` imports and named SQL with bound values.
- Write business source and migrations. Do not hand-author sidecar metadata.
  Startup generates missing meta files, loads existing files, and synchronizes
  declarations while retaining descriptions and extension information.
- Runtime code defines routes and authentication. Editing meta does not grant
  access. Inspect generated records at the authenticated `/admin/metadata` API.
- Preserve the documented response contract: create returns insertId and
  rowsAffected; update/delete return rowsAffected; a missing GET returns 404.
  `fillPlaceholders` binds missing fields as null; it does not validate input.
- Choose authentication and input/error policies from actual user requirements.
  Console ID/password login is separate from a public business API.
- Run `npm run check` and `npm run contract:check`. Write and run HTTP tests for
  the new API, including persistence and authentication as applicable. Bundled
  Note checks do not verify a different API's fields or business requirements.
- Prepare metadata and compiler cache with `npm run workspace:compile` before
  installing source as read-only. Do not rewrite user business files at startup.
- Report actual runtime, OS, database, checks and untested targets. Never claim
  target compatibility based solely on a syntax check or HTTP status 200.
