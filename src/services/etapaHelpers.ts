import { PlantillaEtapa, VentanaEmpleado, RecursoEtapa, EmpleadoEtapaSlot } from '../types/planificacion'

// Convierte el modelo legacy (tiempo_empleado_inicio/fin, bloquea_empleado_total)
// a ventanas de empleado explícitas (minutos relativos al inicio del proceso).
export function convertirLegacyAVentanas(
  etapa: Pick<PlantillaEtapa, 'bloquea_empleado_total' | 'tiempo_empleado_inicio' | 'tiempo_empleado_fin' | 'duracion_proceso'>
): VentanaEmpleado[] {
  if (etapa.bloquea_empleado_total) return [{ desde: 0, hasta: etapa.duracion_proceso }]
  const w: VentanaEmpleado[] = []
  if (etapa.tiempo_empleado_inicio > 0) w.push({ desde: 0, hasta: etapa.tiempo_empleado_inicio })
  if (etapa.tiempo_empleado_fin > 0) w.push({ desde: etapa.duracion_proceso - etapa.tiempo_empleado_fin, hasta: etapa.duracion_proceso })
  return w
}

// Ventanas de empleado de la etapa (modelo nuevo si existe, sino legacy).
export function ventanasDeEtapa(etapa: PlantillaEtapa): VentanaEmpleado[] {
  return etapa.ventanas_empleado?.length > 0 ? etapa.ventanas_empleado : convertirLegacyAVentanas(etapa)
}

// Recursos (máquinas) de la etapa, normalizados al modelo nuevo.
// Si no hay recursos múltiples, cae al recurso legacy (maquina_id + uso_recurso) abarcando todo el proceso.
export function recursosDeEtapa(etapa: PlantillaEtapa): RecursoEtapa[] {
  if (etapa.recursos?.length > 0) return etapa.recursos
  if (etapa.maquina_id) {
    return [{ maquina_id: etapa.maquina_id, uso_recurso: etapa.uso_recurso || 1, desde: 0, hasta: etapa.duracion_proceso }]
  }
  return []
}

// Slots de empleado de la etapa, normalizados.
// La UI guarda el PRINCIPAL en los campos legacy (ventanas_empleado + empleado_preferido_id)
// y `empleados_etapa` contiene SOLO los ayudantes. Por eso el principal se arma siempre desde
// los campos legacy y se le suman los ayudantes, salvo que empleados_etapa ya traiga un principal.
// `preferenciaProceso` es el empleado preferido a nivel proceso (resuelto desde la plantilla y el
// override del día). Jerarquía para el slot principal: una etapa con preferido propio NO reemplazable
// manda; si no, gana el preferido del proceso (si hay); si no, el de la etapa.
export function slotsDeEtapa(
  etapa: PlantillaEtapa,
  preferenciaProceso?: { empleadoId: string | null; puedeReemplazarse: boolean } | null
): EmpleadoEtapaSlot[] {
  const extra = etapa.empleados_etapa ?? []
  if (extra.some(s => s.rol === 'principal')) return extra

  const slots: EmpleadoEtapaSlot[] = []
  const ventanasPrincipal = ventanasDeEtapa(etapa)
  if (ventanasPrincipal.length > 0) {
    const etapaPref = etapa.empleado_preferido_id ?? null
    const etapaNoReemplazable = etapaPref != null && etapa.puede_reemplazarse === false
    let prefId: string | null
    let puedeReemp: boolean
    if (etapaNoReemplazable) {
      prefId = etapaPref
      puedeReemp = false
    } else if (preferenciaProceso?.empleadoId) {
      prefId = preferenciaProceso.empleadoId
      puedeReemp = preferenciaProceso.puedeReemplazarse
    } else {
      prefId = etapaPref
      puedeReemp = etapa.puede_reemplazarse ?? true
    }
    slots.push({
      id: 'principal',
      rol: 'principal',
      ventanas: ventanasPrincipal,
      habilidad_id: etapa.habilidad_id ?? null,
      empleado_preferido_id: prefId,
      puede_reemplazarse: puedeReemp
    })
  }
  return [...slots, ...extra]
}
