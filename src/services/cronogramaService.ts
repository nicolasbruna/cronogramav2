import { supabase } from '../config/supabase'
import { generarId } from '../components/Cronograma/cronogramaHelpers'
import {
  CronogramaLinea,
  CronogramaTarea,
  CronogramaVersion,
  CrearCronogramaLineaRequest,
  ActualizarCronogramaLineaRequest,
  CrearCronogramaTareaRequest,
  ActualizarCronogramaTareaRequest,
  EmpleadoConLineas,
  COLORES_EMPLEADOS
} from '../types/cronograma'

// Mapea una tarea (de otro día, versión o snapshot) al objeto insertable COMPLETO, preservando
// todos los campos relevantes (recursos, trazabilidad de scheduler, solape, visual). Centraliza la
// copia para que copiarTareasDesde / cargarVersion / restaurarSnapshot no se desincronicen.
export function mapTareaParaInsert(
  t: CronogramaTarea,
  diaDestino: number,
  lineaId: string | null,
  overrides: Record<string, unknown> = {}
) {
  return {
    linea_id: lineaId,
    dia_semana: diaDestino,
    hora_inicio: t.hora_inicio,
    hora_fin: t.hora_fin,
    descripcion: t.descripcion,
    color: t.color ?? null,
    bloqueada: t.bloqueada ?? false,
    tamano_texto: t.tamano_texto || 'normal',
    orientacion_texto: t.orientacion_texto || 'horizontal',
    orden: t.orden ?? 0,
    tamano: t.tamano ?? 5,
    fila: t.fila ?? 0,
    grupo_id: t.grupo_id ?? null,
    recursos_programados: t.recursos_programados ?? [],
    plantilla_id: t.plantilla_id ?? null,
    es_provisoria: t.es_provisoria ?? false,
    notas_provisoria: t.notas_provisoria ?? null,
    etapa_orden: t.etapa_orden ?? null,
    lote: t.lote ?? null,
    dependencias: t.dependencias ?? [],
    prerequisitos: t.prerequisitos ?? [],
    permite_solape: t.permite_solape ?? false,
    duracion_base_min: t.duracion_base_min ?? null,
    factor_solape_pct: t.factor_solape_pct ?? null,
    solape_modo: t.solape_modo ?? null,
    eliminada: false,
    ...overrides
  }
}

