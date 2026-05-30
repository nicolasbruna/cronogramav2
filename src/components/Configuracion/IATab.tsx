import { useState, useEffect } from 'react'
import { Save, Check, Sparkles } from 'lucide-react'
import { configuracionService } from '../../services/configuracionService'

export function IATab() {
  const [habilitada, setHabilitada] = useState(false)
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)

  useEffect(() => {
    let cancel = false
    configuracionService.obtenerIAHabilitada()
      .then(v => { if (!cancel) setHabilitada(v) })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [])

  const guardar = async () => {
    setGuardando(true)
    setGuardado(false)
    try {
      await configuracionService.guardarIAHabilitada(habilitada)
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
        <h2 className="text-[14px] font-bold text-slate-900">Asistente de IA</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">
          El planificador automático sigue funcionando igual. La IA es una capa opcional que
          <span className="font-semibold"> repasa el plan generado</span> y propone (o aplica) mejoras.
          Necesita internet; si no hay conexión, la app funciona como siempre.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-5 max-w-[560px] space-y-5">
        <label
          className={`flex items-start gap-3 px-3 py-3 rounded-md border cursor-pointer transition-colors ${
            habilitada ? 'border-violet-400 bg-violet-50' : 'border-slate-200 hover:bg-slate-50'
          }`}
        >
          <input
            type="checkbox"
            checked={habilitada}
            onChange={e => setHabilitada(e.target.checked)}
            className="mt-0.5 accent-violet-600 w-4 h-4"
          />
          <div>
            <div className="text-[13px] font-semibold text-slate-900 flex items-center gap-1.5">
              <Sparkles size={13} className="text-violet-600" /> Activar el repaso con IA
            </div>
            <p className="text-[10.5px] text-slate-500 mt-1 leading-snug">
              Al generar un cronograma, la IA lo repasa automáticamente. Aplica sola las mejoras
              claramente mejores (siempre se puede revertir regenerando) y te consulta las que tienen
              alternativas o contrapartidas.
            </p>
          </div>
        </label>

        <div className="text-[10.5px] text-slate-400 leading-snug border-t border-slate-100 pt-3">
          <span className="font-semibold text-slate-500">Importante:</span> para que funcione hay que
          haber desplegado la Edge Function <code className="bg-slate-100 px-1 rounded">ia-asistente</code> y
          configurado la clave <code className="bg-slate-100 px-1 rounded">ANTHROPIC_API_KEY</code> en
          Supabase. Si falta alguna de esas cosas, el repaso simplemente no aparece.
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
        </div>
      </div>
    </div>
  )
}
