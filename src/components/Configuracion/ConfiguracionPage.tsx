import { useState } from 'react'
import { Package, Layers, ArrowLeft, Zap } from 'lucide-react'
import { MaquinasTab } from './MaquinasTab'
import { PlantillasTab } from './PlantillasTab'
import { SolapamientoTab } from './SolapamientoTab'

interface ConfiguracionPageProps {
  onVolver: () => void
}

type Tab = 'maquinas' | 'plantillas' | 'solapamiento'

export function ConfiguracionPage({ onVolver }: ConfiguracionPageProps) {
  const [tab, setTab] = useState<Tab>('plantillas')

  return (
    <div className="h-full flex flex-col bg-[#f6f7fb] overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 shadow-sm">
        <div className="h-[48px] flex items-center px-4 gap-3">
          <button
            onClick={onVolver}
            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-500 transition-colors"
            title="Volver al cronograma"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="text-[14px] font-bold text-slate-800">Configuración</span>

          <div className="ml-4 flex items-center gap-1">
            <TabBtn active={tab === 'plantillas'} onClick={() => setTab('plantillas')} icon={<Layers size={13} />} label="Plantillas de proceso" />
            <TabBtn active={tab === 'maquinas'} onClick={() => setTab('maquinas')} icon={<Package size={13} />} label="Máquinas" />
            <TabBtn active={tab === 'solapamiento'} onClick={() => setTab('solapamiento')} icon={<Zap size={13} />} label="Solapamiento" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden p-5">
        {tab === 'maquinas' && <MaquinasTab />}
        {tab === 'solapamiento' && <SolapamientoTab />}
        {tab === 'plantillas' && (
          <div className="h-full flex flex-col">
            <div className="mb-3">
              <h2 className="text-[14px] font-bold text-slate-900">Plantillas de proceso</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Cada plantilla es un producto (ej: "Amasado dulce 16 masas") dividido en etapas con sus recursos y dependencias.
              </p>
            </div>
            <div className="flex-1 min-h-0">
              <PlantillasTab />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, icon, label }: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`h-8 px-3 text-[12px] font-semibold rounded-md flex items-center gap-1.5 transition-colors ${
        active
          ? 'bg-slate-900 text-white'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {icon}{label}
    </button>
  )
}
