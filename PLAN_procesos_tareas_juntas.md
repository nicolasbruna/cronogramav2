# Plan: Procesos con atención puntual ("procesos y tareas juntas")

## Contexto y problema

En el cronograma, una etapa que en realidad es un **proceso de máquina** (ej. el **amasado**) donde el
empleado solo interviene un rato al inicio (arrancar la máquina) y otro rato al final (sacar la masa)
hoy se guarda mal: el empleado queda **ocupado durante toda la duración** del amasado, aunque solo
necesite ~1 minuto en cada extremo. Además, al asignarle empleado, la etapa **desaparece** de la
sección "Procesos".

Causa raíz: al **materializar** (guardar) la etapa, el bloque del empleado se crea de `inicioAbs` a
`finAbs` (toda la etapa), ignorando las "ventanas de presencia" que el usuario ya configura y que el
**planificador ya respeta** (internamente reserva al empleado solo en las ventanas). El problema es
exclusivamente el guardado y la visualización, no la planificación.

Archivo de la causa: `src/services/schedulerService.ts` → `materializarInstancia` (líneas ~761-822).

## Objetivo (decisiones ya tomadas con el usuario)

1. **Proceso + toques juntos**: ver una barra del proceso (la máquina trabajando todo el tiempo) **y**,
   en la fila del empleado, solo dos toques cortos (arrancar / sacar).
2. **Empleado libre en el medio**: mientras la máquina trabaja sola, el sistema puede asignarle otra
   tarea al empleado. (Ya lo cumple el planificador; con este cambio también queda fiel al regenerar.)
3. **Automático por los tiempos**: no se crea un "tipo de etapa" nuevo. Si una etapa tiene presencia de
   empleado solo en los extremos (hueco en el medio), se comporta así sola.

## Diseño

Todo el cambio se concentra en **`materializarInstancia`** (`src/services/schedulerService.ts`). El
render del Gantt **no se toca**: se reutilizan las secciones ya existentes.

### Detección "atención puntual"

Una etapa es de atención puntual si las ventanas de presencia del empleado **no cubren de forma
continua** todo el intervalo `[inicioAbs, finAbs]` (es decir, hay un hueco en el medio, o no llegan a
los bordes). Si la presencia es continua (cubre todo) → comportamiento actual sin cambios.

Las ventanas ya vienen separadas en cada asignación: `AsignacionEtapa.ventanasAbs` (ej.
`[{inicio:t, fin:t+1}, {inicio:t+19, fin:t+20}]`). Helper a agregar: una función que dado
`ventanasAbs` y el intervalo total diga si lo cubre sin huecos.

### Qué se guarda cuando es atención puntual

En lugar de **un** bloque de empleado, se generan **tres tipos** de tarea (vía
`cronogramaService.crearTarea`), todas con el mismo `grupo_id` nuevo (`crypto.randomUUID()`) para que
se vean como una unidad (borde + ícono de cadena en los toques):

1. **Cuerpo del proceso** — `linea_id: null` (autónoma), de `inicioAbs` a `finAbs`, lleva
   `recursos_programados` (la máquina). Aparece en la sección **"Procesos"** y mantiene la máquina
   visible en **"Recursos de máquinas"**. Color = color de la plantilla/etapa.
2. **Toques del empleado** — una tarea **corta por cada ventana** de `principal.ventanasAbs`, con
   `linea_id` del empleado (editable/arrastrable). **Sin** `recursos_programados` (la máquina ya está
   en el cuerpo, para no duplicarla en "Recursos de máquinas").
3. **Toques de ayudantes** — igual que los del principal, una tarea corta por cada ventana de cada
   asignación de ayudante (hoy los ayudantes se colapsan con `min/max`; pasa a iterar por ventana).

### Comportamiento normal (sin cambios)

- Etapa con presencia **continua** del empleado → un único bloque en la fila del empleado, como hoy.
- Etapa **sin** empleado → una tarea autónoma con la máquina (va a "Procesos"), como ya ocurre hoy.

### Textos de los toques (default propuesto, ajustable)

