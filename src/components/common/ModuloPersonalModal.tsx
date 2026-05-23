import { useState, useEffect, useRef } from 'react'
import { X, Plus, Search, UserCheck, UserX, CreditCard as Edit2, Check, Brain, Clock } from 'lucide-react'
import { supabase } from '../../config/supabase'
import { Empleado } from '../../types/cronograma'
import { Habilidad } from '../../types/planificacion'
import { planificacionService } from '../../services/planificacionService'

const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

interface HorarioDia {
  dia_semana: number
  activo: boolean
  hora_inicio: string
  hora_fin: string
}

interface ModuloPersonalModalProps {
  visible: boolean
  onCerrar: () => void
  onEmpleadoCreado?: () => void
}

export function ModuloPersonalModal({ visible, onCerrar, onEmpleadoCreado }: ModuloPersonalModalProps) {
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [habilidades, setHabilidades] = useState<Habilidad[]>([])
  const [empleadoHabilidades, setEmpleadoHabilidades] = useState<Map<string, Set<string>>>(new Map())
  // Map: empleadoId → horarios por dia
  const [empleadoHorarios, setEmpleadoHorarios] = useState<Map<string, HorarioDia[]>>(new Map())

  const [loading, setLoading] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [mostrarInactivos, setMostrarInactivos] = useState(false)
  const [formVisible, setFormVisible] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [form, setForm] = useState({ nombre_completo: '', documento: '', telefono: '', email: '' })
  const [guardando, setGuardando] = useState(false)

  // Panel expandido por empleado: null | { empId, tipo }
  const [expandido, setExpandido] = useState<{ empId: string; tipo: 'habilidades' | 'horario' } | null>(null)
  const [editandoHabilidades, setEditandoHabilidades] = useState<Set<string>>(new Set())
  const [guardandoHabilidades, setGuardandoHabilidades] = useState(false)
  const [editandoHorarios, setEditandoHorarios] = useState<HorarioDia[]>([])
  const [guardandoHorarios, setGuardandoHorarios] = useState(false)

  const nombreRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) cargar()
  }, [visible])

  useEffect(() => {
    if (formVisible) setTimeout(() => nombreRef.current?.focus(), 100)
  }, [formVisible])

  const cargar = async () => {
    setLoading(true)
    try {
      const [empRes, habRes, empHabRes, horariosRes] = await Promise.all([
        supabase.from('empleados').select('*').order('nombre_completo'),
        planificacionService.listarHabilidades(),
        supabase.from('empleado_habilidades').select('empleado_id, habilidad_id'),
        planificacionService.listarTodosHorariosEmpleados()
      ])
      if (empRes.error) throw empRes.error
      if (empHabRes.error) throw empHabRes.error

      setEmpleados(empRes.data || [])
      setHabilidades(habRes)

      const habMap = new Map<string, Set<string>>()
      for (const row of empHabRes.data || []) {
        if (!habMap.has(row.empleado_id)) habMap.set(row.empleado_id, new Set())
        habMap.get(row.empleado_id)!.add(row.habilidad_id)
      }
      setEmpleadoHabilidades(habMap)

      const horMap = new Map<string, HorarioDia[]>()
      for (const h of horariosRes) {
        if (!horMap.has(h.empleado_id)) horMap.set(h.empleado_id, [])
        horMap.get(h.empleado_id)!.push({
          dia_semana: h.dia_semana,
          activo: true,
          hora_inicio: h.hora_inicio.slice(0, 5),
          hora_fin: h.hora_fin.slice(0, 5)
        })
      }
      setEmpleadoHorarios(horMap)
    } catch (err) {
      console.error('Error cargando empleados:', err)
    } finally {
      setLoading(false)
    }
  }

  const limpiarForm = () => {
    setForm({ nombre_completo: '', documento: '', telefono: '', email: '' })
    setEditandoId(null)
  }

  const handleNuevo = () => { limpiarForm(); setFormVisible(true) }

  const handleEditar = (emp: Empleado) => {
    setForm({
      nombre_completo: emp.nombre_completo,
      documento: emp.documento || '',
      telefono: emp.telefono || '',
      email: emp.email || ''
    })
    setEditandoId(emp.id)
    setFormVisible(true)
  }

  const handleGuardar = async () => {
    if (!form.nombre_completo.trim()) return
    setGuardando(true)
    try {
      if (editandoId) {
        const { error } = await supabase.from('empleados').update({
          nombre_completo: form.nombre_completo.trim(),
          documento: form.documento.trim() || null,
          telefono: form.telefono.trim() || null,
          email: form.email.trim() || null,
          fecha_actualizacion: new Date().toISOString()
        }).eq('id', editandoId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('empleados').insert({
          nombre_completo: form.nombre_completo.trim(),
          documento: form.documento.trim() || null,
          telefono: form.telefono.trim() || null,
          email: form.email.trim() || null
        })
        if (error) throw error
      }
      setFormVisible(false)
      limpiarForm()
      await cargar()
      onEmpleadoCreado?.()
    } catch (err) {
      console.error('Error guardando empleado:', err)
    } finally {
      setGuardando(false)
    }
  }

  const handleToggleActivo = async (emp: Empleado) => {
    try {
      const { error } = await supabase.from('empleados')
        .update({ activo: !emp.activo, fecha_actualizacion: new Date().toISOString() })
        .eq('id', emp.id)
      if (error) throw error
      await cargar()
      onEmpleadoCreado?.()
    } catch (err) {
      console.error('Error cambiando estado:', err)
    }
  }

  // ---- Habilidades ----

  const abrirHabilidades = (empId: string) => {
    if (expandido?.empId === empId && expandido.tipo === 'habilidades') {
      setExpandido(null)
      return
    }
    const current = empleadoHabilidades.get(empId) ?? new Set<string>()
    setEditandoHabilidades(new Set(current))
    setExpandido({ empId, tipo: 'habilidades' })
  }

  const handleGuardarHabilidades = async (empId: string) => {
    setGuardandoHabilidades(true)
    try {
      await planificacionService.asignarHabilidadesEmpleado(empId, Array.from(editandoHabilidades))
      setEmpleadoHabilidades(prev => {
        const next = new Map(prev)
        next.set(empId, new Set(editandoHabilidades))
        return next
      })
      setExpandido(null)
    } catch (err) {
      console.error('Error guardando habilidades:', err)
    } finally {
      setGuardandoHabilidades(false)
    }
  }

  const toggleHabilidad = (habId: string) => {
    setEditandoHabilidades(prev => {
      const next = new Set(prev)
      if (next.has(habId)) next.delete(habId)
      else next.add(habId)
      return next
    })
  }

  // ---- Horarios ----

  const horarioVacio = (): HorarioDia[] =>
    DIAS_SEMANA.map((_, i) => ({ dia_semana: i, activo: false, hora_inicio: '06:00', hora_fin: '14:00' }))

  const abrirHorario = (empId: string) => {
    if (expandido?.empId === empId && expandido.tipo === 'horario') {
      setExpandido(null)
      return
    }
    const guardados = empleadoHorarios.get(empId) ?? []
    const base = horarioVacio()
    for (const h of guardados) {
      const idx = base.findIndex(d => d.dia_semana === h.dia_semana)
      if (idx >= 0) { base[idx] = { ...h, activo: true } }
    }
    setEditandoHorarios(base)
    setExpandido({ empId, tipo: 'horario' })
  }

  const handleGuardarHorarios = async (empId: string) => {
    setGuardandoHorarios(true)
    try {
      const activos = editandoHorarios.filter(h => h.activo)
      await planificacionService.guardarHorariosEmpleado(empId, activos.map(h => ({
        dia_semana: h.dia_semana,
        hora_inicio: h.hora_inicio,
        hora_fin: h.hora_fin
      })))
      const newMap = new Map(empleadoHorarios)
      newMap.set(empId, activos)
      setEmpleadoHorarios(newMap)
      setExpandido(null)
    } catch (err) {
      console.error('Error guardando horarios:', err)
    } finally {
      setGuardandoHorarios(false)
    }
  }

  const updateHorarioDia = (dia: number, field: 'activo' | 'hora_inicio' | 'hora_fin', value: string | boolean) => {
    setEditandoHorarios(prev => prev.map(h => h.dia_semana === dia ? { ...h, [field]: value } : h))
  }

  if (!visible) return null

  const filtrados = empleados.filter(e => {
    if (!mostrarInactivos && !e.activo) return false
    if (busqueda) {
      const q = busqueda.toLowerCase()
      return e.nombre_completo.toLowerCase().includes(q) || (e.documento || '').toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] backdrop-blur-sm" onClick={onCerrar}>
      <div
        className="bg-white w-[600px] max-w-[94vw] max-h-[88vh] shadow-2xl rounded-lg overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">Módulo de personal</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Gestión de empleados, conocimientos y horarios</p>
          </div>
          <button onClick={onCerrar} className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Search + actions */}
        <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-slate-100">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o documento..."
              className="w-full h-8 pl-8 pr-3 border border-slate-300 rounded-md text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none whitespace-nowrap">
            <input type="checkbox" checked={mostrarInactivos} onChange={e => setMostrarInactivos(e.target.checked)} className="rounded border-slate-300" />
            Inactivos
          </label>
          <button
            onClick={handleNuevo}
            className="h-8 px-3 text-[11px] font-bold rounded-md bg-slate-800 text-white hover:bg-slate-900 flex items-center gap-1.5 transition-colors shadow-sm whitespace-nowrap"
          >
            <Plus size={12} /> Nuevo
          </button>
        </div>

        {/* Form nuevo/editar */}
        {formVisible && (
          <div className="px-5 py-4 border-b border-slate-200 bg-blue-50/50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                {editandoId ? 'Editar empleado' : 'Nuevo empleado'}
              </span>
              <button onClick={() => { setFormVisible(false); limpiarForm() }} className="text-[11px] text-slate-500 hover:text-slate-700">Cancelar</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Nombre completo *</label>
                <input ref={nombreRef} type="text" value={form.nombre_completo}
                  onChange={e => setForm(f => ({ ...f, nombre_completo: e.target.value }))}
                  placeholder="Ej: García, Juan Pablo"
                  className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  onKeyDown={e => { if (e.key === 'Enter') handleGuardar() }} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Documento</label>
                <input type="text" value={form.documento} onChange={e => setForm(f => ({ ...f, documento: e.target.value }))}
                  placeholder="DNI"
                  className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  onKeyDown={e => { if (e.key === 'Enter') handleGuardar() }} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Teléfono</label>
                <input type="text" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                  placeholder="Teléfono"
                  className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  onKeyDown={e => { if (e.key === 'Enter') handleGuardar() }} />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Email</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@ejemplo.com"
                  className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  onKeyDown={e => { if (e.key === 'Enter') handleGuardar() }} />
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <button onClick={handleGuardar} disabled={!form.nombre_completo.trim() || guardando}
                className="h-8 px-4 text-[11px] font-bold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5 transition-colors shadow-sm">
                <Check size={12} /> {editandoId ? 'Actualizar' : 'Crear empleado'}
              </button>
            </div>
          </div>
        )}

        {/* Lista de empleados */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtrados.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-slate-400">
                {busqueda ? 'Sin resultados para esa búsqueda.' : 'No hay empleados registrados.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtrados.map(emp => {
                const habIds = empleadoHabilidades.get(emp.id) ?? new Set<string>()
                const habsDelEmp = habilidades.filter(h => habIds.has(h.id))
                const horariosEmp = empleadoHorarios.get(emp.id) ?? []
                const diasConHorario = horariosEmp.length
                const expandidoHab = expandido?.empId === emp.id && expandido.tipo === 'habilidades'
                const expandidoHor = expandido?.empId === emp.id && expandido.tipo === 'horario'

                return (
                  <div key={emp.id} className={`rounded-md border transition-colors ${emp.activo ? 'border-slate-150 bg-white' : 'border-slate-100 bg-slate-50/50 opacity-60'}`}>
                    {/* Fila principal */}
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${emp.activo ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 truncate">{emp.nombre_completo}</p>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          <p className="text-[10px] text-slate-400">
                            {[emp.documento, emp.telefono].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
                          </p>
                          {/* Habilidades badge */}
                          {habsDelEmp.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              {habsDelEmp.map(h => (
                                <span key={h.id} className="text-[9px] font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">
                                  {h.nombre}
                                </span>
                              ))}
                            </div>
                          )}
                          {/* Horario badge */}
                          {diasConHorario > 0 && (
                            <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 flex items-center gap-1">
                              <Clock size={8} /> {diasConHorario}d
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {/* Horario */}
                        <button
                          onClick={() => abrirHorario(emp.id)}
                          title="Horario de trabajo"
                          className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${
                            expandidoHor
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'hover:bg-emerald-50 text-slate-400 hover:text-emerald-600'
                          }`}
                        >
                          <Clock size={13} />
                        </button>
                        {/* Conocimientos */}
                        {habilidades.length > 0 && (
                          <button
                            onClick={() => abrirHabilidades(emp.id)}
                            title="Conocimientos del empleado"
                            className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${
                              expandidoHab
                                ? 'bg-violet-100 text-violet-700'
                                : 'hover:bg-violet-50 text-slate-400 hover:text-violet-600'
                            }`}
                          >
                            <Brain size={13} />
                          </button>
                        )}
                        <button onClick={() => handleEditar(emp)}
                          className="h-7 w-7 flex items-center justify-center rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors" title="Editar">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => handleToggleActivo(emp)}
                          className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${emp.activo ? 'hover:bg-red-50 text-slate-400 hover:text-red-500' : 'hover:bg-green-50 text-slate-400 hover:text-green-600'}`}
                          title={emp.activo ? 'Desactivar' : 'Activar'}>
                          {emp.activo ? <UserX size={13} /> : <UserCheck size={13} />}
                        </button>
                      </div>
                    </div>

                    {/* Panel de horarios */}
                    {expandidoHor && (
                      <div className="border-t border-emerald-100 bg-emerald-50/40 px-4 py-3">
                        <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-3 flex items-center gap-1">
                          <Clock size={11} /> Horario de {emp.nombre_completo.split(' ')[0]}
                        </p>
                        <div className="space-y-1.5">
                          {editandoHorarios.map(dia => (
                            <div key={dia.dia_semana} className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${dia.activo ? 'bg-white border border-emerald-200' : 'bg-transparent'}`}>
                              <input
                                type="checkbox"
                                checked={dia.activo}
                                onChange={e => updateHorarioDia(dia.dia_semana, 'activo', e.target.checked)}
                                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              />
                              <span className={`text-[12px] font-semibold w-[72px] flex-shrink-0 ${dia.activo ? 'text-slate-800' : 'text-slate-400'}`}>
                                {DIAS_SEMANA[dia.dia_semana]}
                              </span>
                              {dia.activo ? (
                                <div className="flex items-center gap-1.5 flex-1">
                                  <input
                                    type="time"
                                    value={dia.hora_inicio}
                                    onChange={e => updateHorarioDia(dia.dia_semana, 'hora_inicio', e.target.value)}
                                    className="h-7 w-[88px] px-1.5 border border-slate-300 rounded text-[12px] font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white"
                                  />
                                  <span className="text-slate-400 text-[10px]">→</span>
                                  <input
                                    type="time"
                                    value={dia.hora_fin}
                                    onChange={e => updateHorarioDia(dia.dia_semana, 'hora_fin', e.target.value)}
                                    className="h-7 w-[88px] px-1.5 border border-slate-300 rounded text-[12px] font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white"
                                  />
                                  <span className="text-[10px] text-slate-400 ml-1">
                                    {(() => {
                                      const [h1, m1] = dia.hora_inicio.split(':').map(Number)
                                      const [h2, m2] = dia.hora_fin.split(':').map(Number)
                                      const diff = (h2 * 60 + m2) - (h1 * 60 + m1)
                                      if (diff <= 0) return ''
                                      return diff >= 60 ? `${Math.floor(diff / 60)}h${diff % 60 > 0 ? diff % 60 + 'm' : ''}` : `${diff}m`
                                    })()}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[11px] text-slate-300 italic">No trabaja</span>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between mt-3">
                          <p className="text-[10px] text-slate-400">
                            {editandoHorarios.filter(d => d.activo).length === 0 ? 'Sin días configurados' : `${editandoHorarios.filter(d => d.activo).length} día${editandoHorarios.filter(d => d.activo).length !== 1 ? 's' : ''} activo${editandoHorarios.filter(d => d.activo).length !== 1 ? 's' : ''}`}
                          </p>
                          <div className="flex gap-2">
                            <button onClick={() => setExpandido(null)} className="h-7 px-2.5 text-[11px] font-semibold rounded border border-slate-300 text-slate-600 hover:bg-slate-50">
                              Cancelar
                            </button>
                            <button
                              onClick={() => handleGuardarHorarios(emp.id)}
                              disabled={guardandoHorarios}
                              className="h-7 px-3 text-[11px] font-bold rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1"
                            >
                              <Check size={11} /> {guardandoHorarios ? 'Guardando...' : 'Guardar'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Panel de conocimientos */}
                    {expandidoHab && (
                      <div className="border-t border-violet-100 bg-violet-50/50 px-4 py-3">
                        <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <Brain size={11} /> Conocimientos de {emp.nombre_completo.split(' ')[0]}
                        </p>
                        {habilidades.length === 0 ? (
                          <p className="text-[11px] text-slate-400">No hay habilidades configuradas en el sistema. Creá algunas en Configuración → Habilidades.</p>
                        ) : (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {habilidades.map(h => {
                              const activa = editandoHabilidades.has(h.id)
                              return (
                                <button
                                  key={h.id}
                                  onClick={() => toggleHabilidad(h.id)}
                                  className={`flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11px] font-semibold transition-colors ${
                                    activa
                                      ? 'bg-violet-600 border-violet-600 text-white'
                                      : 'bg-white border-slate-300 text-slate-600 hover:border-violet-300 hover:text-violet-700'
                                  }`}
                                >
                                  {activa && <Check size={10} />}
                                  {h.nombre}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-slate-400">
                            {editandoHabilidades.size === 0 ? 'Sin conocimientos asignados' : `${editandoHabilidades.size} conocimiento${editandoHabilidades.size !== 1 ? 's' : ''} seleccionado${editandoHabilidades.size !== 1 ? 's' : ''}`}
                          </p>
                          <div className="flex gap-2">
                            <button onClick={() => setExpandido(null)} className="h-7 px-2.5 text-[11px] font-semibold rounded border border-slate-300 text-slate-600 hover:bg-slate-50">
                              Cancelar
                            </button>
                            <button
                              onClick={() => handleGuardarHabilidades(emp.id)}
                              disabled={guardandoHabilidades}
                              className="h-7 px-3 text-[11px] font-bold rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 flex items-center gap-1"
                            >
                              <Check size={11} /> {guardandoHabilidades ? 'Guardando...' : 'Guardar'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">{filtrados.length} empleado{filtrados.length !== 1 ? 's' : ''}</span>
          <button onClick={onCerrar} className="h-8 px-3 text-sm font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-100 transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
