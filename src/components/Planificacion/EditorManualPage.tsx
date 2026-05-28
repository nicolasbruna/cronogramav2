// Editor Manual del día — Gantt como protagonista + drag & drop.
//
// Layout: PanelSinUbicar (izq.) | GanttEditorPrincipal (centro) | PanelDetalle (der.)
//         + tira "Overrides activos" inferior + barra de acciones.
// El scheduler sigue siendo el motor: el usuario construye SchedulerOverrides
// (drag&drop, panel de detalle, menú contextual) y el resultado se re-corre en vivo.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { ArrowLeft, CalendarClock, Loader2, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import {
  generarParaDia, generarCronograma, aplicarResultado,
  fusionarOverrides, GeneracionPreparada
} from '../../services/schedulerService'
import { SchedulerOverrides, ResultadoScheduler, InstanciaEtapa } from '../../types/scheduler'
import { DIAS_SEMANA_NOMBRES } from '../../types/cronograma'
import { minToTime, formatDuration } from '../Cronograma/cronogramaHelpers'
import { GanttEditorPrincipal } from './GanttEditorPrincipal'
import { PanelSinUbicar } from './PanelSinUbicar'
import { PanelDetalle } from './PanelDetalle'
import { MenuContextual, MenuContextualItem } from './MenuContextual'

interface Props {
  diaActual: number
  onVolver: () => void
}

const claveInst = (i: InstanciaEtapa) => `${i.plantillaId}:${i.lote}:${i.etapa.orden}`

