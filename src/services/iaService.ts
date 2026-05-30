// Capa de IA (opcional) que repasa el resultado del scheduler y propone mejoras.
// Principio: la IA propone, el MOTOR verifica. Cada propuesta se valida, se simula
// con generarCronograma y se compara por métricas reales. Solo se auto-aplica una
// mejora "clara" (domina al base sin trade-offs ni competidoras).
import { supabase } from '../config/supabase'
import {
  generarCronograma,
  fusionarOverrides,
  calcularMetricasJornada,
  GeneracionPreparada,
} from './schedulerService'
import {
  SchedulerOverrides,
  ResultadoScheduler,
  MetricasJornada,
  ContextoScheduler,
  InstanciaEtapa,
  SolucionConflicto,
  FranjaDisponibilidad,
} from '../types/scheduler'
import { configuracionService } from './configuracionService'
import {
  AccionIA,
  RespuestaIA,
  IAEstado,
  OverrideDeltaWire,
  RepasarPlanData,
  ExplicarConflictoData,
} from '../types/ia'

// ============ Errores ============
export class IAError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

// ============ Disponibilidad ============
let cacheSinConfig = false   // si la función no existe / falta secret, no reintentar en loop

export async function iaDisponible(): Promise<IAEstado> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { disponible: false, motivo: 'offline' }
  if (cacheSinConfig) return { disponible: false, motivo: 'sin_config' }
  let habilitada = false
  try {
    habilitada = await configuracionService.obtenerIAHabilitada()
  } catch {
    return { disponible: false, motivo: 'error' }
  }
  if (!habilitada) return { disponible: false, motivo: 'desactivada' }
  return { disponible: true }
}

// ============ Invocación de la Edge Function ============
async function invocarIA<T>(accion: AccionIA, payload: unknown, timeoutMs = 30_000): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new IAError('offline', 'Sin conexión.')

  const llamada = supabase.functions.invoke('ia-asistente', { body: { accion, payload } })
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new IAError('timeout', 'La IA tardó demasiado en responder.')), timeoutMs))

  let res: Awaited<typeof llamada>
  try {
    res = await Promise.race([llamada, timeout])
  } catch (e) {
    if (e instanceof IAError) throw e
    throw new IAError('servidor', e instanceof Error ? e.message : String(e))
  }

  const { data, error } = res
  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status
    if (status === 401) throw new IAError('auth', 'Sesión expirada. Volvé a entrar.')
    throw new IAError('servidor', error.message || 'Error del servidor de IA.')
  }
  const r = data as RespuestaIA<T>
  if (!r || !r.ok) {
    const code = r?.error?.code || 'servidor'
    if (code === 'sin_config') cacheSinConfig = true
    throw new IAError(code, r?.error?.message || 'Error de IA.')
  }
  return r.data
}

