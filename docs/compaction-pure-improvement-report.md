# Reporte: mejoras pendientes de compactación pura

Sí: tu intuición es correcta. **Aún hay mejoras que son 100% compactación pura**, no RAG/watchdogs/multi-agente. El módulo está bien, pero todavía puede madurar bastante en calidad de compresión, integridad y control de pérdida.

## Madurez de compactación pura

### Nota actual

**8.3 / 10 en compactación estricta**

Arquitectónicamente está limpio, pero como *algoritmo de compactación* todavía es más “rolling summary textual seguro” que “compactor robusto con garantías de retención”.

---

## Lo que ya está bien

### 1. Trigger seguro

Ya compacta por presión de tokens y espera `agent_end`/idle.

Archivos:

```text
src/compaction/scheduler.ts
src/compaction/compaction-trigger.ts
src/policy.ts
```

Esto evita compactar arbitrariamente en medio del flujo.

### 2. Fallback robusto

Ante errores devuelve `undefined` para que Pi use la compactación default.

Casos cubiertos:

- evento inválido
- sin modelo
- sin auth
- provider error
- timeout
- abort
- summary vacío
- result inválido
- race de `signal`

Bien.

### 3. Prompt estructurado

`src/prompt.ts` ya fuerza secciones como:

```text
Goal
Constraints & Preferences
Progress
Key Decisions
Risks
Immediate Next Action
Critical Context
```

Esto es mejor que un “resume la conversación”.

---

# Gaps reales de compactación pura

## 1. No hay “budgeting” interno del resumen

Hoy calculamos `maxTokens` así:

```ts
Math.min(0.8 * reserveTokens, modelMaxTokens)
```

Archivo:

```text
src/compaction/summary-request.ts
```

Problema: eso limita la salida del modelo, pero **no define presupuesto por sección**. El modelo puede gastar demasiado en narrativa y dejar fuera “Critical Context”.

### Riesgo

Resumen válido pero pobre: conserva historia general y pierde datos críticos.

### Mejora recomendada

Agregar presupuesto por sección:

```text
Goal: corto
Constraints: medio
Progress: medio
Critical Context: prioridad alta
Immediate Next Action: obligatorio
```

Y en modo `aggressive`, reducir todo salvo:

```text
Critical Context
Blocked
Immediate Next Action
Continuation Contract
```

Prioridad: **Alta**

---

## 2. No hay validación semántica del summary

`result-guard.ts` valida que exista summary, `firstKeptEntryId` y `tokensBefore`.

Pero no valida que el summary tenga la estructura esperada.

Archivo:

```text
src/compaction/result-guard.ts
```

Hoy esto pasaría:

```text
"summary"
```

si viene con `firstKeptEntryId` y tokens válidos.

### Riesgo

Compaction técnicamente válida pero inútil.

### Mejora recomendada

Agregar `summary-structure-guard.ts` que valide secciones mínimas:

```text
## Goal
## Progress
## Immediate Next Action
## Critical Context
```

Y quizás reglas mínimas:

- `Immediate Next Action` no vacío.
- `Critical Context` no placeholder.
- `Continuation Contract` presente.

Prioridad: **Alta**

---

## 3. El resumen sigue siendo texto libre, no “structured extraction”

El prompt pide estructura Markdown, pero internamente no hay schema.

Esto sigue siendo compactación pura: no es RAG ni memoria larga. Es mejorar la forma de la compresión.

### Mejora posible

Dos opciones:

#### Opción A — Markdown estricto validado

Mantener Markdown, pero validar headers y contenido.

Más simple.

#### Opción B — JSON intermedio + render Markdown

El modelo devuelve algo así:

```json
{
  "goal": "...",
  "constraints": [],
  "done": [],
  "inProgress": [],
  "blocked": [],
  "decisions": [],
  "risks": [],
  "immediateNextAction": "...",
  "criticalContext": []
}
```

Luego la extensión lo transforma a Markdown.

Más robusto, pero más cambio.

Mi recomendación: **Opción A primero**.

Prioridad: **Alta/Media**

---

## 4. No hay protección contra summaries demasiado largos

Validamos que no sea vacío, pero no que sea razonablemente compacto.

Si el modelo devuelve un resumen enorme, sigue pasando.

### Riesgo

La compactación reduce poco o incluso empeora la presión de contexto.

### Mejora recomendada

Agregar una política de tamaño:

```text
summary.length
estimatedSummaryTokens
ratio vs tokensBefore
```

Ejemplo:

- warning/fallback si summary supera cierto umbral.
- modo aggressive si está demasiado largo.
- opcional: segundo pase “compress the summary further”.

Prioridad: **Alta**

---

## 5. No hay “retry con modo más agresivo”

