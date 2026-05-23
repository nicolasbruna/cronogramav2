export interface CronogramaLinea {
  id: string
  empleado_id: string
  nombre: string
  orden: number
  color: string | null
  activa: boolean
  dia_semana: number
  fecha_creacion: string
}

export type TamanoTexto = 'xs' | 'sm' | 'normal' | 'lg' | 'xl'
export type OrientacionTexto = 'horizontal' | 'vertical'

export interface RecursoProgramadoCronograma {
  maquina_id: string
  maquina_nombre: string
  hora_inicio: string
  hora_fin: string
}

export interface CronogramaTarea {
  id: string
  linea_id: string | null   // null para tareas autónomas (sin empleado activo)
  dia_semana: number
  hora_inicio: string
  hora_fin: string
  descripcion: string
  color: string | null
  bloqueada: boolean
  tamano_texto: TamanoTexto
  orientacion_texto: OrientacionTexto
  orden: number
  tamano: number
  fila: number
  grupo_id: string | null
  eliminada: boolean
  recursos_programados: RecursoProgramadoCronograma[]
  // Trazabilidad de origen
  plantilla_id: string | null       // plantilla que originó esta tarea (null = manual)
  es_provisoria: boolean            // resolución manual de conflicto pendiente de confirmar
  notas_provisoria: string | null   // notas del usuario al resolver el conflicto
  // Trazabilidad de etapa (para validar dependencias al mover)
  etapa_orden: number | null        // orden de la etapa dentro de la plantilla
  lote: number | null               // número de lote (instancia del proceso)
  dependencias: number[]            // órdenes de etapas que deben terminar antes (encadenadas)
  prerequisitos: number[]           // órdenes de etapas que deben terminar antes (sueltas)
  permite_solape: boolean           // puede solaparse con otras tareas (paralelo)
  // Penalización por solapamiento con una tarea paralela
  duracion_base_min: number | null  // duración original (sin penalización) en minutos — para revertir
  factor_solape_pct: number | null  // override del % de penalización (null = usa config global)
  solape_modo: string | null        // override de a cuál se alarga (null = usa config global)
  fecha_creacion: string
  fecha_actualizacion: string
}

export interface CrearCronogramaLineaRequest {
  empleado_id: string
  nombre: string
  dia_semana: number
  orden?: number
  color?: string | null
}

export interface ActualizarCronogramaLineaRequest {
  nombre?: string
  orden?: number
  color?: string | null
  activa?: boolean
}

export interface CrearCronogramaTareaRequest {
  linea_id: string | null   // null para tareas autónomas
  dia_semana: number
  hora_inicio: string
  hora_fin: string
  descripcion: string
  color?: string | null
  bloqueada?: boolean
  tamano_texto?: TamanoTexto
  orientacion_texto?: OrientacionTexto
  tamano?: number
  fila?: number
  recursos_programados?: RecursoProgramadoCronograma[]
  plantilla_id?: string | null
  es_provisoria?: boolean
  notas_provisoria?: string | null
  etapa_orden?: number | null
  lote?: number | null
  dependencias?: number[]
  prerequisitos?: number[]
  permite_solape?: boolean
  duracion_base_min?: number | null
  factor_solape_pct?: number | null
  solape_modo?: string | null
}

export interface ActualizarCronogramaTareaRequest {
  linea_id?: string
  dia_semana?: number
  hora_inicio?: string
  hora_fin?: string
  descripcion?: string
  color?: string | null
  bloqueada?: boolean
  tamano_texto?: TamanoTexto
  orientacion_texto?: OrientacionTexto
  orden?: number
  tamano?: number
  fila?: number
  recursos_programados?: RecursoProgramadoCronograma[]
  permite_solape?: boolean
  duracion_base_min?: number | null
  factor_solape_pct?: number | null
  solape_modo?: string | null
}

export interface EmpleadoConLineas {
  id: string
  nombre_completo: string
  color: string
  lineas: CronogramaLinea[]
}

export interface Empleado {
  id: string
  codigo: number
  nombre_completo: string
  documento?: string
  telefono?: string
  email?: string
  fecha_ingreso?: string
  activo: boolean
  fecha_creacion: string
  fecha_actualizacion: string
}

export const DIAS_SEMANA_NOMBRES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const
export const DIAS_SEMANA_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const

export interface CronogramaVersion {
  id: string
  nombre: string
  dia_semana: number
  snapshot_tareas: CronogramaTarea[]
  snapshot_lineas: CronogramaLinea[]
  creado_por: string
  fecha_creacion: string
  notas: string
  eliminado_en: string | null
  es_backup_auto: boolean
}

export const COLORES_EMPLEADOS = [
  '#dc2626', '#0ea5e9', '#16a34a', '#f59e0b', '#ec4899',
  '#14b8a6', '#f97316', '#6366f1', '#8b5cf6', '#ef4444'
] as const
