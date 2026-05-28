// Panel lateral izquierdo del Editor Manual: lista de etapas en conflicto (sin ubicar).
// Cada chip es draggable al Gantt — el padre maneja el drop con onDropExterno del Gantt.

import { InstanciaEtapa } from '../../types/scheduler'
import { AlertTriangle } from 'lucide-react'

interface Props {
  conflictosRaiz: InstanciaEtapa[]
  instanciaSeleccionada?: string | null
  onSeleccionar: (instKey: string) => void
  onContextMenu: (instKey: string, x: number, y: number) => void
}

const claveInst = (i: InstanciaEtapa) => `${i.plantillaId}:${i.lote}:${i.etapa.orden}`

export function PanelSinUbicar({ conflictosRaiz, instanciaSeleccionada, onSeleccionar, onContextMenu }: Props) {
  return (
    <aside className="w-[180px] flex-shrink-0 border-r border-slate-200 bg-rose-50/30 overflow-y-auto flex flex-col">
      <div className="px-2 py-2 border-b border-rose-200 bg-rose-50">
        <div className="text-[10px] uppercase tracking-wider font-bold text-rose-700 flex items-center gap-1">
          <AlertTriangle size={11} /> Sin ubicar
          <span className="ml-auto text-rose-800">({conflictosRaiz.length})</span>
        </div>
      </div>
      {conflictosRaiz.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic px-2 py-3 text-center">
          — todo ubicado —
        </div>
      ) : (
        <div className="p-2 space-y-1.5">
          {conflictosRaiz.map(inst => {
            const key = claveInst(inst)
            const sel = instanciaSeleccionada === key
            return (
              <div key={key}
                   draggable
                   onDragStart={e => { e.dataTransfer.setData('text/plain', key); e.dataTransfer.effectAllowed = 'move' }}
                   onClick={() => onSeleccionar(key)}
                   onContextMenu={e => { e.preventDefault(); onContextMenu(key, e.clientX, e.clientY) }}
                   title={inst.conflicto?.mensaje ?? 'Sin ubicar'}
                   className={`bg-white border rounded px-2 py-1.5 text-[10px] cursor-grab active:cursor-grabbing hover:bg-rose-50 ${sel ? 'border-blue-500 ring-1 ring-blue-300' : 'border-rose-300'}`}>
                <div className="font-semibold text-slate-800 truncate">{inst.plantillaNombre}</div>
                <div className="text-slate-600 truncate">{inst.etapa.nombre} · lote {inst.lote}</div>
              </div>
            )
          })}
        </div>
      )}
    </aside>
  )
}