export function EditorManualPage({ diaActual, onVolver }: Props) {
  const [loading, setLoading] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [preparada, setPreparada] = useState<GeneracionPreparada | null>(null)
  const [overridesEditor, setOverridesEditor] = useState<SchedulerOverrides>({})

  const [seleccionada, setSeleccionada] = useState<string | null>(null)
  const [menuCtx, setMenuCtx] = useState<{ x: number; y: number; items: MenuContextualItem[] } | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const prep = await generarParaDia(diaActual)
      setPreparada(prep)
      setOverridesEditor({})
      setSeleccionada(null)
    } catch (err) {
      console.error('Error cargando editor manual:', err)
      alert('Error cargando el contexto del día')
    } finally {
      setLoading(false)
    }
  }, [diaActual])

  useEffect(() => { cargar() }, [cargar])

  const resultado: ResultadoScheduler | null = useMemo(() => {
    if (!preparada) return null
    return generarCronograma(preparada.ctx, overridesEditor)
  }, [preparada, overridesEditor])

  // Set de plantillas culpables activas (resaltado bordes rojos).
  const plantillasCulpables = useMemo(() => {
    const set = new Set<string>()
    if (!resultado) return set
    for (const c of resultado.conflictos) {
      if (c.cascada) continue
      for (const pid of c.conflicto?.culpablesPlantillaIds ?? []) set.add(pid)
    }
    return set
  }, [resultado])

  const resumen = useMemo(() => {
    if (!resultado) return { colocadas: 0, conflictos: 0, cierre: null as number | null, fueraTurno: 0 }
    const colocadas = resultado.instancias.filter(i => i.estado === 'colocada').length
    const conflictos = resultado.conflictos.filter(c => !c.cascada).length
    let fueraTurno = 0
    for (const inst of resultado.instancias) {
      for (const a of inst.asignaciones) if (a.enFranjaExtra) {
        for (const iv of a.ventanasAbs) fueraTurno += Math.max(0, iv.fin - iv.inicio)
      }
    }
    return { colocadas, conflictos, cierre: resultado.cierreJornada, fueraTurno }
  }, [resultado])

  const empleados = useMemo(() => preparada?.ctx.empleados.map(e => ({ id: e.id, nombre: e.nombre_completo })) ?? [], [preparada])
  const nombreEmp = (id: string | null | undefined) => empleados.find(e => e.id === id)?.nombre ?? '—'
  const nombrePlantilla = (id: string) => preparada?.ctx.plantillasConEtapas.find(p => p.id === id)?.nombre ?? id

  // ===== Lookup de instancia seleccionada =====
  const instSeleccionada: InstanciaEtapa | null = useMemo(() => {
    if (!seleccionada || !resultado) return null
    return resultado.instancias.find(i => claveInst(i) === seleccionada) ?? null
  }, [seleccionada, resultado])

  // ===== Acciones que generan overrides =====
  const fijarEmpleado = (inst: InstanciaEtapa, empleadoId: string) => {
    if (!empleadoId) return
    setOverridesEditor(prev => fusionarOverrides(prev, {
      asignacionFijada: [{ plantillaId: inst.plantillaId, lote: inst.lote, etapaOrden: inst.etapa.orden, empleadoId }]
    }))
  }
  // Aplica un delta de overrides al cronograma DE LA BD inmediatamente (commit directo,
  // sin esperar el botón "Aplicar al cronograma"). Recarga el contexto luego para mostrar
  // el estado nuevo.
  const aplicarDeltaInmediato = async (delta: SchedulerOverrides) => {
    if (!preparada) return
    const nuevos = fusionarOverrides(overridesEditor, delta)
    const resultadoLocal = generarCronograma(preparada.ctx, nuevos)
    setOverridesEditor(nuevos)
    setAplicando(true)
    try {
      await aplicarResultado(diaActual, resultadoLocal, preparada.idsReemplazables)
      await cargar()   // recarga el contexto desde la BD y limpia los overrides
    } catch (err) {
      console.error('Error aplicando cambio:', err)
      alert('Error al aplicar el cambio al cronograma')
    } finally {
      setAplicando(false)
    }
  }

  const fijarHora = (inst: InstanciaEtapa, hhmm: string) => {
    const m = hhmmAMin(hhmm)
    if (m == null) return
    // Fijar hora desde el panel detalle: además del override, se aplica AL CRONOGRAMA directo.
    aplicarDeltaInmediato({
      inicioFijado: [{ plantillaId: inst.plantillaId, lote: inst.lote, etapaOrden: inst.etapa.orden, inicioMin: m }]
    })
  }
  const sustituirMaquina = (inst: InstanciaEtapa) =>
    setOverridesEditor(prev => fusionarOverrides(prev, { sustituirMaquina: [inst.etapa.id] }))
  const relajarInicio = (plantillaId: string) =>
    setOverridesEditor(prev => fusionarOverrides(prev, { relajarInicioPlan: [plantillaId] }))
  const relajarTope = (plantillaId: string) =>
    setOverridesEditor(prev => fusionarOverrides(prev, { relajarTopeInicio: [plantillaId] }))
  const cambiarPrioridad = (plantillaId: string, prioridad: number) =>
    setOverridesEditor(prev => ({ ...prev, prioridadPlantilla: { ...(prev.prioridadPlantilla ?? {}), [plantillaId]: prioridad } }))
  const excluirProceso = (plantillaId: string) =>
    setOverridesEditor(prev => fusionarOverrides(prev, { excluirPlantillas: [plantillaId] }))
  const agregarSecuencia = (antesPlantillaId: string, despuesPlantillaId: string) => {
    if (antesPlantillaId === despuesPlantillaId) return
    setOverridesEditor(prev => fusionarOverrides(prev, { secuenciaProcesos: [{ antesPlantillaId, despuesPlantillaId }] }))
  }
  const fijarEmpleadoCompleto = (plantillaId: string, empleadoId: string) => {
    if (!empleadoId) return
    const plantilla = preparada?.ctx.plantillasConEtapas.find(p => p.id === plantillaId)
    const planItem = preparada?.ctx.planDia.find(p => p.plantillaId === plantillaId)
    if (!plantilla || !planItem || !plantilla.etapas) return
    const pins: { plantillaId: string; lote: number; etapaOrden: number; empleadoId: string }[] = []
    for (let lote = 1; lote <= planItem.cantidadLotes; lote++) {
      for (const etapa of plantilla.etapas) pins.push({ plantillaId, lote, etapaOrden: etapa.orden, empleadoId })
    }
    setOverridesEditor(prev => fusionarOverrides(prev, { asignacionFijada: pins }))
  }

  // ===== Drag & drop del Gantt =====
  // Cambio de empleado y/o hora de una instancia ya colocada.
  const onDragSoltar = (instKey: string, nuevoEmpleadoId: string, nuevoInicioMin: number) => {
    const inst = resultado?.instancias.find(i => claveInst(i) === instKey)
    if (!inst) return
    const principal = inst.asignaciones.find(a => a.rol === 'principal') ?? inst.asignaciones[0]
    const cambiaEmp = principal && principal.empleadoId !== nuevoEmpleadoId
    const cambiaHora = inst.inicioAbs !== nuevoInicioMin
    const delta: SchedulerOverrides = {}
    if (cambiaEmp) {
      delta.asignacionFijada = [{ plantillaId: inst.plantillaId, lote: inst.lote, etapaOrden: inst.etapa.orden, empleadoId: nuevoEmpleadoId }]
    }
    if (cambiaHora) {
      delta.inicioFijado = [{ plantillaId: inst.plantillaId, lote: inst.lote, etapaOrden: inst.etapa.orden, inicioMin: nuevoInicioMin }]
    }
    if (Object.keys(delta).length === 0) return
    setOverridesEditor(prev => fusionarOverrides(prev, delta))
  }
  // Drop externo: el usuario soltó un chip "Sin ubicar" sobre la grilla.
  const onDropExterno = (instKey: string, empleadoId: string, inicioMin: number) => {
    const inst = resultado?.instancias.find(i => claveInst(i) === instKey)
    if (!inst) return
    setOverridesEditor(prev => fusionarOverrides(prev, {
      asignacionFijada: [{ plantillaId: inst.plantillaId, lote: inst.lote, etapaOrden: inst.etapa.orden, empleadoId }],
      inicioFijado: [{ plantillaId: inst.plantillaId, lote: inst.lote, etapaOrden: inst.etapa.orden, inicioMin }]
    }))
    setSeleccionada(instKey)
  }

  // ===== Quitar overrides de una instancia (botón en PanelDetalle) =====
  const quitarOverridesDeInstancia = (inst: InstanciaEtapa) => {
    setOverridesEditor(prev => ({
      ...prev,
      asignacionFijada: (prev.asignacionFijada ?? []).filter(a =>
        !(a.plantillaId === inst.plantillaId && a.lote === inst.lote && a.etapaOrden === inst.etapa.orden)),
      inicioFijado: (prev.inicioFijado ?? []).filter(a =>
        !(a.plantillaId === inst.plantillaId && a.lote === inst.lote && a.etapaOrden === inst.etapa.orden))
    }))
  }

  // ===== Sugerencia automática F2 (extender turno cuando PIN sin turno) =====
  type SugerenciaPin = { empleadoId: string; empleadoNombre: string; desde: number; hasta: number; descripcion: string; leadMin: number }
  const sugerirExtensionPin = (inst: InstanciaEtapa): SugerenciaPin | null => {
    if (inst.estado !== 'conflicto') return null
    const conflicto = inst.conflicto
    if (!conflicto) return null
    const pin = overridesEditor.asignacionFijada?.find(p =>
      p.plantillaId === inst.plantillaId && p.lote === inst.lote && p.etapaOrden === inst.etapa.orden)
    if (!pin) return null
    if (conflicto.motivo !== 'empleado_no_disponible' && conflicto.motivo !== 'ventana_horaria') return null
    const desde0 = conflicto.desdeColocacion
    const tope = conflicto.topeColocacion
    if (desde0 == null || tope == null) return null
    const emp = preparada?.ctx.empleados.find(e => e.id === pin.empleadoId)
    if (!emp) return null
    const turnoInicio = emp.franjas.filter(f => f.origen === 'turno').reduce((m, f) => Math.min(m, f.desde), Number.POSITIVE_INFINITY)
    const finTurnoNormal = emp.franjas.filter(f => f.origen === 'turno').reduce((m, f) => Math.max(m, f.hasta), 0)
    if (!Number.isFinite(turnoInicio)) return null
    if (turnoInicio <= desde0) return null
    const ancla = Math.max(desde0, Math.min(tope, turnoInicio))
    const dur = inst.etapa.duracion_proceso
    const lead = conflicto.leadBloqueo ?? dur
    const desde = Math.max(0, ancla - lead)
    const hasta = Math.max(ancla + dur, finTurnoNormal)
    const nombreCorto = emp.nombre_completo.split(' ')[0]
    return {
      empleadoId: pin.empleadoId, empleadoNombre: emp.nombre_completo,
      desde, hasta, leadMin: lead,
      descripcion: `${nombreCorto} no llega a la hora de "${inst.etapa.nombre}". Extender turno: ${minToTime(desde).slice(0, 5)} → ${minToTime(hasta).slice(0, 5)} (+${lead} min)`
    }
  }
  const aplicarSugerenciaPin = (s: SugerenciaPin) => {
    setOverridesEditor(prev => {
      const f = { ...(prev.franjasExtra ?? {}) }
      f[s.empleadoId] = [...(f[s.empleadoId] ?? []), { desde: s.desde, hasta: s.hasta, origen: 'extra', etiqueta: 'Sugerencia: PIN sin turno' }]
      return { ...prev, franjasExtra: f }
    })
  }

  // ===== Menú contextual (click derecho en bloque o chip) =====
  // Acciones rápidas. "Cambiar hora" vive solo en el panel detalle (lateral derecho)
  // para no duplicar la opción.
  const itemsMenuConflicto = (inst: InstanciaEtapa): MenuContextualItem[] => [
    { label: 'Cambiar empleado…', onClick: () => setSeleccionada(claveInst(inst)) },
    { label: 'Fijar al proceso completo…', onClick: () => setSeleccionada(claveInst(inst)) },
    { label: 'Forzar antes de otro proceso…', onClick: () => setSeleccionada(claveInst(inst)) },
    { label: 'Sustituir máquina', onClick: () => sustituirMaquina(inst) },
    { label: 'Relajar tope de inicio', onClick: () => relajarTope(inst.plantillaId) },
    { label: 'Quitar "no empezar antes"', onClick: () => relajarInicio(inst.plantillaId) },
    { label: 'Bajar prioridad', onClick: () => cambiarPrioridad(inst.plantillaId, 1) },
    { label: 'Excluir proceso', danger: true, onClick: () => { if (confirm(`Excluir "${inst.plantillaNombre}" del plan?`)) excluirProceso(inst.plantillaId) } }
  ]
  const itemsMenuCulpable = (plantillaId: string, despuesId?: string): MenuContextualItem[] => {
    const items: MenuContextualItem[] = []
    if (despuesId && despuesId !== plantillaId) {
      items.push({ label: `Forzar que termine antes de "${nombrePlantilla(despuesId)}"`, onClick: () => agregarSecuencia(plantillaId, despuesId) })
    }
    items.push(
      { label: 'Bajar su prioridad', onClick: () => cambiarPrioridad(plantillaId, 1) },
      { label: 'Excluir del plan', danger: true, onClick: () => { if (confirm(`Excluir "${nombrePlantilla(plantillaId)}" del plan?`)) excluirProceso(plantillaId) } }
    )
    return items
  }

  // Items para una instancia "normal" (colocada sin conflicto).
  const itemsMenuColocada = (inst: InstanciaEtapa): MenuContextualItem[] => [
    { label: 'Cambiar empleado…', onClick: () => setSeleccionada(claveInst(inst)) },
    { label: 'Fijar al proceso completo…', onClick: () => setSeleccionada(claveInst(inst)) },
    { label: 'Forzar antes de otro proceso…', onClick: () => setSeleccionada(claveInst(inst)) },
    { label: 'Sustituir máquina', onClick: () => sustituirMaquina(inst) },
    { label: 'Bajar prioridad', onClick: () => cambiarPrioridad(inst.plantillaId, 1) },
    { label: 'Excluir proceso', danger: true, onClick: () => { if (confirm(`Excluir "${inst.plantillaNombre}" del plan?`)) excluirProceso(inst.plantillaId) } }
  ]

  // Apertura del menú contextual desde el Gantt o desde un chip de "Sin ubicar".
  const abrirMenuContextual = (instKey: string, x: number, y: number) => {
    if (!resultado) return
    const inst = resultado.instancias.find(i => claveInst(i) === instKey)
    if (!inst) return
    // Si la instancia es bloqueadora de algún conflicto activo, sumar opciones de culpable
    // (el "despuesId" es el primer conflicto que la nombra como culpable).
    const conflictoBloqueado = resultado.conflictos.find(c =>
      !c.cascada && (c.conflicto?.culpablesPlantillaIds ?? []).includes(inst.plantillaId))
    let items: MenuContextualItem[]
    if (inst.estado === 'conflicto') {
      items = itemsMenuConflicto(inst)
    } else if (conflictoBloqueado) {
      items = [
        ...itemsMenuCulpable(inst.plantillaId, conflictoBloqueado.plantillaId),
        ...itemsMenuColocada(inst).slice(0, 4)   // primeras 4 (acciones de cambio)
      ]
    } else {
      items = itemsMenuColocada(inst)
    }
    setMenuCtx({ x, y, items })
  }

  // ===== Tira "Overrides activos" (chips inferiores) =====
  type ChipOv =
    | { tipo: 'empleado'; key: string; texto: string; pid: string }
    | { tipo: 'hora'; key: string; texto: string; pid: string }
    | { tipo: 'franja'; key: string; texto: string }
    | { tipo: 'sustituir'; key: string; texto: string }
    | { tipo: 'relajar'; key: string; texto: string }
    | { tipo: 'prioridad'; key: string; texto: string }
    | { tipo: 'excluir'; key: string; texto: string }
    | { tipo: 'secuencia'; key: string; texto: string }

  const chipsOverrides = useMemo(() => {
    const items: { chip: ChipOv; quitar: () => void; color: string }[] = []
    for (const a of overridesEditor.asignacionFijada ?? []) {
      const k = `e:${a.plantillaId}:${a.lote}:${a.etapaOrden}`
      items.push({
        chip: { tipo: 'empleado', key: k, pid: a.plantillaId, texto: `${nombreEmp(a.empleadoId)} → ${nombrePlantilla(a.plantillaId)}` },
        color: 'bg-blue-50 border-blue-300 text-blue-800',
        quitar: () => setOverridesEditor(prev => ({
          ...prev,
          asignacionFijada: (prev.asignacionFijada ?? []).filter(x => !(x.plantillaId === a.plantillaId && x.lote === a.lote && x.etapaOrden === a.etapaOrden && x.empleadoId === a.empleadoId))
        }))
      })
    }
    for (const h of overridesEditor.inicioFijado ?? []) {
      const k = `h:${h.plantillaId}:${h.lote}:${h.etapaOrden}`
      items.push({
        chip: { tipo: 'hora', key: k, pid: h.plantillaId, texto: `${minToTime(h.inicioMin).slice(0, 5)} · ${nombrePlantilla(h.plantillaId)}` },
        color: 'bg-blue-50 border-blue-300 text-blue-800',
        quitar: () => setOverridesEditor(prev => ({
          ...prev,
          inicioFijado: (prev.inicioFijado ?? []).filter(x => !(x.plantillaId === h.plantillaId && x.lote === h.lote && x.etapaOrden === h.etapaOrden))
        }))
      })
    }
    for (const [empId, fr] of Object.entries(overridesEditor.franjasExtra ?? {})) {
      fr.forEach((f, i) => items.push({
        chip: { tipo: 'franja', key: `f:${empId}:${i}`, texto: `${nombreEmp(empId)} ${minToTime(f.desde).slice(0, 5)}→${minToTime(f.hasta).slice(0, 5)}` },
        color: 'bg-amber-50 border-amber-300 text-amber-800',
        quitar: () => setOverridesEditor(prev => {
          const next = { ...(prev.franjasExtra ?? {}) }
          const arr = (next[empId] ?? []).filter(x => !(x.desde === f.desde && x.hasta === f.hasta))
          if (arr.length > 0) next[empId] = arr; else delete next[empId]
          return { ...prev, franjasExtra: next }
        })
      }))
    }
    for (const eid of overridesEditor.sustituirMaquina ?? []) {
      items.push({
        chip: { tipo: 'sustituir', key: `s:${eid}`, texto: `Sustituir máquina (etapa ${eid.slice(0, 6)}…)` },
        color: 'bg-slate-50 border-slate-300 text-slate-700',
        quitar: () => setOverridesEditor(prev => ({ ...prev, sustituirMaquina: (prev.sustituirMaquina ?? []).filter(x => x !== eid) }))
      })
    }
    for (const pid of overridesEditor.relajarInicioPlan ?? []) {
      items.push({
        chip: { tipo: 'relajar', key: `ri:${pid}`, texto: `Relajar inicio: ${nombrePlantilla(pid)}` },
        color: 'bg-slate-50 border-slate-300 text-slate-700',
        quitar: () => setOverridesEditor(prev => ({ ...prev, relajarInicioPlan: (prev.relajarInicioPlan ?? []).filter(x => x !== pid) }))
      })
    }
    for (const pid of overridesEditor.relajarTopeInicio ?? []) {
      items.push({
        chip: { tipo: 'relajar', key: `rt:${pid}`, texto: `Relajar tope: ${nombrePlantilla(pid)}` },
        color: 'bg-slate-50 border-slate-300 text-slate-700',
        quitar: () => setOverridesEditor(prev => ({ ...prev, relajarTopeInicio: (prev.relajarTopeInicio ?? []).filter(x => x !== pid) }))
      })
    }
    for (const [pid, p] of Object.entries(overridesEditor.prioridadPlantilla ?? {})) {
      items.push({
        chip: { tipo: 'prioridad', key: `p:${pid}`, texto: `Prioridad ${p}: ${nombrePlantilla(pid)}` },
        color: 'bg-slate-50 border-slate-300 text-slate-700',
        quitar: () => setOverridesEditor(prev => {
          const next = { ...(prev.prioridadPlantilla ?? {}) }; delete next[pid]
          return { ...prev, prioridadPlantilla: next }
        })
      })
    }
    for (const pid of overridesEditor.excluirPlantillas ?? []) {
      items.push({
        chip: { tipo: 'excluir', key: `x:${pid}`, texto: `Excluir: ${nombrePlantilla(pid)}` },
        color: 'bg-rose-50 border-rose-300 text-rose-700',
        quitar: () => setOverridesEditor(prev => ({ ...prev, excluirPlantillas: (prev.excluirPlantillas ?? []).filter(x => x !== pid) }))
      })
    }
    for (const s of overridesEditor.secuenciaProcesos ?? []) {
      items.push({
        chip: { tipo: 'secuencia', key: `seq:${s.antesPlantillaId}>${s.despuesPlantillaId}`, texto: `${nombrePlantilla(s.antesPlantillaId)} → ${nombrePlantilla(s.despuesPlantillaId)}` },
        color: 'bg-orange-50 border-orange-300 text-orange-700',
        quitar: () => setOverridesEditor(prev => ({
          ...prev,
          secuenciaProcesos: (prev.secuenciaProcesos ?? []).filter(x => !(x.antesPlantillaId === s.antesPlantillaId && x.despuesPlantillaId === s.despuesPlantillaId))
        }))
      })
    }
    return items
  }, [overridesEditor, empleados, preparada])

  // ===== Acciones globales =====
  const descartarTodo = () => {
    if (!confirm('¿Descartar todos los overrides?')) return
    setOverridesEditor({})
  }
  const aplicar = async () => {
    if (!preparada || !resultado) return
    if (resumen.conflictos > 0) {
      if (!confirm(`Hay ${resumen.conflictos} conflicto(s) sin resolver. ¿Aplicar igual?`)) return
    }
    if (!confirm(`Se aplicarán ${resumen.colocadas} tarea(s) al cronograma. Backup automático. ¿Continuar?`)) return
    setAplicando(true)
    try {
      await aplicarResultado(diaActual, resultado, preparada.idsReemplazables)
      onVolver()
    } catch (err) {
      console.error('Error aplicando:', err)
      alert('Error al aplicar el cronograma')
    } finally { setAplicando(false) }
  }

  const conflictosRaiz = resultado?.conflictos.filter(c => !c.cascada) ?? []
  const plantillasDelDia = useMemo(() => {
    if (!preparada) return []
    const idsEnPlan = new Set(preparada.ctx.planDia.map(p => p.plantillaId))
    return preparada.ctx.plantillasConEtapas.filter(p => idsEnPlan.has(p.id))
  }, [preparada])

  // Sugerencia F2 banner para la instancia seleccionada (si aplica).
  const sugerenciaSel = useMemo(() => instSeleccionada ? sugerirExtensionPin(instSeleccionada) : null, [instSeleccionada, overridesEditor, preparada])

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
          <span className="text-[12px] text-slate-400 hidden md:inline">Arrastrá los bloques para reorganizar</span>

          <div className="ml-auto flex items-center gap-3 text-[12px]">
            <span className="text-emerald-600 font-semibold flex items-center gap-1"><CheckCircle2 size={13} /> {resumen.colocadas}</span>
            {resumen.conflictos > 0 && <span className="text-rose-600 font-semibold flex items-center gap-1"><AlertTriangle size={13} /> {resumen.conflictos}</span>}
            {resumen.cierre != null && <span className="text-slate-500">· cierre {minToTime(resumen.cierre).slice(0, 5)}</span>}
            {resumen.fueraTurno > 0 && <span className="text-slate-500">· {formatDuration(resumen.fueraTurno)} fuera de turno</span>}
          </div>
        </div>
      </div>

      {/* Body horizontal: SinUbicar | Gantt | Detalle */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            <Loader2 size={18} className="animate-spin mr-2" /> Cargando contexto del día…
          </div>
        ) : !resultado ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">No hay datos para mostrar.</div>
        ) : (
          <>
            <PanelSinUbicar
              conflictosRaiz={conflictosRaiz}
              instanciaSeleccionada={seleccionada}
              onSeleccionar={k => setSeleccionada(k)}
              onContextMenu={(k, x, y) => {
                const inst = resultado.instancias.find(i => claveInst(i) === k)
                if (inst) setMenuCtx({ x, y, items: itemsMenuConflicto(inst) })
              }}
            />

            <div className="flex-1 min-w-0 flex flex-col">
              {/* Banner F2 si aplica para la seleccionada */}
              {sugerenciaSel && (
                <div className="flex-shrink-0 mx-3 mt-2 flex items-start gap-2 p-2 bg-amber-50 border border-amber-300 rounded text-[11px]">
                  <span className="text-amber-600 text-sm">💡</span>
                  <div className="flex-1 text-amber-800">{sugerenciaSel.descripcion}</div>
                  <button onClick={() => aplicarSugerenciaPin(sugerenciaSel)}
                          className="h-6 px-2.5 text-[11px] font-semibold text-white bg-amber-600 rounded hover:bg-amber-700 flex-shrink-0">
                    Aplicar
                  </button>
                </div>
              )}

              <div className="flex-1 min-h-0">
                <GanttEditorPrincipal
                  resultado={resultado}
                  empleados={preparada!.ctx.empleados}
                  rangoInicio={preparada!.ctx.diaInicio}
                  plantillasCulpables={plantillasCulpables}
                  instanciaSeleccionada={seleccionada}
                  onSeleccionar={k => setSeleccionada(k)}
                  onContextMenu={abrirMenuContextual}
                  onDragSoltar={onDragSoltar}
                  onDropExterno={onDropExterno}
                />
              </div>
            </div>

            <PanelDetalle
              inst={instSeleccionada}
              empleados={empleados}
              plantillasDelDia={plantillasDelDia}
              overrides={overridesEditor}
              onFijarEmpleado={fijarEmpleado}
              onFijarHora={fijarHora}
              onFijarEmpleadoCompleto={fijarEmpleadoCompleto}
              onForzarAntes={agregarSecuencia}
              onQuitarOverridesDeInstancia={quitarOverridesDeInstancia}
            />
          </>
        )}
      </div>

      {/* Tira "Overrides activos" — solo si hay alguno */}
      {chipsOverrides.length > 0 && (
        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">
            Overrides activos
            <span className="text-slate-400">({chipsOverrides.length})</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {chipsOverrides.map(({ chip, color, quitar }) => (
              <div key={chip.key}
                   className={`flex-shrink-0 inline-flex items-center gap-1 border rounded px-2 py-1 text-[11px] ${color}`}
                   title={chip.texto}>
                <span className="max-w-[280px] truncate">{chip.texto}</span>
                <button onClick={quitar} className="hover:opacity-70" title="Quitar override">
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Barra de acciones */}
      <div className="flex-shrink-0 bg-white border-t border-slate-200 px-5 py-3">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <button onClick={onVolver} className="h-9 px-3 text-sm font-semibold text-slate-700 border border-slate-300 rounded hover:bg-slate-100">Volver</button>
          <div className="flex items-center gap-2">
            <button onClick={descartarTodo} disabled={chipsOverrides.length === 0}
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

      {/* Menú contextual flotante */}
      {menuCtx && <MenuContextual posicion={{ x: menuCtx.x, y: menuCtx.y }} items={menuCtx.items} onClose={() => setMenuCtx(null)} />}
    </div>
  )
}

// hh:mm → minutos del día.
function hhmmAMin(v: string): number | null {
  if (!v) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return null
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10)
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null
  return h * 60 + mi
}