// ============ Validación: OverrideDeltaWire -> SchedulerOverrides ============
export function validarOverrides(
  wire: OverrideDeltaWire | undefined | null,
  ctx: ContextoScheduler,
): { ok: true; overrides: SchedulerOverrides } | { ok: false; errores: string[] } {
  const errores: string[] = []
  if (!wire || typeof wire !== 'object') return { ok: false, errores: ['Propuesta vacía o inválida.'] }

  const empIds = new Set(ctx.empleados.map(e => e.id))
  const plantById = new Map(ctx.plantillasConEtapas.map(p => [p.id, p]))
  const ordenesPorPlant = new Map(
    ctx.plantillasConEtapas.map(p => [p.id, new Set((p.etapas ?? []).map(e => e.orden))]))
  const etapaIds = new Set(ctx.plantillasConEtapas.flatMap(p => (p.etapas ?? []).map(e => e.id)))

  const min0a1439 = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1439
  const okPlant = (id: string) => plantById.has(id) || (errores.push(`Plantilla inexistente: ${id}`), false)
  const okEmp = (id: string) => empIds.has(id) || (errores.push(`Empleado inexistente: ${id}`), false)
  const okEtapa = (pid: string, orden: number) =>
    (ordenesPorPlant.get(pid)?.has(orden) ?? false) || (errores.push(`Etapa ${orden} inexistente en ${pid}`), false)

  const o: SchedulerOverrides = {}

  if (wire.prioridadPlantilla?.length) {
    o.prioridadPlantilla = {}
    for (const it of wire.prioridadPlantilla) {
      if (!okPlant(it.plantillaId)) continue
      if (!Number.isInteger(it.prioridad) || it.prioridad < 1 || it.prioridad > 10) { errores.push(`Prioridad fuera de rango: ${it.prioridad}`); continue }
      o.prioridadPlantilla[it.plantillaId] = it.prioridad
    }
  }

  if (wire.franjasExtra?.length) {
    o.franjasExtra = {}
    for (const f of wire.franjasExtra) {
      if (!okEmp(f.empleadoId)) continue
      if (!min0a1439(f.desde) || !min0a1439(f.hasta) || f.hasta <= f.desde) { errores.push(`Franja inválida ${f.desde}-${f.hasta}`); continue }
      const franja: FranjaDisponibilidad = { desde: f.desde, hasta: f.hasta, origen: 'extra', etiqueta: f.etiqueta }
      ;(o.franjasExtra[f.empleadoId] ??= []).push(franja)
    }
  }

  if (wire.inicioFijado?.length) {
    o.inicioFijado = []
    for (const it of wire.inicioFijado) {
      if (!okPlant(it.plantillaId) || !okEtapa(it.plantillaId, it.etapaOrden)) continue
      if (!min0a1439(it.inicioMin) || !(it.lote >= 1)) { errores.push('inicioFijado inválido'); continue }
      o.inicioFijado.push({ plantillaId: it.plantillaId, lote: it.lote, etapaOrden: it.etapaOrden, inicioMin: it.inicioMin })
    }
  }

  if (wire.asignacionFijada?.length) {
    o.asignacionFijada = []
    for (const it of wire.asignacionFijada) {
      if (!okPlant(it.plantillaId) || !okEtapa(it.plantillaId, it.etapaOrden) || !okEmp(it.empleadoId)) continue
      if (!(it.lote >= 1)) { errores.push('asignacionFijada: lote inválido'); continue }
      o.asignacionFijada.push({ plantillaId: it.plantillaId, lote: it.lote, etapaOrden: it.etapaOrden, empleadoId: it.empleadoId })
    }
  }

  if (wire.duracionFijada?.length) {
    o.duracionFijada = []
    for (const it of wire.duracionFijada) {
      if (!okPlant(it.plantillaId) || !okEtapa(it.plantillaId, it.etapaOrden)) continue
      if (!Number.isInteger(it.duracionMin) || it.duracionMin < 1 || it.duracionMin > 1439 || !(it.lote >= 1)) { errores.push('duracionFijada inválida'); continue }
      o.duracionFijada.push({ plantillaId: it.plantillaId, lote: it.lote, etapaOrden: it.etapaOrden, duracionMin: it.duracionMin })
    }
  }

  if (wire.ayudantesFijados?.length) {
    o.ayudantesFijados = []
    for (const it of wire.ayudantesFijados) {
      if (!okPlant(it.plantillaId) || !okEtapa(it.plantillaId, it.etapaOrden)) continue
      const ids = (it.empleadosIds ?? []).filter(id => okEmp(id))
      if (!ids.length || !(it.lote >= 1)) continue
      o.ayudantesFijados.push({ plantillaId: it.plantillaId, lote: it.lote, etapaOrden: it.etapaOrden, empleadosIds: ids })
    }
  }

  if (wire.secuenciaProcesos?.length) {
    o.secuenciaProcesos = []
    for (const it of wire.secuenciaProcesos) {
      if (!okPlant(it.antesPlantillaId) || !okPlant(it.despuesPlantillaId)) continue
      o.secuenciaProcesos.push({ antesPlantillaId: it.antesPlantillaId, despuesPlantillaId: it.despuesPlantillaId })
    }
  }

  if (wire.excluirPlantillas?.length) o.excluirPlantillas = wire.excluirPlantillas.filter(okPlant)
  if (wire.relajarTopeInicio?.length) o.relajarTopeInicio = wire.relajarTopeInicio.filter(okPlant)
  if (wire.relajarInicioPlan?.length) o.relajarInicioPlan = wire.relajarInicioPlan.filter(okPlant)
  if (wire.sustituirMaquina?.length) {
    // etapaIds: validar contra los ids de etapa si están disponibles; si no, pasar igual.
    o.sustituirMaquina = etapaIds.size ? wire.sustituirMaquina.filter(id => etapaIds.has(id)) : wire.sustituirMaquina
  }

  if (errores.length) return { ok: false, errores }
  if (Object.keys(o).length === 0) return { ok: false, errores: ['La propuesta no contiene cambios aplicables.'] }
  return { ok: true, overrides: o }
}

