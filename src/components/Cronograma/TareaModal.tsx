import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { CronogramaTarea, EmpleadoConLineas, TamanoTexto, OrientacionTexto } from '../../types/cronograma'
import { timeToMin, minToTime, formatDuration } from './cronogramaHelpers'

interface TareaModalProps {
  visible: boolean
  tarea: Partial<CronogramaTarea> | null
  empleados: EmpleadoConLineas[]
  onGuardar: (data: {
    linea_id: string
    hora_inicio: string
    hora_fin: string
    descripcion: string
    color: string | null
    bloqueada: boolean
    tamano_texto: TamanoTexto
    orientacion_texto: OrientacionTexto
    permite_solape: boolean
    factor_solape_pct: number | null
    solape_modo: string | null
  }) => void
  onEliminar?: () => void
  onAgregarAyudante?: (data: { empleadoId: string | null; nombreManual: string | null; horaInicio: string; horaFin: string }) => void
  onCerrar: () => void
}

const TAMANOS_TEXTO: { value: TamanoTexto; label: string }[] = [
  { value: 'xs', label: 'Muy chico' },
  { value: 'sm', label: 'Chico' },
  { value: 'normal', label: 'Normal' },
  { value: 'lg', label: 'Grande' },
  { value: 'xl', label: 'Muy grande' }
]

