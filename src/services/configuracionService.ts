import { supabase } from '../config/supabase'

// Modo: a cuál tarea se le aplica la penalización de tiempo cuando hay solapamiento con una paralela.
export type SolapeModo = 'solapada' | 'paralela' | 'ambas'

export interface ConfiguracionSolape {
  // Porcentaje de penalización aplicado a los minutos solapados (ej: 30 = +30%)
  penalizacionPct: number
  // A cuál tarea se le alarga la duración por defecto
  modoDefault: SolapeModo
}

const DEFAULT_CONFIG: ConfiguracionSolape = {
  penalizacionPct: 30,
  modoDefault: 'solapada'
}

const KEY_PCT = 'solape_penalizacion_pct'
const KEY_MODO = 'solape_modo_default'

export const configuracionService = {
  async obtenerConfiguracionSolape(): Promise<ConfiguracionSolape> {
    const { data, error } = await supabase
      .from('configuracion_sistema')
      .select('clave, valor')
      .in('clave', [KEY_PCT, KEY_MODO])
    if (error) throw error

    const map = new Map((data || []).map(r => [r.clave, r.valor]))
    const pctRaw = map.get(KEY_PCT)
    const modoRaw = map.get(KEY_MODO)

    const penalizacionPct = typeof pctRaw === 'number' ? pctRaw : DEFAULT_CONFIG.penalizacionPct
    const modoDefault: SolapeModo =
      modoRaw === 'solapada' || modoRaw === 'paralela' || modoRaw === 'ambas'
        ? modoRaw
        : DEFAULT_CONFIG.modoDefault

    return { penalizacionPct, modoDefault }
  },

  async guardarConfiguracionSolape(cfg: ConfiguracionSolape): Promise<void> {
    const fecha = new Date().toISOString()
    const { error } = await supabase
      .from('configuracion_sistema')
      .upsert([
        { clave: KEY_PCT, valor: cfg.penalizacionPct, fecha_actualizacion: fecha },
        { clave: KEY_MODO, valor: cfg.modoDefault, fecha_actualizacion: fecha }
      ], { onConflict: 'clave' })
    if (error) throw error
  }
}
