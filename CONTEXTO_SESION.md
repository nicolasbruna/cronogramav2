# Contexto completo de la sesión — Cronograma v2

> Documento de referencia con TODO lo trabajado en la sesión, desde el inicio.
> Generado para no perder contexto. Fecha de cierre: 2026-05-25.

---

## 1. Proyecto y conexiones

- **Stack:** React + Vite + TypeScript, backend Supabase. App de **organización/planificación de tareas de producción** (panadería).
- **GitHub:** `https://github.com/nicolasbruna/cronogramav2.git` (remoto `origin`).
- **Vercel:** proyecto `cronogramav2`, team `bostongestion`
  - orgId `team_1gzw6hFMkCw3Ke33QrFRLUEi`, projectId `prj_lJju7J8KwWDan01sf7ZA8pLfEBWK`.
- **Supabase:** la app **se cambió** del proyecto viejo al nuevo en esta sesión.
  - **NUEVO (en uso):** `cronogramav2` — ref `sjqmmqlvmcnctmjrhdlk`, región sa-east-1.
  - **VIEJO:** `Cronograma de produccion` — ref `rnwlflhfzerorxjnsmnv`, región us-west-1.
  - Cambio hecho en las env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` en **Vercel (Development + Production)** y en **`.env.local`** local (`vercel env pull`).
- **Dónde corre:** Raspberry Pi. Se accede por VPN a `100.73.79.115`. La app se sirve por **nginx (`:5180`) → Vite dev (`:5173`)**.

---

## 2. Infra / cómo levantar la app

- Dev server: `npm run dev -- --host 0.0.0.0` (Vite v5, puerto 5173). Hubo que usar `--host` (antes escuchaba solo en IPv6 `::1` y no se veía).
- nginx: site `/etc/nginx/sites-available/cronograma` (proxy `:5180` → `127.0.0.1:5173`). Otros sites: `hikvision`, `supabase-studio`.
- **Auto-arranque tras reboot (configurado en esta sesión):**
  - `~/.config/systemd/user/cronograma.service` → corre el **dev server** de Vite. Habilitado + **linger** (`loginctl enable-linger nico`) → arranca solo al bootear.
  - Comandos: `systemctl --user {status|restart|stop} cronograma`, `journalctl --user -u cronograma -f`.
- node por **nvm**: `/home/nico/.nvm/versions/node/v24.16.0/bin/`.

### ⚠️ Pendiente: hay DOS servicios sirviendo la app
- **Puerto 3000** → `cronogramav2.service` (servicio del **sistema**, preexistente) corre `serve /home/nico/cronogramav2/dist -l 3000`. Sirve un **build viejo** (`dist/` del **2026-05-23**, anterior a la sesión: código viejo + SIN la base nueva).
- **Puerto 5180** → `cronograma.service` (usuario, creado hoy) → dev server actual (commit + base `cronogramav2`).
- **Decisión pendiente:** quedarse con UNO.
  - A) Dev server (:5180) y desactivar el de :3000 (recomendado mientras se desarrolla).
  - B) Build de producción (:3000): recompilar `dist/` con código actual + env de cronogramav2 y desactivar el dev.
  - Desactivar `cronogramav2.service` requiere **sudo** (es servicio del sistema).

---

## 3. El problema original que disparó todo

Al planificar un día (modal "Planificar producción"), aparecían **conflictos que el usuario consideraba falsos**. Caso típico: el proceso **"Coccion y decoracion"** no se podía ubicar.

Datos clave del dominio:
- **Empleados:** Cristofer Faccio (`d0aaa4bf-...`), Romina Maciel (`66cd60eb-...`), Sebastian Teruggi (`4a0ac3e5-...`).
- **"Coccion y decoracion"** (`6f0ec7d1-...`): etapa 1 "Calentar horno" (20 min, máquina Horno) + etapa 2 "Coccion y decoracion" (210 min, máquina Torno). **Restricción `hora_inicio_max = 04:35`** (debe arrancar antes de 04:35). Ambas etapas necesitan empleado; preferido Sebastian, `puede_reemplazarse = true`.
- Otros procesos: Crema, Salado, Amasar dulce, Lavar latas, Cortar dulce x4 masas, Arrollar dulce.
- El scheduler vive en **`src/services/schedulerService.ts`** (función `generarCronograma`, modelo "bloque por bloque": cada plantilla+lote es un bloque indivisible).

---

## 4. Bugs de fondo encontrados y arreglados (quedaron en el commit)

1. **Convención de día de semana desalineada:** el **Módulo de personal** (`ModuloPersonalModal`) guardaba `dia_semana` con **Lunes=0…Domingo=6**, pero el resto de la app (planificador, `DIAS_SEMANA_NOMBRES`, `getDay()`) usa **Domingo=0…Sábado=6**. Resultado: se cargaba el turno del día equivocado.
   - **Fix:** unificar el módulo de personal a Domingo=0 (manteniendo el orden visual con Lunes primero) + **migración de datos** en `empleado_horarios`: `dia_semana = (dia_semana + 1) % 7` (se hizo dropeando/recreando la restricción única).
2. **Empleado sin turno ese día = se trataba como "disponible todo el rango"** → entraba a cualquier hora. **Fix:** sin turno configurado ese día ⇒ **no disponible** (campo `trabajaHoy`).
3. **Orden EDF:** a igual prioridad, los procesos con restricción horaria reservan recursos antes que los flexibles.
4. **Mensajes de conflicto con causa** (ventana/máquina/empleado) + **identificación del bloque "culpable"** (qué proceso ocupa el recurso).
5. UI: el mensaje de conflicto dejó de truncarse.

### Horarios reales (post-migración, convención Domingo=0)
- **Sebastian:** trabaja Lun–Sáb 04:30–14:00; **NO trabaja domingo**.
- **Romina:** Domingo 04:00–12:00; Lun/Mié/Jue/Vie/Sáb 06:00–15:00; **no trabaja martes**.
- **Cristofer:** Domingo 03:30–11:30; Lun/Mar/Mié/Vie/Sáb 06:00–15:00; **no trabaja jueves**.
- Rango por día (`cronograma_rango_horario`): Domingo 03:00–15:00, Lunes 04:30–15:00, Miércoles 04:00–15:00 (el usuario lo fue cambiando).

---

## 5. EL COMMIT DE REFERENCIA

**`83875e9` — "fix(scheduler): respetar horarios reales y unificar convención de días"**
Contiene los puntos de la sección 4. **Es el estado actual del código** (se revirtió todo lo posterior, ver sección 7).

Archivos del commit: `schedulerService.ts`, `PlanificarModal.tsx`, `ModuloPersonalModal.tsx`, `.gitignore`.

---

## 6. La función grande que construimos DESPUÉS del commit (y se REVIRTIÓ)

Se diseñó e implementó un **sistema de resolución asistida de conflictos**. Idea: detectar el conflicto, **generar soluciones simuladas** y dejar que el usuario elija; el sistema replanifica. **Todo esto se descartó al revertir**, pero el diseño quedó claro para rehacerlo:

- **`SchedulerOverrides`** (re-simular con cambios): turnos de empleado, prioridad por plantilla, hora_inicio_min/max, hora_fin_max, excluir plantillas, **asignación fijada (pin)**.
- **`generarSolucionesConflicto`**: genera y simula soluciones: traer empleado (just-in-time, ventana recortada, con pin), combinaciones sobre culpables (dejar/bajar prioridad/sacar del plan), relajar restricciones, sacar el propio proceso. Ranquea y deduplica.
- **`calcularMetricasJornada`**: cierre de jornada, carga y horas fuera de turno por empleado, uso de máquinas, cuello de botella, advertencias.
- **UI `PanelAsistido` / `SolucionRow`**: panel de soluciones con consecuencias, ventana editable, preview en vivo, aplicar; **poda de redundancias**; cascada (recalcular tras aplicar).
- **Cambio de modelo de restricciones:** se quitó el "Override horario" de `plan_dia` y se pasó a editar la config de la plantilla; se renombraron campos (No empezar antes de / Empezar a más tardar / Terminar a más tardar) en `PlantillasTab` + validación dinámica con la duración total + fix de CSS (inputs ilegibles en tarjeta seleccionada).

### Aprendizaje clave (la causa de tanta iteración)
**Tensión conceptual:** el scheduler trabaja por **disponibilidad** (le doy un turno a alguien y reparte tareas libremente), pero el usuario piensa por **asignación** ("esta tarea YA es de tal persona, no se la den a otro"). Por eso, cada vez que recalculaba, **reasignaba** tareas. Se intentó resolver con **pinning (`asignacionForzada`)**, ventana recortada, exclusividad, unión de turnos, etc. — pero quedaron tensiones sin cerrar:
- Si la ventana es recortada y exclusiva → el empleado no hace nada más (recae todo en otro).
- Si se une al turno normal → quedan "turnos fantasma" de 13 h con hueco ocioso.
- **Conclusión:** el modelo de **disponibilidad como UN solo bloque** se queda corto. La solución correcta sería modelar la disponibilidad como **varias franjas separadas** (turno normal + extras traídos), pero es un refactor del corazón del scheduler.

---

## 7. La reversión (estado actual)

El usuario decidió **volver al commit `83875e9`** en vez de seguir parchando.
- `git reset --hard 83875e9` → código exacto del commit, working tree limpio.
- **Base de datos:** se habían **dropeado** las columnas `hora_inicio_min` y `hora_fin_max` de `plan_dia`; se **recrearon** (`integer`, nullable) → **vacías** (los datos viejos se perdieron). Quedó consistente con el código del commit.
- La migración de `empleado_horarios` (Domingo=0) **es parte del commit**, no se tocó.

**Estado actual = commit `83875e9`:** vuelve el formulario con "Override horario (Desde/Hasta)" por producción; **sin** panel asistido ni pinning.

---

## 8. Cosas a tener en cuenta / errores preexistentes

- `npx tsc --noEmit` da **4 errores preexistentes** (NO son de esta sesión) en `src/components/Cronograma/CronogramaEmpleadoPage.tsx` y `src/services/cronogramaService.ts`.
- Aviso de seguridad de Supabase: la tabla `empleado_horarios` tiene **RLS deshabilitado** (expuesta con la anon key). Decisión del usuario si se habilita.
- Archivos sin trackear en el repo (no son del feature): `start.sh`, `sync-to-cloud.sh`, `supabase/config.toml`, `supabase/.gitignore`.

---

## 9. Próximos pasos posibles

1. Resolver el tema de los **dos servicios** (:3000 build viejo vs :5180 dev) — quedarse con uno.
2. Si se retoma la **resolución asistida de conflictos**, hacerlo sobre el modelo de **franjas de disponibilidad múltiples** (no parches sobre el bloque único).
3. Revisar los 4 errores de TypeScript preexistentes.