export const cronogramaService = {
  async listarEmpleadosConLineas(diaSemana?: number): Promise<EmpleadoConLineas[]> {
    const { data: empleados, error: empError } = await supabase
      .from('empleados')
      .select('id, nombre_completo')
      .eq('activo', true)
      .order('nombre_completo')

    if (empError) throw empError
    if (!empleados) return []

    let query = supabase
      .from('cronograma_lineas')
      .select('*')
      .eq('activa', true)
      .order('orden')

    if (diaSemana !== undefined) {
      query = query.eq('dia_semana', diaSemana)
    }

    const { data: lineas, error: linError } = await query

    if (linError) throw linError

    return empleados.map((emp, idx) => ({
      id: emp.id,
      nombre_completo: emp.nombre_completo,
      color: COLORES_EMPLEADOS[idx % COLORES_EMPLEADOS.length],
      lineas: (lineas || []).filter(l => l.empleado_id === emp.id)
    }))
  },

  async listarLineas(empleadoId?: string): Promise<CronogramaLinea[]> {
    let query = supabase
      .from('cronograma_lineas')
      .select('*')
      .eq('activa', true)
      .order('orden')

    if (empleadoId) {
      query = query.eq('empleado_id', empleadoId)
    }

    const { data, error } = await query
    if (error) throw error
    return data || []
  },

  async crearLinea(req: CrearCronogramaLineaRequest): Promise<CronogramaLinea> {
    const { data, error } = await supabase
      .from('cronograma_lineas')
      .insert(req)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Crea una línea para un empleado en un día si no existe ya.
  // Usado al aplicar el scheduler (silencioso).
  async asegurarLineaExiste(empleadoId: string, diaSemana: number): Promise<string> {
    const { data: existente } = await supabase
      .from('cronograma_lineas')
      .select('id')
      .eq('empleado_id', empleadoId)
      .eq('dia_semana', diaSemana)
      .eq('activa', true)
      .limit(1)
      .maybeSingle()

    if (existente) return existente.id

    // Obtener nombre del empleado para la línea
    const { data: emp } = await supabase
      .from('empleados')
      .select('nombre_completo')
      .eq('id', empleadoId)
      .single()

    const maxOrden = await supabase
      .from('cronograma_lineas')
      .select('orden')
      .eq('dia_semana', diaSemana)
      .order('orden', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: nueva, error } = await supabase
      .from('cronograma_lineas')
      .insert({
        empleado_id: empleadoId,
        nombre: emp?.nombre_completo ?? 'Sin nombre',
        dia_semana: diaSemana,
        orden: (maxOrden.data?.orden ?? 0) + 1,
        activa: true
      })
      .select('id')
      .single()

    if (error) throw error
    return nueva.id
  },

  // Asegura una segunda línea "paralela" para tareas que pueden solaparse.
  async asegurarLineaParalela(empleadoId: string, diaSemana: number): Promise<string> {
    const { data: emp } = await supabase
      .from('empleados')
      .select('nombre_completo')
      .eq('id', empleadoId)
      .single()
    const nombreParalela = `${emp?.nombre_completo ?? 'Sin nombre'} · paralelo`

    const { data: existente } = await supabase
      .from('cronograma_lineas')
      .select('id')
      .eq('empleado_id', empleadoId)
      .eq('dia_semana', diaSemana)
      .eq('activa', true)
      .eq('nombre', nombreParalela)
      .limit(1)
      .maybeSingle()

    if (existente) return existente.id

    const maxOrden = await supabase
      .from('cronograma_lineas')
      .select('orden')
      .eq('dia_semana', diaSemana)
      .order('orden', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: nueva, error } = await supabase
      .from('cronograma_lineas')
      .insert({
        empleado_id: empleadoId,
        nombre: nombreParalela,
        dia_semana: diaSemana,
        orden: (maxOrden.data?.orden ?? 0) + 1,
        activa: true
      })
      .select('id')
      .single()

    if (error) throw error
    return nueva.id
  },

  async actualizarLinea(id: string, req: ActualizarCronogramaLineaRequest): Promise<CronogramaLinea> {
    const { data, error } = await supabase
      .from('cronograma_lineas')
      .update(req)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  async eliminarLinea(id: string): Promise<void> {
    const { error: errLinea } = await supabase
      .from('cronograma_lineas')
      .update({ activa: false })
      .eq('id', id)

    if (errLinea) throw errLinea

    const { error: errTareas } = await supabase
      .from('cronograma_tareas')
      .update({ eliminada: true })
      .eq('linea_id', id)

    if (errTareas) throw errTareas
  },

  async reordenarLineas(ordenadas: { id: string; orden: number }[]): Promise<void> {
    const promises = ordenadas.map(({ id, orden }) =>
      supabase.from('cronograma_lineas').update({ orden }).eq('id', id)
    )
    await Promise.all(promises)
  },

  async listarTareas(diaSemana: number): Promise<CronogramaTarea[]> {
    const { data, error } = await supabase
      .from('cronograma_tareas')
      .select('*')
      .eq('dia_semana', diaSemana)
      .eq('eliminada', false)
      .order('hora_inicio')

    if (error) throw error
    return data || []
  },

  async crearTarea(req: CrearCronogramaTareaRequest): Promise<CronogramaTarea> {
    const { data, error } = await supabase
      .from('cronograma_tareas')
      .insert(req)
      .select()
      .single()

    if (error) throw error
    return data
  },

  async actualizarTarea(id: string, req: ActualizarCronogramaTareaRequest): Promise<CronogramaTarea> {
    const { data, error } = await supabase
      .from('cronograma_tareas')
      .update({ ...req, fecha_actualizacion: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  async eliminarTarea(id: string): Promise<void> {
    const { error } = await supabase
      .from('cronograma_tareas')
      .update({ eliminada: true })
      .eq('id', id)

    if (error) throw error
  },

  async copiarTareasDesde(diaOrigen: number, diaDestino: number): Promise<number> {
    const [tareasRes, lineasOrigenRes, lineasDestinoRes] = await Promise.all([
      supabase.from('cronograma_tareas').select('*').eq('dia_semana', diaOrigen).eq('eliminada', false),
      supabase.from('cronograma_lineas').select('*').eq('dia_semana', diaOrigen).eq('activa', true),
      supabase.from('cronograma_lineas').select('*').eq('dia_semana', diaDestino).eq('activa', true)
    ])

    if (tareasRes.error) throw tareasRes.error
    if (lineasOrigenRes.error) throw lineasOrigenRes.error
    if (lineasDestinoRes.error) throw lineasDestinoRes.error

    const tareasOrigen = tareasRes.data
    const lineasOrigen = lineasOrigenRes.data || []
    let lineasDestino = lineasDestinoRes.data || []

    if (!tareasOrigen || tareasOrigen.length === 0) return 0

    const lineasFaltantes = lineasOrigen.filter(lo =>
      !lineasDestino.some(ld => ld.empleado_id === lo.empleado_id && ld.nombre === lo.nombre)
    )

    if (lineasFaltantes.length > 0) {
      const nuevasLineas = lineasFaltantes.map(l => ({
        empleado_id: l.empleado_id,
        nombre: l.nombre,
        orden: l.orden,
        color: l.color,
        activa: true,
        dia_semana: diaDestino
      }))
      const { data: created, error: createErr } = await supabase
        .from('cronograma_lineas')
        .insert(nuevasLineas)
        .select('*')
      if (createErr) throw createErr
      if (created) lineasDestino = [...lineasDestino, ...created]
    }

    const lineaMap: Record<string, string> = {}
    for (const lo of lineasOrigen) {
      const match = lineasDestino.find(ld => ld.empleado_id === lo.empleado_id && ld.nombre === lo.nombre)
        || lineasDestino.find(ld => ld.empleado_id === lo.empleado_id && ld.orden === lo.orden)
        || lineasDestino.find(ld => ld.empleado_id === lo.empleado_id)
      if (match) lineaMap[lo.id] = match.id
    }

    const nuevasTareas = tareasOrigen
      .filter(t => t.linea_id != null && lineaMap[t.linea_id])
      .map(t => mapTareaParaInsert(t, diaDestino, lineaMap[t.linea_id!], { bloqueada: false }))

    if (nuevasTareas.length === 0) return 0

    const { error: insertError } = await supabase
      .from('cronograma_tareas')
      .insert(nuevasTareas)

    if (insertError) throw insertError
    return nuevasTareas.length
  },

  async guardarVersion(diaSemana: number, nombre: string, notas: string, creadoPor: string): Promise<void> {
    const [tareasRes, lineasRes] = await Promise.all([
      supabase.from('cronograma_tareas').select('*').eq('dia_semana', diaSemana).eq('eliminada', false),
      supabase.from('cronograma_lineas').select('*').eq('dia_semana', diaSemana).eq('activa', true)
    ])
    if (tareasRes.error) throw tareasRes.error
    if (lineasRes.error) throw lineasRes.error

    const { error } = await supabase.from('cronograma_versiones').insert({
      nombre,
      dia_semana: diaSemana,
      snapshot_tareas: tareasRes.data || [],
      snapshot_lineas: lineasRes.data || [],
      creado_por: creadoPor,
      notas
    })
    if (error) throw error
  },

  async listarVersiones(diaSemana?: number): Promise<CronogramaVersion[]> {
    let query = supabase.from('cronograma_versiones')
      .select('*')
      .is('eliminado_en', null)
      .order('fecha_creacion', { ascending: false })

    if (diaSemana !== undefined) {
      query = query.eq('dia_semana', diaSemana)
    }

    const { data, error } = await query
    if (error) throw error
    return data || []
  },

  async cargarVersion(versionId: string, diaDestino: number): Promise<void> {
    const { data: version, error } = await supabase
      .from('cronograma_versiones')
      .select('*')
      .eq('id', versionId)
      .maybeSingle()

    if (error) throw error
    if (!version) throw new Error('Version no encontrada')

    const lineasSnapshot = version.snapshot_lineas as CronogramaLinea[]
    const tareasSnapshot = version.snapshot_tareas as CronogramaTarea[]

    await supabase.from('cronograma_tareas').update({ eliminada: true }).eq('dia_semana', diaDestino).eq('eliminada', false)
    await supabase.from('cronograma_lineas').update({ activa: false }).eq('dia_semana', diaDestino).eq('activa', true)

    const lineaIdMap: Record<string, string> = {}

    if (lineasSnapshot.length > 0) {
      const lineas = lineasSnapshot.map(l => ({
        empleado_id: l.empleado_id,
        nombre: l.nombre,
        orden: l.orden,
        color: l.color,
        activa: l.activa,
        dia_semana: diaDestino
      }))
      const { data: insertedLineas, error: errLineas } = await supabase
        .from('cronograma_lineas')
        .insert(lineas)
        .select('id')
      if (errLineas) throw errLineas

      if (insertedLineas) {
        lineasSnapshot.forEach((original, idx) => {
          lineaIdMap[original.id] = insertedLineas[idx].id
        })
      }
    }

    if (tareasSnapshot.length > 0) {
      const tareas = tareasSnapshot
        .filter(t => t.linea_id != null && lineaIdMap[t.linea_id])
        .map(t => mapTareaParaInsert(t, diaDestino, lineaIdMap[t.linea_id!]))
      if (tareas.length > 0) {
        const { error: errTareas } = await supabase.from('cronograma_tareas').insert(tareas)
        if (errTareas) throw errTareas
      }
    }
  },

  async eliminarVersion(versionId: string): Promise<void> {
    const { error } = await supabase
      .from('cronograma_versiones')
      .update({ eliminado_en: new Date().toISOString() })
      .eq('id', versionId)
    if (error) throw error
  },

  async listarVersionesEliminadas(): Promise<CronogramaVersion[]> {
    const { data, error } = await supabase
      .from('cronograma_versiones')
      .select('*')
      .not('eliminado_en', 'is', null)
      .order('eliminado_en', { ascending: false })
    if (error) throw error
    return data || []
  },

  async restaurarVersion(versionId: string): Promise<void> {
    const { error } = await supabase
      .from('cronograma_versiones')
      .update({ eliminado_en: null })
      .eq('id', versionId)
    if (error) throw error
  },

  async eliminarVersionPermanente(versionId: string): Promise<void> {
    const { error } = await supabase
      .from('cronograma_versiones')
      .delete()
      .eq('id', versionId)
    if (error) throw error
  },

  async eliminarCronogramaCompleto(diaSemana: number, creadoPor: string): Promise<void> {
    const [tareasRes, lineasRes] = await Promise.all([
      supabase.from('cronograma_tareas').select('*').eq('dia_semana', diaSemana).eq('eliminada', false),
      supabase.from('cronograma_lineas').select('*').eq('dia_semana', diaSemana).eq('activa', true)
    ])
    if (tareasRes.error) throw tareasRes.error
    if (lineasRes.error) throw lineasRes.error

    if ((tareasRes.data?.length || 0) > 0) {
      const { error: backupErr } = await supabase.from('cronograma_versiones').insert({
        nombre: `Backup auto - día ${diaSemana}`,
        dia_semana: diaSemana,
        snapshot_tareas: tareasRes.data || [],
        snapshot_lineas: lineasRes.data || [],
        creado_por: creadoPor,
        notas: 'Backup automático antes de vaciar cronograma',
        es_backup_auto: true,
        eliminado_en: new Date().toISOString()
      })
      if (backupErr) throw backupErr
    }

    // Solo elimina las TAREAS — las líneas (estructura del equipo) se conservan
    // para que el planificador automático pueda seguir funcionando
    await supabase.from('cronograma_tareas').update({ eliminada: true }).eq('dia_semana', diaSemana).eq('eliminada', false)
  },

  async agruparTareas(tareaIds: string[]): Promise<string> {
    const grupoId = generarId()
    const { error } = await supabase
      .from('cronograma_tareas')
      .update({ grupo_id: grupoId })
      .in('id', tareaIds)
    if (error) throw error
    return grupoId
  },

  async desagruparTareas(grupoId: string): Promise<void> {
    const { error } = await supabase
      .from('cronograma_tareas')
      .update({ grupo_id: null })
      .eq('grupo_id', grupoId)
    if (error) throw error
  },

  async obtenerRangoHorario(diaSemana: number): Promise<{ hora_inicio: string; hora_fin: string } | null> {
    const { data, error } = await supabase
      .from('cronograma_rango_horario')
      .select('hora_inicio, hora_fin')
      .eq('dia_semana', diaSemana)
      .maybeSingle()
    if (error) throw error
    return data
  },

  async guardarRangoHorario(diaSemana: number, horaInicio: string, horaFin: string): Promise<void> {
    const { error } = await supabase
      .from('cronograma_rango_horario')
      .upsert({
        dia_semana: diaSemana,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        updated_at: new Date().toISOString()
      }, { onConflict: 'dia_semana' })
    if (error) throw error
  }
}
