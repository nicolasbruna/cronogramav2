export interface GrupoRecurso {
  id: string
  nombre: string
  descripcion?: string | null
  fecha_creacion: string
}

export interface Maquina {
  id: string
  nombre: string
  cantidad: number
  descripcion?: string | null
  activa: boolean
  grupo_id?: string | null
  prioridad_grupo: number
  grupo?: GrupoRecurso | null
  fecha_creacion: string
}

export interface CrearGrupoRecursoRequest {
  nombre: string
  descripcion?: string | null
}

export interface Habilidad {
  id: string
  nombre: string
  descripcion?: string | null
  fecha_creacion: string
}

export type TipoEtapa = 'critica' | 'flexible' | 'descanso'

export interface VentanaEmpleado {
  desde: number  // minutos relativos al inicio del proceso
  hasta: number
}

export type RolEmpleadoEtapa = 'principal' | 'ayudante'

// Un "slot" de empleado dentro de una etapa: un empleado (real o por habilidad)
// que cubre un conjunto de ventanas. Una etapa puede tener varios (principal + ayudantes).
export interface EmpleadoEtapaSlot {
  id: string                         // id local para la UI
  rol: RolEmpleadoEtapa
  ventanas: VentanaEmpleado[]        // minutos relativos al inicio del proceso
  habilidad_id?: string | null
  empleado_preferido_id?: string | null
  puede_reemplazarse?: boolean
}

export interface RecursoEtapa {
  maquina_id: string
  uso_recurso: number  // 0.01–1.0
  desde: number        // minutos desde inicio del proceso
  hasta: number        // minutos desde inicio del proceso
}

export interface PlantillaEtapa {
  id: string
  plantilla_id: string
  orden: number
  nombre: string
  duracion_proceso: number
  // Nuevo modelo (Fase B): múltiples empleados por etapa (principal + ayudantes).
  // Si está vacío, se usa el modelo de empleado único (ventanas_empleado + empleado_preferido_id).
  empleados_etapa: EmpleadoEtapaSlot[]
  // Modelo: ventanas explícitas de empleado (empleado único)
  ventanas_empleado: VentanaEmpleado[]
  // Recursos múltiples (nuevo modelo)
  recursos: RecursoEtapa[]
  // Legacy recurso único (fallback si recursos está vacío)
  uso_recurso: number
  maquina_id?: string | null
  maquina?: Maquina | null
  // Legacy campos empleado (fallback si ventanas_empleado está vacío)
  tiempo_empleado_inicio: number
  tiempo_empleado_fin: number
  bloquea_empleado_total: boolean
  habilidad_id?: string | null
  habilidad?: Habilidad | null
  empleado_preferido_id?: string | null
  empleado_preferido?: { id: string; nombre_completo: string } | null
  puede_reemplazarse?: boolean
  dependencias: string[]            // ids de etapa (estables ante reordenamientos)
  prerequisitos: string[]           // ids de etapa: deben terminar ANTES, sin encadenar
  margen_espera_max?: number | null
  hora_inicio_min?: number | null   // minuto del día: no puede empezar antes
  hora_inicio_max?: number | null   // minuto del día: debe empezar antes (tope de comienzo)
  hora_fin_max?: number | null      // minuto del día: debe terminar antes
  prioridad: number
  tipo: TipoEtapa
  permite_solape?: boolean   // puede ejecutarse en paralelo a otras tareas (no bloquea al empleado)
  atencion_exclusiva?: boolean  // requiere al empleado al 100%: no puede coincidir con una tarea paralela del mismo empleado
  color?: string | null
  descripcion_extra?: string | null
}

export interface EmpleadoHorario {
  id: string
  empleado_id: string
  dia_semana: number
  hora_inicio: string   // "HH:MM:SS" — hora de entrada
  hora_fin: string      // "HH:MM:SS" — hora de salida
}

export interface PlantillaProceso {
  id: string
  nombre: string
  descripcion?: string | null
  categoria?: string | null
  color?: string | null             // color del proceso para el modo "color por proceso"
  hora_inicio_min?: string | null   // TIME "HH:MM" — restricción global: el proceso no puede empezar antes
  hora_inicio_max?: string | null   // TIME "HH:MM" — restricción global: el proceso debe empezar antes (tope de comienzo)
  hora_fin_max?: string | null      // TIME "HH:MM" — restricción global: el proceso no puede terminar después
  permite_solape?: boolean          // default para todas las etapas: pueden ejecutarse en paralelo
  atencion_exclusiva?: boolean      // default para las etapas
  empleado_preferido_id?: string | null  // preferido para todo el proceso (gana sobre el de la etapa)
  puede_reemplazarse?: boolean      // si el preferido del proceso puede reemplazarse por otro
  activa: boolean
  fecha_creacion: string
  etapas?: PlantillaEtapa[]
}

export interface CrearMaquinaRequest {
  nombre: string
  cantidad: number
  descripcion?: string | null
  grupo_id?: string | null
  prioridad_grupo?: number
}

export interface CrearHabilidadRequest {
  nombre: string
  descripcion?: string | null
}

export interface CrearPlantillaRequest {
  nombre: string
  descripcion?: string | null
  categoria?: string | null
  color?: string | null
  hora_inicio_min?: string | null
  hora_inicio_max?: string | null
  hora_fin_max?: string | null
  permite_solape?: boolean
  atencion_exclusiva?: boolean
  empleado_preferido_id?: string | null
  puede_reemplazarse?: boolean
}

export interface CrearEtapaRequest {
  plantilla_id: string
  orden: number
  nombre: string
  duracion_proceso: number
  empleados_etapa: EmpleadoEtapaSlot[]
  ventanas_empleado: VentanaEmpleado[]
  recursos: RecursoEtapa[]
  // Legacy
  uso_recurso: number
  tiempo_empleado_inicio: number
  tiempo_empleado_fin: number
  bloquea_empleado_total: boolean
  maquina_id?: string | null
  habilidad_id?: string | null
  empleado_preferido_id?: string | null
  puede_reemplazarse?: boolean
  dependencias: string[]
  prerequisitos: string[]
  margen_espera_max?: number | null
  hora_inicio_min?: number | null
  hora_inicio_max?: number | null
  hora_fin_max?: number | null
  prioridad: number
  tipo: TipoEtapa
  permite_solape?: boolean
  atencion_exclusiva?: boolean
  color?: string | null
  descripcion_extra?: string | null
}

// Cola de producción de un día: qué plantillas y cuántos lotes producir.
export interface PlanDiaItem {
  id: string
  dia_semana: number
  plantilla_id: string
  plantilla?: PlantillaProceso | null
  cantidad_lotes: number
  prioridad: number
  // Overrides de horario solo para este día (TIME "HH:MM"); null = usa el de la plantilla.
  hora_inicio_min?: string | null
  hora_inicio_max?: string | null
  hora_fin_max?: string | null
  // Override del empleado preferido del proceso para este día.
  empleado_preferido_modo?: string | null   // 'heredar' | 'fijar' | 'ninguno' (null = heredar)
  empleado_preferido_override_id?: string | null
  activo: boolean
  fecha_creacion: string
}

export interface CrearPlanDiaRequest {
  dia_semana: number
  plantilla_id: string
  cantidad_lotes: number
  prioridad: number
  hora_inicio_min?: string | null
  hora_inicio_max?: string | null
  hora_fin_max?: string | null
  empleado_preferido_modo?: string | null
  empleado_preferido_override_id?: string | null
}

export const COLORES_ETAPA: Record<TipoEtapa, string> = {
  critica: '#dc2626',
  flexible: '#16a34a',
  descanso: '#0ea5e9'
}
