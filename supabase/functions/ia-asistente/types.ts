// Tipos de request/response de la Edge Function `ia-asistente`.
// ESPEJO de src/types/ia.ts (mantener sincronizados manualmente — Deno no importa
// desde src/). Si cambia uno, cambiar el otro.

export type AccionIA = 'ping' | 'repasar_plan' | 'explicar_conflicto' | 'comando_overrides'

export interface RequestIA {
  accion: AccionIA
  payload?: unknown
}

export type RespuestaIA<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

// ---- Catálogos compartidos (para mapear nombres -> IDs sin alucinar) ----
export interface CatalogoEmpleado { id: string; nombre: string }
export interface CatalogoPlantilla {
  id: string
  nombre: string
  etapas: { orden: number; nombre: string }[]
}
export interface Catalogos {
  empleados: CatalogoEmpleado[]
  plantillas: CatalogoPlantilla[]
}

// ---- Override en "wire form": arrays + IDs (amigable para el LLM). ----
// El cliente lo convierte/valida a SchedulerOverrides en validarOverrides().
export interface OverrideDeltaWire {
  prioridadPlantilla?: { plantillaId: string; prioridad: number }[]
  franjasExtra?: { empleadoId: string; desde: number; hasta: number; etiqueta?: string }[]
  inicioFijado?: { plantillaId: string; lote: number; etapaOrden: number; inicioMin: number }[]
  asignacionFijada?: { plantillaId: string; lote: number; etapaOrden: number; empleadoId: string }[]
  duracionFijada?: { plantillaId: string; lote: number; etapaOrden: number; duracionMin: number }[]
  ayudantesFijados?: { plantillaId: string; lote: number; etapaOrden: number; empleadosIds: string[] }[]
  secuenciaProcesos?: { antesPlantillaId: string; despuesPlantillaId: string }[]
  excluirPlantillas?: string[]
  sustituirMaquina?: string[]      // etapaIds
  relajarTopeInicio?: string[]     // plantillaIds
  relajarInicioPlan?: string[]     // plantillaIds
}

// ---- A. repasar_plan ----
export interface RepasarPlanPayload {
  dia: number
  metricas: {
    cierreJornada: number | null
    conflictos: number
    cargaPorEmpleado: { nombre: string; minutos: number; minutosFueraTurno: number }[]
  }
  resumenInstancias: {
    plantillaNombre: string
    etapaNombre: string
    lote: number
    inicioAbs: number | null
    finAbs: number | null
    empleados: string[]
    maquinas: string[]
    estado: 'colocada' | 'conflicto'
  }[]
  conflictos: {
    plantillaNombre: string
    etapaNombre: string
    lote: number
    motivo: string
    mensaje: string
    culpables: string[]
  }[]
  catalogos: Catalogos
}

export interface RepasarPlanData {
  diagnostico: { titulo: string; detalle: string; severidad: 'alta' | 'media' | 'baja' }[]
  propuestas: { titulo: string; justificacion: string; overrideDelta: OverrideDeltaWire }[]
}

// ---- B. explicar_conflicto ----
export interface ExplicarConflictoPayload {
  conflicto: {
    plantillaNombre: string
    etapaNombre: string
    lote: number
    motivo: string
    mensaje: string
    culpables: string[]
    decisionesScheduler?: string[]
  }
  soluciones: {
    id: string
    grupo: string
    descripcion: string
    recomendada?: boolean
    conflictosRestantes: number
    costoExtraMin?: number
    dejaProductoFuera?: boolean
  }[]
}

export interface ExplicarConflictoData {
  explicacion: string
  recomendacionSolucionId: string | null
  porQueRecomendada: string
}
