# IA de revisión y mejora del cronograma — Diseño

> Capa de IA (Claude vía Anthropic API) que **repasa el resultado del scheduler y
> busca mejores opciones**. Documento durable para no perder el contexto.

## Concepto

**El scheduler hace el trabajo; la IA lo repasa automáticamente y propone/aplica
mejoras.** La IA es una capa de segunda opinión/optimización, NO genera el plan ni
reemplaza al motor.

Principio rector: **la IA propone, el motor verifica.** Cada mejora que sugiere
Claude se expresa como un `SchedulerOverrides`, el scheduler la **simula** con
`generarCronograma`, y se comparan métricas reales (cierre, hora extra, conflictos,
carga) base vs. propuesta. La IA nunca afirma una mejora que el motor no confirme.

## Decisiones acordadas con el usuario

1. **Opcional / offline-safe:** si no hay internet o la IA falla, todo funciona
   igual que hoy. La IA es additiva.
2. **Edge Function de Supabase** como proxy seguro de la `ANTHROPIC_API_KEY`. El
   navegador nunca la toca.
3. **Repaso automático:** apenas el scheduler termina y hay internet, la IA repasa
   sola (sin botón).
4. **Auto-aplica las mejoras claras:** si una propuesta es inequívocamente mejor
   (mejora ≥1 métrica, no empeora ninguna, no crea conflictos, sin otra propuesta
   pareja que compita) → se aplica sola y se avisa qué cambió. Si hay trade-offs o
   varias opciones parejas → se muestran y el usuario elige. `aplicarResultado` ya
   hace backup automático → siempre reversible.

## Capacidades

- **A. Repasar y mejorar (núcleo):** diagnóstico + propuestas (`overrideDelta`),
  simuladas y comparadas por el motor; auto-aplica las claras, consulta las dudosas.
- **B. Explicar conflictos (apoyo):** si el plan base tiene conflictos, los explica
  en lenguaje claro apoyándose en `ConflictoInfo` + `decisionesScheduler` + las
  `SolucionConflicto` que el motor ya genera.
- **C. Comando en lenguaje natural (opcional, fase posterior).**

## Arquitectura

- **Una Edge Function** `ia-asistente` con discriminador `accion`
  (`repasar_plan` | `explicar_conflicto` | `comando_overrides`). Comparte CORS,
  auth (JWT), cliente Anthropic, errores y **system prompt cacheado**
  (`cache_control: ephemeral` en el bloque de dominio).
- Cliente invoca con `supabase.functions.invoke('ia-asistente', { body })`.
- Modelo por defecto `claude-sonnet-4-6`.

```
supabase/functions/
  _shared/cors.ts
  ia-asistente/{index,anthropic,prompts,schema,types}.ts
  ia-asistente/handlers/{repasarPlan,explicarConflicto}.ts
src/services/iaService.ts     # iaDisponible, invocarIA, repasarPlan, explicarConflicto, validarOverrides, simularPropuestas, aplicarAutomatico
src/types/ia.ts
```

## Flujo del repaso (cliente)

1. Scheduler genera `preparada.resultado` (flujo actual, sin cambios).
2. Si `iaDisponible()` → `repasarPlan(resultado, metricas, ctx, overrides)`.
3. Claude devuelve `{ diagnostico, propuestas:[{titulo,justificacion,overrideDelta}] }`
   (overrideDelta en "wire form" con arrays + IDs de los catálogos).
4. `simularPropuestas`: por cada una → `validarOverrides` (whitelist + IDs reales +
   etapas reales + rangos) → `fusionarOverrides` → `generarCronograma` →
   `calcularMetricasJornada`. Descarta inválidas o que no mejoran.
5. Clasifica: **clara** (domina al base en métricas, sin nuevos conflictos, única) →
   `aplicarAutomatico`; **dudosa** (trade-off o competidoras) → se muestra para
   elegir.

## "Mejora clara" (criterio de auto-aplicación)

