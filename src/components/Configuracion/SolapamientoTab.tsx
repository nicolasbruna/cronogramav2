import { useState, useEffect } from 'react'
import { Save, Check, Layers } from 'lucide-react'
import { configuracionService, ConfiguracionSolape, SolapeModo } from '../../services/configuracionService'

const MODO_LABEL: Record<SolapeModo, string> = {
  solapada: 'La tarea solapada (la que cae sobre la paralela)',
  paralela: 'La tarea paralela',
  ambas: 'Ambas tareas'
}

export function SolapamientoTab() {
  const [cfg, setCfg] = useState<ConfiguracionSolape>({ penalizacionPct: 30, modoDefault: 'solapada' })
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)

  useEffect(() => {
    let cancel = false
    configuracionService.obtenerConfiguracionSolape()
      .then(c => { if (!cancel) setCfg(c) })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [])

  const guardar = async () => {
    setGuardando(true)
    setGuardado(false)
    try {
      const pct = Math.max(0, Math.min(500, Math.round(cfg.penalizacionPct || 0)))
      await configuracionService.guardarConfiguracionSolape({ ...cfg, penalizacionPct: pct })
      setCfg(c => ({ ...c, penalizacionPct: pct }))
      setGuardado(true)
      setTimeout(() => setGuardado(false), 2500)
    } catch (err) {
      alert(`Error al guardar: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGuardando(false)
    }
  }

  if (loading) {
    return <div className="text-[12px] text-slate-400 p-4">Cargando configuración…</div>
  }

  return (
    <div className="h-full flex flex-col">
      <div className="mb-3">
        <h2 className="text-[14px] font-bold text-slate-900">Solapamiento de tareas</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Cuando una tarea coincide en el tiempo con una tarea en paralelo del mismo empleado, su
          duración se alarga porque la atención se reparte. Acá definís el valor por defecto.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-5 max-w-[560px] space-y-5">
        {/* Porcentaje */}
        <div>
          <label className="block text-[12px] font-semibold text-slate-800 mb-1.5">
            Penalización de tiempo
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={500}
              value={cfg.penalizacionPct}
              onChange={e => setCfg(c => ({ ...c, penalizacionPct: Number(e.target.value) }))}
              className="w-24 h-9 px-3 rounded-md border border-slate-300 text-[13px] font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <span className="text-[13px] font-bold text-slate-600">%</span>
          </div>
          <p className="text-[10.5px] text-slate-400 mt-1.5 leading-snug">
            Se aplica de forma proporcional a los minutos solapados.
            Ej: con 30%, una tarea que coincide 10 min con una paralela suma +3 min.
          </p>
        </div>

        {/* Modo: cuál se alarga */}
        <div>
          <label className="block text-[12px] font-semibold text-slate-800 mb-1.5">
            ¿Qué tarea se alarga?
          </label>
          <div className="space-y-1.5">
            {(['solapada', 'paralela', 'ambas'] as SolapeModo[]).map(modo => (
              <label
                key={modo}
                className={`flex items-center gap-2 px-3 h-9 rounded-md border cursor-pointer transition-colors text-[12px] ${
                  cfg.modoDefault === modo
                    ? 'border-violet-400 bg-violet-50 text-violet-900 font-semibold'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="solape-modo"
                  checked={cfg.modoDefault === modo}
                  onChange={() => setCfg(c => ({ ...c, modoDefault: modo }))}
                  className="accent-violet-600"
                />
                {MODO_LABEL[modo]}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={guardar}
            disabled={guardando}
            className="h-9 px-4 rounded-md bg-violet-600 text-white text-[12px] font-bold flex items-center gap-1.5 hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {guardado ? <Check size={14} /> : <Save size={14} />}
            {guardado ? 'Guardado' : guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
          <span className="text-[10.5px] text-slate-400 flex items-center gap-1">
            <Layers size={11} /> Este valor es el default; cada tarea puede sobrescribirlo en su modal.
          </span>
        </div>
      </div>
    </div>
  )
}
