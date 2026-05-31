import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, CalendarClock, AlertTriangle, CheckCircle2, Loader2, Wrench, ArrowLeft, Sparkles } from 'lucide-react'
import { planificacionService } from '../../services/planificacionService'
import { generarParaDia, aplicarResultado, GeneracionPreparada, generarCronograma, generarSolucionesConflicto, fusionarOverrides } from '../../services/schedulerService'
import { iaDisponible, repasarPlan, explicarConflicto as iaExplicarConflicto, comandoAOverrides, IAError, ResultadoRepaso, PropuestaSimulada, PreviewComando } from '../../services/iaService'
import { PlanDiaItem, PlantillaProceso } from '../../types/planificacion'
import { SchedulerOverrides, SolucionConflicto, InstanciaEtapa, ResultadoScheduler } from '../../types/scheduler'
import { IAEstado, ExplicarConflictoData } from '../../types/ia'
import { DIAS_SEMANA_NOMBRES } from '../../types/cronograma'
import { minToTime, formatDuration } from '../Cronograma/cronogramaHelpers'

interface PlanificarPageProps {
  diaActual: number
  onVolver: () => void
  onIrAEditorManual?: () => void
}

export function PlanificarPage({ diaActual, onVolver, onIrAEditorManual }: PlanificarPageProps) {
  const [cola, setCola] = useState<PlanDiaItem[]>([])
  const [plantillas, setPlantillas] = useState<PlantillaProceso[]>([])
  const [empleados, setEmpleados] = useState<{ id: string; nombre_completo: string }[]>([])
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

  // ===== Estado del editor "Resolver manualmente" =====
  // Sección colapsable al pie del modal de resolución. Permite armar un SchedulerOverrides a mano
  // (asignación forzada de empleado + franjas extra ad-hoc) y previsualizar antes de aplicar.
  const [manualAbierto, setManualAbierto] = useState(false)
  const [manualEmpleadoId, setManualEmpleadoId] = useState('')   // empleado forzado para la etapa en conflicto
  const [manualFranjas, setManualFranjas] = useState<{ empleadoId: string; desde: string; hasta: string }[]>([])
  const [nuevaFranjaEmp, setNuevaFranjaEmp] = useState('')
  const [nuevaFranjaDesde, setNuevaFranjaDesde] = useState('')
  const [nuevaFranjaHasta, setNuevaFranjaHasta] = useState('')
  const [manualNota, setManualNota] = useState('')
  const [manualPreview, setManualPreview] = useState<{ conflictos: number; cierre: number | null; fuera: number; cambios?: string[] } | null>(null)
  // Cambio I — funciones nuevas de la sección manual:
  const [manualHora, setManualHora] = useState('')                     // #7 forzar hora HH:MM
  const [manualFijarCompleto, setManualFijarCompleto] = useState(false) // #9 fijar al proceso completo
  const [manualSecuenciaA, setManualSecuenciaA] = useState('')         // #10 plantillaId que termina antes
  const [manualSecuenciaB, setManualSecuenciaB] = useState('')         // #10 plantillaId que empieza después
  const [manualPrioridadId, setManualPrioridadId] = useState('')       // #12 plantillaId a cambiar
  const [manualPrioridadVal, setManualPrioridadVal] = useState(5)      // #12 nueva prioridad
  const [manualDuracion, setManualDuracion] = useState<number | ''>('')  // #26 override duración (min) para la etapa en conflicto
  const [manualAyudantes, setManualAyudantes] = useState<string[]>([]) // #25 ids de ayudantes para la etapa en conflicto
  const [nuevoAyudanteId, setNuevoAyudanteId] = useState('')
  // Cambio E (paso 2): si hubo "Resolver manualmente" en esta sesión, marcamos las tareas como provisorias al aplicar.
  // null = no hubo resolución manual; string = nota a usar (puede ser '' si el usuario no escribió nada).
  const [resolucionManualNota, setResolucionManualNota] = useState<string | null>(null)
  // #28 Modal "¿Por qué?" del scheduler — toggle del panel desplegable con las decisiones.
  const [porQueAbierto, setPorQueAbierto] = useState(false)
  // #22 Templates de resolución guardados (en localStorage por ahora).
  const [templates, setTemplates] = useState<{ nombre: string; campos: TemplateCampos }[]>(() => cargarTemplatesDeStorage())
  const [templateSeleccionado, setTemplateSeleccionado] = useState('')
  const [nuevoTemplateNombre, setNuevoTemplateNombre] = useState('')

  // ===== Capa de IA (opcional): repasa el plan y propone/aplica mejoras =====
  const [iaEstado, setIaEstado] = useState<IAEstado>({ disponible: false })
  const [iaRepasando, setIaRepasando] = useState(false)
  const [iaRepaso, setIaRepaso] = useState<ResultadoRepaso | null>(null)
  const [iaAutoAviso, setIaAutoAviso] = useState<{ titulo: string; diff: string[] } | null>(null)
  const [iaError, setIaError] = useState<string | null>(null)
  // Explicar conflicto (sub-caso, dentro del panel de resolución)
  const [iaExplicando, setIaExplicando] = useState(false)
  const [iaExplicacion, setIaExplicacion] = useState<ExplicarConflictoData | null>(null)
  // Comando en lenguaje natural → overrides
  const [comandoTexto, setComandoTexto] = useState('')
  const [comandoCargando, setComandoCargando] = useState(false)
  const [comandoPreview, setComandoPreview] = useState<PreviewComando | null>(null)
  // Texto de progreso mientras la IA repasa (da feedback de en qué anda).
  const [iaPaso, setIaPaso] = useState(0)

  // Mensajes de progreso que van cambiando mientras la IA repasa.
  const PASOS_IA = [
    'Leyendo la jornada…',
    'Buscando mejoras posibles…',
    'Simulando propuestas con el motor…',
    'Comparando resultados…',
    'Casi listo…',
  ]
  useEffect(() => {
    if (!iaRepasando) { setIaPaso(0); return }
    const id = setInterval(() => setIaPaso(p => Math.min(p + 1, PASOS_IA.length - 1)), 4000)
    return () => clearInterval(id)
  }, [iaRepasando])

  // Carga el estado de la IA al montar y ante cambios de conexión.
  useEffect(() => {
    let activo = true
    const check = () => { iaDisponible().then(e => { if (activo) setIaEstado(e) }).catch(() => {}) }
    check()
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    return () => { activo = false; window.removeEventListener('online', check); window.removeEventListener('offline', check) }
  }, [])

  // Repaso automático: la IA revisa el resultado y aplica sola las mejoras claras.
  const ejecutarRepaso = async (prep: GeneracionPreparada, baseOv: SchedulerOverrides) => {
    setIaRepaso(null); setIaAutoAviso(null); setIaError(null)
    setIaRepasando(true)
    try {
      const rep = await repasarPlan(prep, baseOv)
      if (rep.autoAplicable) {
        // Mejora clara → se aplica sola (el resultado ya fue simulado con base+delta).
        const nuevos = fusionarOverrides(baseOv, rep.autoAplicable.overrideDelta)
        setOverrides(nuevos)
        setPreparada({ ...prep, resultado: rep.autoAplicable.resultado })
        setIaAutoAviso({ titulo: rep.autoAplicable.titulo, diff: rep.autoAplicable.diff })
      }
      setIaRepaso(rep)
    } catch (e) {
      // Si la IA no está disponible, degradar en silencio (el plan determinístico vale igual).
      const code = e instanceof IAError ? e.code : 'servidor'
      if (code !== 'offline' && code !== 'desactivada' && code !== 'sin_config') {
        setIaError(e instanceof Error ? e.message : 'No se pudo repasar con IA.')
      }
    } finally {
      setIaRepasando(false)
    }
  }

  const repasarSiDisponible = async (prep: GeneracionPreparada) => {
    const est = await iaDisponible()
    setIaEstado(est)
    if (est.disponible) await ejecutarRepaso(prep, {})
  }

  // Aplica una opción propuesta por la IA (cuando no hubo auto-aplicación).
  const aplicarOpcionIA = (op: PropuestaSimulada) => {
    aplicarOverrideDelta(op.overrideDelta)
    setIaRepaso(null); setIaAutoAviso(null)
  }

  const interpretarComando = async () => {
    if (!preparada || !comandoTexto.trim()) return
    setComandoCargando(true); setComandoPreview(null); setIaError(null)
    try {
      setComandoPreview(await comandoAOverrides(comandoTexto.trim(), preparada, overrides))
    } catch (e) {
      setIaError(e instanceof Error ? e.message : 'No se pudo interpretar el comando.')
    } finally {
      setComandoCargando(false)
    }
  }

  const aplicarComando = () => {
    if (!comandoPreview?.overrideDelta) return
    aplicarOverrideDelta(comandoPreview.overrideDelta)
    setComandoPreview(null); setComandoTexto(''); setIaRepaso(null); setIaAutoAviso(null)
  }

  const explicarConIA = async () => {
    if (!resolviendo) return
    setIaExplicando(true); setIaExplicacion(null); setIaError(null)
    try {
      setIaExplicacion(await iaExplicarConflicto(resolviendo, soluciones))
    } catch (e) {
      setIaError(e instanceof Error ? e.message : 'No se pudo explicar con IA.')
    } finally {
      setIaExplicando(false)
    }
  }

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const [c, p, emps] = await Promise.all([
        planificacionService.listarPlanDia(diaActual),
        planificacionService.listarPlantillas(),
        planificacionService.listarEmpleadosConHabilidades()
      ])
      setCola(c)
      setPlantillas(p.filter(pl => pl.activa))
      setEmpleados(emps.map(e => ({ id: e.id, nombre_completo: e.nombre_completo })))
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
    setResolucionManualNota(null)
    cargar()
  }, [cargar])

  // #16 Defaults inteligentes: cuando se abre la sección "Resolver manualmente" y hay un conflicto activo,
  // pre-cargar campos con valores razonables para que el usuario sólo confirme.
  useEffect(() => {
    if (!manualAbierto || !resolviendo) return
    const conflicto = resolviendo.conflicto
    // Empleado pre-seleccionado: el preferido bloqueado (lo más común que el usuario querrá forzar).
    if (conflicto?.preferidoBloqueadoId) setManualEmpleadoId(conflicto.preferidoBloqueadoId)
    // Hora pre-cargada: el primer minuto posible de la ventana.
    if (conflicto?.desdeColocacion != null) {
      setManualHora(minToTime(conflicto.desdeColocacion).slice(0, 5))
    }
    // Secuencia: por default proponemos "primera plantilla culpable termina antes que la conflictiva".
    const primeraCulpable = conflicto?.culpablesPlantillaIds?.[0]
    if (primeraCulpable) {
      setManualSecuenciaA(primeraCulpable)
      setManualSecuenciaB(resolviendo.plantillaId)
      // Prioridad: candidato natural a bajar es la culpable.
      setManualPrioridadId(primeraCulpable)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualAbierto])

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

  // Override del empleado preferido del proceso para este día. '' = heredar plantilla,
  // '__ninguno__' = sin preferido este día, otro = fijar ese empleado.
  const cambiarPreferido = async (id: string, valor: string) => {
    const modo = valor === '' ? 'heredar' : valor === '__ninguno__' ? 'ninguno' : 'fijar'
    const override = modo === 'fijar' ? valor : null
    setCola(prev => prev.map(i => i.id === id ? { ...i, empleado_preferido_modo: modo, empleado_preferido_override_id: override } : i))
    try {
      await planificacionService.actualizarPlanDiaItem(id, { empleado_preferido_modo: modo, empleado_preferido_override_id: override })
      setPreparada(null)
    } catch (err) {
      console.error('Error actualizando empleado preferido:', err)
    }
  }
  const valorSelectPreferido = (item: PlanDiaItem): string =>
    item.empleado_preferido_modo === 'fijar' ? (item.empleado_preferido_override_id ?? '')
      : item.empleado_preferido_modo === 'ninguno' ? '__ninguno__' : ''
  const nombreEmpleado = (id: string | null | undefined) => empleados.find(e => e.id === id)?.nombre_completo

  const generar = async () => {
    setGenerando(true)
    setResolviendo(null)
    setSoluciones([])
    setIaRepaso(null); setIaAutoAviso(null); setIaError(null); setIaExplicacion(null)
    setComandoPreview(null); setComandoTexto('')
    try {
      const prep = await generarParaDia(diaActual)
      setPreparada(prep)
      setOverrides({})
      setResolucionManualNota(null)
      // La IA repasa el plan automáticamente (si hay internet y está habilitada).
      void repasarSiDisponible(prep)
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
    // Reset del editor manual al cambiar de conflicto.
    setManualAbierto(false)
    setPorQueAbierto(false)
    setManualEmpleadoId('')
    setManualFranjas([])
    setNuevaFranjaEmp(''); setNuevaFranjaDesde(''); setNuevaFranjaHasta('')
    setManualNota('')
    setManualPreview(null)
    setIaExplicacion(null)
  }

  const aplicarSolucion = (s: SolucionConflicto) => {
    aplicarOverrideDelta(s.overrideDelta)
  }

  // ===== Resolución manual =====

  // Convierte "HH:MM" → minutos del día. Devuelve null si está vacío o inválido.
  const hhmmAMin = (v: string): number | null => {
    if (!v) return null
    const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
    if (!m) return null
    const h = parseInt(m[1], 10), mi = parseInt(m[2], 10)
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null
    return h * 60 + mi
  }

  // Arma un SchedulerOverrides a partir de las palancas del editor manual.
  // No valida (es resolución manual; el usuario asume lo que pone).
  const construirDeltaManual = (): SchedulerOverrides | null => {
    if (!resolviendo) return null
    const delta: SchedulerOverrides = {}

    // 1) Empleado forzado para la etapa en conflicto.
    //    Si "fijar al proceso completo" (#9) está activo, generamos un PIN por cada etapa × lote.
    if (manualEmpleadoId) {
      if (manualFijarCompleto) {
        const plantilla = preparada?.ctx.plantillasConEtapas.find(p => p.id === resolviendo.plantillaId)
        const planItem = preparada?.ctx.planDia.find(p => p.plantillaId === resolviendo.plantillaId)
        if (plantilla && planItem && plantilla.etapas) {
          const pins: { plantillaId: string; lote: number; etapaOrden: number; empleadoId: string }[] = []
          for (let lote = 1; lote <= planItem.cantidadLotes; lote++) {
            for (const etapa of plantilla.etapas) {
              pins.push({ plantillaId: resolviendo.plantillaId, lote, etapaOrden: etapa.orden, empleadoId: manualEmpleadoId })
            }
          }
          delta.asignacionFijada = pins
        }
      } else {
        delta.asignacionFijada = [{
          plantillaId: resolviendo.plantillaId,
          lote: resolviendo.lote,
          etapaOrden: resolviendo.etapa.orden,
          empleadoId: manualEmpleadoId
        }]
      }
    }

    // 2) #7 Forzar hora de inicio de la etapa en conflicto.
    const horaMin = hhmmAMin(manualHora)
    if (horaMin != null) {
      delta.inicioFijado = [{
        plantillaId: resolviendo.plantillaId,
        lote: resolviendo.lote,
        etapaOrden: resolviendo.etapa.orden,
        inicioMin: horaMin
      }]
    }

    // 3) Franjas extra ad-hoc.
    const franjas: Record<string, { desde: number; hasta: number; origen: 'extra'; etiqueta?: string }[]> = {}
    for (const f of manualFranjas) {
      const d = hhmmAMin(f.desde), h = hhmmAMin(f.hasta)
      if (d == null || h == null || h <= d) continue
      if (!franjas[f.empleadoId]) franjas[f.empleadoId] = []
      franjas[f.empleadoId].push({ desde: d, hasta: h, origen: 'extra', etiqueta: 'Manual' })
    }
    if (Object.keys(franjas).length > 0) delta.franjasExtra = franjas

    // 4) #10 Forzar secuencia entre procesos.
    if (manualSecuenciaA && manualSecuenciaB && manualSecuenciaA !== manualSecuenciaB) {
      delta.secuenciaProcesos = [{
        antesPlantillaId: manualSecuenciaA,
        despuesPlantillaId: manualSecuenciaB
      }]
    }

    // 5) #12 Cambiar prioridad de un proceso.
    if (manualPrioridadId && manualPrioridadVal >= 1 && manualPrioridadVal <= 10) {
      delta.prioridadPlantilla = { [manualPrioridadId]: manualPrioridadVal }
    }

    // 6) #26 Override de duración para la etapa en conflicto.
    if (typeof manualDuracion === 'number' && manualDuracion > 0) {
      delta.duracionFijada = [{
        plantillaId: resolviendo.plantillaId,
        lote: resolviendo.lote,
        etapaOrden: resolviendo.etapa.orden,
        duracionMin: manualDuracion
      }]
    }

    // 7) #25 Ayudantes para la etapa en conflicto.
    if (manualAyudantes.length > 0) {
      delta.ayudantesFijados = [{
        plantillaId: resolviendo.plantillaId,
        lote: resolviendo.lote,
        etapaOrden: resolviendo.etapa.orden,
        empleadosIds: manualAyudantes
      }]
    }

    return delta
  }

  // Simula el delta manual sobre los overrides actuales y muestra el resumen.
  const previsualizarManual = () => {
    if (!preparada) return
    const delta = construirDeltaManual()
    if (!delta) return
    const fusionados = fusionarOverrides(overrides, delta)
    const resultado = generarCronograma(preparada.ctx, fusionados)
    const conflictos = resultado.conflictos.filter(c => !c.cascada).length
    let fuera = 0
    for (const inst of resultado.instancias) {
      for (const a of inst.asignaciones) if (a.enFranjaExtra) {
        for (const iv of a.ventanasAbs) fuera += Math.max(0, iv.fin - iv.inicio)
      }
    }
    // #14 Calcular diff vs el resultado base (overrides actuales SIN delta nuevo).
    const cambios = calcularDiffInstancias(preparada.resultado, resultado)
    setManualPreview({ conflictos, cierre: resultado.cierreJornada, fuera, cambios })
  }

  // Calcula el diff entre dos resultados del scheduler. Devuelve una lista de cambios legibles.
  const calcularDiffInstancias = (base: ResultadoScheduler, nuevo: ResultadoScheduler): string[] => {
    const cambios: string[] = []
    const baseMap = new Map(base.instancias.map(i => [`${i.plantillaId}:${i.lote}:${i.etapa.orden}`, i]))
    for (const inst of nuevo.instancias) {
      const key = `${inst.plantillaId}:${inst.lote}:${inst.etapa.orden}`
      const prev = baseMap.get(key)
      const nombre = `${inst.plantillaNombre} · ${inst.etapa.nombre}${inst.lote > 1 ? ` (lote ${inst.lote})` : ''}`
      // Pasó de conflicto → colocada
      if ((prev?.estado === 'conflicto' || !prev) && inst.estado === 'colocada' && inst.inicioAbs != null) {
        const emp = inst.asignaciones[0]?.empleadoNombre.split(' ')[0] ?? '—'
        cambios.push(`✓ "${nombre}" ahora se ubica a las ${minToTime(inst.inicioAbs).slice(0, 5)} con ${emp}`)
        continue
      }
      // Pasó de colocada → conflicto
      if (prev?.estado === 'colocada' && inst.estado === 'conflicto') {
        cambios.push(`⛔ "${nombre}" ya no se puede ubicar`)
        continue
      }
      // Cambió de hora
      if (prev?.inicioAbs != null && inst.inicioAbs != null && prev.inicioAbs !== inst.inicioAbs) {
        cambios.push(`⏱ "${nombre}" se movió de ${minToTime(prev.inicioAbs).slice(0, 5)} a ${minToTime(inst.inicioAbs).slice(0, 5)}`)
      }
      // Cambió de empleado principal
      const empPrev = prev?.asignaciones[0]?.empleadoId
      const empNuevo = inst.asignaciones[0]?.empleadoId
      if (empPrev && empNuevo && empPrev !== empNuevo) {
        const nombreNuevo = inst.asignaciones[0].empleadoNombre.split(' ')[0]
        cambios.push(`👤 "${nombre}" cambia de empleado a ${nombreNuevo}`)
      }
    }
    return cambios.slice(0, 12)   // limitar a 12 para no saturar el panel
  }

  // Limpia TODOS los campos del form manual a sus valores por default. No cierra la sección.
  // #13 Resetear overrides manuales.
  const resetearManual = () => {
    setManualEmpleadoId('')
    setManualFijarCompleto(false)
    setManualHora('')
    setManualFranjas([])
    setNuevaFranjaEmp(''); setNuevaFranjaDesde(''); setNuevaFranjaHasta('')
    setManualSecuenciaA(''); setManualSecuenciaB('')
    setManualPrioridadId(''); setManualPrioridadVal(5)
    setManualDuracion('')
    setManualAyudantes([]); setNuevoAyudanteId('')
    setManualNota('')
    setManualPreview(null)
  }

  // #22 Guardar el formulario actual como template (con un nombre del usuario).
  const guardarTemplate = () => {
    if (!nuevoTemplateNombre.trim()) return
    const campos: TemplateCampos = {
      empleadoId: manualEmpleadoId || undefined,
      fijarCompleto: manualFijarCompleto || undefined,
      hora: manualHora || undefined,
      franjas: manualFranjas.length > 0 ? manualFranjas : undefined,
      secuenciaA: manualSecuenciaA || undefined,
      secuenciaB: manualSecuenciaB || undefined,
      prioridadId: manualPrioridadId || undefined,
      prioridadVal: manualPrioridadId ? manualPrioridadVal : undefined,
      duracion: typeof manualDuracion === 'number' ? manualDuracion : undefined,
      ayudantes: manualAyudantes.length > 0 ? manualAyudantes : undefined,
      nota: manualNota || undefined
    }
    const nuevos = [...templates.filter(t => t.nombre !== nuevoTemplateNombre.trim()), { nombre: nuevoTemplateNombre.trim(), campos }]
    setTemplates(nuevos)
    guardarTemplatesEnStorage(nuevos)
    setNuevoTemplateNombre('')
  }
  const cargarTemplate = (nombre: string) => {
    const tpl = templates.find(t => t.nombre === nombre)
    if (!tpl) return
    resetearManual()
    const c = tpl.campos
    if (c.empleadoId) setManualEmpleadoId(c.empleadoId)
    if (c.fijarCompleto) setManualFijarCompleto(true)
    if (c.hora) setManualHora(c.hora)
    if (c.franjas) setManualFranjas(c.franjas)
    if (c.secuenciaA) setManualSecuenciaA(c.secuenciaA)
    if (c.secuenciaB) setManualSecuenciaB(c.secuenciaB)
    if (c.prioridadId) setManualPrioridadId(c.prioridadId)
    if (c.prioridadVal) setManualPrioridadVal(c.prioridadVal)
    if (c.duracion) setManualDuracion(c.duracion)
    if (c.ayudantes) setManualAyudantes(c.ayudantes)
    if (c.nota) setManualNota(c.nota)
  }
  const eliminarTemplate = (nombre: string) => {
    if (!confirm(`¿Eliminar el template "${nombre}"?`)) return
    const nuevos = templates.filter(t => t.nombre !== nombre)
    setTemplates(nuevos)
    guardarTemplatesEnStorage(nuevos)
    if (templateSeleccionado === nombre) setTemplateSeleccionado('')
  }

  const aplicarManual = () => {
    const delta = construirDeltaManual()
    if (!delta) return
    aplicarOverrideDelta(delta)
    // Guardar la nota (o '' si no la escribió) para que al aplicar al cronograma se persista en
    // notas_provisoria y se marque la tarea como provisoria.
    setResolucionManualNota(manualNota || '')
    setManualAbierto(false)
    resetearManual()
  }

  // #19 Aplica y cierra el modal — vuelve a la lista de conflictos del día.
  const aplicarManualYCerrar = () => {
    aplicarManual()
    setResolviendo(null)
    setSoluciones([])
  }

  // #20 Sugerir solución óptima automática.
  // Prueba candidatos (cada empleado como PIN con franja extra adaptativa + relajar tope) y carga
  // los campos del form con la mejor combinación según ranking (conflictos, fuera de turno, cierre).
  const sugerirSolucionOptima = () => {
    if (!preparada || !resolviendo) return
    type Cand = {
      label: string
      delta: SchedulerOverrides
      conflictos: number
      fuera: number
      cierre: number | null
      // Para reconstruir el form si gana:
      empleadoId?: string
      franjas?: { empleadoId: string; desde: string; hasta: string }[]
      relajarTope?: boolean
    }
    const candidatos: Cand[] = []
    const conflicto = resolviendo.conflicto
    const desde0 = conflicto?.desdeColocacion
    const tope = conflicto?.topeColocacion
    const lead = conflicto?.leadBloqueo ?? resolviendo.etapa.duracion_proceso
    const dur = resolviendo.etapa.duracion_proceso
    const evaluar = (delta: SchedulerOverrides): { conflictos: number; fuera: number; cierre: number | null } => {
      const fus = fusionarOverrides(overrides, delta)
      const r = generarCronograma(preparada.ctx, fus)
      let f = 0
      for (const i of r.instancias) for (const a of i.asignaciones) if (a.enFranjaExtra) for (const iv of a.ventanasAbs) f += iv.fin - iv.inicio
      return { conflictos: r.conflictos.filter(c => !c.cascada).length, fuera: f, cierre: r.cierreJornada }
    }
    // Cand 1..N: cada empleado como PIN. Si tiene turno hoy, una franja extra calculada para entrar 'lead' min antes del inicio normal.
    for (const emp of preparada.ctx.empleados) {
      const turnoIni = emp.franjas.filter(f => f.origen === 'turno').reduce((m, f) => Math.min(m, f.desde), Number.POSITIVE_INFINITY)
      const turnoFin = emp.franjas.filter(f => f.origen === 'turno').reduce((m, f) => Math.max(m, f.hasta), 0)
      if (!Number.isFinite(turnoIni) || turnoFin === 0) continue
      let delta: SchedulerOverrides = {
        asignacionFijada: [{ plantillaId: resolviendo.plantillaId, lote: resolviendo.lote, etapaOrden: resolviendo.etapa.orden, empleadoId: emp.id }]
      }
      let franjas: { empleadoId: string; desde: string; hasta: string }[] = []
      // Si su turno no cubre la ventana, agregar franja extra adaptativa.
      if (desde0 != null && tope != null && turnoIni > desde0) {
        const ancla = Math.max(desde0, Math.min(tope, turnoIni))
        const desde = Math.max(0, ancla - lead)
        const hasta = Math.max(ancla + dur, turnoFin)
        delta = fusionarOverrides(delta, {
          franjasExtra: { [emp.id]: [{ desde, hasta, origen: 'extra', etiqueta: 'Sugerencia' }] }
        })
        franjas = [{ empleadoId: emp.id, desde: minToTime(desde).slice(0, 5), hasta: minToTime(hasta).slice(0, 5) }]
      }
      const m = evaluar(delta)
      candidatos.push({
        label: `PIN ${emp.nombre_completo.split(' ')[0]}${franjas.length > 0 ? ' + franja extra' : ''}`,
        delta, ...m, empleadoId: emp.id, franjas
      })
    }
    // Cand: relajar tope de inicio del proceso (si tiene).
    if (tope != null && tope < 1440) {
      const delta: SchedulerOverrides = { relajarTopeInicio: [resolviendo.plantillaId] }
      const m = evaluar(delta)
      candidatos.push({ label: 'Relajar tope de inicio', delta, ...m, relajarTope: true })
    }
    if (candidatos.length === 0) { alert('No encontré candidatos para sugerir.'); return }
    // Ranking: 1) menos conflictos, 2) menos fuera de turno, 3) cierre más temprano.
    candidatos.sort((a, b) =>
      a.conflictos - b.conflictos ||
      a.fuera - b.fuera ||
      (a.cierre ?? 9999) - (b.cierre ?? 9999)
    )
    const ganadora = candidatos[0]
    // Cargar el form con la sugerencia y resaltarla en el preview.
    resetearManual()
    if (ganadora.empleadoId) setManualEmpleadoId(ganadora.empleadoId)
    if (ganadora.franjas && ganadora.franjas.length > 0) setManualFranjas(ganadora.franjas)
    setManualPreview({
      conflictos: ganadora.conflictos,
      cierre: ganadora.cierre,
      fuera: ganadora.fuera,
      cambios: [`💡 Sugerencia automática: ${ganadora.label}`]
    })
    setManualNota(`Sugerencia óptima: ${ganadora.label}`)
  }

  const agregarFranjaManual = () => {
    if (!nuevaFranjaEmp || !nuevaFranjaDesde || !nuevaFranjaHasta) return
    if (hhmmAMin(nuevaFranjaDesde) == null || hhmmAMin(nuevaFranjaHasta) == null) return
    setManualFranjas(prev => [...prev, { empleadoId: nuevaFranjaEmp, desde: nuevaFranjaDesde, hasta: nuevaFranjaHasta }])
    setNuevaFranjaEmp(''); setNuevaFranjaDesde(''); setNuevaFranjaHasta('')
    setManualPreview(null)
  }

  const eliminarFranjaManual = (idx: number) => {
    setManualFranjas(prev => prev.filter((_, i) => i !== idx))
    setManualPreview(null)
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
    const conResolucionManual = resolucionManualNota !== null
    const mensajeExtra = conResolucionManual
      ? ' Las tareas resultantes quedarán marcadas como PROVISORIAS (borde discontinuo) hasta que las confirmes desde el cronograma.'
      : ''
    if (!confirm(`Se reemplazarán las tareas generadas previamente del ${DIAS_SEMANA_NOMBRES[diaActual]} (las manuales y bloqueadas se conservan). Se guarda un backup.${mensajeExtra} ¿Continuar?`)) return
    setAplicando(true)
    try {
      await aplicarResultado(
        diaActual,
        preparada.resultado,
        preparada.idsReemplazables,
        conResolucionManual ? { esProvisoria: true, notasProvisoria: resolucionManualNota || null } : undefined
      )
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
                      <th className="text-center px-1 py-2 font-bold text-slate-600" title="Empleado preferido del proceso (solo este día)">Empleado</th>
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
                            className="w-[78px] h-7 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <input type="time" value={item.hora_inicio_max?.slice(0, 5) ?? ''}
                            onChange={e => cambiarHorario(item.id, 'hora_inicio_max', e.target.value)}
                            className="w-[78px] h-7 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <input type="time" value={item.hora_fin_max?.slice(0, 5) ?? ''}
                            onChange={e => cambiarHorario(item.id, 'hora_fin_max', e.target.value)}
                            className="w-[78px] h-7 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </td>
                        <td className="px-1 py-1.5">
                          <select value={valorSelectPreferido(item)}
                            onChange={e => cambiarPreferido(item.id, e.target.value)}
                            className="w-full max-w-[150px] h-7 px-1 text-[11px] bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400">
                            <option value="">Heredar{nombreEmpleado(item.plantilla?.empleado_preferido_id) ? ` (${nombreEmpleado(item.plantilla?.empleado_preferido_id)})` : ' (sin preferido)'}</option>
                            {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre_completo}</option>)}
                            <option value="__ninguno__">Sin preferido este día</option>
                          </select>
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <button onClick={() => eliminarItem(item.id)} className="text-red-500 hover:text-red-700"><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ))}
                    {cola.length === 0 && (
                      <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-400">Cola vacía — agregá plantillas abajo</td></tr>
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
                    className="w-[78px] h-8 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <input type="time" value={nuevoInicioMax} title="Tope de inicio (opcional)"
                    onChange={e => setNuevoInicioMax(e.target.value)}
                    className="w-[78px] h-8 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <input type="time" value={nuevoFinMax} title="Fin (opcional)"
                    onChange={e => setNuevoFinMax(e.target.value)}
                    className="w-[78px] h-8 px-1 text-center bg-white text-slate-900 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
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

              {/* ===== Repaso de la IA (automático) ===== */}
              {(iaRepasando || iaRepaso || iaAutoAviso || iaError) && (
                <div className="border border-violet-200 rounded-lg bg-violet-50/40 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-[12px] font-bold text-violet-700">
                    <Sparkles size={13} /> Repaso de la IA
                    {iaRepasando && <Loader2 size={12} className="animate-spin text-violet-500" />}
                  </div>

                  {iaRepasando && (
                    <div className="text-[12px] text-slate-500 flex items-center gap-1.5">
                      <span className="inline-flex gap-0.5">
                        <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                      {PASOS_IA[iaPaso]}
                    </div>
                  )}
                  {iaError && <div className="text-[12px] text-rose-600">{iaError}</div>}

                  {iaAutoAviso && (
                    <div className="border border-emerald-200 bg-emerald-50 rounded p-2 text-[12px]">
                      <div className="font-semibold text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 size={12} /> La IA aplicó una mejora: {iaAutoAviso.titulo}
                      </div>
                      {iaAutoAviso.diff.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-slate-600 pl-1">
                          {iaAutoAviso.diff.map((c, i) => <li key={i}>{c}</li>)}
                        </ul>
                      )}
                      <div className="text-[11px] text-slate-400 mt-1">Se guardó como cambio del plan. Volvé a generar para descartarlo.</div>
                    </div>
                  )}

                  {iaRepaso && iaRepaso.diagnostico.length > 0 && (
                    <div className="space-y-1">
                      {iaRepaso.diagnostico.map((d, i) => (
                        <div key={i} className="text-[12px] flex items-start gap-1.5">
                          <span className={`flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${
                            d.severidad === 'alta' ? 'bg-rose-100 text-rose-700'
                              : d.severidad === 'media' ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-600'}`}>{d.severidad}</span>
                          <span><span className="font-semibold text-slate-700">{d.titulo}:</span> <span className="text-slate-600">{d.detalle}</span></span>
                        </div>
                      ))}
                    </div>
                  )}

                  {iaRepaso && !iaRepaso.autoAplicable && iaRepaso.opciones.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider font-bold text-violet-600">Opciones para mejorar</div>
                      {iaRepaso.opciones.map((op, i) => (
                        <div key={i} className="border border-slate-200 rounded bg-white px-3 py-2">
                          <div className="text-[12px] font-semibold text-slate-800">{op.titulo}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{op.justificacion}</div>
                          <div className="text-[11px] text-slate-500 mt-1 flex gap-2 flex-wrap">
                            {op.metricas.conflictos === 0
                              ? <span className="text-emerald-600 font-semibold">Sin conflictos</span>
                              : <span className="text-amber-600">{op.metricas.conflictos} conflicto(s)</span>}
                            {op.metricas.cierreJornada != null && <span>· cierre {minToTime(op.metricas.cierreJornada)}</span>}
                          </div>
                          {op.diff.length > 0 && (
                            <ul className="text-[11px] text-slate-500 mt-1 space-y-0.5 pl-1">
                              {op.diff.slice(0, 5).map((c, j) => <li key={j}>{c}</li>)}
                            </ul>
                          )}
                          <button onClick={() => aplicarOpcionIA(op)}
                            className="mt-1.5 h-6 px-3 text-[11px] font-semibold text-white bg-violet-600 rounded hover:bg-violet-700">
                            Aplicar esta opción
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {iaRepaso && !iaRepasando && !iaAutoAviso && iaRepaso.opciones.length === 0 && iaRepaso.diagnostico.length === 0 && (
                    <div className="text-[12px] text-slate-500">La IA no encontró mejoras: el plan está bien así.</div>
                  )}
                </div>
              )}

              {/* ===== Comando en lenguaje natural ===== */}
              {iaEstado.disponible && (
                <div className="border border-slate-200 rounded-lg bg-white p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700">
                    <Sparkles size={13} className="text-violet-600" /> Pedile un cambio a la IA
                  </div>
                  <div className="flex gap-2">
                    <input value={comandoTexto} onChange={e => setComandoTexto(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') interpretarComando() }}
                      placeholder="Ej: traé a Romina de 6 a 8 y bajá la prioridad del salado"
                      className="flex-1 h-8 px-3 rounded-md border border-slate-300 text-[12px] focus:outline-none focus:ring-2 focus:ring-violet-300" />
                    <button onClick={interpretarComando} disabled={comandoCargando || !comandoTexto.trim()}
                      className="h-8 px-3 text-[12px] font-semibold text-white bg-violet-600 rounded hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1 flex-shrink-0">
                      {comandoCargando ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Interpretar
                    </button>
                  </div>
                  {comandoPreview && (
                    <div className="border border-slate-200 rounded p-2 text-[12px] space-y-1 bg-slate-50">
                      <div className="text-slate-700"><span className="font-semibold">Entendí:</span> {comandoPreview.resumenInterpretacion}</div>
                      {comandoPreview.advertencias.length > 0 && (
                        <ul className="text-amber-600 text-[11px] space-y-0.5">{comandoPreview.advertencias.map((a, i) => <li key={i}>⚠ {a}</li>)}</ul>
                      )}
                      {comandoPreview.errores && comandoPreview.errores.length > 0 && (
                        <div className="text-rose-600 text-[11px]">No se pudo aplicar: {comandoPreview.errores.join('; ')}</div>
                      )}
                      {comandoPreview.overrideDelta && comandoPreview.metricas && (
                        <>
                          <div className="text-[11px] text-slate-500 flex gap-2 flex-wrap">
                            {comandoPreview.metricas.conflictos === 0
                              ? <span className="text-emerald-600 font-semibold">Sin conflictos</span>
                              : <span className="text-amber-600">{comandoPreview.metricas.conflictos} conflicto(s)</span>}
                            {comandoPreview.metricas.cierreJornada != null && <span>· cierre {minToTime(comandoPreview.metricas.cierreJornada)}</span>}
                          </div>
                          {comandoPreview.diff && comandoPreview.diff.length > 0 && (
                            <ul className="text-[11px] text-slate-500 space-y-0.5 pl-1">{comandoPreview.diff.slice(0, 6).map((c, i) => <li key={i}>{c}</li>)}</ul>
                          )}
                          <div className="flex gap-2 pt-1">
                            <button onClick={aplicarComando} className="h-7 px-3 text-[11px] font-semibold text-white bg-violet-600 rounded hover:bg-violet-700">Aplicar</button>
                            <button onClick={() => setComandoPreview(null)} className="h-7 px-3 text-[11px] font-semibold text-slate-600 border border-slate-300 rounded hover:bg-slate-100">Descartar</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
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
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-[13px] font-semibold text-slate-800 flex-1">
                  Resolver: {resolviendo.plantillaNombre} · {resolviendo.etapa.nombre} (lote {resolviendo.lote})
                </div>
                {/* #28 Botón "¿Por qué?" */}
                {resolviendo.conflicto?.decisionesScheduler && resolviendo.conflicto.decisionesScheduler.length > 0 && (
                  <button onClick={() => setPorQueAbierto(v => !v)}
                          className="h-6 px-2 text-[11px] font-semibold text-slate-600 border border-slate-300 bg-white rounded hover:bg-slate-100 flex items-center gap-1">
                    🔍 ¿Por qué? {porQueAbierto ? '▾' : '▸'}
                  </button>
                )}
                {/* Explicar con IA (sub-caso del repaso) */}
                {iaEstado.disponible && (
                  <button onClick={explicarConIA} disabled={iaExplicando}
                          className="h-6 px-2 text-[11px] font-semibold text-violet-700 border border-violet-300 bg-violet-50 rounded hover:bg-violet-100 flex items-center gap-1 disabled:opacity-50">
                    {iaExplicando ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Explicar con IA
                  </button>
                )}
              </div>
              <div className="text-[12px] text-amber-600">{resolviendo.conflicto?.mensaje}</div>
              {/* Explicación de la IA */}
              {iaExplicacion && (
                <div className="bg-violet-50 border border-violet-200 rounded p-2.5 text-[12px] space-y-1">
                  <div className="flex items-center gap-1 text-[11px] font-bold text-violet-700"><Sparkles size={11} /> Explicación de la IA</div>
                  <div className="text-slate-700">{iaExplicacion.explicacion}</div>
                  {iaExplicacion.recomendacionSolucionId && (
                    <div className="text-slate-600"><span className="font-semibold">Recomendación:</span> {iaExplicacion.porQueRecomendada}</div>
                  )}
                </div>
              )}
              {/* #28 Panel desplegable con las decisiones del scheduler */}
              {porQueAbierto && resolviendo.conflicto?.decisionesScheduler && (
                <div className="bg-slate-50 border border-slate-200 rounded p-2.5 text-[11px] space-y-0.5">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">
                    Decisiones del scheduler (debug):
                  </div>
                  {resolviendo.conflicto.decisionesScheduler.map((d, i) => (
                    <div key={i} className="text-slate-700">• {d}</div>
                  ))}
                </div>
              )}
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
                                {iaExplicacion?.recomendacionSolucionId === s.id && (
                                  <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-700 bg-violet-100 rounded flex items-center gap-0.5"><Sparkles size={9} /> IA sugiere</span>
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

              {/* ===== Sección "Resolver manualmente" ===== */}
              <div className="mt-4 border-t border-slate-200 pt-3">
                <button
                  onClick={() => setManualAbierto(v => !v)}
                  className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700 hover:text-slate-900"
                >
                  <Wrench size={13} /> 🔧 Resolver manualmente {manualAbierto ? '▾' : '▸'}
                </button>
                {manualAbierto && (
                  <div className="mt-2 space-y-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[11px] text-slate-500 flex-1 min-w-[200px]">
                        Ajustes ad-hoc para este conflicto. Usá <span className="font-semibold">Previsualizar</span> para ver el impacto.
                      </p>
                      {/* #20 Sugerir solución óptima */}
                      <button onClick={sugerirSolucionOptima}
                              className="h-7 px-3 text-[11px] font-semibold text-amber-700 border border-amber-300 bg-amber-50 rounded hover:bg-amber-100 flex items-center gap-1">
                        💡 Sugerir solución óptima
                      </button>
                    </div>

                    {/* #22 Templates guardados — cargar / guardar / eliminar */}
                    <div className="flex items-center gap-1.5 flex-wrap bg-blue-50/60 border border-blue-200 rounded p-1.5">
                      <span className="text-[10px] font-semibold text-blue-800">🗂 Templates:</span>
                      <select value={templateSeleccionado}
                              onChange={e => { setTemplateSeleccionado(e.target.value); if (e.target.value) cargarTemplate(e.target.value) }}
                              className="flex-1 min-w-[120px] h-7 px-1 text-[11px] bg-white border border-blue-300 rounded">
                        <option value="">— cargar template guardado —</option>
                        {templates.map(t => <option key={t.nombre} value={t.nombre}>{t.nombre}</option>)}
                      </select>
                      {templateSeleccionado && (
                        <button onClick={() => eliminarTemplate(templateSeleccionado)}
                                title="Eliminar template seleccionado"
                                className="h-7 px-2 text-[11px] text-rose-700 border border-rose-300 bg-white rounded hover:bg-rose-50">
                          <Trash2 size={11} className="inline" />
                        </button>
                      )}
                      <input type="text" value={nuevoTemplateNombre}
                             onChange={e => setNuevoTemplateNombre(e.target.value)}
                             placeholder="Nombre del nuevo template…"
                             className="flex-1 min-w-[140px] h-7 px-2 text-[11px] bg-white border border-blue-300 rounded" />
                      <button onClick={guardarTemplate}
                              disabled={!nuevoTemplateNombre.trim()}
                              className="h-7 px-2 text-[11px] font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-40">
                        + Guardar
                      </button>
                    </div>

                    {/* 1) Forzar empleado para la etapa en conflicto + #9 fijar al proceso completo */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-[11px] font-semibold text-slate-600 min-w-[140px]">
                          Asignar empleado:
                        </label>
                        <select
                          value={manualEmpleadoId}
                          onChange={e => { setManualEmpleadoId(e.target.value); setManualPreview(null) }}
                          className="flex-1 h-7 px-2 text-[12px] bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                        >
                          <option value="">— sin forzar (lo decide el scheduler) —</option>
                          {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre_completo}</option>)}
                        </select>
                      </div>
                      {manualEmpleadoId && (
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-600 ml-[140px]">
                          <input type="checkbox" checked={manualFijarCompleto}
                                 onChange={e => { setManualFijarCompleto(e.target.checked); setManualPreview(null) }} />
                          Fijar al proceso completo (todas las etapas y lotes)
                        </label>
                      )}
                    </div>

                    {/* #7 Forzar hora de inicio de la etapa */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="text-[11px] font-semibold text-slate-600 min-w-[140px]">
                        Forzar hora de inicio:
                      </label>
                      <input type="time" value={manualHora}
                             onChange={e => { setManualHora(e.target.value); setManualPreview(null) }}
                             className="w-[88px] h-7 px-1 text-center text-[11px] bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      <span className="text-[10px] text-slate-400">(vacío = la decide el scheduler)</span>
                    </div>

                    {/* 2) Franjas extra ad-hoc */}
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-slate-600">
                        Adelantar entrada / agregar franja extra:
                      </div>
                      {manualFranjas.length > 0 && (
                        <div className="space-y-1">
                          {manualFranjas.map((f, i) => (
                            <div key={i} className="flex items-center gap-2 text-[11px] bg-white border border-slate-200 rounded px-2 py-1">
                              <span className="flex-1 text-slate-700">
                                <span className="font-semibold">{nombreEmpleado(f.empleadoId) ?? f.empleadoId}</span>
                                {' '}— {f.desde} a {f.hasta}
                              </span>
                              <button onClick={() => eliminarFranjaManual(i)} className="text-rose-500 hover:text-rose-700">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <select
                          value={nuevaFranjaEmp}
                          onChange={e => setNuevaFranjaEmp(e.target.value)}
                          className="flex-1 min-w-[120px] h-7 px-2 text-[11px] bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                        >
                          <option value="">Empleado…</option>
                          {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre_completo}</option>)}
                        </select>
                        <input
                          type="time"
                          value={nuevaFranjaDesde}
                          onChange={e => setNuevaFranjaDesde(e.target.value)}
                          placeholder="Desde"
                          title="Desde"
                          className="w-[88px] h-7 px-1 text-center text-[11px] bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <input
                          type="time"
                          value={nuevaFranjaHasta}
                          onChange={e => setNuevaFranjaHasta(e.target.value)}
                          placeholder="Hasta"
                          title="Hasta"
                          className="w-[88px] h-7 px-1 text-center text-[11px] bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button
                          onClick={agregarFranjaManual}
                          disabled={!nuevaFranjaEmp || !nuevaFranjaDesde || !nuevaFranjaHasta}
                          className="h-7 px-2 text-[11px] font-semibold rounded bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 flex items-center gap-1"
                        >
                          <Plus size={11} /> Agregar
                        </button>
                      </div>
                    </div>

                    {/* #10 Forzar secuencia entre procesos: "A termina antes que B empiece" */}
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-slate-600">Forzar secuencia entre procesos:</div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <select value={manualSecuenciaA}
                                onChange={e => { setManualSecuenciaA(e.target.value); setManualPreview(null) }}
                                className="flex-1 min-w-[120px] h-7 px-1 text-[11px] bg-white border border-slate-300 rounded">
                          <option value="">Proceso A…</option>
                          {plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                        <span className="text-[10px] text-slate-500">termina antes de</span>
                        <select value={manualSecuenciaB}
                                onChange={e => { setManualSecuenciaB(e.target.value); setManualPreview(null) }}
                                className="flex-1 min-w-[120px] h-7 px-1 text-[11px] bg-white border border-slate-300 rounded">
                          <option value="">Proceso B…</option>
                          {plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* #12 Cambiar prioridad fina de un proceso */}
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-slate-600">Cambiar prioridad de un proceso:</div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <select value={manualPrioridadId}
                                onChange={e => { setManualPrioridadId(e.target.value); setManualPreview(null) }}
                                className="flex-1 min-w-[140px] h-7 px-1 text-[11px] bg-white border border-slate-300 rounded">
                          <option value="">Proceso…</option>
                          {plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                        <span className="text-[10px] text-slate-500">nueva prioridad:</span>
                        <input type="number" min={1} max={10} value={manualPrioridadVal}
                               onChange={e => { setManualPrioridadVal(Math.max(1, Math.min(10, parseInt(e.target.value) || 5))); setManualPreview(null) }}
                               className="w-14 h-7 px-1 text-center text-[11px] bg-white border border-slate-300 rounded" />
                        <span className="text-[10px] text-slate-400">(1=baja, 10=alta)</span>
                      </div>
                    </div>

                    {/* #26 Override de duración para esta etapa puntual */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="text-[11px] font-semibold text-slate-600 min-w-[140px]">
                        Duración de esta etapa:
                      </label>
                      <input type="number" min={1} value={manualDuracion}
                             placeholder={String(resolviendo?.etapa.duracion_proceso ?? '—')}
                             onChange={e => { const v = e.target.value; setManualDuracion(v === '' ? '' : Math.max(1, parseInt(v) || 0)); setManualPreview(null) }}
                             className="w-16 h-7 px-1 text-center text-[11px] bg-white border border-slate-300 rounded" />
                      <span className="text-[10px] text-slate-400">
                        min (default: {resolviendo?.etapa.duracion_proceso ?? '—'} min de la plantilla)
                      </span>
                    </div>

                    {/* #25 Ayudantes para esta etapa */}
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-slate-600">
                        Agregar ayudantes a esta etapa:
                      </div>
                      {manualAyudantes.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {manualAyudantes.map(empId => (
                            <span key={empId} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 text-[10px] text-blue-800">
                              {nombreEmpleado(empId) ?? empId}
                              <button onClick={() => { setManualAyudantes(prev => prev.filter(id => id !== empId)); setManualPreview(null) }}
                                      className="text-blue-500 hover:text-blue-700">✕</button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <select value={nuevoAyudanteId} onChange={e => setNuevoAyudanteId(e.target.value)}
                                className="flex-1 h-7 px-1 text-[11px] bg-white border border-slate-300 rounded">
                          <option value="">Empleado…</option>
                          {empleados.filter(e => !manualAyudantes.includes(e.id) && e.id !== manualEmpleadoId).map(e => <option key={e.id} value={e.id}>{e.nombre_completo}</option>)}
                        </select>
                        <button onClick={() => { if (nuevoAyudanteId) { setManualAyudantes(prev => [...prev, nuevoAyudanteId]); setNuevoAyudanteId(''); setManualPreview(null) } }}
                                disabled={!nuevoAyudanteId}
                                className="h-7 px-2 text-[11px] font-semibold rounded bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40">
                          <Plus size={11} className="inline" /> Sumar
                        </button>
                      </div>
                    </div>

                    {/* 3) Nota libre */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">Nota (para la resolución):</label>
                      <textarea
                        value={manualNota}
                        onChange={e => setManualNota(e.target.value)}
                        rows={2}
                        placeholder="Ej.: traigo a Romina antes para liberar a Sebastian del horno"
                        className="w-full px-2 py-1 text-[11px] bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                      />
                    </div>

                    {/* 4) Previsualización + #14 lista de cambios concretos */}
                    {manualPreview && (
                      <div className="text-[11px] bg-white border border-slate-200 rounded p-2 space-y-1.5">
                        <div className="flex items-center gap-3 flex-wrap">
                          {manualPreview.conflictos === 0
                            ? <span className="text-emerald-700 font-semibold">✓ Sin conflictos</span>
                            : <span className="text-amber-700 font-semibold">⚠ {manualPreview.conflictos} conflicto(s) restante(s)</span>}
                          {manualPreview.cierre != null && <span className="text-slate-600">· cierre {minToTime(manualPreview.cierre)}</span>}
                          {manualPreview.fuera > 0 && <span className="text-slate-600">· {formatDuration(manualPreview.fuera)} fuera de turno</span>}
                        </div>
                        {manualPreview.cambios && manualPreview.cambios.length > 0 && (
                          <div className="border-t border-slate-100 pt-1.5">
                            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Cambios respecto al estado actual:</div>
                            <ul className="space-y-0.5 text-slate-700">
                              {manualPreview.cambios.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 5) Botones */}
                    {(() => {
                      // Habilitamos los botones si hay AL MENOS un override cargado.
                      const tieneAlgo = !!manualEmpleadoId || manualFranjas.length > 0 || !!manualHora ||
                        (!!manualSecuenciaA && !!manualSecuenciaB && manualSecuenciaA !== manualSecuenciaB) ||
                        !!manualPrioridadId ||
                        (typeof manualDuracion === 'number' && manualDuracion > 0) ||
                        manualAyudantes.length > 0
                      return (
                        <div className="flex items-center gap-2 justify-end pt-1 flex-wrap">
                          {/* #13 Resetear */}
                          <button onClick={resetearManual}
                                  disabled={!tieneAlgo}
                                  title="Limpiar todos los campos de la sección manual"
                                  className="h-7 px-3 text-[11px] font-semibold text-slate-600 border border-slate-300 bg-white rounded hover:bg-slate-100 disabled:opacity-40 mr-auto">
                            Resetear
                          </button>
                          <button onClick={previsualizarManual}
                                  disabled={!tieneAlgo}
                                  className="h-7 px-3 text-[11px] font-semibold text-slate-700 border border-slate-300 bg-white rounded hover:bg-slate-100 disabled:opacity-40">
                            Previsualizar
                          </button>
                          <button onClick={aplicarManual}
                                  disabled={!tieneAlgo}
                                  className="h-7 px-3 text-[11px] font-semibold text-white bg-violet-600 rounded hover:bg-violet-700 disabled:opacity-40">
                            Aplicar
                          </button>
                          {/* #19 Aplicar y cerrar modal */}
                          <button onClick={aplicarManualYCerrar}
                                  disabled={!tieneAlgo}
                                  title="Aplicar y volver a la lista de conflictos"
                                  className="h-7 px-3 text-[11px] font-semibold text-white bg-violet-700 rounded hover:bg-violet-800 disabled:opacity-40">
                            Aplicar y cerrar
                          </button>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Barra de acciones */}
      <div className="flex-shrink-0 bg-white border-t border-slate-200 px-5 py-3">
        <div className="max-w-[900px] mx-auto flex items-center justify-between">
          <button onClick={onVolver} className="h-9 px-3 text-sm font-semibold text-slate-700 border border-slate-300 rounded hover:bg-slate-100">Volver</button>
          <div className="flex items-center gap-2">
            {onIrAEditorManual && (
              <button onClick={onIrAEditorManual}
                className="h-9 px-3 text-sm font-semibold text-violet-700 border border-violet-300 bg-violet-50 rounded hover:bg-violet-100 flex items-center gap-1.5"
                title="Editor manual libre del día (mover las fichas)">
                <Wrench size={14} /> Editor manual
              </button>
            )}
            <button onClick={generar} disabled={generando || cola.length === 0}
              className="h-9 px-3 text-sm font-semibold text-blue-700 border border-blue-300 bg-blue-50 rounded hover:bg-blue-100 disabled:opacity-40 flex items-center gap-1.5">
              {generando ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />} Generar
            </button>
            {resolucionManualNota !== null && (
              <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-300 rounded px-2 py-1 font-semibold" title="Hubo resolución manual: las tareas se aplicarán como PROVISORIAS">
                ⚠️ Provisorio
              </span>
            )}
            <button onClick={aplicar} disabled={!preparada || aplicando || colocadas.length === 0}
              className={`h-9 px-4 text-sm font-semibold text-white rounded disabled:opacity-40 flex items-center gap-1.5 ${resolucionManualNota !== null ? 'bg-amber-600 hover:bg-amber-700' : 'bg-slate-900 hover:bg-slate-800'}`}>
              {aplicando ? <Loader2 size={14} className="animate-spin" /> : null} Aplicar al cronograma
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ===== #22 Templates de resolución (persistidos en localStorage) =====
// Estructura simple: { nombre, campos } por entrada. Storage compartido por todos los días.
// Si en el futuro hace falta scope por plantilla o por usuario, se migra a tabla en BD.

interface TemplateCampos {
  empleadoId?: string
  fijarCompleto?: boolean
  hora?: string
  franjas?: { empleadoId: string; desde: string; hasta: string }[]
  secuenciaA?: string
  secuenciaB?: string
  prioridadId?: string
  prioridadVal?: number
  duracion?: number
  ayudantes?: string[]
  nota?: string
}

const TEMPLATES_KEY = 'cronograma_templates_resolucion'

function cargarTemplatesDeStorage(): { nombre: string; campos: TemplateCampos }[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function guardarTemplatesEnStorage(items: { nombre: string; campos: TemplateCampos }[]) {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(items))
  } catch (err) {
    console.error('Error guardando templates:', err)
  }
}
