// Editor Manual del día — vista enriquecida del scheduler.
//
// El scheduler sigue siendo el motor: el usuario solo construye SchedulerOverrides
// (PIN de empleado, PIN de hora, franjas extra, sustituir máquina, relajar, prioridad,
// exclusiones). Cada cambio re-corre generarCronograma() y la pantalla se actualiza.
// Al aplicar, se pasa por aplicarResultado() — flujo oficial con backup automático.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { ArrowLeft, CalendarClock, Loader2, AlertTriangle, CheckCircle2, X, Edit3, Plus } from 'lucide-react'
import {
  generarParaDia, generarCronograma, aplicarResultado,
  fusionarOverrides, GeneracionPreparada
} from '../../services/schedulerService'
import { SchedulerOverrides, ResultadoScheduler, InstanciaEtapa } from '../../types/scheduler'
import { DIAS_SEMANA_NOMBRES } from '../../types/cronograma'
import { minToTime, formatDuration } from '../Cronograma/cronogramaHelpers'

interface Props {
  diaActual: number
  onVolver: () => void
}

// Tipo discriminado para mostrar overrides en el panel lateral.
type OverrideItem =
  | { tipo: 'empleado'; key: string; plantillaId: string; lote: number; etapaOrden: number; empleadoId: string }
  | { tipo: 'hora'; key: string; plantillaId: string; lote: number; etapaOrden: number; inicioMin: number }
  | { tipo: 'franja'; key: string; empleadoId: string; desde: number; hasta: number }
  | { tipo: 'sustituir'; key: string; etapaId: string }
  | { tipo: 'relajar-inicio'; key: string; plantillaId: string }
  | { tipo: 'relajar-tope'; key: string; plantillaId: string }
  | { tipo: 'prioridad'; key: string; plantillaId: string; prioridad: number }
  | { tipo: 'excluir'; key: string; plantillaId: string }

// hh:mm → minutos del día.
function hhmm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10)
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null
  return h * 60 + mi
}
const mm = (m: number) => minToTime(m).slice(0, 5)

