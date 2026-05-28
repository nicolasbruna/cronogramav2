import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { ChevronLeft, Play, Pause, MapPin, Activity, RotateCcw, Trash2, ChevronsLeft, ChevronsRight, SkipForward, AlertTriangle, Users, Maximize2, Minus, Plus, Crosshair } from 'lucide-react'
import { cronogramaService } from '../../services/cronogramaService'
import { planificacionService } from '../../services/planificacionService'
import { CronogramaTarea, DIAS_SEMANA_NOMBRES, EmpleadoConLineas } from '../../types/cronograma'
import { Maquina, PlantillaProceso } from '../../types/planificacion'
import { timeToMin, minToTime, getDiaSemanaHoy } from '../Cronograma/cronogramaHelpers'

// ────────────────────────────────────────────────────────────────
// Tipos
// ────────────────────────────────────────────────────────────────

interface SimulacionPageProps {
  onVolver: () => void
}

type Modo = 'simular' | 'ubicar' | 'operarios'

interface Contorno {
  x: number  // %
  y: number
  w: number
  h: number
}
type ContornosMap = Record<string, Contorno>

type Anchor =
  | { tipo: 'maquina'; maquinaId: string }
  | { tipo: 'punto'; x: number; y: number }  // %

type PlanMovimiento =
  | { tipo: 'auto' }
  | { tipo: 'fijo'; anchor: Anchor }
type MovimientosMap = Record<string /* plantilla_id */, PlanMovimiento>

interface View { scale: number; tx: number; ty: number }
interface Pick { plantillaId: string; campo: 'fijo' }

// ────────────────────────────────────────────────────────────────
// Constantes
// ────────────────────────────────────────────────────────────────

const PLANO_SRC = '/plano.png'
const LS_CONTORNOS = 'simulacion_contornos_maquinas_v2'
const LS_MOVIMIENTOS = 'simulacion_movimientos_v1'
const COLOR_DEFAULT = '#64748b'
const VELOCIDADES = [1, 2, 5, 10, 20, 30, 60, 120, 300, 600] as const
const VELOCIDAD_DEFAULT_IDX = 2  // 5×
const AVATAR_SIZE = 36
const AVATAR_SEPARACION = 4  // px entre avatares apilados
const PERIODO_SALTO_MIN = 1  // cada cuántos minutos simulados saltar entre máquinas

