# Plan: evitar que autocompact corte continuaciones post-turn

## Context

El fallo observado parece ocurrir cuando un agente termina un subtrabajo dentro de un goal largo (por ejemplo, termina `#330`), responde estado y luego no continúa con el siguiente item. La hipótesis más probable es una carrera entre:

- `pi-thread-goal`, que usa `agent_end` para evaluar el goal y encolar el siguiente turno.
- `pi-compaction-improvement`, que también usa `agent_end` y llama inmediatamente a `ctx.compact(...)` cuando decide compactar.

Si la compactación se dispara dentro del mismo ciclo `agent_end`, puede ocurrir antes de que otros handlers hayan terminado de encolar follow-ups, o puede interactuar con la cola/estado de retry de Pi de forma que la continuación quede pendiente pero no arranque.

## Approach

Cambiar `pi-compaction-improvement` para que una decisión de autocompact tomada en `agent_end` no invoque `ctx.compact(...)` inmediatamente en el mismo handler. En su lugar, diferir la compactación al siguiente tick/microtask controlado, manteniendo el estado `compactInFlight`, para dar oportunidad a otros handlers `agent_end` de terminar y encolar sus follow-ups.

El cambio debe ser conservador:

- No tocar la librería core de Pi inicialmente.
- No cambiar la política de cuándo compactar.
- Solo cambiar el momento de ejecución de `ctx.compact(...)` para evitar carreras post-turn.
- Mantener callbacks `onComplete` / `onError` y notificaciones existentes.

Si al implementar se confirma que el API de contexto expone estado de mensajes pendientes, añadir una guardia opcional para saltar o retrasar compactación cuando existan mensajes pendientes. Si no existe, usar solamente el diferimiento asíncrono.

## Files to modify

- `pi-compaction-improvement/extensions/index.ts`
  - Extraer la llamada a `ctx.compact(...)` a un helper pequeño, por ejemplo `scheduleAutocompact(...)`.
  - Reemplazar la llamada directa en `agent_end` por la llamada diferida.
- `pi-compaction-improvement/tests/extension.test.ts`
  - Añadir test para verificar que `agent_end` no llama `ctx.compact` sincrónicamente.
  - Verificar que sí lo llama después de drenar microtasks/timers.
- Opcional si hace falta por estructura:
  - Nuevo test helper local en `tests/extension.test.ts` para capturar handlers registrados.

## Reuse

Código existente a reutilizar:

- `extensions/index.ts`
  - `noteCompactionRequested(...)` para marcar `compactInFlight` antes de programar la compactación.
  - `notify(...)` para conservar notificaciones.
  - `debugNotify(...)` y `buildStatusSnapshot(...)` no necesitan cambios.
  - La configuración de `ctx.compact({ customInstructions, onComplete, onError })` debe conservarse.
- `tests/extension.test.ts`
  - Ya registra la extensión con mocks de `on` y `registerCommand`; extender este patrón para capturar el handler `agent_end`.
- `src/policy.ts`
  - No cambiar: la decisión `evaluation.decision.compact` debe mantenerse igual.

## Steps

- [ ] Capturar en un test el handler `agent_end` registrado por la extensión.
- [ ] Construir un contexto mock con uso de tokens alto y configuración que fuerce `evaluation.decision.compact === true`.
- [ ] Añadir expectativa de que `ctx.compact` no se llama antes de que el handler `agent_end` resuelva.
- [ ] Añadir expectativa de que `ctx.compact` sí se llama después de drenar el trabajo diferido.
- [ ] Implementar helper `scheduleAutocompact(ctx, state, customInstructions)` o equivalente en `extensions/index.ts`.
- [ ] Reemplazar la llamada directa a `ctx.compact(...)` dentro de `agent_end` por el helper diferido.
- [ ] Mantener `state.compactInFlight` activo desde `noteCompactionRequested(...)` hasta `onComplete`/`onError`.
- [ ] En `onError`, asegurar que `noteCompactionFailed(state)` sigue ejecutándose y que se notifica el error.
- [ ] Si existe una API fiable para detectar mensajes pendientes/follow-ups en `ctx`, añadir una guardia defensiva; si no, dejarlo fuera para evitar depender de APIs no documentadas.

## Verification

- Ejecutar en `C:/dev/pi/pi-compaction-improvement`:
  - `npm run typecheck`
  - `npm test`
- Validar diagnósticos en archivos tocados:
  - `lsp_diagnostics` sobre `extensions/index.ts` y `tests/extension.test.ts`
  - `lens_diagnostics delta`
- Instalar la extensión actualizada:
  - `pi install .`
- Prueba manual recomendada:
  - Activar un goal largo en `pi-thread-goal`.
  - Forzar una situación donde `pi-compaction-improvement` compacte al terminar un turno.
  - Confirmar que, tras terminar un subitem y compactar, el siguiente turno del goal se arranca automáticamente en vez de quedarse detenido.