// ============ Simulación y clasificación ============
export interface PropuestaSimulada {
  titulo: string
  justificacion: string
  overrideDelta: SchedulerOverrides   // delta a aplicar (vía aplicarOverrideDelta)
  resultado: ResultadoScheduler       // ya simulado (base + delta)
  metricas: MetricasJornada
  diff: string[]
}

export interface ResultadoRepaso {
  diagnostico: RepasarPlanData['diagnostico']
  autoAplicable: PropuestaSimulada | null   // mejora clara → se aplica sola
  opciones: PropuestaSimulada[]             // dudosas → el usuario elige
  descartadas: number                       // inválidas o sin mejora real
}

interface Resumen { conflictos: number; horaExtra: number; cierre: number }
function resumen(m: MetricasJornada): Resumen {
  return {
    conflictos: m.conflictos,
    horaExtra: m.cargaPorEmpleado.reduce((a, c) => a + c.minutosFueraTurno, 0),
    cierre: m.cierreJornada ?? Number.POSITIVE_INFINITY,
  }
}
const mejorOIgual = (a: Resumen, b: Resumen) =>
  a.conflictos <= b.conflictos && a.horaExtra <= b.horaExtra && a.cierre <= b.cierre
const estrictamenteMejor = (a: Resumen, b: Resumen) =>
  mejorOIgual(a, b) && (a.conflictos < b.conflictos || a.horaExtra < b.horaExtra || a.cierre < b.cierre)
const algunaMejora = (a: Resumen, b: Resumen) =>
  a.conflictos < b.conflictos || a.horaExtra < b.horaExtra || a.cierre < b.cierre

function nuevoConflicto(base: ResultadoScheduler, prop: ResultadoScheduler): boolean {
  const claves = new Set(base.conflictos.filter(c => !c.cascada).map(c => c.key))
  return prop.conflictos.filter(c => !c.cascada).some(c => !claves.has(c.key))
}

export async function repasarPlan(
  prep: GeneracionPreparada,
  baseOverrides: SchedulerOverrides,
): Promise<ResultadoRepaso> {
  const { ctx, resultado } = prep
  const metricasBase = calcularMetricasJornada(resultado, ctx.empleados)
  const rBase = resumen(metricasBase)

  const data = await invocarIA<RepasarPlanData>('repasar_plan', construirPayloadRepaso(ctx, resultado, metricasBase))

  let descartadas = 0
  const beneficiosas: PropuestaSimulada[] = []
  for (const p of data.propuestas ?? []) {
    const v = validarOverrides(p.overrideDelta, ctx)
    if (!v.ok) { descartadas++; continue }
    const fus = fusionarOverrides(baseOverrides, v.overrides)
    const res = generarCronograma(ctx, fus)
    const met = calcularMetricasJornada(res, ctx.empleados)
    const rProp = resumen(met)
    // Útil = mejora alguna métrica y no agrega un conflicto nuevo. Si no, se descarta.
    if (!algunaMejora(rProp, rBase) || nuevoConflicto(resultado, res)) { descartadas++; continue }
    beneficiosas.push({
      titulo: p.titulo, justificacion: p.justificacion,
      overrideDelta: v.overrides, resultado: res, metricas: met,
      diff: diffInstancias(resultado, res),
    })
  }

  // Ordenar por mejora (menos conflictos, menos hora extra, cierre más temprano).
  beneficiosas.sort((a, b) => {
    const ra = resumen(a.metricas), rb = resumen(b.metricas)
    return ra.conflictos - rb.conflictos || ra.horaExtra - rb.horaExtra || ra.cierre - rb.cierre
  })

  // "Clara" = domina al base (sin empeorar nada) y es mejor-o-igual que TODAS las
  // demás beneficiosas (campeón único, sin competidoras parejas).
  const dominantes = beneficiosas.filter(p => estrictamenteMejor(resumen(p.metricas), rBase))
  let autoAplicable: PropuestaSimulada | null = null
  if (dominantes.length >= 1) {
    const champ = dominantes[0]
    const rChamp = resumen(champ.metricas)
    const esCampeonUnico = beneficiosas.every(o => o === champ || mejorOIgual(rChamp, resumen(o.metricas)))
    const hayOtroDominanteParejo = dominantes.some(o => o !== champ && estrictamenteMejor(resumen(o.metricas), rBase)
      && !estrictamenteMejor(rChamp, resumen(o.metricas)))
    if (esCampeonUnico && !hayOtroDominanteParejo) autoAplicable = champ
  }

  const opciones = autoAplicable ? beneficiosas.filter(p => p !== autoAplicable) : beneficiosas
  return { diagnostico: data.diagnostico ?? [], autoAplicable, opciones, descartadas }
}