Una propuesta P es **clara** si, comparada con el base B:
- `conflictos(P) <= conflictos(B)` y no aparece ningún conflicto nuevo, y
- ninguna métrica relevante empeora (cierre, total hora extra), y al menos una mejora, y
- ninguna otra propuesta válida queda dentro de un margen pequeño de P (no hay empate).
Si no cumple → es **dudosa** y se consulta.

## Seguridad

- Tool-use forzado (`proponer_mejoras`) con enums dinámicos de IDs (no inventa
  empleados/plantillas).
- Autoridad real = `validarOverrides` en el cliente.
- Auto-aplicar solo tras simular y confirmar mejora; backup automático de
  `aplicarResultado`.

## Feature flag

`configuracion_sistema.ia_habilitada` (boolean, default false) vía
`configuracionService`.

## Deploy (lo corre el usuario)

```bash
supabase link --project-ref sjqmmqlvmcnctmjrhdlk
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy ia-asistente
# Activar el flag: UPDATE configuracion_sistema SET valor=true WHERE clave='ia_habilitada' (o upsert)
```

Verificación local: `supabase functions serve ia-asistente --env-file ./supabase/.env.local`.

## Estado de implementación

- [x] Iter 0 — andamiaje (Edge Function + ping, iaService, feature flag `ia_habilitada`)
- [x] Iter 1 — repasar y mejorar + auto-aplicar mejoras claras (repaso automático tras generar)
- [x] Iter 2 — explicar conflictos (botón "Explicar con IA" + badge "IA sugiere")
- [x] Iter 3 — comando NL → overrides ("Pedile un cambio a la IA" + preview + aplicar)
- [x] Toggle de IA en Configuración (tab "IA" → flag `ia_habilitada`)

### Estado de runtime (al 2026-05-31)
- ✅ Edge Function `ia-asistente` desplegada en Supabase (proyecto `sjqmmqlvmcnctmjrhdlk`), **versión 4**, `verify_jwt` on.
- ✅ Flag `ia_habilitada = true` en `configuracion_sistema`.
- ✅ `ANTHROPIC_API_KEY` cargada como secret (la cargó el usuario; modelo `claude-sonnet-4-6`).
- ✅ La Pi corre la rama `claude/serene-ritchie-5nTCJ` con todo el front de IA.
- Timeouts: Anthropic 60s / cliente 75s. Repaso acotado a ≤3 propuestas y max_tokens 1100 para bajar latencia.
- ✅ SessionStart hook (`.claude/`) que instala deps + carga esta bitácora al iniciar.

### Pendiente / próximos pasos
- ✅ Mergeado a `main` (2026-05-31): la rama principal ya tiene la IA + el hook + el
  trabajo de simulación/editor manual. `main` y `claude/serene-ritchie-5nTCJ` en sync.
- Confirmar que **Vercel** redeploya desde `main` con la IA (producción web).
- Opcional: pasar la **Pi** a seguir `main` (hoy sigue `claude/serene-ritchie-5nTCJ`,
  mismo contenido).
- Posible: límite de gasto / monitoreo de costos de la API.
- Optimizar latencia del repaso si molesta (hoy ~15-30s).

### Cómo retomar (próxima sesión)
- Todo lo de IA está **funcionando end-to-end**: la Pi corre el front con IA, la
  función `ia-asistente` (v4) responde con la `ANTHROPIC_API_KEY` cargada, flag activo.
- El usuario estaba **probando en la Pi** (`Planificar → Generar` dispara el repaso
  automático). Si reporta un error, revisar logs con el MCP de Supabase
  (`get_logs` service `edge-function`).
- Para cambiar la función: editar en `supabase/functions/ia-asistente/`, commitear, y
  **redeployar** con `deploy_edge_function` (MCP) — el CLI de Supabase no está en el
  entorno. Hay que reenviar TODOS los archivos en cada deploy.
- Topología: GitHub = fuente de verdad; yo trabajo en la nube y pusheo; la Pi hace
  `git pull` para recibir cambios. No tengo acceso directo a la Pi ni a la PC.

Mientras el flag esté en false o falte el deploy/secret, la app funciona igual que
hoy (la IA queda invisible).
