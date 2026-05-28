// Panel lateral derecho del Editor Manual: detalle de la instancia seleccionada
// + 4 botones primarios para las acciones más comunes.
// Las acciones secundarias viven en el menú contextual (click derecho en bloque).

import { useState, ReactNode } from 'react'
import { InstanciaEtapa, SchedulerOverrides } from '../../types/scheduler'
import { PlantillaProceso } from '../../types/planificacion'
import { minToTime, formatDuration } from '../Cronograma/cronogramaHelpers'
import { Users, Clock, Layers, ArrowRight, X } from 'lucide-react'

interface Props {
  inst: InstanciaEtapa | null
  empleados: { id: string; nombre: string }[]
  plantillasDelDia: PlantillaProceso[]   // para el select de "Forzar antes de…"
  overrides: SchedulerOverrides
  onFijarEmpleado: (inst: InstanciaEtapa, empleadoId: string) => void
  onFijarHora: (inst: InstanciaEtapa, hhmm: string) => void
  onFijarEmpleadoCompleto: (plantillaId: string, empleadoId: string) => void
  onForzarAntes: (antesPlantillaId: string, despuesPlantillaId: string) => void
  onQuitarOverridesDeInstancia?: (inst: InstanciaEtapa) => void
}

type AccionActiva = 'empleado' | 'hora' | 'empleado-completo' | 'forzar-antes' | null