// ============ Explicar conflicto ============
export async function explicarConflicto(
  inst: InstanciaEtapa,
  soluciones: SolucionConflicto[],
): Promise<ExplicarConflictoData> {
  return invocarIA<ExplicarConflictoData>('explicar_conflicto', {
    conflicto: {
      plantillaNombre: inst.plantillaNombre,
      etapaNombre: inst.etapa.nombre,
      lote: inst.lote,
      motivo: inst.conflicto?.motivo ?? '',
      mensaje: inst.conflicto?.mensaje ?? '',
      culpables: inst.conflicto?.culpables ?? [],
      decisionesScheduler: inst.conflicto?.decisionesScheduler,
    },
    soluciones: soluciones.map(s => ({
      id: s.id, grupo: s.grupo, descripcion: s.descripcion, recomendada: s.recomendada,
      conflictosRestantes: s.metricas.conflictos, costoExtraMin: s.costoExtraMin, dejaProductoFuera: s.dejaProductoFuera,
    })),
  })
}

// ============ Helpers ============
function hhmm(min: number | null): string {
  if (min == null) return '—'
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function diffInstancias(base: ResultadoScheduler, nuevo: ResultadoScheduler): string[] {
  const byKey = new Map(base.instancias.map(i => [i.key, i]))
  const out: string[] = []
  for (const n of nuevo.instancias) {
    const b = byKey.get(n.key)
    if (!b) continue
    const et = `${n.plantillaNombre} · ${n.etapa.nombre} (lote ${n.lote})`
    if (b.estado === 'conflicto' && n.estado === 'colocada') out.push(`✓ ${et} ahora se ubica`)
    else if (b.estado === 'colocada' && n.estado === 'conflicto') out.push(`⛔ ${et} ya no se puede ubicar`)
    else if (b.estado === 'colocada' && n.estado === 'colocada') {
      if (b.inicioAbs !== n.inicioAbs) out.push(`⏱ ${et} ${hhmm(b.inicioAbs)} → ${hhmm(n.inicioAbs)}`)
      const eb = b.asignaciones[0]?.empleadoNombre, en = n.asignaciones[0]?.empleadoNombre
      if (eb && en && eb !== en) out.push(`👤 ${et}: ${eb} → ${en}`)
    }
  }
  return out
}

const TOPE_INSTANCIAS = 80   // acotar payload en planes muy grandes

function construirPayloadRepaso(ctx: ContextoScheduler, resultado: ResultadoScheduler, metricas: MetricasJornada) {
  return {
    dia: ctx.dia,
    metricas: {
      cierreJornada: metricas.cierreJornada,
      conflictos: metricas.conflictos,
      cargaPorEmpleado: metricas.cargaPorEmpleado.map(c => ({
        nombre: c.nombre, minutos: c.minutos, minutosFueraTurno: c.minutosFueraTurno,
      })),
    },
    resumenInstancias: resultado.instancias.slice(0, TOPE_INSTANCIAS).map(i => ({
      plantillaNombre: i.plantillaNombre,
      etapaNombre: i.etapa.nombre,
      lote: i.lote,
      inicioAbs: i.inicioAbs,
      finAbs: i.finAbs,
      empleados: i.asignaciones.map(a => a.empleadoNombre),
      maquinas: i.recursosAbs.map(r => r.maquinaNombre),
      estado: i.estado,
    })),
    conflictos: resultado.conflictos.filter(c => !c.cascada).map(c => ({
      plantillaNombre: c.plantillaNombre,
      etapaNombre: c.etapa.nombre,
      lote: c.lote,
      motivo: c.conflicto?.motivo ?? '',
      mensaje: c.conflicto?.mensaje ?? '',
      culpables: c.conflicto?.culpables ?? [],
    })),
    catalogos: {
      empleados: ctx.empleados.map(e => ({ id: e.id, nombre: e.nombre_completo })),
      plantillas: ctx.plantillasConEtapas.map(p => ({
        id: p.id, nombre: p.nombre,
        etapas: (p.etapas ?? []).map(e => ({ orden: e.orden, nombre: e.nombre })),
      })),
    },
  }
}
