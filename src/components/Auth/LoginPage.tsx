import { useState } from 'react'
import { LogIn, UserPlus, AlertCircle, Loader2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

export function LoginPage() {
  const { signIn, signUp } = useAuth()
  const [modo, setModo] = useState<'login' | 'registro'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setExito(null)

    if (!email.trim() || !password.trim()) {
      setError('Completá email y contraseña.')
      return
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    setLoading(true)
    try {
      if (modo === 'login') {
        const { error } = await signIn(email.trim(), password)
        if (error) setError(tradError(error))
      } else {
        const { error } = await signUp(email.trim(), password)
        if (error) {
          setError(tradError(error))
        } else {
          setExito('Cuenta creada. Ya podés iniciar sesión.')
          setModo('login')
          setPassword('')
        }
      }
    } finally {
      setLoading(false)
    }
  }

  const tradError = (msg: string): string => {
    if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.'
    if (msg.includes('User already registered')) return 'Ya existe una cuenta con ese email.'
    if (msg.includes('Password should be')) return 'La contraseña debe tener al menos 6 caracteres.'
    if (msg.includes('Unable to validate')) return 'No se pudo validar el email.'
    return msg
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white font-black text-lg">CP</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Cronograma de Producción</h1>
          <p className="text-sm text-slate-500 mt-1">Sistema de gestión de cronogramas</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg border border-slate-200/60 overflow-hidden">
          <div className="flex border-b border-slate-200">
            <button
              onClick={() => { setModo('login'); setError(null); setExito(null) }}
              className={`flex-1 h-11 text-sm font-semibold transition-colors ${
                modo === 'login'
                  ? 'text-slate-900 border-b-2 border-slate-800 bg-slate-50/50'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              Iniciar sesión
            </button>
            <button
              onClick={() => { setModo('registro'); setError(null); setExito(null) }}
              className={`flex-1 h-11 text-sm font-semibold transition-colors ${
                modo === 'registro'
                  ? 'text-slate-900 border-b-2 border-slate-800 bg-slate-50/50'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              Crear cuenta
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-[13px] text-red-700">{error}</p>
              </div>
            )}

            {exito && (
              <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <p className="text-[13px] text-emerald-700">{exito}</p>
              </div>
            )}

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@email.com"
                autoComplete="email"
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-800/20 focus:border-slate-800 transition-shadow"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-800/20 focus:border-slate-800 transition-shadow"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 bg-slate-800 text-white text-sm font-bold rounded-lg hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors shadow-sm"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : modo === 'login' ? (
                <><LogIn size={16} /> Ingresar</>
              ) : (
                <><UserPlus size={16} /> Crear cuenta</>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-6">
          Sistema interno de uso exclusivo.
        </p>
      </div>
    </div>
  )
}
