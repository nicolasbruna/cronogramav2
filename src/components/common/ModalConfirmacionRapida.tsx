import { useEffect, useRef } from 'react'
import { AlertCircle, CheckCircle, HelpCircle } from 'lucide-react'

interface ModalConfirmacionRapidaProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  titulo: string
  mensaje?: string
  tipo?: 'question' | 'warning' | 'info' | 'success'
  textoConfirmar?: string
  textoCancelar?: string
  autoFocus?: boolean
}

export function ModalConfirmacionRapida({
  isOpen,
  onClose,
  onConfirm,
  titulo,
  mensaje,
  tipo = 'question',
  textoConfirmar = 'Sí',
  textoCancelar = 'No',
  autoFocus = true
}: ModalConfirmacionRapidaProps) {
  const confirmarRef = useRef<HTMLButtonElement>(null)
  const cancelarRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isOpen && autoFocus) {
      setTimeout(() => {
        confirmarRef.current?.focus()
      }, 100)
    }
  }, [isOpen, autoFocus])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (document.activeElement === cancelarRef.current) {
          onClose()
        } else {
          onConfirm()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (document.activeElement === confirmarRef.current) {
          cancelarRef.current?.focus()
        } else {
          confirmarRef.current?.focus()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, onConfirm, onClose])

  if (!isOpen) return null

  const iconosPorTipo = {
    question: <HelpCircle className="w-6 h-6 text-blue-600" />,
    warning: <AlertCircle className="w-6 h-6 text-yellow-600" />,
    info: <AlertCircle className="w-6 h-6 text-blue-600" />,
    success: <CheckCircle className="w-6 h-6 text-green-600" />
  }

  const coloresPorTipo = {
    question: 'bg-blue-50 border-blue-200',
    warning: 'bg-yellow-50 border-yellow-200',
    info: 'bg-blue-50 border-blue-200',
    success: 'bg-green-50 border-green-200'
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full border border-gray-200">
        <div className={`flex items-start gap-3 p-4 border-b ${coloresPorTipo[tipo]}`}>
          {iconosPorTipo[tipo]}
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900">
              {titulo}
            </h3>
            {mensaje && (
              <p className="text-sm text-gray-600 mt-1">
                {mensaje}
              </p>
            )}
          </div>
        </div>

        <div className="p-4">
          <div className="flex justify-end gap-3">
            <button
              ref={cancelarRef}
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors focus:ring-2 focus:ring-gray-400"
            >
              {textoCancelar}
              <span className="ml-2 text-xs text-gray-500">(ESC)</span>
            </button>
            <button
              ref={confirmarRef}
              type="button"
              onClick={onConfirm}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors focus:ring-2 focus:ring-blue-500"
            >
              {textoConfirmar}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
