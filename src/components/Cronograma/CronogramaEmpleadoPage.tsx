import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { cronogramaService } from '../../services/cronogramaService'
import { CronogramaTarea, EmpleadoConLineas, DIAS_SEMANA_NOMBRES } from '../../types/cronograma'
import { CronogramaTimeline } from './CronogramaTimeline'
import { TareaModal } from './TareaModal'
import { getDiaSemanaHoy } from './cronogramaHelpers'

interface Props {
  empleadoId: string
  diaInicial?: number
  onVolver: () => void
}

export function CronogramaEmpleadoPage({ empleadoId, diaInicial, onVolver }: Props) {
  const [empleados, setEmpleados] = useState<EmpleadoConLineas[]>([])
  const [tareas, setTareas] = useState<CronogramaTarea[]>([])
  const [diaActual, setDiaActual] = useState(diaInicial !== undefined ? diaInicial : getDiaSemanaHoy)
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [rowScale] = useState(1)
  const [rangoInicio, setRangoInicio] = useState('04:00')
  const [rangoFin, setRangoFin] = useState('15:00')
  const [tareasSeleccionadas, setTareasSeleccionadas] = useState<string[]>([])
  const [modalVisible, setModalVisible] = useState(false)
  const [modalTarea, setModalTarea] = useState<Partial<CronogramaTarea> | null>(null)
  const [nombreEmpleado, setNombreEmpleado] = useState('')

  const cargarDatos = useCallback(async () => {
    try {
      setLoading(true)
      const [emps, tars] = await Promise.all([
        cronogramaService.listarEmpleadosConLineas(diaActual),
        cronogramaService.listarTareas(diaActual)
      ])
      const empFiltrado = emps.filter(e => e.id === empleadoId)
      setEmpleados(empFiltrado)
      if (empFiltrado.length > 0) {
        setNombreEmpleado(empFiltrado[0].nombre_completo)
        const lineaIds = new Set(empFiltrado[0].lineas.map(l => l.id))
        setTareas(tars.filter(t => lineaIds.has(t.linea_id)))
      } else {
        setTareas([])
      }
    } catch (err) {
      console.error('Error cargando cronograma empleado:', err)
    } finally {
      setLoading(false)
    }
  }, [diaActual, empleadoId])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  useEffect(() => {
    const cargarRango = async () => {
      try {
        const rango = await cronogramaService.obtenerRangoHorario(diaActual)
        if (rango) {
          setRangoInicio(rango.hora_inicio)
          setRangoFin(rango.hora_fin)
        } else {
          setRangoInicio('04:00')
          setRangoFin('15:00')
        }
      } catch (err) {
        console.error('Error cargando rango horario:', err)
      }
    }
    cargarRango()
  }, [diaActual])

  const handleCrearTarea = useCallback((lineaId: string, horaInicio: string, horaFin: string) => {
    setModalTarea({
      linea_id: lineaId,
      dia_semana: diaActual,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      descripcion: ''
    })
    setModalVisible(true)
  }, [diaActual])

  const handleGuardarTarea = useCallback(async (datos: {
    linea_id: string; hora_inicio: string; hora_fin: string; descripcion: string; color: string | null; bloqueada: boolean; tamano_texto: string; orientacion_texto: string
  }) => {
    try {
      if (modalTarea?.id) {
        await cronogramaService.actualizarTarea(modalTarea.id, datos)
      } else {
        await cronogramaService.crearTarea({ ...datos, dia_semana: diaActual, tamano_texto: datos.tamano_texto as 'xs' | 'sm' | 'normal' | 'lg' | 'xl', orientacion_texto: datos.orientacion_texto as 'horizontal' | 'vertical' })
      }
      setModalVisible(false)
      setModalTarea(null)
      await cargarDatos()
    } catch (err) {
      console.error('Error guardando tarea:', err)
    }
  }, [modalTarea, diaActual, cargarDatos])

  const handleMoverTarea = useCallback(async (tareaId: string, nuevaHoraInicio: string, nuevaHoraFin: string, nuevaLineaId?: string) => {
    try {
      const update: Record<string, string> = { hora_inicio: nuevaHoraInicio, hora_fin: nuevaHoraFin }
      if (nuevaLineaId) update.linea_id = nuevaLineaId
      await cronogramaService.actualizarTarea(tareaId, update)
      await cargarDatos()
    } catch (err) {
      console.error('Error moviendo tarea:', err)
    }
  }, [cargarDatos])

  const handleMoverMultiTareas = useCallback(async (movimientos: { tareaId: string; nuevaHoraInicio: string; nuevaHoraFin: string; nuevaLineaId?: string }[]) => {
    try {
      await Promise.all(movimientos.map(mov => {
        const update: Record<string, string> = { hora_inicio: mov.nuevaHoraInicio, hora_fin: mov.nuevaHoraFin }
        if (mov.nuevaLineaId) update.linea_id = mov.nuevaLineaId
        return cronogramaService.actualizarTarea(mov.tareaId, update)
      }))
      await cargarDatos()
    } catch (err) {
      console.error('Error moviendo múltiples tareas:', err)
    }
  }, [cargarDatos])

  const handleResizeTarea = useCallback(async (tareaId: string, nuevaHoraInicio: string, nuevaHoraFin: string) => {
    try {
      await cronogramaService.actualizarTarea(tareaId, { hora_inicio: nuevaHoraInicio, hora_fin: nuevaHoraFin })
      await cargarDatos()
    } catch (err) {
      console.error('Error redimensionando tarea:', err)
    }
  }, [cargarDatos])

  const handleRenombrarLinea = useCallback(async (lineaId: string, nuevoNombre: string) => {
    try {
      await cronogramaService.actualizarLinea(lineaId, { nombre: nuevoNombre })
      await cargarDatos()
    } catch (err) {
      console.error(err)
    }
  }, [cargarDatos])

  const handleAgregarLinea = useCallback(async (empId: string) => {
    const nombre = prompt('Nombre de la línea:', 'Línea nueva')
    if (!nombre?.trim()) return
    try {
      const emp = empleados.find(e => e.id === empId)
      await cronogramaService.crearLinea({
        empleado_id: empId,
        nombre: nombre.trim(),
        dia_semana: diaActual,
        orden: emp?.lineas.length || 0
      })
      await cargarDatos()
    } catch (err) {
      console.error(err)
    }
  }, [diaActual, empleados, cargarDatos])

  const handleEliminarLinea = useCallback(async (lineaId: string) => {
    if (!confirm('Eliminar esta línea y sus tareas?')) return
    try {
      await cronogramaService.eliminarLinea(lineaId)
      await cargarDatos()
    } catch (err) {
      console.error(err)
    }
  }, [cargarDatos])

  const handleMoverLinea = useCallback(async (empId: string, lineaId: string, direccion: 'up' | 'down') => {
    const emp = empleados.find(e => e.id === empId)
    if (!emp) return
    const idx = emp.lineas.findIndex(l => l.id === lineaId)
    const swapIdx = direccion === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= emp.lineas.length) return
    const nuevas = [...emp.lineas]
    const temp = nuevas[idx]
    nuevas[idx] = nuevas[swapIdx]
    nuevas[swapIdx] = temp
    const ordenadas = nuevas.map((l, i) => ({ id: l.id, orden: i }))
    try {
      await cronogramaService.reordenarLineas(ordenadas)
      await cargarDatos()
    } catch (err) {
      console.error(err)
    }
  }, [empleados, cargarDatos])

  const cambiarDia = (dir: -1 | 1) => {
    setDiaActual(d => ((d + dir) % 7 + 7) % 7)
  }

  if (loading && empleados.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
        <button
          onClick={onVolver}
          className="h-8 w-8 flex items-center justify-center rounded hover:bg-slate-200 text-slate-600"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900">{nombreEmpleado}</h1>
          <p className="text-[12px] text-slate-500">Línea de tiempo individual</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => cambiarDia(-1)} className="h-7 w-7 flex items-center justify-center rounded hover:bg-slate-200 text-slate-600">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-bold text-slate-800 min-w-[80px] text-center">{DIAS_SEMANA_NOMBRES[diaActual]}</span>
          <button onClick={() => cambiarDia(1)} className="h-7 w-7 flex items-center justify-center rounded hover:bg-slate-200 text-slate-600">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex items-center gap-1.5 ml-4">
          <label className="text-[11px] text-slate-500">Inicio</label>
          <input
            type="time"
            value={rangoInicio}
            onChange={e => setRangoInicio(e.target.value)}
            className="h-7 px-1.5 text-[11px] border border-slate-300 rounded bg-white"
          />
          <label className="text-[11px] text-slate-500">Fin</label>
          <input
            type="time"
            value={rangoFin}
            onChange={e => setRangoFin(e.target.value)}
            className="h-7 px-1.5 text-[11px] border border-slate-300 rounded bg-white"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {empleados.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            Este empleado no tiene líneas configuradas para el {DIAS_SEMANA_NOMBRES[diaActual]}
          </div>
        ) : (
          <CronogramaTimeline
            empleados={empleados}
            tareas={tareas}
            rangoInicio={rangoInicio}
            rangoFin={rangoFin}
            zoom={zoom}
            rowScale={rowScale}
            tareasSeleccionadas={tareasSeleccionadas}
            collapsedEmpleados={[]}
            onSeleccionarTarea={setTareasSeleccionadas}
            onDobleClickTarea={(t) => { setModalTarea(t); setModalVisible(true) }}
            onCrearTarea={handleCrearTarea}
            onMoverTarea={handleMoverTarea}
            onMoverMultiTareas={handleMoverMultiTareas}
            onResizeTarea={handleResizeTarea}
            onToggleCollapse={() => {}}
            onRenombrarLinea={handleRenombrarLinea}
            onAgregarLinea={handleAgregarLinea}
            onEliminarLinea={handleEliminarLinea}
            onMoverLinea={handleMoverLinea}
            onZoomChange={setZoom}
          />
        )}
      </div>

      <TareaModal
        visible={modalVisible}
        tarea={modalTarea}
        empleados={empleados}
        onGuardar={handleGuardarTarea}
        onCerrar={() => { setModalVisible(false); setModalTarea(null) }}
      />
    </div>
  )
}
