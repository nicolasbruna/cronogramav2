import { supabase } from '../config/supabase'
import { CronogramaLinea, CronogramaTarea } from '../types/cronograma'

export interface SnapshotCompleto {
  tareas: CronogramaTarea[]
  lineas: CronogramaLinea[] | null
}

export const cronogramaHistorialService = {
  async registrarAccion(
    diaSemana: number,
    tareas: CronogramaTarea[],
    descripcion: string,
    lineas?: CronogramaLinea[]
  ): Promise<void> {
    const { error } = await supabase.rpc('cronograma_registrar_historial', {
      p_dia_semana: diaSemana,
      p_snapshot: tareas,
      p_descripcion: descripcion,
      p_snapshot_lineas: lineas ?? null
    })
    if (error) console.error('Error registrando historial:', error)
  },

  async deshacer(diaSemana: number): Promise<SnapshotCompleto | null> {
    const { data, error } = await supabase.rpc('cronograma_deshacer', {
      p_dia_semana: diaSemana
    })
    if (error) { console.error('Error deshacer:', error); return null }
    if (!data) return null
    return {
      tareas: (data.tareas ?? data) as CronogramaTarea[],
      lineas: (data.lineas ?? null) as CronogramaLinea[] | null
    } as SnapshotCompleto
  },

  async rehacer(diaSemana: number): Promise<SnapshotCompleto | null> {
    const { data, error } = await supabase.rpc('cronograma_rehacer', {
      p_dia_semana: diaSemana
    })
    if (error) { console.error('Error rehacer:', error); return null }
    if (!data) return null
    return {
      tareas: (data.tareas ?? data) as CronogramaTarea[],
      lineas: (data.lineas ?? null) as CronogramaLinea[] | null
    } as SnapshotCompleto
  },

  async obtenerEstado(diaSemana: number): Promise<{ puedeDeshacer: boolean; puedeRehacer: boolean }> {
    const { data, error } = await supabase.rpc('cronograma_estado_historial', {
      p_dia_semana: diaSemana
    })
    if (error || !data) return { puedeDeshacer: false, puedeRehacer: false }
    return { puedeDeshacer: data.puede_deshacer, puedeRehacer: data.puede_rehacer }
  },

  async restaurarSnapshot(diaSemana: number, snapshot: SnapshotCompleto): Promise<void> {
    const { tareas, lineas } = snapshot

    if (lineas && lineas.length > 0) {
      await supabase
        .from('cronograma_lineas')
        .update({ activa: false })
        .eq('dia_semana', diaSemana)
        .eq('activa', true)

      const lineasParaUpsert = lineas.map(l => ({
        id: l.id,
        empleado_id: l.empleado_id,
        nombre: l.nombre,
        orden: l.orden,
        color: l.color,
        activa: true,
        dia_semana: l.dia_semana
      }))

      const { error: errLineas } = await supabase
        .from('cronograma_lineas')
        .upsert(lineasParaUpsert, { onConflict: 'id' })

      if (errLineas) throw errLineas
    } else if (lineas !== null && lineas !== undefined && lineas.length === 0) {
      await supabase
        .from('cronograma_lineas')
        .update({ activa: false })
        .eq('dia_semana', diaSemana)
        .eq('activa', true)
    }

    await supabase
      .from('cronograma_tareas')
      .update({ eliminada: true })
      .eq('dia_semana', diaSemana)
      .eq('eliminada', false)

    if (tareas.length === 0) return

    const lineasIds = [...new Set(tareas.map(t => t.linea_id))]
    const { data: lineasExistentes } = await supabase
      .from('cronograma_lineas')
      .select('id')
      .in('id', lineasIds)

    const lineasValidas = new Set((lineasExistentes || []).map(l => l.id))
    const tareasValidas = tareas.filter(t => lineasValidas.has(t.linea_id))

    if (tareasValidas.length === 0) return

    const tareasParaUpsert = tareasValidas.map(t => ({
      id: t.id,
      linea_id: t.linea_id,
      dia_semana: t.dia_semana,
      hora_inicio: t.hora_inicio,
      hora_fin: t.hora_fin,
      descripcion: t.descripcion,
      color: t.color,
      bloqueada: t.bloqueada,
      tamano_texto: t.tamano_texto || 'normal',
      orientacion_texto: t.orientacion_texto || 'horizontal',
      orden: t.orden || 0,
      tamano: t.tamano || 5,
      fila: t.fila || 0,
      grupo_id: t.grupo_id || null,
      eliminada: false
    }))

    const { error } = await supabase
      .from('cronograma_tareas')
      .upsert(tareasParaUpsert, { onConflict: 'id' })

    if (error) throw error
  }
}
