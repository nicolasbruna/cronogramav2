// Tipos de la capa de IA (cliente). ESPEJO de supabase/functions/ia-asistente/types.ts.
// Si cambia uno, actualizar el otro (Deno no puede importar desde src/).

export type AccionIA = 'ping' | 'repasar_plan' | 'explicar_conflicto' | 'comando_overrides'

export type RespuestaIA<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

// Estado de disponibilidad de la IA (para mostrar/ocultar controles).
export interface IAEstado {
  disponible: boolean
  motivo?: 'offline' | 'desactivada' | 'sin_config' | 'error'
}

// Override en "wire form" que devuelve la IA (arrays + IDs). El cliente lo
// convierte/valida a SchedulerOverrides en validarOverrides().
export interface OverrideDeltaWire {
  prioridadPlantilla?: { plantillaId: string; prioridad: number }[]
  franjasExtra?: { empleadoId: string; desde: number; hasta: number; etiqueta?: string }[]
  inicioFijado?: { plantillaId: string; lote: number; etapaOrden: number; inicioMin: number }[]
  asignacionFijada?: { plantillaId: string; lote: number; etapaOrden: number; empleadoId: string }[]
  duracionFijada?: { plantillaId: string; lote: number; etapaOrden: number; duracionMin: number }[]
  ayudantesFijados?: { plantillaId: string; lote: number; etapaOrden: number; empleadosIds: string[] }[]
  secuenciaProcesos?: { antesPlantillaId: string; despuesPlantillaId: string }[]
  excluirPlantillas?: string[]
  sustituirMaquina?: string[]
  relajarTopeInicio?: string[]
  relajarInicioPlan?: string[]
}

export interface RepasarPlanData {
  diagnostico: { titulo: string; detalle: string; severidad: 'alta' | 'media' | 'baja' }[]
  propuestas: { titulo: string; justificacion: string; overrideDelta: OverrideDeltaWire }[]
}

export interface ExplicarConflictoData {
  explicacion: string
  recomendacionSolucionId: string | null
  porQueRecomendada: string
}

export interface ComandoOverridesData {
  overrides: OverrideDeltaWire
  resumenInterpretacion: string
  advertencias?: string[]
}