// ────────────────────────────────────────────────────────────────
// Utils
// ────────────────────────────────────────────────────────────────

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function iniciales(nombreCompleto: string): string {
  const parts = nombreCompleto.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ────────────────────────────────────────────────────────────────
// Componente
// ────────────────────────────────────────────────────────────────

export function SimulacionPage({ onVolver }: SimulacionPageProps) {
  const [diaActual] = useState(() => {
    const saved = localStorage.getItem('cronograma_dia_actual')
    return saved !== null ? parseInt(saved, 10) : getDiaSemanaHoy()
  })

  // Data
  const [maquinas, setMaquinas] = useState<Maquina[]>([])
  const [tareas, setTareas] = useState<CronogramaTarea[]>([])
  const [empleados, setEmpleados] = useState<EmpleadoConLineas[]>([])
  const [plantillas, setPlantillas] = useState<PlantillaProceso[]>([])
  const [loading, setLoading] = useState(true)
  const [imgFalla, setImgFalla] = useState(false)

  // UI
  const [modo, setModo] = useState<Modo>('simular')
  const [maquinaSeleccionada, setMaquinaSeleccionada] = useState<string | null>(null)
  const [plantillaExpandida, setPlantillaExpandida] = useState<string | null>(null)
  const [pick, setPick] = useState<Pick | null>(null)

  // Persistencia
  const [contornos, setContornos] = useState<ContornosMap>(() => loadLS(LS_CONTORNOS, {}))
  const [movimientos, setMovimientos] = useState<MovimientosMap>(() => loadLS(LS_MOVIMIENTOS, {}))

  useEffect(() => {
    localStorage.setItem(LS_CONTORNOS, JSON.stringify(contornos))
  }, [contornos])
  useEffect(() => {
    localStorage.setItem(LS_MOVIMIENTOS, JSON.stringify(movimientos))
  }, [movimientos])

  // Viewport
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 })
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 })
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Drag/draw state
  const [draft, setDraft] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const panRef = useRef<{ startX: number; startY: number; tx0: number; ty0: number } | null>(null)

  // Timeline
  const [minutoActual, setMinutoActual] = useState<number>(4 * 60)
  const [reproduciendo, setReproduciendo] = useState(false)
  const [velocidadIdx, setVelocidadIdx] = useState(VELOCIDAD_DEFAULT_IDX)
  const velocidad = VELOCIDADES[velocidadIdx]

  // ── Carga inicial ──
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      planificacionService.listarMaquinas(),
      cronogramaService.listarTareas(diaActual),
      cronogramaService.listarEmpleadosConLineas(diaActual),
      planificacionService.listarPlantillas()
    ])
      .then(([m, t, e, p]) => {
        if (cancelled) return
        setMaquinas(m.filter(x => x.activa))
        setTareas(t)
        setEmpleados(e)
        setPlantillas(p.filter(x => x.activa))
      })
      .catch(err => console.error('Error cargando simulación:', err))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [diaActual])

  // ── Medir el contenedor ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setContainerSize({ w: e.contentRect.width, h: e.contentRect.height })
      }
    })
    ro.observe(el)
    setContainerSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // ── Fit zoom ──
  const fitScale = useMemo(() => {
    if (!imgSize || !containerSize.w || !containerSize.h) return 1
    return Math.min(containerSize.w / imgSize.w, containerSize.h / imgSize.h)
  }, [imgSize, containerSize])

  const fitView = useCallback(() => {
    if (!imgSize) return
    const s = Math.min(containerSize.w / imgSize.w, containerSize.h / imgSize.h)
    setView({
      scale: s,
      tx: (containerSize.w - imgSize.w * s) / 2,
      ty: (containerSize.h - imgSize.h * s) / 2
    })
  }, [imgSize, containerSize])

  useEffect(() => { fitView() }, [fitView])

  // ── Mapas auxiliares ──
  const lineaToEmpleado = useMemo(() => {
    const m = new Map<string, EmpleadoConLineas>()
    for (const emp of empleados) for (const l of emp.lineas) m.set(l.id, emp)
    return m
  }, [empleados])

  const empleadoDeTarea = useCallback((t: CronogramaTarea) =>
    t.linea_id ? lineaToEmpleado.get(t.linea_id) : undefined
  , [lineaToEmpleado])

  const colorDeTarea = useCallback((t: CronogramaTarea) =>
    t.color || empleadoDeTarea(t)?.color || COLOR_DEFAULT
  , [empleadoDeTarea])

  const centroContorno = useCallback((maquinaId: string): { x: number; y: number } | null => {
    const c = contornos[maquinaId]
    if (!c) return null
    return { x: c.x + c.w / 2, y: c.y + c.h / 2 }
  }, [contornos])

  const resolverAnchor = useCallback((a: Anchor): { x: number; y: number } => {
    if (a.tipo === 'punto') return { x: a.x, y: a.y }
    return centroContorno(a.maquinaId) ?? { x: 50, y: 50 }
  }, [centroContorno])

  // ── Rango horario ──
  const [rangoMin, rangoMax] = useMemo<[number, number]>(() => {
    if (tareas.length === 0) return [4 * 60, 22 * 60]
    let lo = Infinity, hi = -Infinity
    for (const t of tareas) {
      lo = Math.min(lo, timeToMin(t.hora_inicio))
      hi = Math.max(hi, timeToMin(t.hora_fin))
    }
    if (!isFinite(lo)) lo = 4 * 60
    if (!isFinite(hi)) hi = 22 * 60
    return [Math.max(0, lo - 15), Math.min(24 * 60 - 1, hi + 15)]
  }, [tareas])

  useEffect(() => {
    setMinutoActual(m => Math.min(Math.max(m, rangoMin), rangoMax))
  }, [rangoMin, rangoMax])

  const eventos = useMemo(() => {
    const set = new Set<number>()
    for (const t of tareas) {
      set.add(timeToMin(t.hora_inicio))
      set.add(timeToMin(t.hora_fin))
    }
    return Array.from(set).filter(m => m >= rangoMin && m <= rangoMax).sort((a, b) => a - b)
  }, [tareas, rangoMin, rangoMax])

  // ── Loop animación ──
  useEffect(() => {
    if (!reproduciendo) return
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setMinutoActual(m => {
        const next = m + dt * velocidad
        if (next >= rangoMax) { setReproduciendo(false); return rangoMax }
        return next
      })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [reproduciendo, velocidad, rangoMax])

  // ── Ocupaciones por máquina ──
  type Ocupacion = { tarea: CronogramaTarea; color: string; empleado?: EmpleadoConLineas; uso: number }
  const ocupacionesPorMaquina = useMemo(() => {
    const map = new Map<string, Ocupacion[]>()
    const m = minutoActual
    for (const tarea of tareas) {
      for (const r of tarea.recursos_programados) {
        const rIni = timeToMin(r.hora_inicio)
        const rFin = timeToMin(r.hora_fin)
        if (m >= rIni && m < rFin) {
          const arr = map.get(r.maquina_id) || []
          arr.push({
            tarea,
            color: colorDeTarea(tarea),
            empleado: empleadoDeTarea(tarea),
            uso: r.uso ?? 100
          })
          map.set(r.maquina_id, arr)
        }
      }
    }
    return map
  }, [tareas, minutoActual, colorDeTarea, empleadoDeTarea])

  // ── Tareas activas por empleado ──
  const tareasActivasPorEmpleado = useMemo(() => {
    const map = new Map<string, CronogramaTarea[]>()
    const m = minutoActual
    for (const t of tareas) {
      const ini = timeToMin(t.hora_inicio)
      const fin = timeToMin(t.hora_fin)
      if (m >= ini && m < fin) {
        const emp = empleadoDeTarea(t)
        if (emp) {
          const arr = map.get(emp.id) || []
          arr.push(t)
          map.set(emp.id, arr)
        }
      }
    }
    return map
  }, [tareas, minutoActual, empleadoDeTarea])

  // ── Posición instantánea del operario ──
  // Devuelve { x, y } en % del plano o null si "libre" (mostrar en barra lateral)
  const posicionOperario = useCallback((tarea: CronogramaTarea): { x: number; y: number } | null => {
    const m = minutoActual
    const plan: PlanMovimiento = (tarea.plantilla_id && movimientos[tarea.plantilla_id]) || { tipo: 'auto' }

    if (plan.tipo === 'fijo') return resolverAnchor(plan.anchor)

    // auto: recursos activos en este instante; si hay 2+, saltar entre ellos
    const activos: { x: number; y: number }[] = []
    for (const r of tarea.recursos_programados) {
      const rIni = timeToMin(r.hora_inicio)
      const rFin = timeToMin(r.hora_fin)
      if (m >= rIni && m < rFin) {
        const c = centroContorno(r.maquina_id)
        if (c) activos.push(c)
      }
    }
    if (activos.length === 0) return null
    if (activos.length === 1) return activos[0]
    const idx = Math.floor(m / PERIODO_SALTO_MIN) % activos.length
    return activos[idx]
  }, [minutoActual, movimientos, resolverAnchor, centroContorno])

  // ── Avatares a renderizar ──
  interface AvatarRender {
    empleadoId: string
    nombre: string
    color: string
    iniciales: string
    xPct: number
    yPct: number
    tareaDesc: string
  }
  const avatares = useMemo<AvatarRender[]>(() => {
    const list: AvatarRender[] = []
    for (const [empId, ts] of tareasActivasPorEmpleado.entries()) {
      const emp = empleados.find(e => e.id === empId)
      if (!emp) continue
      // Tomamos la primera tarea para posición. Si tiene 2+ es conflicto, igual mostramos una.
      const tarea = ts[0]
      const pos = posicionOperario(tarea)
      if (!pos) continue
      list.push({
        empleadoId: empId,
        nombre: emp.nombre_completo,
        color: emp.color,
        iniciales: iniciales(emp.nombre_completo),
        xPct: pos.x,
        yPct: pos.y,
        tareaDesc: ts.length > 1 ? `⚠ ${ts.length} tareas: ${ts.map(t => t.descripcion).join(' + ')}` : tarea.descripcion
      })
    }
    return list
  }, [tareasActivasPorEmpleado, empleados, posicionOperario])

  // Operarios libres = empleados sin tarea activa Y empleados con tarea sin posición resuelta
  const operariosLibres = useMemo(() => {
    const ocupados = new Set(avatares.map(a => a.empleadoId))
    return empleados.filter(e => !ocupados.has(e.id))
  }, [avatares, empleados])

  // Anti-solape: agrupar avatares cuya posición es muy cercana y distribuirlos horizontalmente
  const avataresConOffset = useMemo(() => {
    const grupos = new Map<string, AvatarRender[]>()
    // Resolución de la clave: 0.25% del plano → en pantalla son unos pocos px, suficiente para detectar "misma máquina"
    for (const a of avatares) {
      const key = `${Math.round(a.xPct * 4)}|${Math.round(a.yPct * 4)}`
      const arr = grupos.get(key) || []
      arr.push(a)
      grupos.set(key, arr)
    }
    const resultado: (AvatarRender & { offsetX: number })[] = []
    for (const arr of grupos.values()) {
      // Orden estable por empleadoId para que el avatar no salte de lado al re-render
      arr.sort((x, y) => x.empleadoId.localeCompare(y.empleadoId))
      const n = arr.length
      const paso = AVATAR_SIZE + AVATAR_SEPARACION
      arr.forEach((a, i) => {
        const offsetX = (i - (n - 1) / 2) * paso
        resultado.push({ ...a, offsetX })
      })
    }
    return resultado
  }, [avatares])

  // ── Conflictos ──
  const conflictos = useMemo(() => {
    const items: { tipo: 'maquina' | 'empleado'; nombre: string; detalle: string }[] = []
    for (const [maqId, ocs] of ocupacionesPorMaquina.entries()) {
      const usoTotal = ocs.reduce((s, o) => s + o.uso, 0)
      if (ocs.length > 1 || usoTotal > 100) {
        const maq = maquinas.find(x => x.id === maqId)
        items.push({ tipo: 'maquina', nombre: maq?.nombre || maqId, detalle: `${ocs.length} tarea(s), uso ${Math.round(usoTotal)}%` })
      }
    }
    for (const [empId, ts] of tareasActivasPorEmpleado.entries()) {
      if (ts.length > 1) {
        const emp = empleados.find(e => e.id === empId)
        items.push({ tipo: 'empleado', nombre: emp?.nombre_completo || empId, detalle: `${ts.length} tareas en paralelo` })
      }
    }
    return items
  }, [ocupacionesPorMaquina, tareasActivasPorEmpleado, maquinas, empleados])

  const proximoEvento = useMemo(() => {
    const t = eventos.find(e => e > minutoActual)
    if (t === undefined) return null
    const cambios: string[] = []
    for (const tarea of tareas) {
      if (timeToMin(tarea.hora_inicio) === t) cambios.push(`empieza ${tarea.descripcion}`)
      if (timeToMin(tarea.hora_fin) === t) cambios.push(`termina ${tarea.descripcion}`)
    }
    return { minuto: t, cambios: cambios.slice(0, 3) }
  }, [eventos, minutoActual, tareas])

  // ── Conversión de coordenadas ──
  const eventToPlanoPct = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    if (!imgSize || !containerRef.current) return { x: 0, y: 0 }
    const rect = containerRef.current.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    // (cx - tx) / scale = xPx en plano, dividido por imgSize.w → fracción → ×100 %
    const xPx = (cx - view.tx) / view.scale
    const yPx = (cy - view.ty) / view.scale
    return { x: (xPx / imgSize.w) * 100, y: (yPx / imgSize.h) * 100 }
  }

  // ── Mouse handlers en el viewport ──
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    // 1) Picking de punto en modo operarios (solo fijo)
    if (pick) {
      const p = eventToPlanoPct(e)
      const anchor: Anchor = { tipo: 'punto', x: p.x, y: p.y }
      setMovimientos(prev => ({ ...prev, [pick.plantillaId]: { tipo: 'fijo', anchor } }))
      setPick(null)
      return
    }
    // 2) Dibujado de contornos en modo ubicar
    if (modo === 'ubicar' && maquinaSeleccionada) {
      e.preventDefault()
      const p = eventToPlanoPct(e)
      setDraft({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
      return
    }
    // 3) Pan
    panRef.current = { startX: e.clientX, startY: e.clientY, tx0: view.tx, ty0: view.ty }
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draft) {
        const p = eventToPlanoPct(e)
        setDraft(d => d ? { ...d, x2: p.x, y2: p.y } : null)
        return
      }
      if (panRef.current) {
        const dx = e.clientX - panRef.current.startX
        const dy = e.clientY - panRef.current.startY
        setView(v => ({ ...v, tx: panRef.current!.tx0 + dx, ty: panRef.current!.ty0 + dy }))
      }
    }
    const onUp = () => {
      if (draft) {
        setDraft(d => {
          if (!d || !maquinaSeleccionada) return null
          const x = Math.max(0, Math.min(d.x1, d.x2))
          const y = Math.max(0, Math.min(d.y1, d.y2))
          const w = Math.min(100 - x, Math.abs(d.x2 - d.x1))
          const h = Math.min(100 - y, Math.abs(d.y2 - d.y1))
          if (w > 0.8 && h > 0.8) {
            setContornos(prev => ({ ...prev, [maquinaSeleccionada]: { x, y, w, h } }))
          }
          return null
        })
      }
      panRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [draft, maquinaSeleccionada, view.scale, view.tx, view.ty, imgSize])

  const handleWheel = (e: React.WheelEvent) => {
    if (!imgSize) return
    e.preventDefault()
    const rect = containerRef.current!.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    const minS = fitScale * 0.3
    const maxS = fitScale * 8
    const newScale = Math.max(minS, Math.min(maxS, view.scale * factor))
    // Mantener el punto bajo el cursor fijo
    const planoX = (cx - view.tx) / view.scale
    const planoY = (cy - view.ty) / view.scale
    const tx = cx - planoX * newScale
    const ty = cy - planoY * newScale
    setView({ scale: newScale, tx, ty })
  }

  // ── Atajos de teclado ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'Space') { e.preventDefault(); setReproduciendo(r => !r) }
      else if (e.code === 'ArrowLeft') { setMinutoActual(m => Math.max(rangoMin, m - 15)) }
      else if (e.code === 'ArrowRight') { setMinutoActual(m => Math.min(rangoMax, m + 15)) }
      else if (e.key === '+' || e.key === '=') { setVelocidadIdx(i => Math.min(VELOCIDADES.length - 1, i + 1)) }
      else if (e.key === '-') { setVelocidadIdx(i => Math.max(0, i - 1)) }
      else if (e.key === '0') { fitView() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [rangoMin, rangoMax, fitView])

  // ── Render helpers ──
  const horaActualStr = minToTime(Math.round(minutoActual))
  const cantUbicadas = Object.keys(contornos).filter(id => maquinas.some(m => m.id === id)).length
  const draftRect = draft ? {
    left: Math.min(draft.x1, draft.x2),
    top: Math.min(draft.y1, draft.y2),
    width: Math.abs(draft.x2 - draft.x1),
    height: Math.abs(draft.y2 - draft.y1)
  } : null

  // ── Indicador de anchor en modo operarios ──
  const planEditando = plantillaExpandida ? movimientos[plantillaExpandida] : undefined
  const anchoresEditando: { x: number; y: number; label: string }[] = []
  if (plantillaExpandida && planEditando && planEditando.tipo === 'fijo') {
    const p = resolverAnchor(planEditando.anchor)
    anchoresEditando.push({ ...p, label: 'Fijo' })
  }

  if (loading) {
    return <div className="h-screen flex items-center justify-center bg-slate-50"><div className="text-slate-500">Cargando simulación...</div></div>
  }

  // ────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────

  const cursorClass = pick
    ? 'cursor-crosshair'
    : modo === 'ubicar' && maquinaSeleccionada
      ? 'cursor-crosshair'
      : panRef.current ? 'cursor-grabbing' : 'cursor-grab'

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <div className="h-12 bg-white border-b border-slate-200 flex items-center px-4 gap-3 flex-shrink-0">
        <button onClick={onVolver} className="px-3 py-1.5 rounded hover:bg-slate-100 text-sm flex items-center gap-1 text-slate-700">
          <ChevronLeft size={16} /> Volver
        </button>
        <div className="w-px h-5 bg-slate-200" />
        <h1 className="text-base font-semibold text-slate-800">
          Simulación · <span className="text-blue-600">{DIAS_SEMANA_NOMBRES[diaActual]}</span>
        </h1>

        <div className="flex-1" />

        <div className="text-xs text-slate-500 mr-2">
          {cantUbicadas} / {maquinas.length} máquinas ubicadas
        </div>

        <div className="flex bg-slate-100 rounded-lg p-1">
          <button onClick={() => { setModo('simular'); setMaquinaSeleccionada(null); setPick(null) }}
            className={`px-3 py-1 text-sm rounded flex items-center gap-1 transition-colors ${modo === 'simular' ? 'bg-white shadow-sm font-medium text-slate-900' : 'text-slate-600 hover:text-slate-800'}`}>
            <Activity size={14} /> Simular
          </button>
          <button onClick={() => { setModo('ubicar'); setPick(null) }}
            className={`px-3 py-1 text-sm rounded flex items-center gap-1 transition-colors ${modo === 'ubicar' ? 'bg-white shadow-sm font-medium text-slate-900' : 'text-slate-600 hover:text-slate-800'}`}>
            <MapPin size={14} /> Dibujar contornos
          </button>
          <button onClick={() => { setModo('operarios'); setMaquinaSeleccionada(null) }}
            className={`px-3 py-1 text-sm rounded flex items-center gap-1 transition-colors ${modo === 'operarios' ? 'bg-white shadow-sm font-medium text-slate-900' : 'text-slate-600 hover:text-slate-800'}`}>
            <Users size={14} /> Operarios
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar izquierdo */}
        <aside className="w-72 bg-white border-r border-slate-200 overflow-y-auto flex flex-col flex-shrink-0">
          {modo === 'ubicar' && <SidebarUbicar
            maquinas={maquinas}
            contornos={contornos}
            seleccionada={maquinaSeleccionada}
            onSeleccionar={setMaquinaSeleccionada}
            onBorrar={(id) => setContornos(prev => { const n = { ...prev }; delete n[id]; return n })}
            onBorrarTodo={() => { if (confirm('¿Borrar todos los contornos?')) { setContornos({}); setMaquinaSeleccionada(null) } }}
          />}

          {modo === 'operarios' && <SidebarOperarios
            plantillas={plantillas}
            tareas={tareas}
            maquinas={maquinas}
            movimientos={movimientos}
            expandida={plantillaExpandida}
            pick={pick}
            onExpand={setPlantillaExpandida}
            onPick={setPick}
            onChange={(plantillaId, plan) => setMovimientos(prev => ({ ...prev, [plantillaId]: plan }))}
            onReset={(plantillaId) => setMovimientos(prev => { const n = { ...prev }; delete n[plantillaId]; return n })}
          />}

          {modo === 'simular' && <SidebarSimular
            horaActualStr={horaActualStr}
            ocupacionesPorMaquina={ocupacionesPorMaquina}
            avatares={avatares}
            maquinasCount={maquinas.length}
            empleadosCount={empleados.length}
            proximoEvento={proximoEvento}
            conflictos={conflictos}
            maquinas={maquinas}
            onSaltarProximo={() => proximoEvento && setMinutoActual(proximoEvento.minuto)}
          />}
        </aside>

        {/* Plano */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div
            ref={containerRef}
            className={`flex-1 relative overflow-hidden bg-slate-300 ${cursorClass}`}
            onMouseDown={handleMouseDown}
            onWheel={handleWheel}
          >
            {imgFalla && (
              <div className="absolute inset-0 flex items-center justify-center p-8 z-30 pointer-events-none">
                <div className="bg-white rounded-lg shadow-lg p-6 max-w-md text-center pointer-events-auto">
                  <div className="text-amber-600 font-semibold mb-2">No se encontró el plano</div>
                  <div className="text-sm text-slate-600">
                    Copiá la imagen a:
                    <div className="mt-2 px-3 py-2 bg-slate-100 rounded font-mono text-xs">
                      /home/nico/cronogramav2/public/plano.png
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Wrapper escalado: imagen + contornos */}
            {imgSize && (
              <div
                className="absolute top-0 left-0 origin-top-left"
                style={{
                  width: imgSize.w,
                  height: imgSize.h,
                  transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`
                }}
              >
                <img
                  src={PLANO_SRC}
                  alt="Plano"
                  className="block select-none"
                  draggable={false}
                  style={{ width: imgSize.w, height: imgSize.h }}
                />

                {/* Contornos */}
                {Object.entries(contornos).map(([id, c]) => {
                  const maq = maquinas.find(x => x.id === id)
                  if (!maq) return null
                  const ocs = ocupacionesPorMaquina.get(id) || []
                  const usoTotal = ocs.reduce((s, o) => s + o.uso, 0)
                  const saturado = ocs.length > 1 || usoTotal > 100
                  const sel = modo === 'ubicar' && maquinaSeleccionada === id
                  const ocupada = ocs.length > 0
                  const wPx = (c.w / 100) * imgSize.w
                  const hPx = (c.h / 100) * imgSize.h
                  const grande = wPx > 80 && hPx > 50

                  return (
                    <div
                      key={id}
                      className="absolute pointer-events-none"
                      style={{ left: `${c.x}%`, top: `${c.y}%`, width: `${c.w}%`, height: `${c.h}%` }}
                      title={`${maq.nombre}${ocupada ? ' · ' + ocs.map(o => o.tarea.descripcion).join(' + ') : ''}`}
                    >
                      {ocupada ? (
                        <div className="absolute inset-0 flex rounded-sm overflow-hidden">
                          {ocs.map((o, i) => (
                            <div key={i} className="flex-1" style={{ background: o.color, opacity: 0.7 }} />
                          ))}
                        </div>
                      ) : (
                        <div className="absolute inset-0 bg-white/30 rounded-sm" />
                      )}

                      <div className={`absolute inset-0 rounded-sm ${
                        saturado ? 'border-[3px] border-red-600 animate-pulse'
                        : ocupada ? 'border-2 border-slate-900/60'
                        : 'border border-dashed border-slate-500/60'
                      } ${sel ? 'ring-4 ring-blue-400' : ''}`} />

                      {grande && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1 overflow-hidden">
                          <div className="bg-white/90 backdrop-blur-sm px-1.5 py-0.5 rounded shadow-sm max-w-full">
                            <div className="text-[10px] uppercase font-bold text-slate-500 truncate leading-tight">{maq.nombre}</div>
                            {ocupada && (
                              <>
                                <div className="text-[12px] font-bold text-slate-900 truncate leading-tight">{ocs[0].tarea.descripcion}</div>
                                {ocs[0].empleado && (
                                  <div className="text-[10px] text-slate-600 truncate leading-tight">{ocs[0].empleado.nombre_completo}</div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Borrador del rectángulo */}
                {draftRect && (
                  <div className="absolute pointer-events-none border-2 border-blue-500 bg-blue-400/30 rounded-sm"
                    style={{ left: `${draftRect.left}%`, top: `${draftRect.top}%`, width: `${draftRect.width}%`, height: `${draftRect.height}%` }} />
                )}

                {/* Anchor editando (modo operarios) */}
                {anchoresEditando.map((a, i) => (
                  <div key={i} className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${a.x}%`, top: `${a.y}%` }}>
                    <div className="w-4 h-4 rounded-full bg-purple-500 border-2 border-white shadow" />
                    <div className="absolute top-5 left-1/2 -translate-x-1/2 text-[10px] font-bold text-purple-700 bg-white/95 px-1 rounded">{a.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Layer de avatares (NO escalado) */}
            {imgSize && avataresConOffset.map(av => {
              const xPx = (av.xPct / 100) * imgSize.w * view.scale + view.tx
              const yPx = (av.yPct / 100) * imgSize.h * view.scale + view.ty
              return (
                <div key={av.empleadoId}
                  className="absolute pointer-events-auto z-20"
                  style={{
                    left: xPx - AVATAR_SIZE / 2 + av.offsetX,
                    top: yPx - AVATAR_SIZE / 2,
                    transition: 'left 600ms ease-in-out, top 600ms ease-in-out'
                  }}
                  title={`${av.nombre} · ${av.tareaDesc}`}
                >
                  <div
                    className="rounded-full border-2 border-white shadow-lg flex items-center justify-center font-bold text-white text-[12px]"
                    style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, background: av.color }}
                  >
                    {av.iniciales}
                  </div>
                </div>
              )
            })}

            {/* Imagen oculta para conocer el tamaño nativo */}
            <img
              src={PLANO_SRC}
              alt=""
              className="hidden"
              onLoad={(e) => {
                const img = e.currentTarget
                setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
                setImgFalla(false)
              }}
              onError={() => { setImgFalla(true); setImgSize({ w: 1200, h: 700 }) }}
            />

            {/* Controles flotantes del viewport */}
            <div className="absolute top-3 right-3 z-30 bg-white rounded-lg shadow-lg flex flex-col">
              <button onClick={() => setView(v => ({ ...v, scale: Math.min(fitScale * 8, v.scale * 1.2) }))}
                className="p-2 hover:bg-slate-100 border-b border-slate-200" title="Acercar (rueda mouse)"><Plus size={14} /></button>
              <button onClick={() => setView(v => ({ ...v, scale: Math.max(fitScale * 0.3, v.scale / 1.2) }))}
                className="p-2 hover:bg-slate-100 border-b border-slate-200" title="Alejar"><Minus size={14} /></button>
              <button onClick={fitView} className="p-2 hover:bg-slate-100" title="Encajar (tecla 0)"><Maximize2 size={14} /></button>
            </div>

            {pick && (
              <div className="absolute top-3 left-3 z-30 bg-purple-600 text-white px-3 py-1.5 rounded-lg shadow-lg text-sm flex items-center gap-2">
                <Crosshair size={14} />
                Clickeá en el plano para fijar el punto {pick.campo.toUpperCase()}
                <button onClick={() => setPick(null)} className="ml-2 text-white/80 hover:text-white">✕</button>
              </div>
            )}
          </div>

          {/* Timeline (solo simular) */}
          {modo === 'simular' && (
            <div className="bg-white border-t border-slate-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
              <button onClick={() => setMinutoActual(m => Math.max(rangoMin, m - 15))}
                className="w-8 h-8 rounded hover:bg-slate-100 text-slate-600 flex items-center justify-center" title="-15 min (←)">
                <ChevronsLeft size={16} />
              </button>
              <button onClick={() => setReproduciendo(r => !r)}
                className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 shadow" title={reproduciendo ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}>
                {reproduciendo ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
              </button>
              <button onClick={() => setMinutoActual(m => Math.min(rangoMax, m + 15))}
                className="w-8 h-8 rounded hover:bg-slate-100 text-slate-600 flex items-center justify-center" title="+15 min (→)">
                <ChevronsRight size={16} />
              </button>
              <button onClick={() => proximoEvento && setMinutoActual(proximoEvento.minuto)} disabled={!proximoEvento}
                className="w-8 h-8 rounded hover:bg-slate-100 text-slate-600 flex items-center justify-center disabled:opacity-30" title="Siguiente evento">
                <SkipForward size={14} />
              </button>
              <button onClick={() => { setMinutoActual(rangoMin); setReproduciendo(false) }}
                className="w-8 h-8 rounded hover:bg-slate-100 text-slate-600 flex items-center justify-center" title="Reiniciar">
                <RotateCcw size={14} />
              </button>

              <div className="font-mono text-2xl font-bold text-slate-800 w-20 text-center">{horaActualStr}</div>

              <div className="relative flex-1">
                <input
                  type="range"
                  min={rangoMin}
                  max={rangoMax}
                  step={1}
                  value={Math.round(minutoActual)}
                  onChange={e => { setMinutoActual(parseInt(e.target.value)); setReproduciendo(false) }}
                  className="w-full"
                />
                <div className="absolute left-0 right-0 -bottom-1 h-2 pointer-events-none">
                  {eventos.map((m, i) => {
                    const pct = ((m - rangoMin) / (rangoMax - rangoMin)) * 100
                    return <div key={i} className="absolute w-px h-1.5 bg-slate-400" style={{ left: `${pct}%` }} />
                  })}
                </div>
                <div className="flex justify-between text-[9px] text-slate-400 font-mono mt-1">
                  <span>{minToTime(rangoMin)}</span>
                  <span>{minToTime(Math.round((rangoMin + rangoMax) / 2))}</span>
                  <span>{minToTime(rangoMax)}</span>
                </div>
              </div>

              {/* Control velocidad */}
              <div className="flex items-center gap-1 bg-slate-50 rounded border border-slate-200 px-1 py-0.5">
                <span className="text-[10px] uppercase text-slate-400 font-bold ml-1">vel</span>
                <button onClick={() => setVelocidadIdx(i => Math.max(0, i - 1))} disabled={velocidadIdx === 0}
                  className="w-6 h-6 rounded hover:bg-slate-200 disabled:opacity-30 flex items-center justify-center" title="Más lento (−)">
                  <Minus size={12} />
                </button>
                <div className="font-mono font-bold text-slate-800 w-12 text-center text-sm">{velocidad}×</div>
                <button onClick={() => setVelocidadIdx(i => Math.min(VELOCIDADES.length - 1, i + 1))} disabled={velocidadIdx === VELOCIDADES.length - 1}
                  className="w-6 h-6 rounded hover:bg-slate-200 disabled:opacity-30 flex items-center justify-center" title="Más rápido (+)">
                  <Plus size={12} />
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Sidebar derecho: operarios libres */}
        {modo === 'simular' && (
          <aside className="w-44 bg-white border-l border-slate-200 overflow-y-auto flex-shrink-0 p-2">
            <div className="text-[10px] font-bold uppercase text-slate-500 mb-2 tracking-wider">
              Libres ({operariosLibres.length})
            </div>
            {operariosLibres.length === 0 ? (
              <p className="text-xs text-slate-400 italic">Todos ocupados</p>
            ) : (
              <ul className="space-y-1.5">
                {operariosLibres.map(emp => (
                  <li key={emp.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-slate-50">
                    <div
                      className="rounded-full border-2 border-white shadow flex items-center justify-center font-bold text-white text-[10px] flex-shrink-0"
                      style={{ width: 28, height: 28, background: emp.color }}
                    >
                      {iniciales(emp.nombre_completo)}
                    </div>
                    <span className="text-xs text-slate-700 truncate">{emp.nombre_completo}</span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Sub-componentes de sidebar
// ────────────────────────────────────────────────────────────────

interface SidebarUbicarProps {
  maquinas: Maquina[]
  contornos: ContornosMap
  seleccionada: string | null
  onSeleccionar: (id: string | null) => void
  onBorrar: (id: string) => void
  onBorrarTodo: () => void
}
function SidebarUbicar({ maquinas, contornos, seleccionada, onSeleccionar, onBorrar, onBorrarTodo }: SidebarUbicarProps) {
  return (
    <div className="p-3 flex-1">
      <h2 className="text-[10px] font-bold uppercase text-slate-500 mb-2 tracking-wider">
        Elegí una máquina y arrastrá en el plano
      </h2>
      <div className="text-xs text-slate-600 mb-2">Click+drag para dibujar el rectángulo.</div>
      <div className="space-y-1">
        {maquinas.map(m => {
          const ubicada = !!contornos[m.id]
          const sel = seleccionada === m.id
          return (
            <div key={m.id} className="flex items-center gap-1">
              <button onClick={() => onSeleccionar(sel ? null : m.id)}
                className={`flex-1 text-left px-3 py-2 rounded text-sm flex items-center justify-between transition-colors ${sel ? 'bg-blue-100 text-blue-900 ring-1 ring-blue-300' : 'hover:bg-slate-100 text-slate-700'}`}>
                <span className="truncate">{m.nombre}</span>
                <span className={ubicada ? 'text-green-600' : 'text-slate-300'}>{ubicada ? '●' : '○'}</span>
              </button>
              {ubicada && (
                <button onClick={() => onBorrar(m.id)} className="p-1.5 text-slate-400 hover:text-red-600" title="Borrar"><Trash2 size={12} /></button>
              )}
            </div>
          )
        })}
      </div>
      <button onClick={onBorrarTodo} className="mt-4 text-xs text-red-600 hover:underline flex items-center gap-1">
        <Trash2 size={12} /> Borrar todos
      </button>
    </div>
  )
}

interface SidebarOperariosProps {
  plantillas: PlantillaProceso[]
  tareas: CronogramaTarea[]
  maquinas: Maquina[]
  movimientos: MovimientosMap
  expandida: string | null
  pick: Pick | null
  onExpand: (id: string | null) => void
  onPick: (p: Pick | null) => void
  onChange: (plantillaId: string, plan: PlanMovimiento) => void
  onReset: (plantillaId: string) => void
}
function SidebarOperarios({ plantillas, tareas, maquinas, movimientos, expandida, pick, onExpand, onPick, onChange, onReset }: SidebarOperariosProps) {
  const plantillasUsadas = useMemo(() => {
    const ids = new Set(tareas.map(t => t.plantilla_id).filter(Boolean) as string[])
    const conMov = plantillas.filter(p => ids.has(p.id))
    const otras = plantillas.filter(p => !ids.has(p.id))
    return [...conMov, ...otras]
  }, [plantillas, tareas])

  return (
    <div className="p-3 flex-1">
      <h2 className="text-[10px] font-bold uppercase text-slate-500 mb-2 tracking-wider">
        Movimiento del operario por proceso
      </h2>
      <div className="text-xs text-slate-600 mb-3">
        Configurá cómo se ubica/mueve el operario para cada plantilla.
      </div>
      <div className="space-y-2">
        {plantillasUsadas.map(p => {
          const plan = movimientos[p.id] || { tipo: 'auto' as const }
          const usada = tareas.some(t => t.plantilla_id === p.id)
          const exp = expandida === p.id
          return (
            <div key={p.id} className={`border rounded ${usada ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}>
              <button onClick={() => onExpand(exp ? null : p.id)}
                className={`w-full text-left px-2 py-1.5 text-sm flex items-center justify-between ${exp ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
                <span className="truncate">{p.nombre}</span>
                <span className="text-[10px] font-mono uppercase text-slate-500">{plan.tipo}</span>
              </button>

              {exp && (
                <div className="p-2 border-t border-slate-200 space-y-2 text-xs">
                  <div className="text-[11px] text-slate-600 leading-snug">
                    <b>Auto:</b> sigue a las máquinas de la tarea (si hay varias, salta entre ellas).<br />
                    <b>Fijo:</b> queda quieto en un punto del plano.
                  </div>
                  {/* Selector de tipo */}
                  <div className="flex gap-1">
                    {(['auto', 'fijo'] as const).map(tipo => (
                      <button key={tipo}
                        onClick={() => {
                          if (tipo === 'auto') onChange(p.id, { tipo: 'auto' })
                          else if (tipo === 'fijo' && plan.tipo !== 'fijo') onChange(p.id, { tipo: 'fijo', anchor: { tipo: 'punto', x: 50, y: 50 } })
                        }}
                        className={`flex-1 px-1 py-1 rounded text-[11px] font-semibold uppercase ${plan.tipo === tipo ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                        {tipo}
                      </button>
                    ))}
                  </div>

                  {plan.tipo === 'fijo' && (
                    <AnchorEditor
                      label="Punto"
                      anchor={plan.anchor}
                      maquinas={maquinas}
                      pickActive={pick?.plantillaId === p.id && pick.campo === 'fijo'}
                      onPick={() => onPick({ plantillaId: p.id, campo: 'fijo' })}
                      onSelectMaquina={(maquinaId) => onChange(p.id, { tipo: 'fijo', anchor: { tipo: 'maquina', maquinaId } })}
                    />
                  )}

                  {plan.tipo !== 'auto' && (
                    <button onClick={() => onReset(p.id)} className="text-[10px] text-red-600 hover:underline">Resetear a auto</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface AnchorEditorProps {
  label: string
  anchor: Anchor
  maquinas: Maquina[]
  pickActive: boolean
  onPick: () => void
  onSelectMaquina: (maquinaId: string) => void
}
function AnchorEditor({ label, anchor, maquinas, pickActive, onPick, onSelectMaquina }: AnchorEditorProps) {
  const valor = anchor.tipo === 'maquina'
    ? (maquinas.find(m => m.id === anchor.maquinaId)?.nombre || '?')
    : `(${Math.round(anchor.x)}, ${Math.round(anchor.y)})`
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] font-bold text-purple-700 w-4">{label}</span>
      <select
        value={anchor.tipo === 'maquina' ? anchor.maquinaId : '__punto__'}
        onChange={e => {
          if (e.target.value !== '__punto__') onSelectMaquina(e.target.value)
        }}
        className="flex-1 border border-slate-300 rounded px-1 py-0.5 text-[11px]"
      >
        {anchor.tipo === 'punto' && <option value="__punto__">{valor}</option>}
        <optgroup label="Centro de máquina">
          {maquinas.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </optgroup>
      </select>
      <button onClick={onPick}
        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${pickActive ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'}`}
        title="Clickear punto en el plano">
        <Crosshair size={11} />
      </button>
    </div>
  )
}

interface SidebarSimularProps {
  horaActualStr: string
  ocupacionesPorMaquina: Map<string, { tarea: CronogramaTarea; color: string; empleado?: EmpleadoConLineas; uso: number }[]>
  avatares: { empleadoId: string }[]
  maquinasCount: number
  empleadosCount: number
  proximoEvento: { minuto: number; cambios: string[] } | null
  conflictos: { tipo: 'maquina' | 'empleado'; nombre: string; detalle: string }[]
  maquinas: Maquina[]
  onSaltarProximo: () => void
}
function SidebarSimular({ horaActualStr, ocupacionesPorMaquina, avatares, maquinasCount, empleadosCount, proximoEvento, conflictos, maquinas, onSaltarProximo }: SidebarSimularProps) {
  return (
    <div className="p-3 flex-1 flex flex-col gap-3">
      <div className="text-center py-2 bg-slate-900 text-white rounded-lg">
        <div className="text-[10px] uppercase tracking-wider text-slate-300">Hora</div>
        <div className="text-3xl font-mono font-bold">{horaActualStr}</div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="bg-blue-50 rounded p-2">
          <div className="text-[9px] uppercase text-blue-700 font-bold">Máquinas</div>
          <div className="text-lg font-bold text-blue-900">{ocupacionesPorMaquina.size} / {maquinasCount}</div>
        </div>
        <div className="bg-emerald-50 rounded p-2">
          <div className="text-[9px] uppercase text-emerald-700 font-bold">Operarios</div>
          <div className="text-lg font-bold text-emerald-900">{avatares.length} / {empleadosCount}</div>
        </div>
      </div>

      {proximoEvento && (
        <div className="bg-slate-50 border border-slate-200 rounded p-2">
          <div className="text-[9px] uppercase text-slate-500 font-bold tracking-wider">Próximo evento</div>
          <div className="text-sm font-bold text-slate-900">{minToTime(proximoEvento.minuto)}</div>
          {proximoEvento.cambios.map((c, i) => (<div key={i} className="text-[11px] text-slate-600 truncate">{c}</div>))}
          <button onClick={onSaltarProximo} className="mt-1 text-[11px] text-blue-600 hover:underline flex items-center gap-1">
            <SkipForward size={11} /> Saltar
          </button>
        </div>
      )}

      {conflictos.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded p-2">
          <div className="flex items-center gap-1 text-[10px] uppercase text-red-700 font-bold tracking-wider">
            <AlertTriangle size={11} /> Conflictos
          </div>
          <ul className="mt-1 space-y-1 text-[11px]">
            {conflictos.map((c, i) => (
              <li key={i} className="text-red-900"><span className="font-semibold">{c.nombre}</span>: {c.detalle}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="text-[10px] font-bold uppercase text-slate-500 mb-1 tracking-wider sticky top-0 bg-white">Activas ahora</div>
        {ocupacionesPorMaquina.size === 0 ? (
          <p className="text-xs text-slate-400 italic">Ninguna</p>
        ) : (
          <ul className="space-y-1">
            {Array.from(ocupacionesPorMaquina.entries()).map(([maqId, ocs]) => {
              const maq = maquinas.find(x => x.id === maqId)
              return ocs.map((o, i) => (
                <li key={`${maqId}-${i}`} className="px-2 py-1.5 rounded border-l-4 bg-white shadow-sm" style={{ borderLeftColor: o.color }}>
                  <div className="text-[9px] uppercase font-bold text-slate-500">{maq?.nombre}</div>
                  <div className="text-xs font-semibold text-slate-900 truncate">{o.tarea.descripcion}</div>
                  {o.empleado && (<div className="text-[10px] text-slate-600">{o.empleado.nombre_completo}</div>)}
                </li>
              ))
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
