// Menú contextual posicionado donde el usuario hizo click derecho (o ⋮).
// Componente desacoplado: el padre arma los items y la posición; el menú se ocupa
// del render + cierre (click fuera, Escape).

import { useEffect, ReactNode } from 'react'

export interface MenuContextualItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
}

interface Props {
  posicion: { x: number; y: number }
  items: MenuContextualItem[]
  onClose: () => void
}

export function MenuContextual({ posicion, items, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Clamp para que no se vaya fuera de la ventana (estimación: 220 px de ancho).
  const x = Math.min(posicion.x, window.innerWidth - 230)
  const y = Math.min(posicion.y, window.innerHeight - items.length * 32 - 12)

  return (
    <>
      {/* Overlay invisible para capturar click fuera */}
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />

      <div className="fixed z-50 bg-white border border-slate-300 rounded-md shadow-lg py-1 min-w-[200px]"
           style={{ left: x, top: y }}
           onClick={e => e.stopPropagation()}>
        {items.map((it, i) => (
          <button key={i}
                  onClick={() => { it.onClick(); onClose() }}
                  className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 ${it.danger ? 'text-rose-700 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-100'}`}>
            {it.icon && <span className="flex-shrink-0">{it.icon}</span>}
            <span className="flex-1">{it.label}</span>
          </button>
        ))}
      </div>
    </>
  )
}
