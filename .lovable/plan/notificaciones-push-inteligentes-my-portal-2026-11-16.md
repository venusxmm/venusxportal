# Notificaciones push inteligentes — My Portal

## 1. Qué existe hoy
- Campana interna (`notifications-bell`) + RPC `sync_my_portal_notifications`: crea avisos deduplicados de tareas propias publicadas, pero **solo cuando el Portal está abierto**.
- Backend con tareas/ejecuciones, zona Bogotá, Trash, permisos RLS y rutas públicas `/api/public/*`.
- No hay: service worker, suscripciones push, claves VAPID, ajustes de notificaciones en My Portal, ni tarea programada de envío.

## 2. Qué falta para push real
- Service worker propio de mensajes (`public/push-sw.js`), solo para push (no caché offline, no rompe la vista previa).
- Claves VAPID (generadas una vez, guardadas como secreto) y envío Web Push estándar desde el servidor (sin servicio de pago, sin Firebase).
- Tabla de suscripciones por dispositivo, tabla de preferencias y cola de recordatorios.
- Tarea programada cada 5 min que envía lo pendiente.

## 3. Arquitectura mínima
```text
Tarea (deadline) --trigger--> task_reminders (3 filas, send_at)
cron 5 min -> /api/public/jobs/send-reminders
   -> toma recordatorios vencidos, valida tarea viva/no completada/dueña
   -> inserta en campana (misma tabla notifications, dedupe_key)
   -> Web Push a cada suscripción de esa creadora -> SW muestra aviso
   -> clic: abre /portal?task=<id>
```
- `push_subscriptions` (user_id, endpoint único, claves, user_agent, last_ok_at): RLS solo propio; envío con admin solo dentro del job autenticado.
- `notification_preferences` (user_id, enabled, paused_until, quiet_start/quiet_end, default 21:00–08:00 Bogotá).
- `task_reminders` (execution_id, recipient_user_id, n 1–3, send_at, status pending/sent/cancelled, dedupe_key único).
- Suscripciones expiradas (404/410) se eliminan automáticamente.

## 4. Tres recordatorios y reprogramación
- Plazo = desde publicación/asignación hasta deadline (fecha + hora, o fin del día si no tiene hora).
- Puntos 25%, 70% y cerca del final (deadline − min(2 h, 10% del plazo)); si el plazo es < 3 h se envía solo 1; < 24 h máximo 2; separación mínima 1 h (descartar el que choque).
- Si cae en horas de descanso: se mueve al inicio de la ventana permitida anterior (nunca después del deadline); si no cabe, se descarta.
- Función SQL `rebuild_task_reminders(execution_id)` llamada por trigger cuando cambia deadline, dueña, publicación, completado o Trash: cancela pendientes y recalcula. Completada/eliminada/no publicada/sin deadline = sin recordatorios.
- Reasignación: los pendientes de la anterior se cancelan; solo la nueva creadora recibe.
- El job revalida todo justo antes de enviar (doble seguro contra duplicados y tareas eliminadas).
- Textos en español, tono cálido creciente: 1 “✨ Tienes tiempo para …”, 2 “💛 Vas a buen ritmo, recuerda …”, 3 “⏰ ¡Último impulso! … vence hoy a las 5:00 p. m.”.

## 5. Ajustes en My Portal
Nueva sección **Notificaciones** (negro/dorado, español):
- Estado: Activadas / Desactivadas / Bloqueadas por el navegador / No compatible.
- Tarjeta previa con beneficio + botón **Activar notificaciones** (solo entonces se pide el permiso nativo).
- Interruptor activar/desactivar, pausar 1 día / 1 semana, horario de recepción (desde–hasta).
- Si está bloqueado: instrucciones por navegador (candado de la barra → Notificaciones → Permitir). En iPhone: explicar que requiere añadir el Portal a la pantalla de inicio (iOS 16.4+), con un manifiesto mínimo.
- Botón “Enviar notificación de prueba”.

## 6. Costos, dependencias, límites
- Sin costo externo: Web Push nativo (Chrome/Edge/Firefox usan sus servidores gratuitos).
- Dependencia: una librería Web Push compatible con el entorno del servidor (o firma VAPID manual con Web Crypto si la librería no es compatible).
- Límites: iOS solo con app añadida a inicio; el navegador puede retrasar avisos en ahorro de batería; tolerancia ±5 min por el cron; no funciona dentro de la vista previa del editor, solo en la app publicada.

## 7. Pruebas
- Unitarias: cálculo de los 3 horarios (2 h, 1 día, 1 semana, 2 meses, horas de descanso, sin deadline) y recalculo al cambiar deadline/completar/reasignar/eliminar.
- Backend: una creadora no puede leer suscripciones/recordatorios de otra; job rechaza llamadas sin credencial.
- Manual en app publicada: escritorio Chrome con pestaña cerrada, Android Chrome, iPhone instalado; prueba de clic abriendo la tarea; denegar permiso y ver instrucciones.

## Sin cambios
Tasks, Daily Schedule, Board, MCP, Finanzas y permisos existentes; solo se añaden triggers que leen ejecuciones.
