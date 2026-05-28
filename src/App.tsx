import { useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { LoginPage } from './components/Auth/LoginPage'
import { CronogramaPage } from './components/Cronograma/CronogramaPage'
import { CronogramaEmpleadoPage } from './components/Cronograma/CronogramaEmpleadoPage'
import { ConfiguracionPage } from './components/Configuracion/ConfiguracionPage'
import { PlanificarPage } from './components/Planificacion/PlanificarPage'
import { SimulacionPage } from './components/Simulacion/SimulacionPage'
import { Loader2 } from 'lucide-react'

type Vista =
  | { tipo: 'cronograma' }
  | { tipo: 'cronograma-empleado'; empleadoId: string; dia?: number }
  | { tipo: 'configuracion' }
  | { tipo: 'planificar'; dia: number }
  | { tipo: 'simulacion' }

function AppContent() {
  const { user, loading } = useAuth()
  const [vista, setVista] = useState<Vista>({ tipo: 'cronograma' })

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-slate-400" />
      </div>
    )
  }

  if (!user) {
    return <LoginPage />
  }

  const handleSectionChange = (section: string) => {
    if (section.startsWith('cronograma-empleado/')) {
      const parts = section.split('/')
      setVista({
        tipo: 'cronograma-empleado',
        empleadoId: parts[1],
        dia: parts[2] ? parseInt(parts[2]) : undefined
      })
    }
    if (section === 'configuracion') {
      setVista({ tipo: 'configuracion' })
    }
  }

  if (vista.tipo === 'cronograma-empleado') {
    return (
      <CronogramaEmpleadoPage
        empleadoId={vista.empleadoId}
        diaInicial={vista.dia}
        onVolver={() => setVista({ tipo: 'cronograma' })}
      />
    )
  }

  if (vista.tipo === 'configuracion') {
    return (
      <div className="h-screen">
        <ConfiguracionPage onVolver={() => setVista({ tipo: 'cronograma' })} />
      </div>
    )
  }

  if (vista.tipo === 'planificar') {
    return (
      <div className="h-screen">
        <PlanificarPage diaActual={vista.dia} onVolver={() => setVista({ tipo: 'cronograma' })} />
      </div>
    )
  }

  if (vista.tipo === 'simulacion') {
    return <SimulacionPage onVolver={() => setVista({ tipo: 'cronograma' })} />
  }

  return (
    <CronogramaPage
      onSectionChange={handleSectionChange}
      onIrAConfiguracion={() => setVista({ tipo: 'configuracion' })}
      onIrAPlanificar={(dia) => setVista({ tipo: 'planificar', dia })}
      onIrASimulacion={() => setVista({ tipo: 'simulacion' })}
    />
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
