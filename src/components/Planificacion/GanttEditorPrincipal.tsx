// Gantt principal del Editor Manual.
//
// Vista interactiva del resultado del scheduler con drag & drop por bloque:
//   - Drag horizontal → cambia hora de inicio (snap a 5 min).
//   - Drag vertical → cambia empleado (snap a fila).
//   - Click simple → onSeleccionar(instKey).
//   - Click derecho → onContextMenu(instKey, x, y).
//   - Drop externo (desde chips "Sin ubicar") → onDropExterno(instKey, empleadoId, inicioMin).

import { useMemo, useState, useRef, useEffect } from 'react'
import { ResultadoScheduler, EmpleadoScheduler, InstanciaEtapa } from '../../types/scheduler'
import { minToTime, formatDuration } from '../Cronograma/cronogramaHelpers'

interface Props {
  resultado: ResultadoScheduler
  empleados: EmpleadoScheduler[]
  rangoInicio: number
  rangoFin?: number
  plantillasCulpables?: Set<string>
  instanciaSeleccionada?: string | null
  onSeleccionar: (instKey: string) => void
  onContextMenu: (instKey: string, x: number, y: number) => void
  // Llamado cuando el usuario suelta un bloque (drag completado).
  onDragSoltar: (instKey: string, nuevoEmpleadoId: string, nuevoInicioMin: number) => void
  // Llamado cuando el usuario suelta un chip externo ("Sin ubicar") sobre el Gantt.
  // El padre detecta el drop con `instKeyArrastrandoExterno` en el data del drag.
  onDropExterno?: (instKey: string, empleadoId: string, inicioMin: number) => void
}

const PX_PER_MIN = 4
const ALTO_FILA = 44
const ANCHO_LABEL = 150
const SNAP_MIN = 5

const mm = (m: number) => minToTime(m).slice(0, 5)
const claveInst = (i: InstanciaEtapa) => `${i.plantillaId}:${i.lote}:${i.etapa.orden}`

function colorDePlantilla(plantillaId: string): string {
  let hash = 0
  for (let i = 0; i < plantillaId.length; i++) hash = (hash * 31 + plantillaId.charCodeAt(i)) | 0
  const h = Math.abs(hash) % 360
  return `hsl(${h}, 55%, 78%)`
}

interface DragState {
  instKey: string
  startX: number
  startY: number
  origenEmpleadoId: string
  origenInicio: number
  duracion: number
  // En vivo durante el drag:
  candEmpleadoId: string
  candInicio: number
  validez: 'ok' | 'warn' | 'error'
  mensajeValidez: string
}

