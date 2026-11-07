# MCP remoto VenusX Portal para Grok Bot

## Resumen
Un único endpoint `/mcp` dentro de esta misma app (TanStack Start en Lovable Cloud), generado por el SDK oficial `@lovable.dev/mcp-js`. Grok se conecta con OAuth: el usuario inicia sesión con su cuenta normal del portal y aprueba el acceso. Cada herramienta actúa como ese usuario, así que RLS y roles actuales deciden qué ve y qué puede cambiar. Sin backend nuevo, sin service-role, sin tablas nuevas.

## Dónde va
- `vite.config.ts`: añadir `mcpPlugin()` (mantiene la config actual, incluida la rama Vercel).
- `src/lib/mcp/index.ts`: `defineMcp` (name `venusxportal`, title `Venusxportal`) con verificación OAuth del emisor del backend.
- `src/lib/mcp/supabase.ts`: cliente por usuario con el token verificado (clave pública + Bearer).
- `src/lib/mcp/tools/*.ts`: una herramienta por archivo.
- Rutas `/mcp` y metadatos OAuth: las genera el plugin (no se escriben a mano).
- `src/routes/[.]lovable.oauth.consent.tsx`: pantalla de aprobación ("Conectar Grok a VenusX Portal").
- `src/routes/auth.tsx`: aceptar `next` validado y volver ahí tras iniciar sesión (único cambio en código existente).

## Reutilización (sin duplicar lógica)
- Dashboard: misma fuente que Overview — `task_agenda(today)` + `executionOverdue` de `src/lib/task-executions.ts`; finanzas vía `transactions` + `summarize` de `src/lib/finance.ts` (RLS ya limita a ejecutivos/finanzas); actividad vía `audit_events` (RLS ya existente).
- Tasks: `task_agenda`, `tasks`/`task_executions` (lectura RLS), `save_task_configuration` (crear/editar, ya ejecutivo-only en BD), `task_execution_action` y `task_future_action` ('complete'/'reopen', ya con chequeos de permiso, papelera y unicidad por fecha).
- Fechas en America/Bogota con los helpers existentes (`agencyDate`).

## Herramientas mínimas (8)
| Herramienta | Tipo | Parámetros |
|---|---|---|
| `get_dashboard_summary` | lectura | `date?` (YYYY-MM-DD) → abiertas, vencidas, críticas, totales financieros si el rol lo permite |
| `list_recent_activity` | lectura | `limit?` (≤50) |
| `list_tasks` | lectura | `date?`, `status?`, `query?` (busca en título), `limit?` |
| `get_task` | lectura | `task_id`, `date?` → configuración + ejecución de esa fecha + comentarios |
| `create_task` | escritura | `title`, `description?`, `priority?`, `due_date?`, `due_time?`, `owner_id?`, `creator_id?`, `recurrence?` (none/daily/weekdays), `weekdays?`, `visible_to_creator?` |
| `update_task` | escritura | `task_id` + mismos campos opcionales |
| `complete_task` | escritura | `task_id`, `date` (ejecución concreta) |
| `reopen_task` | escritura | `task_id`, `date` |

Sin borrar/papelera/mover por ahora. Arquitectura ampliable: Creators, Finance, Team, Audit, Settings se añaden luego como archivos de lectura en `tools/` y se registran en `index.ts`.

## Autenticación segura
- Activar el servidor OAuth del backend (`configure_oauth_server`, sin parámetros) con registro dinámico de clientes.
- Emisor directo del backend (no el proxy) y `requireOAuthClientClaim: true`: se rechazan tokens de sesión copiados.
- Identidad siempre del token, nunca de un parámetro. Sin service-role, sin ampliar políticas anónimas, sin tokens en logs.
- Verificar que el backend firma con claves asimétricas; si firma HS256, rotar con `migrate_signing_keys` (necesario para validar tokens externos).

## Limitaciones a comprobar (no asumidas)
1. Grok: debe soportar MCP remoto con OAuth 2.1 + registro dinámico. Si solo acepta token fijo/API key, este plan no basta y habría que decidir otra opción (no se implementará un atajo inseguro).
2. Publicación: `/mcp` solo existe en la URL publicada (venusxportal.lovable.app) tras publicar. El despliegue en Vercel no está incluido (le faltan variables del backend); requiere tu autorización para publicar en Lovable.
3. Tiempo de respuesta: solo consultas cortas; nada largo.
4. Paquete reciente: si el instalador bloquea `@lovable.dev/mcp-js` por antigüedad, añadir excepción en `bunfig.toml`.

## Pasos (mínimos)
1. Backend: activar OAuth + comprobar/rotar firma.
2. Código: instalar SDK, plugin, `index.ts`, cliente, 8 herramientas, consentimiento, `next` en inicio de sesión; extraer manifiesto.
3. Prueba enfocada: manifiesto válido, `/mcp` sin token → 401, consentimiento aprobar/denegar, y (tras publicar) conexión real desde Grok con lectura de dashboard y completar una tarea propia.

## Resultado al terminar
Tú publicas; en Grok añades `https://venusxportal.lovable.app/mcp`, inicias sesión y apruebas.
