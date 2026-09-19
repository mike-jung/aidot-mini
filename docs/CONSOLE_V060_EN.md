# Console 0.6.0

New installations default to English. The header and favicon use the same
font-independent m. SVG. The requested English welcome line is preserved verbatim:
“Sprint Boot style javascript web server for mobile devices, robots and drones”.
Saved preferences and environment overrides remain effective.

Workspace files: choose a Controller, Service or SQL file, edit, then Validate
and save. The syntax checker reuses the installed annotation compiler. Named SQL
validation checks names and non-empty statements, not database execution.
Restart a normal server to apply changes; npm run dev restarts automatically.
Metadata and migrations are read-only. Files are UTF-8, at most 64 KiB. Conflicting
saves return 409 and preserve the editor buffer. Source access is administrative.

Log files: choose server.log or a rotated file, a level and a literal search.
Only the last 128 KiB are read; at most 300 matching lines are displayed. Optional
five-second refresh runs while the log tab is visible. Logs are rendered as text.

Public includes the usable single-device runtime, console, TLS/authentication,
AI examples, optional communication adapters and basic Linux/Android/ROS tooling.
Enterprise reserves organizational and fleet operations as separate future modules.
See COPYRIGHT.md and LICENSING.md; no production Enterprise feature is claimed.