export function GanttEditorPrincipal({
  resultado, empleados, rangoInicio, rangoFin = 960,
  plantillasCulpables, instanciaSeleccionada,
  onSeleccionar, onContextMenu, onDragSoltar, onDropExterno
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const finEfectivo = useMemo(() => {
    let max = rangoFin
    for (const e of empleados) for (const f of e.franjas) if (f.hasta > max) max = f.hasta
    for (const inst of resultado.instancias) {
      if (inst.estado === 'colocada' && inst.finAbs != null && inst.finAbs > max) max = inst.finAbs
    }
    return max
  }, [resultado, empleados, rangoFin])

  const totalMin = Math.max(60, finEfectivo - rangoInicio)
  const chartWidth = totalMin * PX_PER_MIN
  const minToPx = (m: number) => (m - rangoInicio) * PX_PER_MIN
  const pxToMin = (px: number) => Math.round(px / PX_PER_MIN / SNAP_MIN) * SNAP_MIN + rangoInicio

  const ticks = useMemo(() => {
    const arr: { m: number; mayor: boolean }[] = []
    const inicio = Math.ceil(rangoInicio / 30) * 30
    for (let t = inicio; t <= finEfectivo; t += 30) arr.push({ m: t, mayor: t % 60 === 0 })
    return arr
  }, [rangoInicio, finEfectivo])

  // Bloques por empleado (cada asignación de una instancia colocada).
  const bloquesPorEmpleado = useMemo(() => {
    const map = new Map<string, { inst: InstanciaEtapa; inicio: number; fin: number; enFranjaExtra: boolean }[]>()
    for (const inst of resultado.instancias) {
      if (inst.estado !== 'colocada') continue
      for (const a of inst.asignaciones) {
        for (const iv of a.ventanasAbs) {
          if (!map.has(a.empleadoId)) map.set(a.empleadoId, [])
          map.get(a.empleadoId)!.push({ inst, inicio: iv.inicio, fin: iv.fin, enFranjaExtra: a.enFranjaExtra })
        }
      }
    }
    return map
  }, [resultado])

  const empleadosVisibles = useMemo(
    () => empleados.filter(e => e.franjas.length > 0 || bloquesPorEmpleado.has(e.id)),
    [empleados, bloquesPorEmpleado]
  )

  // Validar candidato del drag (warn si fuera de turno, error si solape con otro bloque del mismo empleado).
  const validarCandidato = (instKey: string, empId: string, ini: number, dur: number): { v: 'ok' | 'warn' | 'error'; msg: string } => {
    const fin = ini + dur
    const emp = empleados.find(e => e.id === empId)
    if (!emp) return { v: 'error', msg: 'Empleado desconocido' }
    // Solape con otros bloques del mismo empleado (excluyendo el que se está moviendo).
    const otros = bloquesPorEmpleado.get(empId) ?? []
    for (const b of otros) {
      if (claveInst(b.inst) === instKey) continue
      if (ini < b.fin && fin > b.inicio) {
        return { v: 'error', msg: `Solape con ${b.inst.etapa.nombre}` }
      }
    }
    // Fuera de turno (suma de minutos que caen fuera de franjas 'turno').
    const minEnTurno = emp.franjas.filter(f => f.origen === 'turno')
      .reduce((s, f) => s + Math.max(0, Math.min(fin, f.hasta) - Math.max(ini, f.desde)), 0)
    const fuera = Math.max(0, dur - minEnTurno)
    if (fuera > 0) return { v: 'warn', msg: `+${fuera} min fuera de turno` }
    return { v: 'ok', msg: '' }
  }

  // Iniciar drag al apretar el mouse en un bloque.
  const iniciarDrag = (e: React.MouseEvent, inst: InstanciaEtapa, inicioActual: number, duracion: number, empleadoActual: string) => {
    if (e.button !== 0) return  // solo botón izquierdo
    e.preventDefault()
    setDrag({
      instKey: claveInst(inst),
      startX: e.clientX,
      startY: e.clientY,
      origenEmpleadoId: empleadoActual,
      origenInicio: inicioActual,
      duracion,
      candEmpleadoId: empleadoActual,
      candInicio: inicioActual,
      validez: 'ok',
      mensajeValidez: ''
    })
  }

  // Listener global de mousemove/mouseup durante el drag.
  useEffect(() => {
    if (!drag) return
    let movido = false
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!movido && (Math.abs(dx) < 3 && Math.abs(dy) < 3)) return
      movido = true
      // Calcular nuevo inicio (snap a 5 min) y nuevo empleado (snap a fila).
      const nuevoInicio = Math.max(rangoInicio, Math.min(finEfectivo - drag.duracion, pxToMin(minToPx(drag.origenInicio) + dx)))
      // La fila destino se calcula mediante el offset vertical (cada fila = ALTO_FILA).
      const filaActual = empleadosVisibles.findIndex(e2 => e2.id === drag.origenEmpleadoId)
      const filaCandidata = Math.max(0, Math.min(empleadosVisibles.length - 1, filaActual + Math.round(dy / ALTO_FILA)))
      const nuevoEmpId = empleadosVisibles[filaCandidata].id
      const v = validarCandidato(drag.instKey, nuevoEmpId, nuevoInicio, drag.duracion)
      setDrag(prev => prev ? { ...prev, candInicio: nuevoInicio, candEmpleadoId: nuevoEmpId, validez: v.v, mensajeValidez: v.msg } : null)
    }
    const onUp = () => {
      if (movido && drag) {
        // Solo aplicar si hubo cambio real.
        if (drag.candEmpleadoId !== drag.origenEmpleadoId || drag.candInicio !== drag.origenInicio) {
          onDragSoltar(drag.instKey, drag.candEmpleadoId, drag.candInicio)
        }
      } else if (drag) {
        // Click simple (sin movimiento) → seleccionar.
        onSeleccionar(drag.instKey)
      }
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag, empleadosVisibles, finEfectivo, rangoInicio, onDragSoltar, onSeleccionar])

  // Drop de un chip externo "Sin ubicar".
  const onDropEnGrilla = (e: React.DragEvent, empleadoId: string) => {
    if (!onDropExterno) return
    e.preventDefault()
    const instKey = e.dataTransfer.getData('text/plain')
    if (!instKey) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const inicio = Math.max(rangoInicio, pxToMin(x))
    onDropExterno(instKey, empleadoId, inicio)
  }

  const conflictosRaiz = resultado.conflictos.filter(c => !c.cascada)

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto select-none">
        <div className="relative" style={{ minWidth: ANCHO_LABEL + chartWidth }}>

          {/* Cabecera ticks */}
          <div className="flex sticky top-0 z-20 bg-white border-b border-slate-200">
            <div className="flex-shrink-0 sticky left-0 z-10 bg-white border-r border-slate-200" style={{ width: ANCHO_LABEL, height: 28 }} />
            <div className="relative flex-shrink-0" style={{ width: chartWidth, height: 28 }}>
              {ticks.map(t => (
                <div key={t.m} className={`absolute top-0 bottom-0 border-l ${t.mayor ? 'border-slate-300' : 'border-slate-200'}`} style={{ left: minToPx(t.m) }}>
                  {t.mayor && <span className="text-[10px] text-slate-500 px-1 select-none">{mm(t.m)}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Filas por empleado */}
          {empleadosVisibles.map(emp => {
            const bloques = bloquesPorEmpleado.get(emp.id) ?? []
            return (
              <div key={emp.id} className="flex border-b border-slate-100" style={{ height: ALTO_FILA }}>
                <div className="flex-shrink-0 sticky left-0 z-10 bg-white border-r border-slate-200 px-2 flex items-center" style={{ width: ANCHO_LABEL, height: ALTO_FILA }}>
                  <span className="text-[11px] font-semibold text-slate-700 truncate" title={emp.nombre_completo}>{emp.nombre_completo}</span>
                </div>

                <div
                  className="relative flex-shrink-0"
                  style={{ width: chartWidth, height: ALTO_FILA }}
                  onDragOver={onDropExterno ? (e => e.preventDefault()) : undefined}
                  onDrop={onDropExterno ? (e => onDropEnGrilla(e, emp.id)) : undefined}
                >
                  {/* Fondos de turno / franja extra */}
                  {emp.franjas.map((f, i) => (
                    <div key={i}
                         className={f.origen === 'turno' ? 'bg-slate-100' : 'bg-amber-100'}
                         style={{
                           position: 'absolute',
                           left: minToPx(Math.max(f.desde, rangoInicio)),
                           width: (Math.min(f.hasta, finEfectivo) - Math.max(f.desde, rangoInicio)) * PX_PER_MIN,
                           top: 0, bottom: 0
                         }}
                         title={f.origen === 'extra' ? `Franja extra: ${mm(f.desde)}–${mm(f.hasta)}` : `Turno: ${mm(f.desde)}–${mm(f.hasta)}`} />
                  ))}

                  {ticks.filter(t => t.mayor).map(t => (
                    <div key={`g-${t.m}`} className="absolute top-0 bottom-0 border-l border-slate-200/70 pointer-events-none" style={{ left: minToPx(t.m) }} />
                  ))}

                  {/* Bloques */}
                  {bloques.map((b, i) => {
                    const inst = b.inst
                    const key = claveInst(inst)
                    const seleccionado = instanciaSeleccionada === key
                    const enDrag = drag?.instKey === key
                    const color = inst.etapa.color ?? colorDePlantilla(inst.plantillaId)
                    const esCulpable = plantillasCulpables?.has(inst.plantillaId) ?? false
                    return (
                      <div key={`${key}:${i}`}
                           onMouseDown={e => iniciarDrag(e, inst, b.inicio, b.fin - b.inicio, emp.id)}
                           onContextMenu={e => { e.preventDefault(); onContextMenu(key, e.clientX, e.clientY) }}
                           title={`${inst.plantillaNombre} · ${inst.etapa.nombre} (lote ${inst.lote}) · ${mm(b.inicio)}–${mm(b.fin)} · ${formatDuration(b.fin - b.inicio)}${b.enFranjaExtra ? ' · hora extra' : ''}${esCulpable ? ' · bloqueando otra tarea' : ''}`}
                           className={`absolute rounded text-[10px] leading-tight text-slate-800 px-1 flex items-center overflow-hidden cursor-grab active:cursor-grabbing ${b.enFranjaExtra ? 'border-2 border-dashed border-violet-500' : 'border border-slate-400'} ${esCulpable ? 'ring-2 ring-rose-400' : ''} ${seleccionado ? 'ring-2 ring-blue-500' : ''} ${enDrag ? 'opacity-30' : ''}`}
                           style={{
                             left: minToPx(b.inicio),
                             width: Math.max(2, (b.fin - b.inicio) * PX_PER_MIN),
                             top: 4,
                             height: ALTO_FILA - 8,
                             backgroundColor: color
                           }}>
                        <span className="truncate">{inst.etapa.nombre}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Ghost del bloque en drag */}
          {drag && (() => {
            const filaIdx = empleadosVisibles.findIndex(e => e.id === drag.candEmpleadoId)
            if (filaIdx === -1) return null
            const top = 28 /* header */ + filaIdx * ALTO_FILA + 4
            const colorGhost = drag.validez === 'error' ? 'bg-rose-300 border-rose-500' :
                              drag.validez === 'warn' ? 'bg-amber-200 border-amber-500' :
                              'bg-blue-200 border-blue-500'
            return (
              <div className={`absolute rounded border-2 pointer-events-none flex items-center px-2 text-[10px] font-semibold ${colorGhost}`}
                   style={{
                     left: ANCHO_LABEL + minToPx(drag.candInicio),
                     width: drag.duracion * PX_PER_MIN,
                     top,
                     height: ALTO_FILA - 8,
                     opacity: 0.9
                   }}>
                <span className="truncate">{mm(drag.candInicio)}–{mm(drag.candInicio + drag.duracion)}{drag.mensajeValidez ? ` · ${drag.mensajeValidez}` : ''}</span>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Sección "Sin ubicar" como antes pero más simple — los chips draggables están en PanelSinUbicar */}
      {conflictosRaiz.length > 0 && (
        <div className="flex-shrink-0 border-t border-rose-200 px-3 py-1.5 bg-rose-50/40 text-[10px] text-rose-700">
          {conflictosRaiz.length} etapa(s) sin ubicar — arrastralas desde el panel izquierdo o usá el menú contextual.
        </div>
      )}
    </div>
  )
}
