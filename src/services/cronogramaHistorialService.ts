import { supabase } from '../config/supabase'
import { CronogramaLinea, CronogramaTarea } from '../types/cronograma'
import { mapTareaParaInsert } from './cronogramaService'

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

    const lineasIds = [...new Set(tareas.map(t => t.linea_id).filter((id): id is string => id != null))]
    const { data: lineasExistentes } = await supabase
      .from('cronograma_lineas')
      .select('id')
      .in('id', lineasIds)

    const lineasValidas = new Set((lineasExistentes || []).map(l => l.id))
    // Conservar tareas autónomas (linea_id null = procesos sin empleado) y las que apuntan a una línea
    // que aún existe. NO descartar las autónomas: si no, un snapshot solo de procesos borraría todo.
    const tareasValidas = tareas.filter(t => t.linea_id == null || lineasValidas.has(t.linea_id))

    if (tareasValidas.length === 0) return

    // Preserva id (upsert) y todos los campos (recursos, trazabilidad, solape) vía el helper común.
    const tareasParaUpsert = tareasValidas.map(t =>
      mapTareaParaInsert(t, t.dia_semana, t.linea_id, { id: t.id })
    )

    const { error } = await supabase
      .from('cronograma_tareas')
      .upsert(tareasParaUpsert, { onConflict: 'id' })

    if (error) throw error
  }
}
