import { supabase } from '../config/supabase'
import {
  Maquina, Habilidad, PlantillaProceso, PlantillaEtapa,
  GrupoRecurso, CrearGrupoRecursoRequest,
  CrearMaquinaRequest, CrearHabilidadRequest, CrearPlantillaRequest,
  CrearEtapaRequest, EmpleadoHorario, PlanDiaItem, CrearPlanDiaRequest
} from '../types/planificacion'
import { EmpleadoScheduler, FranjaDisponibilidad } from '../types/scheduler'
import { timeToMin } from '../components/Cronograma/cronogramaHelpers'

export const planificacionService = {

  // ==================== GRUPOS DE RECURSOS ====================

  async listarGruposRecursos(): Promise<GrupoRecurso[]> {
    const { data, error } = await supabase
      .from('grupos_recursos')
      .select('*')
      .order('nombre')
    if (error) throw error
    return data || []
  },

  async crearGrupoRecurso(req: CrearGrupoRecursoRequest): Promise<GrupoRecurso> {
    const { data, error } = await supabase
      .from('grupos_recursos')
      .insert(req)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async actualizarGrupoRecurso(id: string, req: Partial<CrearGrupoRecursoRequest>): Promise<void> {
    const { error } = await supabase
      .from('grupos_recursos')
      .update(req)
      .eq('id', id)
    if (error) throw error
  },

  async eliminarGrupoRecurso(id: string): Promise<void> {
    // Primero desasociar las máquinas del grupo
    await supabase.from('maquinas').update({ grupo_id: null }).eq('grupo_id', id)
    const { error } = await supabase.from('grupos_recursos').delete().eq('id', id)
    if (error) throw error
  },

  // ==================== MÁQUINAS ====================

  async listarMaquinas(): Promise<Maquina[]> {
    const { data, error } = await supabase
      .from('maquinas')
      .select('*, grupo:grupos_recursos(*)')
      .order('nombre')
    if (error) throw error
    return (data || []).map(m => ({ ...m, prioridad_grupo: m.prioridad_grupo ?? 1 }))
  },

  async crearMaquina(req: CrearMaquinaRequest): Promise<Maquina> {
    const { data, error } = await supabase
      .from('maquinas')
      .insert({ ...req, prioridad_grupo: req.prioridad_grupo ?? 1 })
      .select('*, grupo:grupos_recursos(*)')
      .single()
    if (error) throw error
    return { ...data, prioridad_grupo: data.prioridad_grupo ?? 1 }
  },

  async actualizarMaquina(id: string, req: Partial<CrearMaquinaRequest> & { activa?: boolean }): Promise<void> {
    const { error } = await supabase
      .from('maquinas')
      .update(req)
      .eq('id', id)
    if (error) throw error
  },

  async eliminarMaquina(id: string): Promise<void> {
    const { error } = await supabase
      .from('maquinas')
      .delete()
      .eq('id', id)
    if (error) throw error
  },

  // ==================== HABILIDADES ====================

  async listarHabilidades(): Promise<Habilidad[]> {
    const { data, error } = await supabase
      .from('habilidades')
      .select('*')
      .order('nombre')
    if (error) throw error
    return data || []
  },

  async crearHabilidad(req: CrearHabilidadRequest): Promise<Habilidad> {
    const { data, error } = await supabase
      .from('habilidades')
      .insert(req)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async actualizarHabilidad(id: string, req: Partial<CrearHabilidadRequest>): Promise<void> {
    const { error } = await supabase
      .from('habilidades')
      .update(req)
      .eq('id', id)
    if (error) throw error
  },

  async eliminarHabilidad(id: string): Promise<void> {
    const { error } = await supabase
      .from('habilidades')
      .delete()
      .eq('id', id)
    if (error) throw error
  },

  // ==================== HABILIDADES DE EMPLEADOS ====================

  async listarHabilidadesEmpleado(empleadoId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('empleado_habilidades')
      .select('habilidad_id')
      .eq('empleado_id', empleadoId)
    if (error) throw error
    return (data || []).map(r => r.habilidad_id)
  },

  async asignarHabilidadesEmpleado(empleadoId: string, habilidadIds: string[]): Promise<void> {
    await supabase.from('empleado_habilidades').delete().eq('empleado_id', empleadoId)
    if (habilidadIds.length === 0) return
    const rows = habilidadIds.map(hid => ({ empleado_id: empleadoId, habilidad_id: hid }))
    const { error } = await supabase.from('empleado_habilidades').insert(rows)
    if (error) throw error
  },

  // ==================== PLANTILLAS ====================

  async listarPlantillas(): Promise<PlantillaProceso[]> {
    const { data, error } = await supabase
      .from('plantillas_proceso')
      .select('*')
      .order('nombre')
    if (error) throw error
    return data || []
  },

  async crearPlantilla(req: CrearPlantillaRequest): Promise<PlantillaProceso> {
    const { data, error } = await supabase
      .from('plantillas_proceso')
      .insert(req)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async actualizarPlantilla(id: string, req: Partial<CrearPlantillaRequest> & { activa?: boolean }): Promise<void> {
    const { error } = await supabase
      .from('plantillas_proceso')
      .update(req)
      .eq('id', id)
    if (error) throw error
  },

  async eliminarPlantilla(id: string): Promise<void> {
    const { error } = await supabase
      .from('plantillas_proceso')
      .delete()
      .eq('id', id)
    if (error) throw error
  },

  // ==================== ETAPAS ====================

  async listarEtapasPorPlantilla(plantillaId: string): Promise<PlantillaEtapa[]> {
    const { data, error } = await supabase
      .from('plantilla_etapas')
      .select('*, maquina:maquinas(*), habilidad:habilidades(*), empleado_preferido:empleados(id, nombre_completo)')
      .eq('plantilla_id', plantillaId)
      .order('orden')
    if (error) throw error
    return data || []
  },

  async crearEtapa(req: CrearEtapaRequest): Promise<PlantillaEtapa> {
    const { data, error } = await supabase
      .from('plantilla_etapas')
      .insert(req)
      .select('*, maquina:maquinas(*), habilidad:habilidades(*), empleado_preferido:empleados(id, nombre_completo)')
      .single()
    if (error) throw error
    return data
  },

  async actualizarEtapa(id: string, req: Partial<CrearEtapaRequest>): Promise<void> {
    const { error } = await supabase
      .from('plantilla_etapas')
      .update(req)
      .eq('id', id)
    if (error) throw error
  },

  async eliminarEtapa(id: string): Promise<void> {
    const { error } = await supabase
      .from('plantilla_etapas')
      .delete()
      .eq('id', id)
    if (error) throw error
  },

  async reordenarEtapas(ordenadas: { id: string; orden: number }[]): Promise<void> {
    await Promise.all(
      ordenadas.map(({ id, orden }) =>
        supabase.from('plantilla_etapas').update({ orden }).eq('id', id)
      )
    )
  },

  // ==================== HORARIOS DE EMPLEADOS ====================

  async listarHorariosEmpleado(empleadoId: string): Promise<EmpleadoHorario[]> {
    const { data, error } = await supabase
      .from('empleado_horarios')
      .select('*')
      .eq('empleado_id', empleadoId)
      .order('dia_semana')
    if (error) throw error
    return data || []
  },

  async listarTodosHorariosEmpleados(): Promise<EmpleadoHorario[]> {
    const { data, error } = await supabase
      .from('empleado_horarios')
      .select('*')
    if (error) throw error
    return data || []
  },

  async guardarHorariosEmpleado(
    empleadoId: string,
    horarios: { dia_semana: number; hora_inicio: string; hora_fin: string }[]
  ): Promise<void> {
    await supabase.from('empleado_horarios').delete().eq('empleado_id', empleadoId)
    if (horarios.length === 0) return
    const rows = horarios.map(h => ({ empleado_id: empleadoId, ...h }))
    const { error } = await supabase.from('empleado_horarios').insert(rows)
    if (error) throw error
  },

  // Empleados activos con sus habilidades (para UI de plantillas y módulo personal)
  async listarEmpleadosConHabilidades(): Promise<{ id: string; nombre_completo: string; habilidades: string[] }[]> {
    const { data: empleados, error: ee } = await supabase
      .from('empleados')
      .select('id, nombre_completo')
      .eq('activo', true)
      .order('nombre_completo')
    if (ee) throw ee

    const { data: habs, error: he } = await supabase
      .from('empleado_habilidades')
      .select('empleado_id, habilidad_id')
    if (he) throw he

    return (empleados || []).map(emp => ({
      id: emp.id,
      nombre_completo: emp.nombre_completo,
      habilidades: (habs || [])
        .filter(h => h.empleado_id === emp.id)
        .map(h => h.habilidad_id)
    }))
  },

  // ==================== PLAN DEL DÍA (cola de producción) ====================

  async listarPlanDia(diaSemana: number): Promise<PlanDiaItem[]> {
    const { data, error } = await supabase
      .from('plan_dia')
      .select('*, plantilla:plantillas_proceso(*)')
      .eq('dia_semana', diaSemana)
      .eq('activo', true)
      .order('prioridad', { ascending: false })
    if (error) throw error
    return data || []
  },

  async crearPlanDiaItem(req: CrearPlanDiaRequest): Promise<PlanDiaItem> {
    const { data, error } = await supabase
      .from('plan_dia')
      .insert(req)
      .select('*, plantilla:plantillas_proceso(*)')
      .single()
    if (error) throw error
    return data
  },

  async actualizarPlanDiaItem(id: string, req: Partial<Pick<PlanDiaItem, 'cantidad_lotes' | 'prioridad' | 'activo' | 'hora_inicio_min' | 'hora_inicio_max' | 'hora_fin_max'>>): Promise<void> {
    const { error } = await supabase
      .from('plan_dia')
      .update(req)
      .eq('id', id)
    if (error) throw error
  },

  async eliminarPlanDiaItem(id: string): Promise<void> {
    const { error } = await supabase
      .from('plan_dia')
      .delete()
      .eq('id', id)
    if (error) throw error
  },

  // ==================== LOADERS PARA EL SCHEDULER ====================

  // Plantillas activas con sus etapas pobladas (para el generador).
  async listarPlantillasConEtapas(): Promise<PlantillaProceso[]> {
    const { data: plantillas, error: pe } = await supabase
      .from('plantillas_proceso')
      .select('*')
      .eq('activa', true)
      .order('nombre')
    if (pe) throw pe

    const { data: etapas, error: ee } = await supabase
      .from('plantilla_etapas')
      .select('*, maquina:maquinas(*), habilidad:habilidades(*)')
      .order('orden')
    if (ee) throw ee

    return (plantillas || []).map(p => ({
      ...p,
      etapas: (etapas || []).filter(e => e.plantilla_id === p.id)
    }))
  },

  // Empleados activos como EmpleadoScheduler: habilidades + FRANJAS del día.
  // Cada fila de empleado_horarios del día es una franja independiente (no se fusionan).
  async listarEmpleadosParaScheduler(diaSemana: number): Promise<EmpleadoScheduler[]> {
    const { data: empleados, error: ee } = await supabase
      .from('empleados')
      .select('id, nombre_completo')
      .eq('activo', true)
      .order('nombre_completo')
    if (ee) throw ee

    const { data: habs, error: he } = await supabase
      .from('empleado_habilidades')
      .select('empleado_id, habilidad_id')
    if (he) throw he

    const { data: horarios, error: ho } = await supabase
      .from('empleado_horarios')
      .select('empleado_id, hora_inicio, hora_fin')
      .eq('dia_semana', diaSemana)
    if (ho) throw ho

    return (empleados || []).map(emp => {
      const franjas: FranjaDisponibilidad[] = (horarios || [])
        .filter(h => h.empleado_id === emp.id)
        .flatMap(h => {
          const desde = timeToMin(h.hora_inicio)
          const hasta = timeToMin(h.hora_fin)
          // Turno que cruza medianoche (ej. 22:00→06:00): partir en [desde,1440] y [0,hasta].
          if (hasta <= desde) {
            return [
              { desde, hasta: 1440, origen: 'turno' as const, etiqueta: 'Turno' },
              { desde: 0, hasta, origen: 'turno' as const, etiqueta: 'Turno' }
            ]
          }
          return [{ desde, hasta, origen: 'turno' as const, etiqueta: 'Turno' }]
        })
        .sort((a, b) => a.desde - b.desde)
      return {
        id: emp.id,
        nombre_completo: emp.nombre_completo,
        habilidades: new Set((habs || []).filter(h => h.empleado_id === emp.id).map(h => h.habilidad_id)),
        franjas
      }
    })
  }
}
