import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, CalendarClock, AlertTriangle, CheckCircle2, Loader2, Wrench, ArrowLeft } from 'lucide-react'
import { planificacionService } from '../../services/planificacionService'
import { generarParaDia, aplicarResultado, GeneracionPreparada, generarCronograma, generarSolucionesConflicto, fusionarOverrides } from '../../services/schedulerService'
import { PlanDiaItem, PlantillaProceso } from '../../types/planificacion'
import { SchedulerOverrides, SolucionConflicto, InstanciaEtapa } from '../../types/scheduler'
import { DIAS_SEMANA_NOMBRES } from '../../types/cronograma'
import { minToTime, formatDuration } from '../Cronograma/cronogramaHelpers'

interface PlanificarPageProps {
  diaActual: number
  onVolver: () => void
}

export function PlanificarPage({ diaActual, onVolver }: PlanificarPageProps) {
  const [cola, setCola] = useState<PlanDiaItem[]>([])
  const [plantillas, setPlantillas] = useState<PlantillaProceso[]>([])
  const [loading, setLoading] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [preparada, setPreparada] = useState<GeneracionPreparada | null>(null)
  const [overrides, setOverrides] = useState<SchedulerOverrides>({})
  const [resolviendo, setResolviendo] = useState<InstanciaEtapa | null>(null)
  const [soluciones, setSoluciones] = useState<SolucionConflicto[]>([])

  const [nuevaPlantillaId, setNuevaPlantillaId] = useState('')
  const [nuevaCantidad, setNuevaCantidad] = useState(1)
  const [nuevaPrioridad, setNuevaPrioridad] = useState(5)
  const [nuevoInicioMin, setNuevoInicioMin] = useState('')
  const [nuevoInicioMax, setNuevoInicioMax] = useState('')
  const [nuevoFinMax, setNuevoFinMax] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const [c, p] = await Promise.all([
        planificacionService.listarPlanDia(diaActual),
        planificacionService.listarPlantillas()
      ])
      setCola(c)
      setPlantillas(p.filter(pl => pl.activa))
    } catch (err) {
      console.error('Error cargando planificación:', err)
    } finally {
      setLoading(false)
    }
  }, [diaActual])

  useEffect(() => {
    setPreparada(null)
    setOverrides({})
    setResolviendo(null)
    setSoluciones([])
    cargar()
  }, [cargar])

  const agregarItem = async () => {
    if (!nuevaPlantillaId) return
    try {
      await planificacionService.crearPlanDiaItem({
        dia_semana: diaActual,
        plantilla_id: nuevaPlantillaId,
        cantidad_lotes: nuevaCantidad,
        prioridad: nuevaPrioridad,
        hora_inicio_min: nuevoInicioMin || null,
        hora_inicio_max: nuevoInicioMax || null,
        hora_fin_max: nuevoFinMax || null
      })
      setNuevaPlantillaId('')
      setNuevaCantidad(1)
      setNuevaPrioridad(5)
      setNuevoInicioMin('')
      setNuevoInicioMax('')
      setNuevoFinMax('')
      setPreparada(null)
      await cargar()
    } catch (err) {
      console.error('Error agregando item:', err)
    }
  }

  const eliminarItem = async (id: string) => {
    try {
      await planificacionService.eliminarPlanDiaItem(id)
      setPreparada(null)
      await cargar()
    } catch (err) {
      console.error('Error eliminando item:', err)
    }
  }

  const cambiarCampo = async (id: string, campo: 'cantidad_lotes' | 'prioridad', valor: number) => {
    setCola(prev => prev.map(i => i.id === id ? { ...i, [campo]: valor } : i))
    try {
      await planificacionService.actualizarPlanDiaItem(id, { [campo]: valor })
      setPreparada(null)
    } catch (err) {
      console.error('Error actualizando item:', err)
    }
  }

  const cambiarHorario = async (id: string, campo: 'hora_inicio_min' | 'hora_inicio_max' | 'hora_fin_max', valor: string) => {
    const v = valor || null
    setCola(prev => prev.map(i => i.id === id ? { ...i, [campo]: v } : i))
    try {
      await planificacionService.actualizarPlanDiaItem(id, { [campo]: v })
      setPreparada(null)
    } catch (err) {
      console.error('Error actualizando horario:', err)
    }
  }

  const generar = async () => {
    setGenerando(true)
    setResolviendo(null)
    setSoluciones([])
    try {
      const prep = await generarParaDia(diaActual)
      setPreparada(prep)
      setOverrides({})
    } catch (err) {
      console.error('Error generando:', err)
      alert('Error al generar el cronograma')
    } finally {
      setGenerando(false)
    }
  }

  const resolverConflicto = (c: InstanciaEtapa) => {
    if (!preparada) return
    setResolviendo(c)
    setSoluciones(generarSolucionesConflicto(c, preparada.ctx, overrides))
  }

  const aplicarSolucion = (s: SolucionConflicto) => {
    aplicarOverrideDelta(s.overrideDelta)
  }

  // Aplica un override y re-simula todo (cascada). Reutilizado por soluciones y acciones de culpable.
  const aplicarOverrideDelta = (delta: SchedulerOverrides) => {
    if (!preparada) return
    const nuevos = fusionarOverrides(overrides, delta)
    setOverrides(nuevos)
    setPreparada({ ...preparada, resultado: generarCronograma(preparada.ctx, nuevos) })
    setResolviendo(null)
    setSoluciones([])
  }

  const nombrePlantilla = (id: string) => plantillas.find(p => p.id === id)?.nombre ?? 'proceso'

  const aplicar = async () => {
    if (!preparada) return
    if (!confirm(`Se reemplazarán las tareas generadas previamente del ${DIAS_SEMANA_NOMBRES[diaActual]} (las manuales y bloqueadas se conservan). Se guarda un backup. ¿Continuar?`)) return
    setAplicando(true)
    try {
      await aplicarResultado(diaActual, preparada.resultado, preparada.idsReemplazables)
      onVolver()
    } catch (err) {
      console.error('Error aplicando:', err)
      alert('Error al aplicar el cronograma')
    } finally {
      setAplicando(false)
    }
  }

  const colocadas = preparada?.resultado.instancias.filter(i => i.estado === 'colocada') ?? []
  // Mostrar solo los conflictos raíz (no las etapas arrastradas en cascada).
  const conflictos = preparada?.resultado.conflictos.filter(c => !c.cascada) ?? []

  return (
    <div className="h-full flex flex-col bg-[#f6f7fb] overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 shadow-sm">
        <div className="h-[48px] flex items-center px-4 gap-3">
          <button
            onClick={onVolver}
            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-500 transition-colors"
            title="Volver al cronograma"
          >
            <ArrowLeft size={16} />
          </button>
          <CalendarClock size={16} className="text-blue-600" />
          <span className="text-[14px] font-bold text-slate-800">Planificar — {DIAS_SEMANA_NOMBRES[diaActual]}</span>
          <span className="text-[12px] text-slate-400 hidden sm:inline">Cola de producción y generación automática</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[900px] mx-auto p-5 space-y-4">
          {/* Cola */}
          <div>
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-2">Qué producir este día</h3>
            {loading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-4"><Loader2 size={16} className="animate-spin" /> Cargando...</div>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-3 py-2 font-bold text-slate-600">Plantilla</th>
                      <th className="text-center px-1 py-2 font-bold text-slate-600 w-[54px]">Lotes</th>
                      <th className="text-center px-1 py-2 font-bold text-slate-600 w-[54px]">Prior.</th>
                      <th className="text-center px-1 py-2 font-bold text-slate-600 w-[66px]" title="No empezar antes de (solo este día)">Inicio</th>
                      <th className="text-center px-1 py-2 font-bold text-slate-600 w-[66px]" title="Empezar a más tardar (solo este día)">Tope ini.</th>
                      <th className="text-center px-1 py-2 font-bold text-slate-600 w-[66px]" title="Terminar a más tardar (solo este día)">Fin</th>
                      <th className="w-[36px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cola.map(item => (
                      <tr key={item.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-3 py-1.5 font-medium text-slate-800">{item.plantilla?.nombre ?? '—'}</td>
                        <td className="px-1 py-1.5 text-center">
                          <input type="number" min={1} value={item.cantidad_lotes}
                            onChange={e => cambiarCampo(item.id, 'cantidad_lotes', Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-12 h-7 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <input type="number" min={1} max={10} value={item.prioridad}
                            onChange={e => cambiarCampo(item.id, 'prioridad', Math.max(1, Math.min(10, parseInt(e.target.value) || 5)))}
                            className="w-12 h-7 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <input type="time" value={item.hora_inicio_min?.slice(0, 5) ?? ''}
                            onChange={e => cambiarHorario(item.id, 'hora_inicio_min', e.target.value)}
                            className="w-[62px] h-7 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <input type="time" value={item.hora_inicio_max?.slice(0, 5) ?? ''}
                            onChange={e => cambiarHorario(item.id, 'hora_inicio_max', e.target.value)}
                            className="w-[62px] h-7 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <input type="time" value={item.hora_fin_max?.slice(0, 5) ?? ''}
                            onChange={e => cambiarHorario(item.id, 'hora_fin_max', e.target.value)}
                            className="w-[62px] h-7 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <button onClick={() => eliminarItem(item.id)} className="text-red-500 hover:text-red-700"><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ))}
                    {cola.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-400">Cola vacía — agregá plantillas abajo</td></tr>
                    )}
                  </tbody>
                </table>
                {/* Agregar */}
                <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border-t border-slate-200">
                  <select value={nuevaPlantillaId} onChange={e => setNuevaPlantillaId(e.target.value)}
                    className="flex-1 h-8 px-2 text-[12px] bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400">
                    <option value="">Seleccionar plantilla...</option>
                    {plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                  <input type="number" min={1} value={nuevaCantidad} title="Lotes"
                    onChange={e => setNuevaCantidad(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-12 h-8 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <input type="number" min={1} max={10} value={nuevaPrioridad} title="Prioridad"
                    onChange={e => setNuevaPrioridad(Math.max(1, Math.min(10, parseInt(e.target.value) || 5)))}
                    className="w-12 h-8 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <input type="time" value={nuevoInicioMin} title="Inicio (opcional, solo este día)"
                    onChange={e => setNuevoInicioMin(e.target.value)}
                    className="w-[62px] h-8 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <input type="time" value={nuevoInicioMax} title="Tope de inicio (opcional)"
                    onChange={e => setNuevoInicioMax(e.target.value)}
                    className="w-[62px] h-8 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <input type="time" value={nuevoFinMax} title="Fin (opcional)"
                    onChange={e => setNuevoFinMax(e.target.value)}
                    className="w-[62px] h-8 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <button onClick={agregarItem} disabled={!nuevaPlantillaId}
                    className="h-8 px-2.5 text-[12px] font-semibold rounded bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 flex items-center gap-1">
                    <Plus size={13} /> Agregar
                  </button>
                </div>
                <p className="px-3 pb-2 pt-1 bg-slate-50 text-[10px] text-slate-400">Inicio / Tope ini. / Fin: dejar vacío usa el horario de la plantilla; cargado lo pisa solo este día.</p>
              </div>
            )}
          </div>

          {/* Resultado de la simulación */}
          {preparada && !resolviendo && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-700">
                <CheckCircle2 size={15} /> {colocadas.length} etapa(s) ubicada(s)
                {preparada.resultado.cierreJornada != null && (
                  <span className="text-slate-500 font-normal">· cierre {minToTime(preparada.resultado.cierreJornada)}</span>
                )}
              </div>
              {conflictos.length > 0 && (
                <div className="border border-amber-200 rounded-lg overflow-hidden bg-white">
                  <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-[12px] font-bold text-amber-700">
                    <AlertTriangle size={14} /> {conflictos.length} etapa(s) en conflicto
                  </div>
                  <div className="divide-y divide-slate-100">
                    {conflictos.map(c => {
                      const culpables = [...new Set((c.conflicto?.culpablesPlantillaIds ?? []).filter(id => id !== c.plantillaId))]
                      return (
                        <div key={c.key} className="px-3 py-2 text-[12px]">
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <span className="font-semibold text-slate-800">{c.plantillaNombre}</span>
                              <span className="text-slate-400"> · </span>
                              <span className="text-slate-700">{c.etapa.nombre} (lote {c.lote})</span>
                            </div>
                            <button onClick={() => resolverConflicto(c)}
                              className="flex-shrink-0 h-6 px-2 text-[11px] font-semibold text-violet-700 border border-violet-300 bg-violet-50 rounded hover:bg-violet-100 flex items-center gap-1">
                              <Wrench size={11} /> Resolver
                            </button>
                          </div>
                          <p className="text-amber-700 mt-1 leading-snug">{c.conflicto?.mensaje}</p>
                          {culpables.map(id => (
                            <div key={id} className="mt-1.5 flex items-center gap-2 flex-wrap pl-2 border-l-2 border-rose-200">
                              <span className="text-[11px] text-slate-500">Lo bloquea <span className="font-semibold text-rose-600">{nombrePlantilla(id)}</span>:</span>
                              <button onClick={() => aplicarOverrideDelta({ prioridadPlantilla: { [id]: 1 } })}
                                className="h-5 px-2 text-[10px] font-semibold text-rose-700 border border-rose-300 bg-rose-50 rounded hover:bg-rose-100">
                                Bajar su prioridad
                              </button>
                              <button onClick={() => aplicarOverrideDelta({ excluirPlantillas: [id] })}
                                className="h-5 px-2 text-[10px] font-semibold text-rose-700 border border-rose-300 bg-rose-50 rounded hover:bg-rose-100">
                                Sacarla del plan
                              </button>
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Panel de resolución asistida */}
          {resolviendo && (
            <div className="space-y-2">
              <button onClick={() => { setResolviendo(null); setSoluciones([]) }}
                className="text-[12px] text-slate-500 hover:text-slate-700 flex items-center gap-1">
                <ArrowLeft size={13} /> Volver a la lista
              </button>
              <div className="text-[13px] font-semibold text-slate-800">
                Resolver: {resolviendo.plantillaNombre} · {resolviendo.etapa.nombre} (lote {resolviendo.lote})
              </div>
              <div className="text-[12px] text-amber-600">{resolviendo.conflicto?.mensaje}</div>
              {soluciones.length === 0 ? (
                <div className="text-[12px] text-slate-400 py-2">No se encontraron soluciones automáticas.</div>
              ) : (
                ([
                  { key: 'maquina', titulo: 'Usar otra máquina (más barato)', color: 'text-teal-600' },
                  { key: 'traer', titulo: 'Extender turno', color: 'text-violet-600' },
                  { key: 'relajar', titulo: 'Relajar restricciones', color: 'text-amber-600' },
                  { key: 'culpable', titulo: 'Liberar lo que ocupa el recurso', color: 'text-rose-600' },
                  { key: 'proceso', titulo: 'Postergar este proceso (perdés producto)', color: 'text-slate-600' }
                ] as const).map(g => {
                  const items = soluciones.filter(s => s.grupo === g.key)
                  if (items.length === 0) return null
                  return (
                    <div key={g.key} className="space-y-1.5">
                      <div className={`text-[11px] uppercase tracking-wider font-bold pt-1 ${g.color}`}>{g.titulo}</div>
                      {items.map(s => {
                        const fuera = s.metricas.cargaPorEmpleado.reduce((a, c) => a + c.minutosFueraTurno, 0)
                        return (
                          <div key={s.id} className="border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-3 bg-white">
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] font-semibold text-slate-800 flex items-center gap-1.5 flex-wrap">
                                {s.descripcion}
                                {s.recomendada && (
                                  <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-100 rounded">Recomendado</span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5 flex-wrap">
                                {s.metricas.conflictos === 0
                                  ? <span className="text-emerald-600 font-semibold">Sin conflictos</span>
                                  : <span className="text-amber-600">{s.metricas.conflictos} conflicto(s) restante(s)</span>}
                                {s.metricas.cierreJornada != null && <span>· cierre {minToTime(s.metricas.cierreJornada)}</span>}
                                {s.costoExtraMin != null && s.costoExtraMin > 0 && <span>· +{formatDuration(s.costoExtraMin)} extra</span>}
                                {s.huecoMuertoMin != null && s.huecoMuertoMin > 0 && <span>· {formatDuration(s.huecoMuertoMin)} muerta</span>}
                                {s.costoExtraMin == null && fuera > 0 && <span>· {formatDuration(fuera)} fuera de turno</span>}
                                {s.dejaProductoFuera && <span className="text-rose-600 font-semibold">· perdés este producto</span>}
                              </div>
                            </div>
                            <button onClick={() => aplicarSolucion(s)}
                              className="flex-shrink-0 h-7 px-3 text-[11px] font-semibold text-white bg-violet-600 rounded hover:bg-violet-700">
                              Aplicar
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Barra de acciones */}
      <div className="flex-shrink-0 bg-white border-t border-slate-200 px-5 py-3">
        <div className="max-w-[900px] mx-auto flex items-center justify-between">
          <button onClick={onVolver} className="h-9 px-3 text-sm font-semibold text-slate-700 border border-slate-300 rounded hover:bg-slate-100">Volver</button>
          <div className="flex items-center gap-2">
            <button onClick={generar} disabled={generando || cola.length === 0}
              className="h-9 px-3 text-sm font-semibold text-blue-700 border border-blue-300 bg-blue-50 rounded hover:bg-blue-100 disabled:opacity-40 flex items-center gap-1.5">
              {generando ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />} Generar
            </button>
            <button onClick={aplicar} disabled={!preparada || aplicando || colocadas.length === 0}
              className="h-9 px-4 text-sm font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 disabled:opacity-40 flex items-center gap-1.5">
              {aplicando ? <Loader2 size={14} className="animate-spin" /> : null} Aplicar al cronograma
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