export function TareaModal({ visible, tarea, empleados, onGuardar, onEliminar, onAgregarAyudante, onCerrar }: TareaModalProps) {
  const [ayudanteSel, setAyudanteSel] = useState('')
  const [ayudanteNombre, setAyudanteNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [horaInicio, setHoraInicio] = useState('04:00')
  const [horaFin, setHoraFin] = useState('04:30')
  const [lineaId, setLineaId] = useState('')
  const [color, setColor] = useState('')
  const [usarColorEmpleado, setUsarColorEmpleado] = useState(true)
  const [bloqueada, setBloqueada] = useState(false)
  const [permiteSolape, setPermiteSolape] = useState(false)
  const [factorSolape, setFactorSolape] = useState('')   // '' = usar global
  const [solapeModo, setSolapeModo] = useState('')        // '' = usar global
  const [tamanoTexto, setTamanoTexto] = useState<TamanoTexto>('normal')
  const [orientacionTexto, setOrientacionTexto] = useState<OrientacionTexto>('horizontal')
  const [duracionMin, setDuracionMin] = useState(30)

  const mouseDownOnBackdropRef = useRef(false)

  useEffect(() => {
    setAyudanteSel('')
    setAyudanteNombre('')
    if (tarea) {
      setDescripcion(tarea.descripcion || '')
      setHoraInicio(tarea.hora_inicio || '04:00')
      setHoraFin(tarea.hora_fin || '04:30')
      setLineaId(tarea.linea_id || '')
      setBloqueada(tarea.bloqueada || false)
      setPermiteSolape(tarea.permite_solape || false)
      setFactorSolape(tarea.factor_solape_pct != null ? String(tarea.factor_solape_pct) : '')
      setSolapeModo(tarea.solape_modo || '')
      setTamanoTexto(tarea.tamano_texto || 'normal')
      setOrientacionTexto(tarea.orientacion_texto || 'horizontal')
      const dur = timeToMin(tarea.hora_fin || '04:30') - timeToMin(tarea.hora_inicio || '04:00')
      setDuracionMin(Math.max(1, dur))
      if (tarea.color) {
        setColor(tarea.color)
        setUsarColorEmpleado(false)
      } else {
        setUsarColorEmpleado(true)
        const emp = empleados.find(e => e.lineas.some(l => l.id === tarea.linea_id))
        setColor(emp?.color || '#3b82f6')
      }
    }
  }, [tarea, empleados])

  if (!visible) return null

  const duracion = timeToMin(horaFin) - timeToMin(horaInicio)
  const esNueva = !tarea?.id

  const handleCambioDuracion = (valor: string) => {
    const num = parseInt(valor)
    if (isNaN(num) || num < 1) return
    setDuracionMin(num)
    const nuevoFin = timeToMin(horaInicio) + num
    setHoraFin(minToTime(Math.min(nuevoFin, 1439)))
  }

  const handleCambioInicio = (valor: string) => {
    setHoraInicio(valor)
    const nuevoFin = timeToMin(valor) + duracionMin
    setHoraFin(minToTime(Math.min(nuevoFin, 1439)))
  }

  const handleCambioFin = (valor: string) => {
    setHoraFin(valor)
    const nuevaDur = timeToMin(valor) - timeToMin(horaInicio)
    if (nuevaDur > 0) setDuracionMin(nuevaDur)
  }

  const handleGuardar = () => {
    if (!horaInicio || !horaFin || !lineaId) return
    if (timeToMin(horaFin) <= timeToMin(horaInicio)) return
    onGuardar({
      linea_id: lineaId,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      descripcion: descripcion.trim() || 'Sin descripción',
      color: usarColorEmpleado ? null : color,
      bloqueada,
      tamano_texto: tamanoTexto,
      orientacion_texto: orientacionTexto,
      permite_solape: permiteSolape,
      factor_solape_pct: factorSolape.trim() === '' ? null : Math.max(0, Math.min(500, Math.round(Number(factorSolape)))),
      solape_modo: solapeModo === '' ? null : solapeModo
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCerrar()
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault()
      handleGuardar()
    }
  }

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    mouseDownOnBackdropRef.current = e.target === e.currentTarget
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && mouseDownOnBackdropRef.current) {
      onCerrar()
    }
    mouseDownOnBackdropRef.current = false
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] backdrop-blur-sm"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white w-[480px] max-w-[92vw] max-h-[90vh] shadow-2xl rounded-lg overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              {esNueva ? 'Nueva tarea' : 'Editar tarea'}
            </h2>
            <button onClick={onCerrar} className="p-1 rounded hover:bg-slate-200 text-slate-500">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
              Descripción
            </label>
            <input
              type="text"
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Ej: Estiba medialunas dulces"
              className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
                Inicio
              </label>
              <input
                type="time"
                value={horaInicio}
                onChange={e => handleCambioInicio(e.target.value)}
                className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm font-mono font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
                Fin
              </label>
              <input
                type="time"
                value={horaFin}
                onChange={e => handleCambioFin(e.target.value)}
                className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm font-mono font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
                Duración (min)
              </label>
              <input
                type="number"
                min={1}
                value={duracionMin}
                onChange={e => handleCambioDuracion(e.target.value)}
                className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm font-mono font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                {duracion > 0 ? formatDuration(duracion) : '—'}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
              Línea
            </label>
            <select
              value={lineaId}
              onChange={e => {
                setLineaId(e.target.value)
                if (usarColorEmpleado) {
                  const emp = empleados.find(em => em.lineas.some(l => l.id === e.target.value))
                  if (emp) setColor(emp.color)
                }
              }}
              className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            >
              <option value="">Seleccionar...</option>
              {empleados.map(emp => (
                <optgroup key={emp.id} label={emp.nombre_completo}>
                  {emp.lineas.map(ln => (
                    <option key={ln.id} value={ln.id}>{ln.nombre}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
                Tamaño de texto
              </label>
              <select
                value={tamanoTexto}
                onChange={e => setTamanoTexto(e.target.value as TamanoTexto)}
                className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              >
                {TAMANOS_TEXTO.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
                Orientación texto
              </label>
              <select
                value={orientacionTexto}
                onChange={e => setOrientacionTexto(e.target.value as OrientacionTexto)}
                className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              >
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
              Color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color || '#3b82f6'}
                onChange={e => { setColor(e.target.value); setUsarColorEmpleado(false) }}
                className="w-10 h-9 border border-slate-300 rounded cursor-pointer"
              />
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={usarColorEmpleado}
                  onChange={e => setUsarColorEmpleado(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Usar color del empleado
              </label>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={bloqueada}
              onChange={e => setBloqueada(e.target.checked)}
              className="rounded border-slate-300"
            />
            Bloquear esta tarea
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={permiteSolape}
              onChange={e => setPermiteSolape(e.target.checked)}
              className="rounded border-slate-300"
            />
            Puede solaparse (paralelo)
          </label>

          {/* Override de penalización por solapamiento (solo esta tarea) */}
          <div className="pt-3 border-t border-slate-200">
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
              Penalización por solape (solo esta tarea)
            </label>
            <p className="text-[11px] text-slate-400 mb-2">Dejá vacío / "Global" para usar la configuración general.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-slate-500 font-semibold mb-1">% extra</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={factorSolape}
                  onChange={e => setFactorSolape(e.target.value)}
                  placeholder="Global"
                  className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm font-mono font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 font-semibold mb-1">¿Cuál se alarga?</label>
                <select
                  value={solapeModo}
                  onChange={e => setSolapeModo(e.target.value)}
                  className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                >
                  <option value="">Global</option>
                  <option value="solapada">La solapada</option>
                  <option value="paralela">La paralela</option>
                  <option value="ambas">Ambas</option>
                </select>
              </div>
            </div>
          </div>

          {/* Ayudantes (manual) */}
          {!esNueva && onAgregarAyudante && (
            <div className="pt-3 border-t border-slate-200">
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
                Agregar ayudante a esta tarea
              </label>
              <p className="text-[11px] text-slate-400 mb-2">Crea un bloque ({horaInicio}–{horaFin}) en la línea del ayudante elegido, o escribí un nombre manual.</p>
              <div className="flex items-center gap-2">
                <select
                  value={ayudanteSel}
                  onChange={e => setAyudanteSel(e.target.value)}
                  className="flex-1 h-9 px-3 border border-slate-300 rounded-md text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                >
                  <option value="">Seleccionar empleado...</option>
                  {empleados.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.nombre_completo}</option>
                  ))}
                  <option value="__manual__">Otro (escribir manual)</option>
                </select>
                {ayudanteSel === '__manual__' && (
                  <input
                    type="text"
                    value={ayudanteNombre}
                    onChange={e => setAyudanteNombre(e.target.value)}
                    placeholder="Nombre..."
                    className="flex-1 h-9 px-3 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  />
                )}
                <button
                  onClick={() => {
                    if (!ayudanteSel) return
                    const esManual = ayudanteSel === '__manual__'
                    if (esManual && !ayudanteNombre.trim()) return
                    onAgregarAyudante({
                      empleadoId: esManual ? null : ayudanteSel,
                      nombreManual: esManual ? ayudanteNombre.trim() : null,
                      horaInicio,
                      horaFin
                    })
                    setAyudanteSel('')
                    setAyudanteNombre('')
                  }}
                  disabled={!ayudanteSel || (ayudanteSel === '__manual__' && !ayudanteNombre.trim())}
                  className="h-9 px-3 text-sm font-semibold text-amber-700 border border-amber-300 bg-amber-50 rounded-md hover:bg-amber-100 disabled:opacity-40"
                >
                  Agregar
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button
            onClick={onCerrar}
            className="h-8 px-3 text-sm font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-100"
          >
            Cancelar
          </button>
          {!esNueva && onEliminar && (
            <button
              onClick={onEliminar}
              className="h-8 px-3 text-sm font-semibold text-red-600 border border-red-300 rounded-md hover:bg-red-50"
            >
              Eliminar
            </button>
          )}
          <button
            onClick={handleGuardar}
            disabled={!lineaId || duracion <= 0}
            className="h-8 px-4 text-sm font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