- Primera ventana: `Arrancar · {nombre etapa}`
- Última ventana: `Finalizar · {nombre etapa}`
- Ventanas intermedias (si hubiera): `{nombre etapa}`

### Vínculo con grupo_id (default: sí)

Cuerpo + toques comparten `grupo_id`. Se reutiliza el mecanismo existente
(`cronogramaService.agruparTareas` / `getGrupoColor`). Nota: la sección "Procesos" es de solo lectura y
no dibuja el borde de grupo; el vínculo se verá sobre todo en los toques de la fila del empleado.

## Archivos a modificar

- **`src/services/schedulerService.ts`** — reescribir `materializarInstancia` (~761-822):
  - Agregar helper `cubreContinuo(ventanas, inicio, fin): boolean`.
  - Rama "atención puntual": crear cuerpo autónomo + un bloque por ventana (principal y ayudantes) con
    `grupo_id` compartido.
  - Rama normal: dejar la lógica actual.
- (Posible) **`src/types/cronograma.ts`** — solo si hace falta exponer algún campo; en principio
  `CrearCronogramaTareaRequest` ya soporta `linea_id: null`, `recursos_programados`, `grupo_id` no está
  en el request → **verificar**: hoy `crearTarea` no recibe `grupo_id`. Si no lo recibe, hay que
  agregarlo al request y al insert (`cronogramaService.crearTarea`) o agrupar luego con
  `agruparTareas(ids)` tras crear las tres.

## Reutilización de lo existente

- `cronogramaService.crearTarea` (creación de cada bloque) y `asegurarLineaExiste` /
  `asegurarLineaParalela` (línea del empleado) — ya usados en `materializarInstancia`.
- Sección "Procesos": `procesosRows` (CronogramaTimeline.tsx ~226) y su render (~1596-1640).
- Sección "Recursos de máquinas": `machineRows` (CronogramaTimeline.tsx ~213) — se alimenta de
  `recursos_programados`, así que el cuerpo basta para que la máquina se vea.
- Agrupado: `cronogramaService.agruparTareas` / `desagruparTareas` (~490-503) y `getGrupoColor`.

## Limitaciones conocidas (v1)

- El cuerpo del proceso es **solo lectura** (las tareas autónomas no se arrastran). Mover toda la etapa
  a mano no es posible desde el cuerpo; sí se pueden mover los toques.
- Mover un toque a mano **no arrastra** el cuerpo (son independientes, solo vinculados visualmente por
  el grupo). Si molesta, se aborda en una iteración posterior (mover/borrar en cascada por grupo).

## Verificación (end-to-end)

1. **Datos**: en una etapa de máquina (ej. "Amasar" de la plantilla "Salado") configurar presencia de
   empleado solo en extremos (tiempo de empleado al inicio = 1, al fin = 1), dejando el medio libre.
2. **Rama**: trabajar en `procesos-y-tareas-juntas`. `npx tsc --noEmit` debe quedar limpio.
3. **Regenerar** el día (botón "Planificar" → Aplicar) con sesión iniciada en la app de la Pi.
4. **Comprobar en la base** (vía MCP Supabase, tabla `cronograma_tareas`, día correspondiente):
   - Una tarea con `linea_id = null` que dura todo el amasado y tiene la máquina en
     `recursos_programados` (el cuerpo).
   - Dos tareas cortas con `linea_id` del empleado en los extremos (los toques), sin máquina.
   - Las tres comparten `grupo_id`.
5. **Comprobar en pantalla**: el amasado aparece como barra en "Procesos" y en "Recursos de máquinas";
   en la fila del empleado solo se ven los dos toques cortos; el empleado queda libre en el medio (se le
   puede asignar otra tarea, y al regenerar el sistema la coloca ahí).
6. Si todo va bien: unir `procesos-y-tareas-juntas` a `main` y `git push`.

## Decisiones abiertas (menores, confirmables antes o durante)

- Textos exactos de los toques (default: "Arrancar" / "Finalizar").
- Confirmar si `grupo_id` se setea en `crearTarea` o se agrupan las tres con `agruparTareas` tras
  crearlas (depende de si el request actual acepta `grupo_id`).
