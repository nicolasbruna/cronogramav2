import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit2, Check, X, Package, Layers, ChevronDown, ChevronRight } from 'lucide-react'
import { Maquina, CrearMaquinaRequest, GrupoRecurso, CrearGrupoRecursoRequest } from '../../types/planificacion'
import { planificacionService } from '../../services/planificacionService'

export function MaquinasTab() {
  const [maquinas, setMaquinas] = useState<Maquina[]>([])
  const [grupos, setGrupos] = useState<GrupoRecurso[]>([])
  const [loading, setLoading] = useState(true)

  // Máquinas form state
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [form, setForm] = useState<CrearMaquinaRequest>({ nombre: '', cantidad: 1, descripcion: '', grupo_id: null, prioridad_grupo: 1 })
  const [saving, setSaving] = useState(false)

  // Grupos form state
  const [editandoGrupoId, setEditandoGrupoId] = useState<string | null>(null)
  const [creandoGrupo, setCreandoGrupo] = useState(false)
  const [formGrupo, setFormGrupo] = useState<CrearGrupoRecursoRequest>({ nombre: '', descripcion: '' })
  const [savingGrupo, setSavingGrupo] = useState(false)
  const [gruposExpandido, setGruposExpandido] = useState(true)

  const cargar = async () => {
    try {
      setLoading(true)
      const [m, g] = await Promise.all([
        planificacionService.listarMaquinas(),
        planificacionService.listarGruposRecursos()
      ])
      setMaquinas(m)
      setGrupos(g)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  // ---- Grupos CRUD ----
  const iniciarCrearGrupo = () => {
    setFormGrupo({ nombre: '', descripcion: '' })
    setCreandoGrupo(true)
    setEditandoGrupoId(null)
  }

  const iniciarEditarGrupo = (g: GrupoRecurso) => {
    setFormGrupo({ nombre: g.nombre, descripcion: g.descripcion || '' })
    setEditandoGrupoId(g.id)
    setCreandoGrupo(false)
  }

  const guardarGrupo = async () => {
    if (!formGrupo.nombre.trim()) return
    setSavingGrupo(true)
    try {
      if (creandoGrupo) {
        await planificacionService.crearGrupoRecurso({ ...formGrupo, descripcion: formGrupo.descripcion || null })
      } else if (editandoGrupoId) {
        await planificacionService.actualizarGrupoRecurso(editandoGrupoId, { ...formGrupo, descripcion: formGrupo.descripcion || null })
      }
      await cargar()
      setCreandoGrupo(false)
      setEditandoGrupoId(null)
    } finally {
      setSavingGrupo(false)
    }
  }

  const eliminarGrupo = async (id: string, nombre: string) => {
    const ms = maquinas.filter(m => m.grupo_id === id)
    const extra = ms.length > 0 ? ` Las ${ms.length} máquina(s) del grupo quedarán sin grupo.` : ''
    if (!confirm(`¿Eliminar el grupo "${nombre}"?${extra}`)) return
    await planificacionService.eliminarGrupoRecurso(id)
    await cargar()
  }

  // ---- Máquinas CRUD ----
  const iniciarCrear = () => {
    setForm({ nombre: '', cantidad: 1, descripcion: '', grupo_id: null, prioridad_grupo: 1 })
    setCreando(true)
    setEditandoId(null)
  }

  const iniciarEditar = (m: Maquina) => {
    setForm({
      nombre: m.nombre,
      cantidad: m.cantidad,
      descripcion: m.descripcion || '',
      grupo_id: m.grupo_id ?? null,
      prioridad_grupo: m.prioridad_grupo ?? 1
    })
    setEditandoId(m.id)
    setCreando(false)
  }

  const cancelar = () => {
    setCreando(false)
    setEditandoId(null)
  }

  const guardar = async () => {
    if (!form.nombre.trim()) return
    setSaving(true)
    try {
      if (creando) {
        await planificacionService.crearMaquina({ ...form, descripcion: form.descripcion || null })
      } else if (editandoId) {
        await planificacionService.actualizarMaquina(editandoId, { ...form, descripcion: form.descripcion || null })
      }
      await cargar()
      cancelar()
    } finally {
      setSaving(false)
    }
  }

  const eliminar = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar la máquina "${nombre}"? Las etapas que la usan quedarán sin máquina.`)) return
    await planificacionService.eliminarMaquina(id)
    await cargar()
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Cargando...</div>
  }

  // Group machines by grupo_id, sorted by prioridad_grupo within each group
  const maquinasPorGrupo = new Map<string | null, Maquina[]>()
  maquinasPorGrupo.set(null, [])
  for (const g of grupos) maquinasPorGrupo.set(g.id, [])
  for (const m of maquinas) {
    const key = m.grupo_id ?? null
    if (!maquinasPorGrupo.has(key)) maquinasPorGrupo.set(key, [])
    maquinasPorGrupo.get(key)!.push(m)
  }
  for (const [, ms] of maquinasPorGrupo) {
    ms.sort((a, b) => (a.prioridad_grupo ?? 1) - (b.prioridad_grupo ?? 1))
  }

  const sinGrupo = maquinasPorGrupo.get(null) ?? []

  return (
    <div className="max-w-2xl space-y-6">

      {/* ===== GRUPOS DE RECURSOS ===== */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => setGruposExpandido(v => !v)}
            className="flex items-center gap-1.5 min-w-0"
          >
            {gruposExpandido
              ? <ChevronDown size={13} className="text-slate-400 flex-shrink-0" />
              : <ChevronRight size={13} className="text-slate-400 flex-shrink-0" />}
            <div className="text-left min-w-0">
              <span className="text-[13px] font-bold text-slate-900">Grupos de recursos</span>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                Agrupá máquinas intercambiables. El planificador probará los miembros en orden de prioridad.
              </p>
            </div>
          </button>
          <button
            onClick={iniciarCrearGrupo}
            className="ml-3 h-7 px-2.5 text-[11px] font-semibold rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 flex items-center gap-1 transition-colors flex-shrink-0"
          >
            <Plus size={11} /> Nuevo grupo
          </button>
        </div>

        {gruposExpandido && (
          <div className="space-y-1.5">
            {creandoGrupo && (
              <FormGrupo
                form={formGrupo}
                onChange={setFormGrupo}
                onGuardar={guardarGrupo}
                onCancelar={() => setCreandoGrupo(false)}
                saving={savingGrupo}
                titulo="Nuevo grupo"
              />
            )}
            {grupos.length === 0 && !creandoGrupo && (
              <div className="text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-lg px-4 py-3 text-center">
                Sin grupos configurados. Las máquinas sin grupo no se sustituyen automáticamente al planificar.
              </div>
            )}
            {grupos.map(g => (
              <div key={g.id}>
                {editandoGrupoId === g.id ? (
                  <FormGrupo
                    form={formGrupo}
                    onChange={setFormGrupo}
                    onGuardar={guardarGrupo}
                    onCancelar={() => setEditandoGrupoId(null)}
                    saving={savingGrupo}
                    titulo={`Editando: ${g.nombre}`}
                  />
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50/60 border border-indigo-100 rounded-lg group hover:border-indigo-200 transition-colors">
                    <Layers size={12} className="text-indigo-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[12px] font-bold text-indigo-900">{g.nombre}</span>
                      {g.descripcion && (
                        <span className="text-[10px] text-indigo-400 ml-2">{g.descripcion}</span>
                      )}
                      <span className="text-[10px] text-indigo-300 ml-2">
                        · {(maquinasPorGrupo.get(g.id) ?? []).length} máquina{(maquinasPorGrupo.get(g.id) ?? []).length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => iniciarEditarGrupo(g)}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-indigo-100 text-indigo-400 hover:text-indigo-700"
                      >
                        <Edit2 size={11} />
                      </button>
                      <button
                        onClick={() => eliminarGrupo(g.id, g.nombre)}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 text-indigo-400 hover:text-red-500"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== MÁQUINAS ===== */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-[13px] font-bold text-slate-900">Máquinas y recursos</h2>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Cada unidad física es un registro separado (ej: Torno 1, Torno 2).
            </p>
          </div>
          <button
            onClick={iniciarCrear}
            className="h-8 px-3 text-[12px] font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <Plus size={13} /> Nueva máquina
          </button>
        </div>

        {creando && (
          <FormMaquina
            form={form}
            onChange={setForm}
            onGuardar={guardar}
            onCancelar={cancelar}
            saving={saving}
            titulo="Nueva máquina"
            grupos={grupos}
          />
        )}

        {maquinas.length === 0 && !creando ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 border border-dashed border-slate-200 rounded-lg">
            <Package size={28} className="mb-2 opacity-40" />
            <p className="text-[12px] font-medium">No hay máquinas cargadas</p>
            <p className="text-[11px] mt-0.5">Agregá las máquinas que usás en producción</p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Machines per group */}
            {grupos.map(g => {
              const ms = maquinasPorGrupo.get(g.id) ?? []
              return (
                <div key={g.id}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Layers size={11} className="text-indigo-400" />
                    <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">{g.nombre}</span>
                  </div>
                  <div className="space-y-1.5 pl-3 border-l-2 border-indigo-100">
                    {ms.map(m => (
                      <MaquinaRow
                        key={m.id}
                        m={m}
                        editandoId={editandoId}
                        form={form}
                        onChange={setForm}
                        onGuardar={guardar}
                        onCancelar={cancelar}
                        saving={saving}
                        onEditar={iniciarEditar}
                        onEliminar={eliminar}
                        grupos={grupos}
                      />
                    ))}
                    {ms.length === 0 && (
                      <p className="text-[11px] text-slate-400 italic pl-1 py-1">Sin máquinas en este grupo</p>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Machines without group */}
            {sinGrupo.length > 0 && (
              <div>
                {grupos.length > 0 && (
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sin grupo</span>
                  </div>
                )}
                <div className={grupos.length > 0 ? 'space-y-1.5 pl-3 border-l-2 border-slate-100' : 'space-y-1.5'}>
                  {sinGrupo.map(m => (
                    <MaquinaRow
                      key={m.id}
                      m={m}
                      editandoId={editandoId}
                      form={form}
                      onChange={setForm}
                      onGuardar={guardar}
                      onCancelar={cancelar}
                      saving={saving}
                      onEditar={iniciarEditar}
                      onEliminar={eliminar}
                      grupos={grupos}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- MaquinaRow ----

function MaquinaRow({
  m, editandoId, form, onChange, onGuardar, onCancelar, saving, onEditar, onEliminar, grupos
}: {
  m: Maquina
  editandoId: string | null
  form: CrearMaquinaRequest
  onChange: (f: CrearMaquinaRequest) => void
  onGuardar: () => void
  onCancelar: () => void
  saving: boolean
  onEditar: (m: Maquina) => void
  onEliminar: (id: string, nombre: string) => void
  grupos: GrupoRecurso[]
}) {
  if (editandoId === m.id) {
    return (
      <FormMaquina
        form={form}
        onChange={onChange}
        onGuardar={onGuardar}
        onCancelar={onCancelar}
        saving={saving}
        titulo={`Editando: ${m.nombre}`}
        grupos={grupos}
      />
    )
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-white border border-slate-200 rounded-lg group hover:border-slate-300 transition-colors">
      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
        <Package size={14} className="text-slate-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-bold text-slate-900">{m.nombre}</span>
          {!m.activa && (
            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
              inactiva
            </span>
          )}
          {m.grupo_id && (
            <span className="text-[10px] font-semibold text-indigo-500 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5">
              #{m.prioridad_grupo ?? 1}
            </span>
          )}
        </div>
        {m.descripcion && (
          <p className="text-[11px] text-slate-500 mt-0.5 truncate">{m.descripcion}</p>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEditar(m)}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
        >
          <Edit2 size={13} />
        </button>
        <button
          onClick={() => onEliminar(m.id, m.nombre)}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-50 text-slate-400 hover:text-red-600"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

// ---- FormMaquina ----

function FormMaquina({
  form, onChange, onGuardar, onCancelar, saving, titulo, grupos
}: {
  form: CrearMaquinaRequest
  onChange: (f: CrearMaquinaRequest) => void
  onGuardar: () => void
  onCancelar: () => void
  saving: boolean
  titulo: string
  grupos: GrupoRecurso[]
}) {
  return (
    <div className="border border-blue-200 bg-blue-50/30 rounded-lg p-4 mb-2">
      <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wider mb-3">{titulo}</p>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">
            Nombre *
          </label>
          <input
            autoFocus
            type="text"
            value={form.nombre}
            onChange={e => onChange({ ...form, nombre: e.target.value })}
            placeholder="Ej: Horno 1, Amasadora grande..."
            className="w-full h-9 px-3 text-[13px] border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            onKeyDown={e => { if (e.key === 'Enter') onGuardar() }}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">
            Cantidad
          </label>
          <input
            type="number"
            min={1}
            value={form.cantidad}
            onChange={e => onChange({ ...form, cantidad: parseInt(e.target.value) || 1 })}
            className="w-full h-9 px-3 text-[13px] border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">
          Descripción (opcional)
        </label>
        <input
          type="text"
          value={form.descripcion || ''}
          onChange={e => onChange({ ...form, descripcion: e.target.value })}
          placeholder="Ej: 80 litros, capacidad 20kg..."
          className="w-full h-9 px-3 text-[13px] border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
        />
      </div>

      {grupos.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Grupo (opcional)
            </label>
            <select
              value={form.grupo_id ?? ''}
              onChange={e => onChange({ ...form, grupo_id: e.target.value || null })}
              className="w-full h-9 px-2.5 text-[13px] border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            >
              <option value="">Sin grupo</option>
              {grupos.map(g => (
                <option key={g.id} value={g.id}>{g.nombre}</option>
              ))}
            </select>
          </div>
          {form.grupo_id && (
            <div>
              <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                Prioridad en grupo
              </label>
              <input
                type="number"
                min={1}
                value={form.prioridad_grupo ?? 1}
                onChange={e => onChange({ ...form, prioridad_grupo: parseInt(e.target.value) || 1 })}
                className="w-full h-9 px-3 text-[13px] border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />
              <p className="text-[10px] text-slate-400 mt-0.5">1 = primera opción al planificar</p>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancelar}
          className="h-8 px-3 text-[12px] font-semibold rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
        >
          <X size={12} className="inline mr-1" />Cancelar
        </button>
        <button
          onClick={onGuardar}
          disabled={saving || !form.nombre.trim()}
          className="h-8 px-3 text-[12px] font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40 flex items-center gap-1"
        >
          <Check size={12} />{saving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}

// ---- FormGrupo ----

function FormGrupo({
  form, onChange, onGuardar, onCancelar, saving, titulo
}: {
  form: CrearGrupoRecursoRequest
  onChange: (f: CrearGrupoRecursoRequest) => void
  onGuardar: () => void
  onCancelar: () => void
  saving: boolean
  titulo: string
}) {
  return (
    <div className="border border-indigo-200 bg-indigo-50/30 rounded-lg p-3 mb-1">
      <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider mb-2">{titulo}</p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">
            Nombre *
          </label>
          <input
            autoFocus
            type="text"
            value={form.nombre}
            onChange={e => onChange({ ...form, nombre: e.target.value })}
            placeholder="Ej: Hornos, Amasadoras..."
            className="w-full h-8 px-2.5 text-[12px] border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            onKeyDown={e => { if (e.key === 'Enter') onGuardar() }}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">
            Descripción (opcional)
          </label>
          <input
            type="text"
            value={form.descripcion || ''}
            onChange={e => onChange({ ...form, descripcion: e.target.value })}
            placeholder="Notas..."
            className="w-full h-8 px-2.5 text-[12px] border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancelar}
          className="h-7 px-2.5 text-[11px] font-semibold rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
        >
          <X size={11} className="inline mr-1" />Cancelar
        </button>
        <button
          onClick={onGuardar}
          disabled={saving || !form.nombre.trim()}
          className="h-7 px-2.5 text-[11px] font-semibold rounded-md bg-indigo-700 text-white hover:bg-indigo-800 disabled:opacity-40 flex items-center gap-1"
        >
          <Check size={11} />{saving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}
