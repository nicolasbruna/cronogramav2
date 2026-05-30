# Cambios posteriores al commit `83875e9` (la función que después revertimos)

> **Qué es este documento.** Explica en detalle TODO lo que construimos *después* del
> commit de referencia `83875e9` y que luego **se descartó** al hacer
> `git reset --hard 83875e9`.
>
> **Importante:** todo este trabajo eran cambios **sin commitear** (working tree). Al
> revertir, se perdieron del repositorio y **no son recuperables desde git** (el
> `reflog` no los tiene porque nunca fueron un commit). Este archivo es la memoria
> de ese diseño, por si lo queremos rehacer.
>
> Fecha: 2026-05-25.

---

## 0. Punto de partida y por qué lo revertimos

El commit `83875e9` ("fix(scheduler): respetar horarios reales y unificar convención
de días") dejó el scheduler funcionando con horarios reales y la convención de días
unificada (Domingo=0). **A partir de ahí** empezamos a construir un sistema mucho más
ambicioso: la **resolución asistida de conflictos**.

Después de muchas iteraciones, el sistema seguía sin comportarse como esperabas
(reasignaba tareas, dejaba empleados ociosos, generaba "turnos fantasma" de 13 h).
La causa no era un bug suelto sino una **limitación de fondo del modelo** (ver
sección 8). Por eso decidiste **volver al commit** en lugar de seguir parchando.

El orden real del trabajo fue, a grandes rasgos:

1. Mejoras al diagnóstico de conflictos (mensajes + culpable).
2. Generador de soluciones candidatas + simulación.
3. Métricas de jornada por solución.
4. UI del panel asistido (elegir solución, ver consecuencias, aplicar, recalcular).
5. Unificación del modelo de restricciones (sacar el override de `plan_dia`,
   dejar todo en la config de la plantilla) + cambios de UI/CSS.

---

## 1. Diagnóstico de conflictos (mejoras sobre el scheduler)

Antes de proponer soluciones, había que **explicar bien el conflicto**. Esto se
construyó dentro de `src/services/schedulerService.ts` y se mostraba en
`PlanificarModal.tsx`.

### 1.1. Orden por urgencia (EDF — Earliest Deadline First)
- A igualdad de prioridad, los procesos **con restricción horaria** (los que tienen
  `hora_inicio_max` / `hora_fin_max`) reservan recursos **antes** que los flexibles.
- Objetivo: que un proceso "que sí o sí tiene que arrancar antes de las 04:35" no se
  quede sin lugar porque un proceso flexible le ocupó la máquina/empleado.

### 1.2. Mensajes de conflicto con causa
- Cuando un bloque no entraba, el mensaje dejó de ser genérico y pasó a decir
  **la causa concreta**: ventana horaria, máquina ocupada o empleado no disponible.

### 1.3. Identificación del bloque "culpable"
- Cuando el conflicto era por un recurso ocupado, el sistema identificaba
  **qué otro proceso/lote estaba ocupando** ese recurso en esa franja (el "culpable").
- Esto era la base para después poder ofrecer "bajale la prioridad al culpable" o
  "sacá al culpable del plan".

### 1.4. Fix de UI
- El texto del mensaje de conflicto **dejaba de truncarse** (antes se cortaba y no se
  leía la causa completa).

---

## 2. `SchedulerOverrides` — re-simular con cambios

Para poder ofrecer soluciones y previsualizarlas, hubo que poder correr el scheduler
**"como si" se aplicaran ciertos cambios**, sin tocar la base de datos. Para eso se
introdujo un objeto de overrides que `generarCronograma` aceptaba como parámetro:

Campos del override (lo que se podía simular):
- **Turnos de empleado:** cambiar/forzar el horario de entrada-salida de un empleado
  para ese día (p. ej. "traer a Cristofer a las 06:00").
- **Prioridad por plantilla:** subir o bajar la prioridad de una plantilla.
- **`hora_inicio_min` / `hora_inicio_max` / `hora_fin_max`:** relajar o endurecer las
  restricciones horarias de un proceso.
- **Excluir plantillas:** sacar una plantilla del plan en la simulación.
- **Asignación fijada (PIN):** `asignacionForzada` / `forzadoEmpId` — clavar que tal
  etapa/proceso la hace tal empleado, para que el recálculo **no se la reasigne** a otro.

Idea clave: el scheduler seguía corriendo igual, pero **leía estos overrides** para
modificar disponibilidad, prioridades, restricciones y asignaciones forzadas.

---

## 3. `generarSolucionesConflicto` — generar y simular soluciones

Esta función tomaba un conflicto concreto y producía una **lista de soluciones
candidatas**, cada una **ya simulada** (corría el scheduler con su override para saber
si realmente resolvía el conflicto y qué consecuencias tenía).

Tipos de solución que generaba:

1. **Traer un empleado** (el caso más trabajado):
   - **Just-in-time:** traerlo justo a la hora que se necesita, no antes.
   - **Ventana recortada:** que su disponibilidad extra sea solo la franja necesaria,
     no un turno entero.
   - **Con PIN:** fijar que esa tarea la haga ese empleado traído, para que el recálculo
     no se la dé a otro.

2. **Combinaciones sobre el/los culpable(s)** (el proceso que ocupa el recurso):
   - **Dejarlo como está** (no tocar).
   - **Bajarle la prioridad.**
   - **Sacarlo del plan.**
   - Y combinaciones de varios culpables a la vez.

3. **Relajar restricciones** del propio proceso en conflicto (correr su
   `hora_inicio_max` / `hora_fin_max`), mostrando **el detalle de la restricción
   horaria** que se estaba relajando.

4. **Sacar el propio proceso** del plan (última opción).

Sobre todas estas:
- **Ranqueo:** ordenaba las soluciones por "qué tan buenas" eran (menos perjuicio,
  menos horas fuera de turno, etc.).
- **Deduplicación / poda:** descartaba soluciones redundantes o equivalentes para no
  abrumar con opciones que daban el mismo resultado.

---

## 4. `calcularMetricasJornada` — consecuencias de cada solución

Para que pudieras **decidir con información**, cada solución mostraba el impacto a
nivel de toda la jornada, no solo "si el conflicto se resolvió". Calculaba:

- **Cierre de jornada:** a qué hora termina toda la producción del día.
- **Carga por empleado** y, sobre todo, **horas fuera de turno** por empleado
  (cuánto se le pedía trabajar de más respecto de su horario real).
- **Uso de máquinas.**
- **Cuello de botella** (el recurso más saturado).
- **Advertencias** (p. ej. alguien trabajando fuera de su turno).

Esto era lo que permitía comparar: "traer a Cristofer cierra la jornada a las 11:45
pero le agrega 1 h fuera de turno" vs "bajar la prioridad del Salado cierra a las 12:30
sin horas extra".

---

## 5. UI del panel asistido (`PanelAsistido` / `SolucionRow`)

En `PlanificarModal.tsx` se agregó la interfaz para operar todo lo anterior:

- **Panel de soluciones:** lista cada solución candidata con sus **consecuencias**
  (las métricas de la sección 4).
- **Ventana editable:** para las soluciones de "traer empleado", podías editar a mano
  la franja horaria (desde/hasta) del empleado traído.
- **Preview en vivo:** al tocar/editar una solución, se veía el cronograma resultante
  **simulado** antes de confirmarla.
- **Aplicar:** confirmabas la solución elegida y se aplicaba al plan.
- **Cascada (recálculo):** tras aplicar una solución, el sistema **volvía a simular todo
  el cronograma** y, si aparecía un nuevo conflicto, ofrecía soluciones para ese — en
  cadena. (Esto respondía tu pedido: "una vez que reubico la crema, tiene que simular
  todo el cronograma nuevamente".)
- **Poda de redundancias** también en la UI, para no listar opciones equivalentes.

---

## 6. Cambio del modelo de restricciones (unificar en "un solo todo")

En paralelo, pediste eliminar la duplicación de dónde vivían las restricciones
horarias. Había **dos lugares** que hacían lo mismo:
- El **override horario por día** en `plan_dia` (campos `hora_inicio_min` /
  `hora_fin_max`, editables en el formulario de planificación).
- La **config de la plantilla** (sus propias restricciones horarias).

Cambios hechos:

- **Se eliminó el "Override horario (Desde/Hasta)"** del formulario de planificación
  (`PlanificarModal.tsx`).
- Las restricciones pasaron a vivir **solo en la config de la plantilla**
  (`PlantillasTab`), con **3 campos renombrados** para que se entiendan:
  - **"No empezar antes de"** (= `hora_inicio_min`)
  - **"Empezar a más tardar"** (= `hora_inicio_max`, tope de comienzo)
  - **"Terminar a más tardar"** (= `hora_fin_max`)
- **Validación dinámica:** el sistema validaba que la ventana entre el tope de inicio
  y el tope de fin **no fuera menor que la duración total** del proceso (no tiene
  sentido pedir que algo de 230 min empiece y termine en una ventana de 60 min).
- **Fix de CSS:** en las tarjetas de plantilla, los inputs eran **ilegibles** (texto
  blanco sobre fondo blanco) en la tarjeta seleccionada. Se corrigió el color del
  texto dentro del recuadro.

### Cambio en la base de datos (esto sí dejó huella)
Para sacar el override de `plan_dia` se **dropearon** las columnas
`hora_inicio_min` y `hora_fin_max` de esa tabla. Al revertir, se **recrearon**
(`integer`, nullable) pero **quedaron vacías** (los datos viejos se perdieron). Hoy el
esquema vuelve a ser consistente con el commit `83875e9`.

---

## 7. Bugs que aparecieron mientras construíamos esto (y cómo se arreglaron)

Todos estos fixes también se perdieron al revertir; los documento por si reaparecen
al rehacer.

1. **Crash de array disperso — `.for is not iterable`** (`PlanificarModal.tsx:250`,
   originado en `getNextFreeStart`):
   - Causa: el loop de *undo* dentro de `findBestSlotForChain` seteaba
     `array.length` a valores **crecientes**, lo que creaba **huecos** (sparse array).
   - Fix: iterar `savedLengths` **en orden inverso** al deshacer.

2. **El PIN se perdía al editar la ventana** de un empleado traído:
   - Causa: `ajusteActual()` reconstruía el ajuste y **descartaba** `asignacionForzada`.
   - Fix: preservarlo con `...sol.ajuste` al reconstruir.

3. **Sospechas de bundle viejo (HMR):** varias veces el comportamiento "no cambiaba".
   Se reinició Vite varias veces, se verificó por `curl` que el server servía el código
   correcto y se probó en incógnito para descartar caché del navegador.

4. **Iteraciones sobre la ventana de "traer empleado":**
   - Primero entraba **demasiado temprano** → se pasó a **just-in-time**.
   - Después entraba hasta las **18:00** sin necesidad → se **recortó** a la franja del
     proceso.
   - Después el recálculo **se la reasignaba a otro** → se agregó el **PIN**.
   - Con PIN + exclusividad, el empleado **quedaba ocioso** el resto del día → se quitó
     la exclusividad.
   - Al unir la franja extra con el turno normal → **turnos fantasma de 13 h** con hueco
     ocioso → se revirtió la unión.

---

## 8. El aprendizaje de fondo (por qué nada terminaba de cerrar)

**Tensión conceptual entre dos formas de pensar el problema:**

- **El scheduler piensa por DISPONIBILIDAD:** le das a alguien un turno (un bloque
  continuo de horas) y reparte libremente las tareas que entren en ese bloque.
- **Vos pensás por ASIGNACIÓN:** "esta tarea YA es de Sebastián, no se la den a otro",
  y además "Sebastián, después de esa tarea, tiene que poder seguir haciendo otras"
  (no quedar ocioso).

Cada vez que el scheduler **recalculaba**, **reasignaba** tareas, rompiendo tu idea de
asignación fija. Lo intentamos resolver con **pinning**, ventana recortada,
exclusividad, unión de turnos, etc., pero quedaron tensiones imposibles de cerrar con
el modelo actual:

- Si la ventana del empleado traído es **recortada y exclusiva** → no hace nada más y
  todo el resto recae en otro.
- Si se **une al turno normal** → quedan turnos fantasma larguísimos con huecos ociosos.

**Conclusión:** el modelo de **disponibilidad como UN solo bloque continuo** se queda
corto. La solución correcta sería modelar la disponibilidad de cada empleado como
**varias franjas separadas** (turno normal + extras traídos como franjas distintas),
pero eso es un **refactor del corazón del scheduler**, no un parche.

---

## 9. Si lo retomamos: por dónde empezar

1. **Primero el modelo, no la UI.** Cambiar la disponibilidad de empleado de
   "un intervalo" a "lista de franjas" en `schedulerService.ts`. Todo lo demás
   (traer empleado, pin, métricas) se vuelve mucho más natural sobre esa base.
2. Recién después reconstruir el generador de soluciones y el panel asistido.
3. Tener en cuenta los 4 errores de TypeScript preexistentes (no son de este trabajo)
   en `CronogramaEmpleadoPage.tsx` y `cronogramaService.ts`.

> Referencia cruzada: el contexto general de toda la sesión está en
> `CONTEXTO_SESION.md` (este archivo amplía su sección 6).