export function PanelDetalle({
  inst, empleados, plantillasDelDia, overrides,
  onFijarEmpleado, onFijarHora, onFijarEmpleadoCompleto, onForzarAntes,
  onQuitarOverridesDeInstancia
}: Props) {
  const [accion, setAccion] = useState<AccionActiva>(null)
  const [tmp, setTmp] = useState('')

  if (!inst) {
    return (
      <aside className="w-[260px] flex-shrink-0 border-l border-slate-200 bg-slate-50 p-4 text-[12px] text-slate-400 italic">
        Hacé click en un bloque para ver detalle.
      </aside>
    )
  }

  const principal = inst.asignaciones.find(a => a.rol === 'principal') ?? inst.asignaciones[0]
  const colocada = inst.estado === 'colocada'

  // Overrides activos sobre esta instancia.
  const pinEmp = overrides.asignacionFijada?.find(p => p.plantillaId === inst.plantillaId && p.lote === inst.lote && p.etapaOrden === inst.etapa.orden)
  const pinHora = overrides.inicioFijado?.find(p => p.plantillaId === inst.plantillaId && p.lote === inst.lote && p.etapaOrden === inst.etapa.orden)

  const resetAccion = () => { setAccion(null); setTmp('') }

  return (
    <aside className="w-[260px] flex-shrink-0 border-l border-slate-200 bg-white overflow-y-auto flex flex-col">
      <div className="px-3 py-2 border-b border-slate-200">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Detalle</div>
        <div className="text-[13px] font-bold text-slate-800 mt-0.5">{inst.plantillaNombre}</div>
        <div className="text-[12px] text-slate-600">{inst.etapa.nombre} · lote {inst.lote}</div>
      </div>

      <div className="px-3 py-2 space-y-1 text-[11px] border-b border-slate-100">
        <div className="flex gap-1.5"><span className="text-slate-500 w-16">Estado:</span>
          {colocada
            ? <span className="text-emerald-600 font-semibold">✓ Colocada</span>
            : <span className="text-rose-600 font-semibold">⛔ Sin ubicar</span>}
        </div>
        <div className="flex gap-1.5"><span className="text-slate-500 w-16">Duración:</span><span>{formatDuration(inst.etapa.duracion_proceso)}</span></div>
        {colocada && inst.inicioAbs != null && inst.finAbs != null && (
          <>
            <div className="flex gap-1.5"><span className="text-slate-500 w-16">Inicio:</span><span>{minToTime(inst.inicioAbs).slice(0, 5)}</span></div>
            <div className="flex gap-1.5"><span className="text-slate-500 w-16">Fin:</span><span>{minToTime(inst.finAbs).slice(0, 5)}</span></div>
          </>
        )}
        {principal && <div className="flex gap-1.5"><span className="text-slate-500 w-16">Empleado:</span><span className="font-semibold">{empleados.find(e => e.id === principal.empleadoId)?.nombre ?? '—'}</span></div>}
        {inst.recursosAbs.length > 0 && <div className="flex gap-1.5"><span className="text-slate-500 w-16">Máquinas:</span><span>{inst.recursosAbs.map(r => r.maquinaNombre).join(', ')}</span></div>}
      </div>

      {!colocada && inst.conflicto?.mensaje && (
        <div className="px-3 py-2 bg-rose-50 border-b border-rose-200 text-[11px] text-rose-700 italic">
          {inst.conflicto.mensaje}
        </div>
      )}

      {/* Overrides activos sobre esta instancia */}
      {(pinEmp || pinHora) && (
        <div className="px-3 py-2 border-b border-slate-100">
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Overrides sobre esta etapa</div>
          <div className="space-y-1 text-[11px]">
            {pinEmp && (
              <div className="bg-blue-50 border border-blue-200 rounded px-2 py-1 flex items-center gap-1.5">
                <span className="flex-1">📌 Empleado fijado: <span className="font-semibold">{empleados.find(e => e.id === pinEmp.empleadoId)?.nombre ?? pinEmp.empleadoId}</span></span>
              </div>
            )}
            {pinHora && (
              <div className="bg-blue-50 border border-blue-200 rounded px-2 py-1 flex items-center gap-1.5">
                <span className="flex-1">📌 Hora fijada: <span className="font-semibold">{minToTime(pinHora.inicioMin).slice(0, 5)}</span></span>
              </div>
            )}
          </div>
          {onQuitarOverridesDeInstancia && (
            <button onClick={() => onQuitarOverridesDeInstancia(inst)}
                    className="mt-1.5 w-full h-6 text-[10px] font-semibold text-rose-700 border border-rose-300 bg-white rounded hover:bg-rose-50 flex items-center justify-center gap-1">
              <X size={10} /> Quitar overrides de esta etapa
            </button>
          )}
        </div>
      )}

      {/* Acciones primarias */}
      <div className="px-3 py-2 space-y-1.5 flex-1">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Acciones</div>

        <AccionBoton activo={accion === 'empleado'} onClick={() => { setAccion('empleado'); setTmp('') }} icon={<Users size={12} />}>
          Cambiar empleado
        </AccionBoton>
        {accion === 'empleado' && (
          <FormSelect tmp={tmp} setTmp={setTmp} placeholder="Elegí empleado…" options={empleados.map(e => ({ value: e.id, label: e.nombre }))}
                      onAplicar={() => { onFijarEmpleado(inst, tmp); resetAccion() }} />
        )}

        <AccionBoton activo={accion === 'hora'} onClick={() => { setAccion('hora'); setTmp(inst.inicioAbs != null ? minToTime(inst.inicioAbs).slice(0, 5) : '') }} icon={<Clock size={12} />}>
          Cambiar hora
        </AccionBoton>
        {accion === 'hora' && (
          <div className="flex items-center gap-1.5">
            <input type="time" value={tmp} onChange={e => setTmp(e.target.value)}
                   className="flex-1 h-7 px-1 text-center text-[11px] bg-white border border-slate-300 rounded" />
            <button onClick={() => { onFijarHora(inst, tmp); resetAccion() }} disabled={!tmp}
                    className="h-7 px-2 text-[11px] font-semibold text-white bg-violet-600 rounded hover:bg-violet-700 disabled:opacity-40">
              Aplicar
            </button>
          </div>
        )}

        <AccionBoton activo={accion === 'empleado-completo'} onClick={() => { setAccion('empleado-completo'); setTmp('') }} icon={<Layers size={12} />}>
          Fijar al proceso completo
        </AccionBoton>
        {accion === 'empleado-completo' && (
          <FormSelect tmp={tmp} setTmp={setTmp} placeholder="Empleado para todo el proceso…" options={empleados.map(e => ({ value: e.id, label: e.nombre }))}
                      onAplicar={() => { onFijarEmpleadoCompleto(inst.plantillaId, tmp); resetAccion() }} />
        )}

        <AccionBoton activo={accion === 'forzar-antes'} onClick={() => { setAccion('forzar-antes'); setTmp('') }} icon={<ArrowRight size={12} />}>
          Forzar antes de…
        </AccionBoton>
        {accion === 'forzar-antes' && (
          <FormSelect tmp={tmp} setTmp={setTmp} placeholder="Elegí proceso destino…"
                      options={plantillasDelDia.filter(p => p.id !== inst.plantillaId).map(p => ({ value: p.id, label: p.nombre }))}
                      onAplicar={() => { onForzarAntes(inst.plantillaId, tmp); resetAccion() }} />
        )}
      </div>

      <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400 italic">
        Tip: click derecho en un bloque del Gantt para más acciones (sustituir máquina, relajar, excluir).
      </div>
    </aside>
  )
}

function AccionBoton({ children, onClick, activo, icon }: { children: ReactNode; onClick: () => void; activo: boolean; icon?: ReactNode }) {
  return (
    <button onClick={onClick}
            className={`w-full h-7 px-2 text-[11px] font-semibold rounded border flex items-center gap-1.5 ${activo ? 'bg-violet-600 text-white border-violet-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
      {icon}
      <span className="flex-1 text-left">{children}</span>
    </button>
  )
}

function FormSelect({ tmp, setTmp, placeholder, options, onAplicar }: {
  tmp: string; setTmp: (v: string) => void; placeholder: string;
  options: { value: string; label: string }[]; onAplicar: () => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <select value={tmp} onChange={e => setTmp(e.target.value)}
              className="flex-1 h-7 px-1 text-[11px] bg-white border border-slate-300 rounded">
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button onClick={onAplicar} disabled={!tmp}
              className="h-7 px-2 text-[11px] font-semibold text-white bg-violet-600 rounded hover:bg-violet-700 disabled:opacity-40">
        Aplicar
      </button>
    </div>
  )
}
