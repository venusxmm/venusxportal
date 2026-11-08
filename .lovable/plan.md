# Grok MCP — finish, verify, publish (4 credits)

## 1. Current state (checked in code)
- `/mcp` endpoint, OAuth metadata route and approval page (`/.lovable/oauth/consent`) exist; plugin wired in `vite.config.ts`; SDK `@lovable.dev/mcp-js` 3.4.
- 8 tools registered in `src/lib/mcp/index.ts` (dashboard, activity, list/get/create/update task, complete/reopen). Sign-in uses the portal login issuer; copied sessions rejected by the SDK client check.
- Unverified: last error fix, typecheck, manifest extraction, approval/cancel, OAuth server activation, token signing type, production endpoint.

## 2. Critical blocker to confirm first (before spending more)
- **Grok's connection method.** xAI's documented remote-MCP support (API "remote MCP tools") passes a fixed `server_url` plus an optional static authorization header; it does not run an interactive sign-in/approval flow. If Grok Bot only accepts a fixed key, the current sign-in approach cannot connect from it. Step 1 checks xAI's current docs; if it is static-key only, I stop and report — no further credits spent on code that cannot connect.

## 3. Files that may change (only if a check fails)
- `src/lib/mcp/tools/*.ts`, `src/lib/mcp/tasks.ts`, `src/lib/mcp/supabase.ts` — error/schema fixes only.
- `src/routes/[.]lovable.oauth.consent.tsx`, `src/routes/auth.tsx` — only if approve/cancel or return-to-approval fails.
- One small test file under `src/lib/mcp/` for permission rules.
- No migrations, no new tools, no UI changes elsewhere.

## 4. Sequence
- **Credit 1 — fix + prove locally:** read build log, fix errors; extract MCP manifest (8 tools, valid schemas); run existing task tests; check Grok's documented auth requirements; confirm OAuth server is active and logins are signed with a verifiable key (rotate signing keys if still symmetric).
- **Credit 2 — security + flow tests:** unauthenticated `/mcp` returns 401 with discovery header; copied session token rejected; approval page Approve/Cancel in browser as Executive; tool calls with a real approved token: Executive create/edit allowed, non-Executive create/edit rejected; complete/reopen changes only the chosen date; no delete/trash tool present.
- **Credit 3 — publish + production check:** publish; probe `https://venusxportal.lovable.app/mcp` and its metadata route; confirm discovery lists 8 tools.
- **Credit 4 — reserve:** fix anything a production check reveals.

## 5. Tests that must pass
- Manifest lists exactly 8 tools.
- No token → rejected; copied login token → rejected.
- Non-Executive cannot create/edit; Executive can.
- Completing date D leaves D+1 Pending; reopening D only reverts D.
- Existing task test suite still green.

## 6. Connection procedure (after publish)
- URL: `https://venusxportal.lovable.app/mcp`
- In Grok: add a remote MCP/connector with that URL, sign in with your portal account, click Approve on "Connect Grok to VenusX Portal".
- The Vercel copy is not covered (still missing backend settings).

## 7. Limits outside this architecture
- If Grok only supports a static key, connecting requires a different auth design (separate approval needed) — not in this budget.
- Token expiry/revocation is handled by the login service; I can test rejection of invalid tokens but not wait for real expiry.
- An end-to-end test from inside Grok can only be done by you after publish.