Si el summary sale vacío o inválido, ahora caemos directo a default compaction.

Eso es seguro, pero menos bueno.

### Mejora recomendada

Para errores recuperables:

```text
empty
invalid-structure
too-long
```

hacer un segundo intento con:

```text
mode=aggressive
maxTokens menor
prompt más estricto
```

No para provider-error/abort/timeout.

Prioridad: **Media**

---

## 6. `willRetry` se pierde

En `summary-request.ts` aparece:

```ts
willRetry: false
```

Aunque el evento real de Pi trae `willRetry`.

Archivo:

```text
src/compaction/summary-request.ts
```

Esto sí es compactación pura: en overflow recovery el resumen debería ser más agresivo y orientado a reintento.

### Mejora recomendada

Agregar `reason` y `willRetry` al `SafeBeforeCompactEvent` / preparation normalizada y pasarlo al prompt.

Prioridad: **Alta**

---

## 7. El orden de mensajes puede ser discutible

Hoy:

```ts
const allMessages = [
  ...preparation.messagesToSummarize,
  ...preparation.turnPrefixMessages,
];
```

Archivo:

```text
src/compaction/summary-request.ts
```

Hay que confirmar si Pi espera ese orden. Si `turnPrefixMessages` representa prefijo del turno retenido, quizá debería ir antes o tratarse como bloque separado.

### Riesgo

El summary mezcla el material compactado y el prefijo del turno de forma ambigua.

### Mejora recomendada

No mezclar ambos en un solo `<conversation>`. Separar:

```xml
<messages-to-summarize>
...
</messages-to-summarize>

<retained-turn-prefix>
...
</retained-turn-prefix>
```

Prioridad: **Media/Alta**

---

## 8. `previousSummary` se inyecta como texto no saneado

Actualmente:

```ts
<previous-summary>
${preparation.previousSummary}
</previous-summary>
```

Si el summary anterior contiene tags similares, puede contaminar el prompt.

### Mejora recomendada

Escapar o encapsular en CDATA-like delimiters propios.

Ejemplo:

```text
<previous-summary><![CDATA[
...
]]></previous-summary>
```

O usar delimitadores Markdown resistentes.

Prioridad: **Media**

---

## 9. File tags son estructura parcial, pero no contrato fuerte

Se preservan:

```text
readFiles
modifiedFiles
```

Bien. Pero no hay garantía de que aparezcan en el cuerpo del summary o que no se dupliquen/rueguen.

Archivos:

```text
src/file-tags.ts
src/compaction/orchestration.ts
```

### Mejora recomendada

Formalizar una sección obligatoria:

```text
## File Context
### Read
### Modified
```

Y validar que los detalles coincidan con los tags.

Prioridad: **Media**

---

# Plan recomendado de mejora

## Fase 1 — Integridad mínima del summary

Crear:

```text
src/compaction/summary-structure-guard.ts
tests/compaction-summary-structure-guard.test.ts
```

Validar:

- headers obligatorios
- immediate next action no vacío
- critical context presente
- no placeholders crudos tipo `[What the user...]`

Impacto alto, riesgo bajo.

---

## Fase 2 — Separar bloques del prompt

Modificar `buildSummaryRequest()` para generar:

```text
<messages-to-summarize>
...
</messages-to-summarize>

<retained-turn-prefix>
...
</retained-turn-prefix>

<previous-summary>
...
</previous-summary>

<compaction-context>
...
</compaction-context>
```

Impacto medio/alto.

---

## Fase 3 — Usar `willRetry` real

Extender:

```text
SafeBeforeCompactEvent
parseBeforeCompactEvent
buildSummaryRequest
```

Para pasar:

```ts
willRetry
reason
```

Impacto alto, sobre todo para overflow recovery.

---

## Fase 4 — Control de tamaño

Agregar:

```text
src/compaction/summary-size-policy.ts
```

Reglas:

- máximo por caracteres/tokens estimados
- fallback o retry aggressive si excede

---

## Fase 5 — Retry de compactación estricta

Solo para:

```text
empty
invalid-structure
too-long
```

No para:

```text
abort
provider-error
auth-error
timeout
```

---

# Veredicto

La otra IA tenía razón sobre la frontera conceptual, pero tú también tienes razón: **dentro de compactación pura todavía hay mejoras importantes**.

Las más valiosas son:

1. **validar estructura del summary**
2. **pasar `willRetry` real**
3. **separar `messagesToSummarize` de `turnPrefixMessages`**
4. **controlar tamaño/ratio del summary**
5. **retry aggressive para summaries inválidos o largos**

Eso llevaría la compactación de “segura y limpia” a “robusta y con garantías de calidad”.
