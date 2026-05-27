import { PlantillaProceso, PlantillaEtapa, Maquina, RolEmpleadoEtapa } from './planificacion'

// Intervalo en minutos absolutos del día (0-1439)
export interface IntervaloAbs {
  inicio: number
  fin: number
}

// Una franja de disponibilidad de un empleado en un día.
// La clave del modelo: un empleado puede tener VARIAS franjas separadas
// (turno normal + extras traídos), y una sub-tarea debe caber dentro de UNA sola.
export interface FranjaDisponibilidad {
  desde: number              // minuto absoluto del día
  hasta: number
  origen: 'turno' | 'extra'  // 'turno' = empleado_horarios; 'extra' = traído por resolución asistida
  etiqueta?: string
}

export interface EmpleadoScheduler {
  id: string
  nombre_completo: string
  habilidades: Set<string>   // habilidad_id; vacío = sin habilidades cargadas
  franjas: FranjaDisponibilidad[]
}

// Ocupación pre-existente (tareas manuales/bloqueadas que no se deben pisar)
export interface OcupacionMaquina {
  maquinaId: string
  intervalo: IntervaloAbs
  uso: number   // 0.01–1.0
  etiqueta?: string      // nombre de la tarea que ocupa (para explicar conflictos)
  plantillaId?: string   // plantilla que generó la ocupación (para soluciones sobre el culpable)
}

export interface OcupacionEmpleado {
  empleadoId: string
  intervalo: IntervaloAbs
  etiqueta?: string
  plantillaId?: string
  permiteSolape?: boolean   // la tarea puede correr en paralelo (no bloquea al empleado al 100%)
  exclusiva?: boolean       // atención exclusiva: no admite ninguna tarea en paralelo
}

// Asignación resuelta de un empleado a una etapa (ventanas en minutos absolutos)
export interface AsignacionEtapa {
  slotId: string
  rol: RolEmpleadoEtapa
  empleadoId: string
  empleadoNombre: string
  ventanasAbs: IntervaloAbs[]
  esReemplazo: boolean        // true si no es el preferido
  enFranjaExtra: boolean      // true si alguna ventana cae en franja 'extra'
}

// Recurso (máquina) reservado por una etapa, en minutos absolutos
export interface RecursoAbs {
  maquinaId: string
  maquinaNombre: string
  uso: number
  intervalo: IntervaloAbs
}

export type MotivoConflicto = 'ventana_horaria' | 'maquina_ocupada' | 'empleado_no_disponible' | 'dependencia'

export interface ConflictoInfo {
  motivo: MotivoConflicto
  mensaje: string
  culpables: string[]              // etiquetas de tareas que ocupan el recurso (para mostrar)
  culpablesPlantillaIds?: string[] // plantillas culpables (para ofrecer bajar prioridad / sacar del plan)
  // Datos para "traer empleado el tiempo justo": el empleado entra en el primer momento posible.
  desdeColocacion?: number         // minuto más temprano en que esta etapa puede arrancar (earliest)
  topeColocacion?: number          // minuto límite (latest) en que esta etapa debe arrancar como máximo
  leadBloqueo?: number             // minutos que el proceso culpable ocupa al empleado preferido (lo que tarda, p.ej. la crema)
  preferidoBloqueadoId?: string    // empleado preferido que está bloqueado por el proceso culpable
}

// Una instancia concreta de una etapa (una etapa de una plantilla en un lote)
export interface InstanciaEtapa {
  key: string                 // `${plantillaId}:${lote}:${etapa.orden}`
  plantillaId: string
  plantillaNombre: string
  lote: number
  etapa: PlantillaEtapa
  inicioAbs: number | null
  finAbs: number | null
  asignaciones: AsignacionEtapa[]
  recursosAbs: RecursoAbs[]
  estado: 'colocada' | 'conflicto'
  conflicto?: ConflictoInfo
  cascada?: boolean   // conflicto arrastrado por otra etapa del mismo proceso (no es la causa raíz)
}

export interface ResultadoScheduler {
  instancias: InstanciaEtapa[]
  conflictos: InstanciaEtapa[]   // subconjunto con estado 'conflicto'
  cierreJornada: number | null   // minuto absoluto del fin más tardío colocado
}

// Datos ya cargados que consume el generador (función pura)
export interface ContextoScheduler {
  dia: number
  diaInicio: number   // minuto del día desde el que se puede planificar (rango del cronograma)
  plantillasConEtapas: PlantillaProceso[]   // etapas pobladas
  planDia: {
    plantillaId: string
    cantidadLotes: number
    prioridad: number
    // Overrides de horario del día (minutos absolutos); null/undefined = usa el de la plantilla.
    inicioMinOverride?: number | null
    inicioMaxOverride?: number | null
    finMaxOverride?: number | null
  }[]
  maquinas: Maquina[]
  empleados: EmpleadoScheduler[]
  ocupacionMaquinasInicial: OcupacionMaquina[]
  ocupacionEmpleadosInicial: OcupacionEmpleado[]
}

// ============ Fase 4: resolución asistida ============

export interface SchedulerOverrides {
  franjasExtra?: Record<string, FranjaDisponibilidad[]>   // empId -> franjas 'extra'
  prioridadPlantilla?: Record<string, number>             // plantillaId -> prioridad
  relajarRestriccion?: Record<string, { hora_inicio_min?: number | null; hora_inicio_max?: number | null; hora_fin_max?: number | null }>
  relajarTopeInicio?: string[]   // plantillaIds: ignorar su "no empezar antes" / "tope de inicio" (puede empezar más tarde)
  relajarInicioPlan?: string[]   // plantillaIds: quitar el "no empezar antes" del plan del día / plantilla (hora_inicio_min)
  sustituirMaquina?: string[]    // etapaIds: pueden usar cualquier máquina activa de su mismo grupo (no solo la asignada)
  excluirPlantillas?: string[]
  asignacionFijada?: { plantillaId: string; lote: number; etapaOrden: number; empleadoId: string }[]  // PIN
}

export interface MetricasJornada {
  cierreJornada: number | null
  conflictos: number
  cargaPorEmpleado: { empleadoId: string; nombre: string; minutos: number; minutosFueraTurno: number }[]
}

export interface SolucionConflicto {
  id: string
  tipo: 'sustituir_maquina' | 'traer_empleado' | 'relajar' | 'excluir' | 'bajar_prioridad'
  grupo: 'maquina' | 'culpable' | 'traer' | 'relajar' | 'proceso'   // para agrupar visualmente las soluciones
  descripcion: string
  overrideDelta: SchedulerOverrides   // se fusiona con los overrides acumulados
  resultado: ResultadoScheduler       // ya simulado
  metricas: MetricasJornada
  recomendada?: boolean               // marcada como la opción sugerida dentro de su grupo
  // Señales de negocio (para ordenar y mostrar el costo de cada opción)
  costoNegocio?: number               // 0 = más barata (sustituir máquina) … 5 = última (sacar producto)
  costoExtraMin?: number              // minutos de hora extra que implica (solo "extender turno")
  huecoMuertoMin?: number             // minutos pagos sin trabajar entre el turno y la tarea
  dejaProductoFuera?: boolean         // la opción elimina o posterga un producto (pérdida comercial)
}

export type { PlantillaProceso, Maquina }
