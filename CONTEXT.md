---
name: project-planificacion-produccion
description: Contexto del proyecto para continuar con Claude Code en otra PC
lastUpdated: 2026-05-22
---

Sistema de planificación de producción para panadería/pastelería.

**Ruta local:** `D:\Dropbox\Claude code\Cronograma de produccion\Proyecto Bolt`
**URL producción:** https://cronograma-produccion.vercel.app
**Supabase project ID:** `rnwlflhfzerorxjnsmnv`

**Stack:** React + TypeScript + Tailwind + Vite + Supabase (PostgreSQL + auth) + Vercel

---

## Lo que funciona (estado actual)

### Módulo Cronograma (gantt manual)
- Gantt timeline con empleados, líneas, tareas arrastrables
- Undo/redo 50 pasos persistido en Supabase
- Versiones guardadas + papelera
- Auth con Supabase
- 7 días de la semana, rango horario configurable
- **Filas de máquinas en el timeline** — las tareas con `recursos_programados` muestran bloques de color por recurso debajo del Gantt de empleados

### Módulo Planificación automática
- Tablas DB: `maquinas`, `habilidades`, `empleado_habilidades`, `plantillas_proceso`, `plantilla_etapas`, `plan_dia`
- Migration principal: `supabase/migrations/20260522000000_002_planning_engine.sql`
- Columna adicional (aplicada vía MCP): `cronograma_tareas.recursos_programados jsonb NOT NULL DEFAULT '[]'`
- Tipos: `src/types/planificacion.ts`, `src/types/cronograma.ts`
- Servicio CRUD: `src/services/planificacionService.ts`
- Scheduler: `src/services/schedulerService.ts` (ver detalles abajo)
- UI Configuración: `src/components/Configuracion/PlantillasTab.tsx`
- UI Planificar: `src/components/Planificacion/PlanificarModal.tsx`
- UI Cronograma con recursos: `src/components/Cronograma/CronogramaTimeline.tsx`

### Flujo de uso
1. **Configuración → Plantillas**: crear plantillas con etapas (duración, máquinas, empleado, dependencias, margen_espera_max)
2. **Botón "Planificar"** en el cronograma → seleccionar producciones del día y cantidad de lotes
3. **"Generar"** → scheduler corre y muestra Gantt preview
4. **"Aplicar"** → crea tareas reales en el Gantt guardando `recursos_programados`
5. **Cronograma principal** → muestra filas de máquinas debajo de empleados

---

## Scheduler (`src/services/schedulerService.ts`)

### Conceptos clave
- `RecursoEfectivo { maquinaId, usoRecurso, desde, hasta }` — recurso con ventana relativa al inicio del proceso
- `RecursoProgramado { maquinaId, maquinaNombre, inicio, fin }` — recurso con tiempos absolutos
- `ChainGroup { headKey, tasks, offsets, totalDuration }` — cadena de tareas "en cadena" (margen=0)
- `getRecursosEfectivos(etapa)` — usa campo `recursos[]` nuevo; si vacío, fallback a campo legacy `maquina_id`
- Máquinas admiten uso parcial (0.0–1.0), varias tareas pueden compartir máquina
- Empleados: campos legacy `tiempo_empleado_inicio`, `tiempo_empleado_fin`, `bloquea_empleado_total`; nuevo: `ventanas_empleado[]`

### Cadenas "en cadena" (margen_espera_max === 0)
- Una cadena es una secuencia A→B→C donde cada sucesor tiene `margen_espera_max=0`
- La cadena ENTERA debe encontrar un slot donde todos los recursos de todas las tareas estén libres en sus ventanas relativas
- `detectChains(ordered)`: cada sucesor se marca como absorbido al asignarlo (evita que quede sin cadena)
- `findBestSlotForChain`: Fase 1 máquinas → Fase 2 empleados con rollback
- **BUG CORREGIDO (2026-05-22)**: múltiples sucesores con margen=0 del mismo nodo causaban TypeError silencioso

### Defensas en el código
- `(etapa.dependencias ?? []).map(...)` — por si la DB devuelve null
- Guard `if (!chain)` con `console.warn` antes de usar el ChainGroup
- `catch (err)` en `generar()` del modal → muestra `alert()` con el error real

---

## Tipos importantes

### `PlantillaEtapa` (src/types/planificacion.ts)
```typescript
interface PlantillaEtapa {
  recursos: RecursoEtapa[]              // nuevo: múltiples recursos con ventana temporal
  maquina_id?: string | null            // legacy: una sola máquina (fallback)
  uso_recurso: number                   // legacy
  ventanas_empleado: VentanaEmpleado[]  // nuevo: ventanas explícitas de presencia empleado
  tiempo_empleado_inicio: number        // legacy
  tiempo_empleado_fin: number           // legacy
  bloquea_empleado_total: boolean       // legacy
  dependencias: number[]                // órdenes de etapas previas requeridas
  margen_espera_max?: number | null     // null=sin límite, 0=en cadena (inmediato)
}
```

### `RecursoEtapa` (en planificacion.ts)
```typescript
interface RecursoEtapa {
  maquina_id: string
  uso_recurso: number   // 0.01–1.0
  desde: number         // minutos desde inicio del proceso
  hasta: number         // minutos desde inicio del proceso
}
```

### `RecursoProgramadoCronograma` (en cronograma.ts)
```typescript
interface RecursoProgramadoCronograma {
  maquina_id: string
  maquina_nombre: string
  hora_inicio: string   // "HH:MM"
  hora_fin: string      // "HH:MM"
}
```
Se guarda en `cronograma_tareas.recursos_programados` (jsonb).

---

## UI: PlantillasTab (`src/components/Configuracion/PlantillasTab.tsx`)
- `RecursosEtapaEditor`: editor visual multi-máquina con barra de preview de ventanas temporales
- `EtapaCard`: muestra nombre de máquina (resuelto desde UUID)
- `FormEtapa`: usa `RecursosEtapaEditor` en lugar del antiguo dropdown+slider single-machine
- `RECURSO_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']`

## UI: CronogramaTimeline (`src/components/Cronograma/CronogramaTimeline.tsx`)
- `MAQUINA_ROW_H = 36` — altura de fila de máquina
- `machineRows` (useMemo) — agrega `recursos_programados` de todas las tareas por maquina_id
- Sidebar: sección "Máquinas" (header oscuro) + filas con icono Package + nombre
- Content: header oscuro + bloques de color por ventana de recurso programado

---

## DB — columnas en `plantilla_etapas` agregadas vía MCP (no en archivos SQL)
- `ventanas_empleado jsonb NOT NULL DEFAULT '[]'`
- `recursos jsonb NOT NULL DEFAULT '[]'`
- `uso_recurso numeric NOT NULL DEFAULT 1.0`

La columna `cronograma_tareas.recursos_programados` fue agregada vía migration `005_recursos_programados_en_tareas`.

---

## Pendientes conocidos
1. **Habilidades de empleados**: tabla y CRUD existen. Falta UI para asignar habilidades a empleados en Configuración.
2. **Detección visual de conflictos** en el Gantt principal
3. **Pre-producción sugerida** (optimización cross-day)
4. **`caniuse-lite` desactualizado** — warning no crítico en build

---

## Por qué existe este proyecto
Panadería/pastelería con ~4 empleados, ~5 máquinas, producción lunes a domingo. El sistema organiza etapas de producción (amasado, fermentación, horneado, etc.) como piezas de Tetris respetando dependencias, disponibilidad de máquinas con capacidad parcial, presencia del empleado, y restricciones de timing ("en cadena" = sin gap entre etapas).
