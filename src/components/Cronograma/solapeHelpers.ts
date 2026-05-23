import { CronogramaTarea, EmpleadoConLineas } from '../../types/cronograma'
import { ConfiguracionSolape, SolapeModo } from '../../services/configuracionService'
import { timeToMin } from './cronogramaHelpers'

// ¿Se le aplica penalización a esta tarea según el modo?
// - tarea normal (no paralela): se alarga si el modo es 'solapada' o 'ambas'
// - tarea paralela: se alarga si el modo es 'paralela' o 'ambas'
export function decidePenalizar(permiteSolape: boolean, modo: SolapeModo): boolean {
  if (permiteSolape) return modo === 'paralela' || modo === 'ambas'
  return modo === 'solapada' || modo === 'ambas'
}

// Minutos de [aStart,aEnd] que se solapan con la unión de intervalos.
function minutosSolapados(aStart: number, aEnd: number, intervalos: [number, number][]): number {
  let total = 0
  for (const [s, e] of intervalos) {
    const lo = Math.max(aStart, s)
    const hi = Math.min(aEnd, e)
    if (hi > lo) total += hi - lo
  }
  return total
}

export interface CambioSolape {
  id: string
  hora_fin: string
  duracion_base_min: number
}

// Recalcula la duración de cada tarea según su solapamiento con tareas paralelas
// del MISMO empleado. Devuelve solo las tareas cuyo hora_fin o duracion_base_min cambia.
// Determinístico: si una tarea deja de solaparse, vuelve a su duracion_base_min.
export function calcularCambiosSolape(
  tareas: CronogramaTarea[],
  empleados: EmpleadoConLineas[],
  config: ConfiguracionSolape
): CambioSolape[] {
  const minToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  // Mapa línea -> empleadoId
  const lineaEmpleado = new Map<string, string>()
  for (const emp of empleados) for (const l of emp.lineas) lineaEmpleado.set(l.id, emp.id)

  // Agrupar tareas por empleado
  const porEmpleado = new Map<string, CronogramaTarea[]>()
  for (const t of tareas) {
    if (!t.linea_id) continue
    const empId = lineaEmpleado.get(t.linea_id)
    if (!empId) continue
    if (!porEmpleado.has(empId)) porEmpleado.set(empId, [])
    porEmpleado.get(empId)!.push(t)
  }

  const cambios: CambioSolape[] = []

  for (const tareasEmp of porEmpleado.values()) {
    // Intervalos paralelos del empleado (usando la ventana BASE de cada paralela, para evitar feedback)
    const parIntervalos: { id: string; intervalo: [number, number] }[] = []
    for (const t of tareasEmp) {
      if (!t.permite_solape) continue
      const ini = timeToMin(t.hora_inicio)
      const base = t.duracion_base_min ?? (timeToMin(t.hora_fin) - ini)
      parIntervalos.push({ id: t.id, intervalo: [ini, ini + base] })
    }

    for (const t of tareasEmp) {
      if (t.bloqueada) continue
      const ini = timeToMin(t.hora_inicio)
      const finActual = timeToMin(t.hora_fin)
      const base = t.duracion_base_min ?? (finActual - ini)
      if (base <= 0) continue

      const modo: SolapeModo = (t.solape_modo as SolapeModo) || config.modoDefault
      const pct = t.factor_solape_pct ?? config.penalizacionPct

      let extra = 0
      if (decidePenalizar(t.permite_solape, modo)) {
        // Solapamiento con paralelas de OTRAS tareas (no consigo misma)
        const otros = parIntervalos.filter(p => p.id !== t.id).map(p => p.intervalo)
        const solapMin = minutosSolapados(ini, ini + base, otros)
        extra = Math.round((pct / 100) * solapMin)
      }

      const nuevoFin = ini + base + extra
      const baseGuardada = t.duracion_base_min ?? base
      // Solo emitir cambio si difiere lo persistido
      if (nuevoFin !== finActual || t.duracion_base_min !== baseGuardada) {
        cambios.push({ id: t.id, hora_fin: minToTime(nuevoFin), duracion_base_min: baseGuardada })
      }
    }
  }

  return cambios
}