export function EditorManualPage({ diaActual, onVolver }: Props) {
  const [loading, setLoading] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [preparada, setPreparada] = useState<GeneracionPreparada | null>(null)
  const [overridesEditor, setOverridesEditor] = useState<SchedulerOverrides>({})

  // Estado UI para los menús de edición por fila.
  const [filaAbierta, setFilaAbierta] = useState<string | null>(null)
  const [accionAbierta, setAccionAbierta] = useState<'empleado' | 'hora' | 'sustituir' | 'relajar' | 'prioridad' | 'excluir' | null>(null)
  const [inputTmp, setInputTmp] = useState<string>('')

  // Estado para "Agregar franja extra".
  const [franjaEmp, setFranjaEmp] = useState('')
  const [franjaDesde, setFranjaDesde] = useState('')
  const [franjaHasta, setFranjaHasta] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const prep = await generarParaDia(diaActual)
      setPreparada(prep)
      setOverridesEditor({})
    } catch (err) {
      console.error('Error cargando editor manual:', err)
      alert('Error cargando el contexto del día')
    } finally {
      setLoading(false)
    }
  }, [diaActual])

  useEffect(() => { cargar() }, [cargar])

  // Re-correr el scheduler con los overrides actuales en cada cambio. Determinístico y barato.
  const resultado: ResultadoScheduler | null = useMemo(() => {
    if (!preparada) return null
    return generarCronograma(preparada.ctx, overridesEditor)
  }, [preparada, overridesEditor])

  // Instancias ordenadas por proceso > orden > lote para la tabla.
  const instanciasOrden = useMemo(() => {
    if (!resultado) return []
    return [...resultado.instancias].sort((a, b) =>
      a.plantillaNombre.localeCompare(b.plantillaNombre, 'es') ||
      a.etapa.orden - b.etapa.orden ||
      a.lote - b.lote
    )
  }, [resultado])

  // Métricas resumidas.
  const resumen = useMemo(() => {
    if (!resultado) return { colocadas: 0, conflictos: 0, cierre: null as number | null, fueraTurno: 0 }
    const colocadas = resultado.instancias.filter(i => i.estado === 'colocada').length
    const conflictos = resultado.conflictos.filter(c => !c.cascada).length
    const fueraTurno = (() => {
      // Aproximación: minutos de asignaciones que caen en franja extra.
      let s = 0
      for (const inst of resultado.instancias) {
        for (const a of inst.asignaciones) if (a.enFranjaExtra) {
          for (const iv of a.ventanasAbs) s += Math.max(0, iv.fin - iv.inicio)
        }
      }
      return s
    })()
    return { colocadas, conflictos, cierre: resultado.cierreJornada, fueraTurno }
  }, [resultado])

  // Empleados del contexto (con nombres legibles).
  const empleados = useMemo(() => preparada?.ctx.empleados.map(e => ({ id: e.id, nombre: e.nombre_completo })) ?? [], [preparada])
  const nombreEmp = (id: string | null | undefined) => empleados.find(e => e.id === id)?.nombre ?? '—'

  // Plantillas (con nombre).
  const nombrePlantilla = (id: string) => preparada?.ctx.plantillasConEtapas.find(p => p.id === id)?.nombre ?? id

  // Construir la lista de overrides activos para el panel lateral.
  const overridesActivos: OverrideItem[] = useMemo(() => {
    const items: OverrideItem[] = []
    for (const a of overridesEditor.asignacionFijada ?? []) {
      items.push({ tipo: 'empleado', key: `e:${a.plantillaId}:${a.lote}:${a.etapaOrden}`, ...a })
    }
    for (const h of overridesEditor.inicioFijado ?? []) {
      items.push({ tipo: 'hora', key: `h:${h.plantillaId}:${h.lote}:${h.etapaOrden}`, ...h })
    }
    for (const [empId, franjas] of Object.entries(overridesEditor.franjasExtra ?? {})) {
      franjas.forEach((f, i) => items.push({ tipo: 'franja', key: `f:${empId}:${i}`, empleadoId: empId, desde: f.desde, hasta: f.hasta }))
    }
    for (const eid of overridesEditor.sustituirMaquina ?? []) {
      items.push({ tipo: 'sustituir', key: `s:${eid}`, etapaId: eid })
    }
    for (const pid of overridesEditor.relajarInicioPlan ?? []) {
      items.push({ tipo: 'relajar-inicio', key: `ri:${pid}`, plantillaId: pid })
    }
    for (const pid of overridesEditor.relajarTopeInicio ?? []) {
      items.push({ tipo: 'relajar-tope', key: `rt:${pid}`, plantillaId: pid })
    }
    for (const [pid, pr] of Object.entries(overridesEditor.prioridadPlantilla ?? {})) {
      items.push({ tipo: 'prioridad', key: `p:${pid}`, plantillaId: pid, prioridad: pr })
    }
    for (const pid of overridesEditor.excluirPlantillas ?? []) {
      items.push({ tipo: 'excluir', key: `x:${pid}`, plantillaId: pid })
    }
    return items
  }, [overridesEditor])

  // ===== Acciones que agregan overrides =====

  const fijarEmpleado = (inst: InstanciaEtapa, empleadoId: string) => {
    if (!empleadoId) return
    setOverridesEditor(prev => fusionarOverrides(prev, {
      asignacionFijada: [{ plantillaId: inst.plantillaId, lote: inst.lote, etapaOrden: inst.etapa.orden, empleadoId }]
    }))
  }

  const fijarHora = (inst: InstanciaEtapa, hhmmStr: string) => {
    const m = hhmm(hhmmStr)
    if (m == null) return
    setOverridesEditor(prev => fusionarOverrides(prev, {
      inicioFijado: [{ plantillaId: inst.plantillaId, lote: inst.lote, etapaOrden: inst.etapa.orden, inicioMin: m }]
    }))
  }

  const sustituirMaquina = (inst: InstanciaEtapa) => {
    setOverridesEditor(prev => fusionarOverrides(prev, { sustituirMaquina: [inst.etapa.id] }))
  }

  const relajarInicio = (plantillaId: string) => {
    setOverridesEditor(prev => fusionarOverrides(prev, { relajarInicioPlan: [plantillaId] }))
  }

  const relajarTope = (plantillaId: string) => {
    setOverridesEditor(prev => fusionarOverrides(prev, { relajarTopeInicio: [plantillaId] }))
  }

  const cambiarPrioridad = (plantillaId: string, prioridad: number) => {
    setOverridesEditor(prev => ({ ...prev, prioridadPlantilla: { ...(prev.prioridadPlantilla ?? {}), [plantillaId]: prioridad } }))
  }

  const excluirProceso = (plantillaId: string) => {
    setOverridesEditor(prev => fusionarOverrides(prev, { excluirPlantillas: [plantillaId] }))
  }

  const agregarFranja = () => {
    const d = hhmm(franjaDesde), h = hhmm(franjaHasta)
    if (!franjaEmp || d == null || h == null || h <= d) return
    setOverridesEditor(prev => {
      const nuevasFranjas = { ...(prev.franjasExtra ?? {}) }
      nuevasFranjas[franjaEmp] = [...(nuevasFranjas[franjaEmp] ?? []), { desde: d, hasta: h, origen: 'extra', etiqueta: 'Editor manual' }]
      return { ...prev, franjasExtra: nuevasFranjas }
    })
    setFranjaEmp(''); setFranjaDesde(''); setFranjaHasta('')
  }

  // Quitar un override del panel lateral.
  const quitarOverride = (item: OverrideItem) => {
    setOverridesEditor(prev => {
      const next = { ...prev }
      switch (item.tipo) {
        case 'empleado':
          next.asignacionFijada = (prev.asignacionFijada ?? []).filter(a =>
            !(a.plantillaId === item.plantillaId && a.lote === item.lote && a.etapaOrden === item.etapaOrden))
          break
        case 'hora':
          next.inicioFijado = (prev.inicioFijado ?? []).filter(a =>
            !(a.plantillaId === item.plantillaId && a.lote === item.lote && a.etapaOrden === item.etapaOrden))
          break
        case 'franja': {
          const f = { ...(prev.franjasExtra ?? {}) }
          const arr = (f[item.empleadoId] ?? []).filter(fr => !(fr.desde === item.desde && fr.hasta === item.hasta))
          if (arr.length > 0) f[item.empleadoId] = arr; else delete f[item.empleadoId]
          next.franjasExtra = f
          break
        }
        case 'sustituir':
          next.sustituirMaquina = (prev.sustituirMaquina ?? []).filter(id => id !== item.etapaId)
          break
        case 'relajar-inicio':
          next.relajarInicioPlan = (prev.relajarInicioPlan ?? []).filter(id => id !== item.plantillaId)
          break
        case 'relajar-tope':
          next.relajarTopeInicio = (prev.relajarTopeInicio ?? []).filter(id => id !== item.plantillaId)
          break
        case 'prioridad': {
          const p = { ...(prev.prioridadPlantilla ?? {}) }
          delete p[item.plantillaId]
          next.prioridadPlantilla = p
          break
        }
        case 'excluir':
          next.excluirPlantillas = (prev.excluirPlantillas ?? []).filter(id => id !== item.plantillaId)
          break
      }
      return next
    })
  }

  const descartarTodo = () => {
    if (!confirm('¿Descartar todos los overrides y volver al cronograma generado por el scheduler?')) return
    setOverridesEditor({})
  }

  const aplicar = async () => {
    if (!preparada || !resultado) return
    if (resumen.conflictos > 0) {
      if (!confirm(`Hay ${resumen.conflictos} conflicto(s) sin resolver. ¿Aplicar igual?`)) return
    }
    if (!confirm(`Se aplicarán ${resumen.colocadas} tarea(s) al cronograma. Se guarda backup automático. ¿Continuar?`)) return
    setAplicando(true)
    try {
      await aplicarResultado(diaActual, resultado, preparada.idsReemplazables)
      onVolver()
    } catch (err) {
      console.error('Error aplicando:', err)
      alert('Error al aplicar el cronograma')
    } finally {
      setAplicando(false)
    }
  }

  // ===== Render =====

  return (
    <div className="h-full flex flex-col bg-[#f6f7fb] overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 shadow-sm">
        <div className="h-[48px] flex items-center px-4 gap-3">
          <button onClick={onVolver} className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-500" title="Volver">
            <ArrowLeft size={16} />
          </button>
          <CalendarClock size={16} className="text-violet-600" />
          <span className="text-[14px] font-bold text-slate-800">Editor manual — {DIAS_SEMANA_NOMBRES[diaActual]}</span>
          <span className="text-[12px] text-slate-400 hidden md:inline">Construí overrides; el scheduler los aplica en vivo</span>

          <div className="ml-auto flex items-center gap-3 text-[12px]">
            <span className="text-emerald-600 font-semibold flex items-center gap-1"><CheckCircle2 size={13} /> {resumen.colocadas}</span>
            {resumen.conflictos > 0 && <span className="text-rose-600 font-semibold flex items-center gap-1"><AlertTriangle size={13} /> {resumen.conflictos}</span>}
            {resumen.cierre != null && <span className="text-slate-500">· cierre {minToTime(resumen.cierre)}</span>}
            {resumen.fueraTurno > 0 && <span className="text-slate-500">· {formatDuration(resumen.fueraTurno)} fuera de turno</span>}
          </div>
        </div>
      </div>

      {/* Body: dos columnas — tabla (izq.) y overrides activos + franja nueva (der.) */}
      <div className="flex-1 min-h-0 overflow-hidden flex">
        {/* Tabla de instancias */}
        <div className="flex-1 min-w-0 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
              <Loader2 size={16} className="animate-spin" /> Cargando contexto del día…
            </div>
          ) : !resultado || instanciasOrden.length === 0 ? (
            <div className="text-slate-400 text-sm py-8 text-center">
              No hay etapas para este día.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-2 py-2 text-center w-[36px]">Est.</th>
                    <th className="px-2 py-2 text-left">Proceso · Etapa</th>
                    <th className="px-2 py-2 text-center w-[50px]">Lote</th>
                    <th className="px-2 py-2 text-left w-[160px]">Empleado</th>
                    <th className="px-2 py-2 text-center w-[80px]">Inicio</th>
                    <th className="px-2 py-2 text-center w-[70px]">Dur.</th>
                    <th className="px-2 py-2 text-center w-[60px]">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {instanciasOrden.map(inst => {
                    const key = `${inst.plantillaId}:${inst.lote}:${inst.etapa.orden}`
                    const colocada = inst.estado === 'colocada'
                    const principal = inst.asignaciones.find(a => a.rol === 'principal') ?? inst.asignaciones[0]
                    const filaColor = colocada ? '' : 'bg-rose-50'
                    return (
                      <>
                        <tr key={key} className={`border-b border-slate-100 ${filaColor}`}>
                          <td className="px-2 py-1.5 text-center">
                            {colocada
                              ? <span className="text-emerald-600" title="Colocada">✓</span>
                              : <span title={inst.conflicto?.mensaje ?? 'Sin ubicar'} className="text-rose-600 font-bold cursor-help">⛔</span>}
                          </td>
                          <td className="px-2 py-1.5 text-slate-800">
                            <span className="font-semibold">{inst.plantillaNombre}</span>
                            <span className="text-slate-400"> · </span>
                            <span>{inst.etapa.nombre}</span>
                          </td>
                          <td className="px-2 py-1.5 text-center text-slate-500">{inst.lote}</td>
                          <td className="px-2 py-1.5 text-slate-700 truncate" title={principal ? nombreEmp(principal.empleadoId) : ''}>
                            {principal ? nombreEmp(principal.empleadoId) : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-center text-slate-700">
                            {inst.inicioAbs != null ? mm(inst.inicioAbs) : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-center text-slate-500">{formatDuration(inst.etapa.duracion_proceso)}</td>
                          <td className="px-2 py-1.5 text-center">
                            <button
                              onClick={() => { setFilaAbierta(filaAbierta === key ? null : key); setAccionAbierta(null); setInputTmp('') }}
                              className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-slate-100 text-slate-600"
                              title="Editar"
                            >
                              <Edit3 size={13} />
                            </button>
                          </td>
                        </tr>

                        {filaAbierta === key && (
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <td colSpan={7} className="px-3 py-2">
                              <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                                <button onClick={() => { setAccionAbierta('empleado'); setInputTmp('') }}
                                  className={`px-2 py-1 rounded ${accionAbierta === 'empleado' ? 'bg-violet-600 text-white' : 'bg-white border border-slate-300 hover:bg-slate-100'}`}>
                                  Fijar empleado
                                </button>
                                <button onClick={() => { setAccionAbierta('hora'); setInputTmp(inst.inicioAbs != null ? mm(inst.inicioAbs) : '') }}
                                  className={`px-2 py-1 rounded ${accionAbierta === 'hora' ? 'bg-violet-600 text-white' : 'bg-white border border-slate-300 hover:bg-slate-100'}`}>
                                  Fijar hora
                                </button>
                                <button onClick={() => sustituirMaquina(inst)}
                                  className="px-2 py-1 rounded bg-white border border-slate-300 hover:bg-slate-100">
                                  Usar máquina equivalente
                                </button>
                                <button onClick={() => { setAccionAbierta('relajar') }}
                                  className={`px-2 py-1 rounded ${accionAbierta === 'relajar' ? 'bg-violet-600 text-white' : 'bg-white border border-slate-300 hover:bg-slate-100'}`}>
                                  Relajar
                                </button>
                                <button onClick={() => { setAccionAbierta('prioridad'); setInputTmp('5') }}
                                  className={`px-2 py-1 rounded ${accionAbierta === 'prioridad' ? 'bg-violet-600 text-white' : 'bg-white border border-slate-300 hover:bg-slate-100'}`}>
                                  Cambiar prioridad
                                </button>
                                <button onClick={() => { if (confirm(`Excluir todo el proceso "${inst.plantillaNombre}" del plan?`)) excluirProceso(inst.plantillaId) }}
                                  className="px-2 py-1 rounded bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700">
                                  Excluir proceso
                                </button>
                              </div>

                              {/* Inputs según la acción elegida */}
                              {accionAbierta === 'empleado' && (
                                <div className="mt-2 flex items-center gap-2">
                                  <select value={inputTmp} onChange={e => setInputTmp(e.target.value)}
                                    className="h-7 px-2 text-[11px] bg-white border border-slate-300 rounded">
                                    <option value="">Elegí empleado…</option>
                                    {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                                  </select>
                                  <button onClick={() => { fijarEmpleado(inst, inputTmp); setAccionAbierta(null); setFilaAbierta(null) }}
                                    disabled={!inputTmp}
                                    className="h-7 px-2 text-[11px] font-semibold text-white bg-violet-600 rounded hover:bg-violet-700 disabled:opacity-40">
                                    Aplicar
                                  </button>
                                </div>
                              )}
                              {accionAbierta === 'hora' && (
                                <div className="mt-2 flex items-center gap-2">
                                  <input type="time" value={inputTmp} onChange={e => setInputTmp(e.target.value)}
                                    className="h-7 px-1 w-[88px] text-center text-[11px] bg-white border border-slate-300 rounded" />
                                  <button onClick={() => { fijarHora(inst, inputTmp); setAccionAbierta(null); setFilaAbierta(null) }}
                                    disabled={!inputTmp}
                                    className="h-7 px-2 text-[11px] font-semibold text-white bg-violet-600 rounded hover:bg-violet-700 disabled:opacity-40">
                                    Aplicar
                                  </button>
                                </div>
                              )}
                              {accionAbierta === 'relajar' && (
                                <div className="mt-2 flex items-center gap-2">
                                  <button onClick={() => { relajarInicio(inst.plantillaId); setAccionAbierta(null); setFilaAbierta(null) }}
                                    className="h-7 px-2 text-[11px] font-semibold text-white bg-violet-600 rounded hover:bg-violet-700">
                                    Quitar "no empezar antes" del proceso
                                  </button>
                                  <button onClick={() => { relajarTope(inst.plantillaId); setAccionAbierta(null); setFilaAbierta(null) }}
                                    className="h-7 px-2 text-[11px] font-semibold text-white bg-violet-600 rounded hover:bg-violet-700">
                                    Quitar tope de inicio del proceso
                                  </button>
                                </div>
                              )}
                              {accionAbierta === 'prioridad' && (
                                <div className="mt-2 flex items-center gap-2">
                                  <label className="text-[11px]">Nueva prioridad (1=baja, 10=alta):</label>
                                  <input type="number" min={1} max={10} value={inputTmp} onChange={e => setInputTmp(e.target.value)}
                                    className="h-7 w-14 px-1 text-center text-[11px] bg-white border border-slate-300 rounded" />
                                  <button onClick={() => { const p = parseInt(inputTmp, 10); if (p >= 1 && p <= 10) { cambiarPrioridad(inst.plantillaId, p); setAccionAbierta(null); setFilaAbierta(null) } }}
                                    className="h-7 px-2 text-[11px] font-semibold text-white bg-violet-600 rounded hover:bg-violet-700">
                                    Aplicar
                                  </button>
                                </div>
                              )}

                              {!colocada && inst.conflicto?.mensaje && (
                                <div className="mt-2 text-[11px] text-rose-700 italic">{inst.conflicto.mensaje}</div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[11px] text-slate-400 mt-2">
            ⛔ = sin ubicar (mirá el motivo en el detalle de la fila). ✓ = colocada.
            Cada cambio re-corre el scheduler. Al aplicar, las tareas pasan al cronograma como
            tareas normales (no provisorias) y se guarda un backup automático.
          </p>
        </div>

        {/* Panel lateral: overrides activos + agregar franja */}
        <aside className="w-[300px] flex-shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-3 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Agregar franja extra</div>
            <div className="space-y-1.5">
              <select value={franjaEmp} onChange={e => setFranjaEmp(e.target.value)}
                className="w-full h-7 px-2 text-[11px] bg-white border border-slate-300 rounded">
                <option value="">Empleado…</option>
                {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
              <div className="flex items-center gap-1.5">
                <input type="time" value={franjaDesde} onChange={e => setFranjaDesde(e.target.value)} placeholder="Desde"
                  className="flex-1 h-7 px-1 text-center text-[11px] bg-white border border-slate-300 rounded" />
                <span className="text-slate-400 text-[11px]">→</span>
                <input type="time" value={franjaHasta} onChange={e => setFranjaHasta(e.target.value)} placeholder="Hasta"
                  className="flex-1 h-7 px-1 text-center text-[11px] bg-white border border-slate-300 rounded" />
              </div>
              <button onClick={agregarFranja}
                disabled={!franjaEmp || !franjaDesde || !franjaHasta}
                className="w-full h-7 text-[11px] font-semibold text-white bg-slate-700 rounded hover:bg-slate-800 disabled:opacity-40 flex items-center justify-center gap-1">
                <Plus size={11} /> Agregar
              </button>
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">
              Overrides activos ({overridesActivos.length})
            </div>
            {overridesActivos.length === 0 ? (
              <div className="text-[11px] text-slate-400 italic">— sin overrides aún —</div>
            ) : (
              <div className="space-y-1">
                {overridesActivos.map(item => (
                  <div key={item.key} className="flex items-start gap-1.5 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-[11px]">
                    <div className="flex-1 min-w-0 text-slate-700">
                      {item.tipo === 'empleado' && (
                        <>PIN empleado: <span className="font-semibold">{nombreEmp(item.empleadoId)}</span> en {nombrePlantilla(item.plantillaId)} · etapa #{item.etapaOrden} · lote {item.lote}</>
                      )}
                      {item.tipo === 'hora' && (
                        <>PIN hora: <span className="font-semibold">{mm(item.inicioMin)}</span> en {nombrePlantilla(item.plantillaId)} · etapa #{item.etapaOrden} · lote {item.lote}</>
                      )}
                      {item.tipo === 'franja' && (
                        <>Franja extra: <span className="font-semibold">{nombreEmp(item.empleadoId)}</span> {mm(item.desde)} → {mm(item.hasta)}</>
                      )}
                      {item.tipo === 'sustituir' && (
                        <>Sustituir máquina: etapa {item.etapaId.slice(0, 8)}…</>
                      )}
                      {item.tipo === 'relajar-inicio' && (
                        <>Relajar "no empezar antes" de {nombrePlantilla(item.plantillaId)}</>
                      )}
                      {item.tipo === 'relajar-tope' && (
                        <>Relajar tope de inicio de {nombrePlantilla(item.plantillaId)}</>
                      )}
                      {item.tipo === 'prioridad' && (
                        <>Prioridad {item.prioridad} para {nombrePlantilla(item.plantillaId)}</>
                      )}
                      {item.tipo === 'excluir' && (
                        <>Excluir {nombrePlantilla(item.plantillaId)} del plan</>
                      )}
                    </div>
                    <button onClick={() => quitarOverride(item)}
                      className="text-rose-500 hover:text-rose-700 flex-shrink-0"
                      title="Quitar override">
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Barra de acciones */}
      <div className="flex-shrink-0 bg-white border-t border-slate-200 px-5 py-3">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <button onClick={onVolver} className="h-9 px-3 text-sm font-semibold text-slate-700 border border-slate-300 rounded hover:bg-slate-100">
            Volver
          </button>
          <div className="flex items-center gap-2">
            <button onClick={descartarTodo} disabled={overridesActivos.length === 0}
              className="h-9 px-3 text-sm font-semibold text-slate-700 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-40">
              Descartar overrides
            </button>
            <button onClick={aplicar} disabled={!resultado || aplicando || loading || resumen.colocadas === 0}
              className="h-9 px-4 text-sm font-semibold text-white bg-violet-600 rounded hover:bg-violet-700 disabled:opacity-40 flex items-center gap-1.5">
              {aplicando ? <Loader2 size={14} className="animate-spin" /> : null} Aplicar al cronograma
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
