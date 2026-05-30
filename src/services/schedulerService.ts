import { PlantillaProceso, PlantillaEtapa, Maquina } from '../types/planificacion'
import {
  ContextoScheduler, ResultadoScheduler, InstanciaEtapa, FranjaDisponibilidad,
  EmpleadoScheduler, IntervaloAbs, AsignacionEtapa, RecursoAbs, OcupacionMaquina,
  OcupacionEmpleado, SchedulerOverrides, MotivoConflicto, MetricasJornada, SolucionConflicto
} from '../types/scheduler'
import { recursosDeEtapa, slotsDeEtapa } from './etapaHelpers'
import { timeToMin, minToTime, formatDuration, generarId } from '../components/Cronograma/cronogramaHelpers'
import { cronogramaService } from './cronogramaService'
import { cronogramaHistorialService } from './cronogramaHistorialService'
import { planificacionService } from './planificacionService'
import { configuracionService } from './configuracionService'
import { calcularCambiosSolape } from '../components/Cronograma/solapeHelpers'
import { RecursoProgramadoCronograma } from '../types/cronograma'

const DIA_FIN = 1440  // minuto tope del día

// ============ Estructuras de ocupación (mutables durante la colocación) ============

interface ReservaMaquina { intervalo: IntervaloAbs; uso: number; etiqueta?: string; plantillaId?: string }
interface ReservaEmpleado { intervalo: IntervaloAbs; etiqueta?: string; plantillaId?: string; permiteSolape: boolean; exclusiva: boolean }

class CalendarioOcupacion {
  private maquinas = new Map<string, ReservaMaquina[]>()
  private empleados = new Map<string, ReservaEmpleado[]>()

  constructor(maqInit: OcupacionMaquina[], empInit: OcupacionEmpleado[]) {
    for (const o of maqInit) this.reservarMaquina(o.maquinaId, o.intervalo, o.uso, o.etiqueta, o.plantillaId)
    for (const o of empInit) this.reservarEmpleado(o.empleadoId, o.intervalo, o.etiqueta, o.plantillaId, o.permiteSolape ?? false, o.exclusiva ?? false)
  }

  private solapan<T extends { intervalo: IntervaloAbs }>(arr: T[], ivs: IntervaloAbs[]): T[] {
    return arr.filter(o => ivs.some(iv => o.intervalo.inicio < iv.fin && o.intervalo.fin > iv.inicio))
  }

  // Etiquetas de las tareas que ocupan a un empleado dentro de los intervalos dados.
  competidoresEmpleado(empId: string, ivs: IntervaloAbs[]): string[] {
    return [...new Set(this.solapan(this.empleados.get(empId) || [], ivs).map(o => o.etiqueta).filter((e): e is string => !!e))]
  }

  // Plantillas culpables que ocupan a un empleado / máquina (para soluciones sobre el culpable).
  plantillasEmpleado(empId: string, ivs: IntervaloAbs[]): string[] {
    return [...new Set(this.solapan(this.empleados.get(empId) || [], ivs).map(o => o.plantillaId).filter((p): p is string => !!p))]
  }

  plantillasMaquina(maquinaId: string, ivs: IntervaloAbs[]): string[] {
    return [...new Set(this.solapan(this.maquinas.get(maquinaId) || [], ivs).map(o => o.plantillaId).filter((p): p is string => !!p))]
  }

  // Cuántos minutos tienen ocupado a un empleado las plantillas dadas (p.ej. la crema que hace
  // Sebastián). Sirve para traerlo SOLO ese tiempo antes del tope de la otra etapa.
  spanOcupacionPlantillasEnEmpleado(plantillaIds: string[], empId: string): number {
    const set = new Set(plantillaIds)
    const arr = (this.empleados.get(empId) || []).filter(o => o.plantillaId && set.has(o.plantillaId))
    if (arr.length === 0) return 0
    const inicio = Math.min(...arr.map(o => o.intervalo.inicio))
    const fin = Math.max(...arr.map(o => o.intervalo.fin))
    return fin - inicio
  }

  // Etiquetas de las reservas que se solapan con un intervalo en una máquina (para explicar conflictos).
  competidoresMaquina(maquinaId: string, iv: IntervaloAbs): string[] {
    const reservas = this.maquinas.get(maquinaId) || []
    const etiquetas = reservas
      .filter(r => r.intervalo.inicio < iv.fin && r.intervalo.fin > iv.inicio && r.etiqueta)
      .map(r => r.etiqueta!)
    return [...new Set(etiquetas)]
  }

  // Máximo uso concurrente de una máquina dentro de un intervalo (para capacidad parcial).
  maxUsoMaquina(maquinaId: string, iv: IntervaloAbs): number {
    const reservas = this.maquinas.get(maquinaId) || []
    const solapadas = reservas.filter(r => r.intervalo.inicio < iv.fin && r.intervalo.fin > iv.inicio)
    if (solapadas.length === 0) return 0
    // Barrido de puntos de inicio para hallar el pico de uso simultáneo.
    const puntos = [iv.inicio, ...solapadas.map(r => Math.max(r.intervalo.inicio, iv.inicio))]
    let pico = 0
    for (const t of puntos) {
      const suma = solapadas
        .filter(r => r.intervalo.inicio <= t && r.intervalo.fin > t)
        .reduce((acc, r) => acc + r.uso, 0)
      if (suma > pico) pico = suma
    }
    return pico
  }

  // ¿El empleado puede tomar una reserva nueva en estos intervalos? Dos reservas pueden
  // COEXISTIR (solaparse) solo si ambas permiten solape y ninguna es de atención exclusiva.
  empleadoLibre(empId: string, ivs: IntervaloAbs[], permiteSolapeNuevo: boolean, exclusivaNueva: boolean): boolean {
    const ocup = this.empleados.get(empId) || []
    return ivs.every(iv =>
      !ocup.some(o => {
        if (o.intervalo.inicio >= iv.fin || o.intervalo.fin <= iv.inicio) return false  // no se solapan
        const puedenCoexistir = permiteSolapeNuevo && o.permiteSolape && !exclusivaNueva && !o.exclusiva
        return !puedenCoexistir  // si no pueden coexistir, está ocupado
      })
    )
  }

  reservarMaquina(maquinaId: string, iv: IntervaloAbs, uso: number, etiqueta?: string, plantillaId?: string) {
    const arr = this.maquinas.get(maquinaId) || []
    arr.push({ intervalo: iv, uso, etiqueta, plantillaId })
    this.maquinas.set(maquinaId, arr)
  }

  reservarEmpleado(empId: string, iv: IntervaloAbs, etiqueta: string | undefined, plantillaId: string | undefined, permiteSolape: boolean, exclusiva: boolean) {
    const arr = this.empleados.get(empId) || []
    arr.push({ intervalo: iv, etiqueta, plantillaId, permiteSolape, exclusiva })
    this.empleados.set(empId, arr)
  }

  // Copia profunda, para probar la colocación de un proceso sin tocar el calendario real.
  clonar(): CalendarioOcupacion {
    const c = new CalendarioOcupacion([], [])
    for (const [k, arr] of this.maquinas) c.maquinas.set(k, arr.map(r => ({ ...r, intervalo: { ...r.intervalo } })))
    for (const [k, arr] of this.empleados) c.empleados.set(k, arr.map(r => ({ ...r, intervalo: { ...r.intervalo } })))
    return c
  }

  // Momentos en que se libera algún recurso (para atrasar un proceso a horarios "candidatos").
  tiemposLiberacion(): number[] {
    const s = new Set<number>()
    for (const arr of this.maquinas.values()) for (const r of arr) s.add(r.intervalo.fin)
    for (const arr of this.empleados.values()) for (const r of arr) s.add(r.intervalo.fin)
    return [...s].sort((a, b) => a - b)
  }
}

// ============ Helpers ============

function timeOrNull(t: string | null | undefined): number | null {
  return t ? timeToMin(t) : null
}

function ventanaEnUnaFranja(emp: EmpleadoScheduler, iv: IntervaloAbs): boolean {
  return emp.franjas.some(f => f.desde <= iv.inicio && f.hasta >= iv.fin)
}

function franjaExtraDe(emp: EmpleadoScheduler, iv: IntervaloAbs): boolean {
  const f = emp.franjas.find(fr => fr.desde <= iv.inicio && fr.hasta >= iv.fin)
  return f?.origen === 'extra'
}

// Por defecto, modo estricto: cada recurso usa EXACTAMENTE la máquina asignada. Si la etapa habilita
// sustitución (resolución asistida), puede usar cualquier máquina ACTIVA de su mismo grupo, ordenadas
// por prioridad_grupo (se prueba la preferida del grupo primero).
function maquinasCandidatas(maquinaId: string, maquinas: Maquina[], permitirSustitucion = false): Maquina[] {
  const m = maquinas.find(x => x.id === maquinaId)
  if (!m) return []
  if (!permitirSustitucion || !m.grupo_id) return [m]
  const grupo = maquinas.filter(x => x.id !== m.id && x.activa && x.grupo_id === m.grupo_id)
  return [m, ...grupo].sort((a, b) => a.prioridad_grupo - b.prioridad_grupo)
}

// Una etapa es "preparable con antelación" (se puede adelantar a cualquier hueco libre del día):
// no tiene dependencias ni prerequisitos propios, tiene al menos una etapa que la consume, y ninguna
// de las que la usan como DEPENDENCIA exige arrancar enseguida (margen_espera_max acotado). Si solo
// la usan como prerequisito, el acoplamiento es flojo y también se adelanta. Así se adelantan las
// preparaciones (ingredientes, margarina, empaste) pero NO cosas como "calentar horno", cuya cocción
// arranca inmediatamente después (margen acotado), ni "pasar masas", que va pegada a la cortada.
function esFloatable(etapa: PlantillaEtapa, plantilla: PlantillaProceso): boolean {
  if ((etapa.dependencias?.length ?? 0) > 0) return false
  if ((etapa.prerequisitos?.length ?? 0) > 0) return false
  let tieneConsumidor = false
  for (const c of plantilla.etapas ?? []) {
    const esDep = (c.dependencias ?? []).includes(etapa.id)
    const esPre = (c.prerequisitos ?? []).includes(etapa.id)
    if (esDep || esPre) tieneConsumidor = true
    if (esDep && c.margen_espera_max != null) return false  // acoplamiento estricto → no se adelanta
  }
  return tieneConsumidor
}

// ============ Generador ============

// Empleado preferido a nivel proceso (resuelto). null = el proceso no impone preferido.
type PreferenciaProceso = { empleadoId: string; puedeReemplazarse: boolean } | null

// Resuelve el preferido del proceso para el día: override del plan_dia (heredar/fijar/ninguno) sobre el
// preferido de la plantilla. El flag "puede reemplazarse" siempre viene de la plantilla.
function resolverPreferenciaProceso(
  item: { empleadoPreferidoModo?: string | null; empleadoPreferidoOverride?: string | null },
  plantilla: PlantillaProceso
): PreferenciaProceso {
  const modo = item.empleadoPreferidoModo ?? 'heredar'
  let empleadoId: string | null
  if (modo === 'ninguno') empleadoId = null
  else if (modo === 'fijar') empleadoId = item.empleadoPreferidoOverride ?? null
  else empleadoId = plantilla.empleado_preferido_id ?? null
  return empleadoId ? { empleadoId, puedeReemplazarse: plantilla.puede_reemplazarse ?? true } : null
}

export function generarCronograma(ctx: ContextoScheduler, overrides: SchedulerOverrides = {}): ResultadoScheduler {
  let cal = new CalendarioOcupacion(ctx.ocupacionMaquinasInicial, ctx.ocupacionEmpleadosInicial)

  // Empleados con franjas extra inyectadas por overrides (resolución asistida)
  const empleados: EmpleadoScheduler[] = ctx.empleados.map(e => {
    const extra = overrides.franjasExtra?.[e.id] || []
    return extra.length > 0
      ? { ...e, franjas: [...e.franjas, ...extra].sort((a, b) => a.desde - b.desde) }
      : e
  })
  const empById = new Map(empleados.map(e => [e.id, e]))

  const plantById = new Map(ctx.plantillasConEtapas.map(p => [p.id, p]))

  // 1) Construir "procesos" = (plantilla, lote) según plan_dia
  interface Proceso {
    plantilla: PlantillaProceso
    lote: number
    prioridad: number   // del item de plan
    edf: number         // deadline efectivo (menor hora_fin_max entre etapas), SENTINEL si ninguna
    topeInicioEf: number // tope de inicio efectivo (menor entre override/plantilla/etapas inicio), SENTINEL si ninguno
    inicioMinEf: number  // piso de inicio efectivo (override ?? plantilla ?? 0)
    inicioMinOverride: number | null
    inicioMaxOverride: number | null
    finMaxOverride: number | null
    preferenciaProceso: PreferenciaProceso
  }
  const SENTINEL = 100000 // valor finito grande para evitar Infinity-Infinity=NaN al ordenar
  const procesos: Proceso[] = []
  for (const item of ctx.planDia) {
    if (overrides.excluirPlantillas?.includes(item.plantillaId)) continue
    const plantilla = plantById.get(item.plantillaId)
    if (!plantilla || !plantilla.etapas || plantilla.etapas.length === 0) continue
    const prioridad = overrides.prioridadPlantilla?.[item.plantillaId] ?? item.prioridad
    const inicioMinOverride = item.inicioMinOverride ?? null
    const inicioMaxOverride = item.inicioMaxOverride ?? null
    const finMaxOverride = item.finMaxOverride ?? null
    const preferenciaProceso = resolverPreferenciaProceso(item, plantilla)
    const finMaxEfectivo = finMaxOverride ?? timeOrNull(plantilla.hora_fin_max)
    const edf = Math.min(
      SENTINEL,
      ...plantilla.etapas.map(e => e.hora_fin_max ?? SENTINEL),
      finMaxEfectivo ?? SENTINEL
    )
    // Tope de inicio efectivo: el menor entre el override, el de plantilla y los topes de etapa.
    // Un proceso con tope temprano (ej. cocción 04:35) DEBE empezar antes → se coloca primero.
    const topeInicioEf = Math.min(
      SENTINEL,
      inicioMaxOverride ?? timeOrNull(plantilla.hora_inicio_max) ?? SENTINEL,
      ...plantilla.etapas.map(e => e.hora_inicio_max ?? SENTINEL)
    )
    // Piso de inicio efectivo: el "Desde…"; un proceso flexible (Desde tardío) se deja para después.
    const inicioMinEf = inicioMinOverride ?? timeOrNull(plantilla.hora_inicio_min) ?? 0
    for (let lote = 1; lote <= item.cantidadLotes; lote++) {
      procesos.push({ plantilla, lote, prioridad, edf, topeInicioEf, inicioMinEf, inicioMinOverride, inicioMaxOverride, finMaxOverride, preferenciaProceso })
    }
  }

  // 2) Orden: prioridad desc; luego el MÁS RESTRINGIDO primero (tope de inicio temprano),
  //    luego EDF asc, luego el que puede empezar antes (Desde temprano), estable por (nombre, lote).
  procesos.sort((a, b) =>
    b.prioridad - a.prioridad ||
    a.topeInicioEf - b.topeInicioEf ||
    a.edf - b.edf ||
    a.inicioMinEf - b.inicioMinEf ||
    a.plantilla.nombre.localeCompare(b.plantilla.nombre) ||
    a.lote - b.lote
  )

  const instancias: InstanciaEtapa[] = []

  // 3) Colocar cada proceso COMO UNIDAD: se busca un horario de inicio donde toda la cadena
  //    entre; si entra, se commitea entero; si no, se reporta un conflicto raíz (no se rompe a la mitad).
  for (const proc of procesos) {
    const res = colocarProceso(
      proc.plantilla, proc.lote, empleados, empById, ctx.maquinas, cal, overrides, ctx.diaInicio,
      { inicioMin: proc.inicioMinOverride, inicioMax: proc.inicioMaxOverride, finMax: proc.finMaxOverride },
      proc.preferenciaProceso,
      instancias,   // pasamos lo ya colocado para que respete vínculos secuenciaProcesos
      plantById
    )
    instancias.push(...res.instancias)
    cal = res.cal
  }

  // === G6: post-validación bidireccional del vínculo secuenciaProcesos ===
  // Si B quedó en conflicto culpando a A, marcamos también las instancias de A como conflicto
  // (la secuencia exige que ambas estén bien). No liberamos reservas del calendario —
  // el calendario ya no se usa después de generarCronograma y otros procesos podrían depender
  // de esas reservas.
  for (const v of (overrides.secuenciaProcesos ?? [])) {
    const instsB = instancias.filter(i => i.plantillaId === v.despuesPlantillaId)
    const bFallaPorA = instsB.some(i =>
      i.estado === 'conflicto' &&
      !i.cascada &&
      (i.conflicto?.culpablesPlantillaIds ?? []).includes(v.antesPlantillaId)
    )
    if (!bFallaPorA) continue
    const nombreB = plantById.get(v.despuesPlantillaId)?.nombre ?? 'el otro proceso'
    for (const inst of instancias) {
      if (inst.plantillaId !== v.antesPlantillaId) continue
      if (inst.estado === 'conflicto') continue   // ya está mal por otro motivo, no pisar el mensaje original
      inst.estado = 'conflicto'
      inst.inicioAbs = null
      inst.finAbs = null
      inst.asignaciones = []
      inst.recursosAbs = []
      inst.conflicto = {
        motivo: 'dependencia',
        mensaje: `Termina muy tarde para que "${nombreB}" pueda empezar a tiempo. La secuencia activa exige terminar antes.`,
        culpables: [],
        culpablesPlantillaIds: [v.despuesPlantillaId]
      }
    }
  }

  const conflictos = instancias.filter(i => i.estado === 'conflicto')
  const cierreJornada = instancias.reduce<number | null>(
    (max, i) => i.finAbs != null ? Math.max(max ?? 0, i.finAbs) : max, null
  )

  return { instancias, conflictos, cierreJornada }
}

interface OverrideDia { inicioMin: number | null; inicioMax: number | null; finMax: number | null }

// Coloca un PROCESO completo (todas sus etapas) como unidad. Busca el menor "piso" de inicio
// (desde diaInicio, probando los momentos en que se liberan recursos) donde la cadena entera entra,
// y commitea ese intento al calendario. Si nunca entra completo, devuelve el mejor intento con un
// conflicto raíz y las demás etapas marcadas como cascada (no se ubica nada del proceso).
function colocarProceso(
  plantilla: PlantillaProceso,
  lote: number,
  empleados: EmpleadoScheduler[],
  empById: Map<string, EmpleadoScheduler>,
  maquinas: Maquina[],
  cal: CalendarioOcupacion,
  overrides: SchedulerOverrides,
  diaInicio: number,
  overrideDia: OverrideDia,
  preferenciaProceso: PreferenciaProceso,
  instanciasPrevias: InstanciaEtapa[] = [],
  plantById?: Map<string, PlantillaProceso>
): { instancias: InstanciaEtapa[]; cal: CalendarioOcupacion } {
  const etapas = [...plantilla.etapas!].sort((a, b) => a.orden - b.orden)

  // === Override secuenciaProcesos: este proceso debe esperar a que termine "antes" ===
  // Si A no se pudo colocar (alguna instancia en conflicto), B queda bloqueado con motivo claro.
  let secuenciaPiso = 0
  let secuenciaRazon = ''
  let secuenciaCulpableId: string | null = null
  let secuenciaBloqueada = false
  const vinculos = (overrides.secuenciaProcesos ?? []).filter(v => v.despuesPlantillaId === plantilla.id)
  for (const v of vinculos) {
    const instsAntes = instanciasPrevias.filter(i => i.plantillaId === v.antesPlantillaId)
    if (instsAntes.length === 0) continue   // antes no está en el plan (o no se intentó aún), ignorar
    const nombreAntes = plantById?.get(v.antesPlantillaId)?.nombre ?? instsAntes[0].plantillaNombre
    const algunaEnConflicto = instsAntes.some(i => i.estado !== 'colocada' || i.finAbs == null)
    if (algunaEnConflicto) {
      secuenciaBloqueada = true
      secuenciaCulpableId = v.antesPlantillaId
      secuenciaRazon = `depende de "${nombreAntes}" que no se pudo ubicar`
      break
    }
    const fin = Math.max(...instsAntes.map(i => i.finAbs!))
    if (fin > secuenciaPiso) {
      secuenciaPiso = fin
      secuenciaCulpableId = v.antesPlantillaId
      secuenciaRazon = `debe esperar a que termine "${nombreAntes}" (${minLabel(fin)})`
    }
  }

  // Etapas que pueden adelantarse: se ubican desde el inicio del día (no desde el piso del proceso),
  // así caen en el primer hueco libre aunque el resto de la cadena arranque más tarde.
  const floatableIds = new Set(etapas.filter(e => esFloatable(e, plantilla)).map(e => e.id))

  const nuevaInst = (etapa: PlantillaEtapa): InstanciaEtapa => ({
    key: `${plantilla.id}:${lote}:${etapa.orden}`,
    plantillaId: plantilla.id,
    plantillaNombre: plantilla.nombre,
    lote,
    etapa,
    inicioAbs: null,
    finAbs: null,
    asignaciones: [],
    recursosAbs: [],
    estado: 'conflicto'
  })

  // Info de secuencia para pasar a colocarEtapa (solo se aplica en etapas que arrancan el proceso).
  const secuenciaInfo = secuenciaPiso > 0
    ? { piso: secuenciaPiso, razon: secuenciaRazon, culpableId: secuenciaCulpableId }
    : null

  // Si la secuencia está bloqueada (antes no se pudo colocar), no tiene sentido probar pisos.
  // Generar conflicto raíz directo, sin commitear nada.
  if (secuenciaBloqueada) {
    const insts: InstanciaEtapa[] = []
    for (const etapa of etapas) {
      const inst = nuevaInst(etapa)
      if (etapas[0].id === etapa.id) {
        inst.conflicto = {
          motivo: 'dependencia',
          mensaje: `No se puede ubicar porque ${secuenciaRazon}.`,
          culpables: [],
          culpablesPlantillaIds: secuenciaCulpableId ? [secuenciaCulpableId] : []
        }
      } else {
        inst.cascada = true
        inst.conflicto = { motivo: 'dependencia', mensaje: 'El proceso no se pudo ubicar completo.', culpables: [] }
      }
      insts.push(inst)
    }
    return { instancias: insts, cal }
  }

  // Prueba colocar toda la cadena con un piso dado, contra un clon del calendario.
  const intentar = (piso: number) => {
    const calAttempt = cal.clonar()
    const colocadasPorId = new Map<string, InstanciaEtapa>()
    const insts: InstanciaEtapa[] = []
    let colocadas = 0
    let ok = true
    for (const etapa of etapas) {
      const inst = nuevaInst(etapa)
      // Las etapas preparables arrancan su búsqueda desde el inicio del día; el resto, desde el piso.
      const floor = floatableIds.has(etapa.id) ? diaInicio : piso
      const c = colocarEtapa(inst, plantilla, etapa, colocadasPorId, empleados, empById, maquinas, calAttempt, overrides, lote, floor, overrideDia, preferenciaProceso, secuenciaInfo)
      insts.push(inst)
      if (c) { colocadasPorId.set(etapa.id, inst); colocadas++ }
      else ok = false
    }
    return { insts, cal: calAttempt, ok, colocadas }
  }

  // Offset (en min) de cada etapa respecto al arranque del proceso, siguiendo solo las dependencias
  // encadenadas (cada una va inmediatamente después de la anterior). El offset de una etapa es el
  // camino de duraciones más largo de dependencias que la preceden.
  const etapaPorId = new Map(etapas.map(e => [e.id, e]))
  const offsetCache = new Map<string, number>()
  const offsetDe = (e: PlantillaEtapa): number => {
    const cached = offsetCache.get(e.id)
    if (cached != null) return cached
    let off = 0
    for (const depId of e.dependencias ?? []) {
      const dep = etapaPorId.get(depId)
      if (dep) off = Math.max(off, offsetDe(dep) + dep.duracion_proceso)
    }
    offsetCache.set(e.id, off)
    return off
  }

  // Candidatos de piso: el arranque del día, los momentos en que se libera algún recurso, y —para
  // cada liberación T— ese momento menos el offset de cada etapa. Esto último permite arrancar el
  // proceso un poco antes para que la etapa interna que necesita ese recurso caiga JUSTO cuando se
  // libera (si no, el proceso saltaría directo al instante de liberación y arrancaría más tarde de
  // lo necesario, corriendo toda la cadena).
  const liberaciones = cal.tiemposLiberacion().filter(t => t > diaInicio && t < DIA_FIN)
  const candidatos = new Set<number>([diaInicio, ...liberaciones])
  for (const t of liberaciones) {
    for (const e of etapas) {
      const p = t - offsetDe(e)
      if (p > diaInicio && p < DIA_FIN) candidatos.add(p)
    }
  }
  // Si hay secuencia, asegurarnos de probar exactamente ese piso (la primera etapa no podrá arrancar antes).
  if (secuenciaPiso > 0 && secuenciaPiso < DIA_FIN) candidatos.add(secuenciaPiso)
  const pisos = [...candidatos].sort((a, b) => a - b)

  let mejor: { insts: InstanciaEtapa[]; colocadas: number } | null = null
  for (const piso of pisos) {
    const r = intentar(piso)
    if (r.ok) return { instancias: r.insts, cal: r.cal }   // entra completo → commit
    if (!mejor || r.colocadas > mejor.colocadas) mejor = { insts: r.insts, colocadas: r.colocadas }
  }

  // No entró en ningún piso: el proceso NO se ubica. Marcar causa raíz + cascada, sin commitear.
  const insts = mejor!.insts
  const raiz = insts.find(i => i.estado === 'conflicto')
  let nCascada = 0
  for (const inst of insts) {
    if (inst === raiz) continue
    // todo lo demás del proceso queda sin ubicar (no se rompe a la mitad)
    inst.estado = 'conflicto'
    inst.cascada = true
    inst.inicioAbs = null
    inst.finAbs = null
    inst.asignaciones = []
    inst.recursosAbs = []
    if (!inst.conflicto) inst.conflicto = { motivo: 'dependencia', mensaje: 'El proceso no se pudo ubicar completo.', culpables: [] }
    nCascada++
  }
  if (raiz?.conflicto && nCascada > 0) {
    raiz.conflicto.mensaje += ` Y ${nCascada} etapa(s) más de este proceso quedan sin ubicar.`
  }
  return { instancias: insts, cal }
}

// Coloca una etapa; muta `inst` y reserva en el calendario. Devuelve true si colocó.
function colocarEtapa(
  inst: InstanciaEtapa,
  plantilla: PlantillaProceso,
  etapa: PlantillaEtapa,
  colocadasPorId: Map<string, InstanciaEtapa>,
  empleados: EmpleadoScheduler[],
  empById: Map<string, EmpleadoScheduler>,
  maquinas: Maquina[],
  cal: CalendarioOcupacion,
  overrides: SchedulerOverrides,
  lote: number,
  piso: number,
  overrideDia: { inicioMin: number | null; inicioMax: number | null; finMax: number | null },
  preferenciaProceso: PreferenciaProceso,
  // Info de vínculo "secuenciaProcesos": solo se aplica si esta etapa es la primera del proceso.
  secuenciaInfo: { piso: number; razon: string; culpableId: string | null } | null = null
): boolean {
  // #26 Override de duración para esta instancia (resolución manual). Si no hay, usa la duración de la etapa.
  const overrideDur = overrides.duracionFijada?.find(d =>
    d.plantillaId === plantilla.id && d.lote === lote && d.etapaOrden === etapa.orden)
  const dur = overrideDur?.duracionMin ?? etapa.duracion_proceso

  // Restricciones (override de relajación si aplica)
  const rel = overrides.relajarRestriccion?.[etapa.id] || overrides.relajarRestriccion?.[plantilla.id]
  const etapaInicioMin = rel?.hora_inicio_min ?? etapa.hora_inicio_min ?? null
  const etapaInicioMax = rel?.hora_inicio_max ?? etapa.hora_inicio_max ?? null
  const etapaFinMax = rel?.hora_fin_max ?? etapa.hora_fin_max ?? null
  // Override de horario del día (plan_dia) tiene prioridad sobre el de la plantilla.
  // "Desde" (hora_inicio_min) es un PISO: la etapa se puede ubicar de ahí en adelante (se mantiene).
  // "Tope de inicio" (hora_inicio_max) obliga a arrancar antes de X; la solución "empezar más tarde"
  // relaja SOLO el tope, nunca el piso.
  const sinTopeInicio = overrides.relajarTopeInicio?.includes(plantilla.id) ?? false
  const sinInicioPlan = overrides.relajarInicioPlan?.includes(plantilla.id) ?? false
  const plantInicioMin = sinInicioPlan ? null : (overrideDia.inicioMin ?? timeOrNull(plantilla.hora_inicio_min))
  const plantInicioMax = sinTopeInicio ? null : (overrideDia.inicioMax ?? timeOrNull(plantilla.hora_inicio_max))
  const plantFinMax = overrideDia.finMax ?? timeOrNull(plantilla.hora_fin_max)

  const nombreEtapaId = (id: string) => plantilla.etapas?.find(e => e.id === id)?.nombre ?? 'una etapa previa'

  // Dependencias (encadenadas) y prerequisitos (sueltos): deben estar colocadas y terminar antes.
  // El piso `earliest` usa el máximo de AMBOS (todas deben terminar antes), pero el margen de
  // espera (cap) se mide SOLO contra las dependencias encadenadas, no contra los prerequisitos.
  let depFinMax = 0
  let depFinNombre = ''
  let depEncadenadasFinMax = 0
  let depEncadenadasNombre = ''
  const deps = etapa.dependencias || []
  const requisitos = [...deps, ...(etapa.prerequisitos || [])]
  for (const reqId of requisitos) {
    const dep = colocadasPorId.get(reqId)
    if (!dep || dep.finAbs == null) {
      inst.conflicto = {
        motivo: 'dependencia',
        mensaje: `No se puede ubicar porque su etapa previa "${nombreEtapaId(reqId)}" quedó en conflicto. Resolvé esa etapa primero para que ésta pueda encadenarse.`,
        culpables: []
      }
      return false
    }
    if (dep.finAbs > depFinMax) { depFinMax = dep.finAbs; depFinNombre = nombreEtapaId(reqId) }
    if (deps.includes(reqId) && dep.finAbs > depEncadenadasFinMax) { depEncadenadasFinMax = dep.finAbs; depEncadenadasNombre = nombreEtapaId(reqId) }
  }

  // El "tope de inicio" del proceso (plantilla/override) solo limita a la etapa que
  // arranca el proceso (sin dependencias); las siguientes arrancan según sus dependencias.
  const esInicioProceso = (etapa.dependencias?.length ?? 0) === 0

  // Ventana de inicio permitida, registrando el motivo de cada borde para explicar conflictos.
  // #28 Llevamos un trace de decisiones para el botón "¿Por qué?".
  const decisiones: string[] = [`Etapa "${etapa.nombre}" de "${plantilla.nombre}" (lote ${lote}), duración ${formatDuration(dur)}.`]
  let earliest = piso
  let earliestReason = `no puede arrancar antes de las ${minLabel(piso)}`
  decisiones.push(`Piso inicial: ${minLabel(piso)} (${earliestReason}).`)
  const subirEarliest = (v: number | null, reason: string) => {
    if (v != null && v > earliest) {
      earliest = v; earliestReason = reason
      decisiones.push(`Subí piso a ${minLabel(v)}: ${reason}.`)
    }
  }
  if (depFinMax > 0) subirEarliest(depFinMax, `debe esperar a que termine "${depFinNombre}" (${minLabel(depFinMax)})`)
  subirEarliest(etapaInicioMin, `la etapa no puede empezar antes de las ${minLabel(etapaInicioMin ?? 0)}`)
  subirEarliest(plantInicioMin, `el proceso no puede empezar antes de las ${minLabel(plantInicioMin ?? 0)}`)
  // Vínculo "secuenciaProcesos": solo aplica a la primera etapa del proceso (la que arranca).
  if (esInicioProceso && secuenciaInfo && secuenciaInfo.piso > 0) {
    subirEarliest(secuenciaInfo.piso, secuenciaInfo.razon)
  }

  let latest = DIA_FIN - dur
  let latestReason = 'el fin del día'
  const bajarLatest = (v: number | null, reason: string) => {
    if (v != null && v < latest) {
      latest = v; latestReason = reason
      decisiones.push(`Bajé tope a ${minLabel(v)}: ${reason}.`)
    }
  }
  if (etapaInicioMax != null) bajarLatest(etapaInicioMax, `la etapa debe empezar a más tardar a las ${minLabel(etapaInicioMax)}`)
  if (esInicioProceso && plantInicioMax != null) bajarLatest(plantInicioMax, `el proceso debe empezar a más tardar a las ${minLabel(plantInicioMax)}`)
  if (etapaFinMax != null) bajarLatest(etapaFinMax - dur, `la etapa debe terminar a más tardar a las ${minLabel(etapaFinMax)}`)
  if (plantFinMax != null) bajarLatest(plantFinMax - dur, `el proceso debe terminar a más tardar a las ${minLabel(plantFinMax)}`)
  if (etapa.margen_espera_max != null && depEncadenadasFinMax > 0) bajarLatest(depEncadenadasFinMax + etapa.margen_espera_max, `solo puede esperar ${etapa.margen_espera_max} min después de "${depEncadenadasNombre}"`)

  // Si hay PIN de hora, la ventana legítima se ignora — la responsabilidad es del usuario.
  const pinHoraTmp = overrides.inicioFijado?.find(p => p.plantillaId === plantilla.id && p.lote === lote && p.etapaOrden === etapa.orden)
  if (earliest > latest && !pinHoraTmp) {
    // Si la subida del earliest vino del vínculo secuenciaProcesos, marcar al "antes" como culpable.
    const culpablesPlantillaIds: string[] = []
    if (esInicioProceso && secuenciaInfo?.culpableId && earliest === secuenciaInfo.piso) {
      culpablesPlantillaIds.push(secuenciaInfo.culpableId)
    }
    decisiones.push(`✗ Ventana imposible: earliest (${minLabel(earliest)}) > latest (${minLabel(latest)}). Conflicto.`)
    inst.conflicto = {
      motivo: 'ventana_horaria',
      mensaje: `Dura ${formatDuration(dur)} y no hay lugar en su ventana: puede empezar recién a las ${minLabel(earliest)} porque ${earliestReason}, pero ${latestReason}, así que tendría que empezar a más tardar a las ${minLabel(latest)}.`,
      culpables: [],
      culpablesPlantillaIds: culpablesPlantillaIds.length > 0 ? culpablesPlantillaIds : undefined,
      decisionesScheduler: [...decisiones]
    }
    return false
  }

  // PIN: asignación fijada por resolución asistida
  const pin = overrides.asignacionFijada?.find(p => p.plantillaId === plantilla.id && p.lote === lote && p.etapaOrden === etapa.orden)

  // PIN de HORA: el editor manual puede fijar la hora exacta de inicio. Si está, no se barre la
  // ventana — sólo se prueba ese minuto. Permite forzar una colocación fuera de [earliest, latest]
  // a riesgo del usuario.
  const pinHora = overrides.inicioFijado?.find(p => p.plantillaId === plantilla.id && p.lote === lote && p.etapaOrden === etapa.orden)

  // Solape de empleado: la etapa define si puede correr en paralelo / si es exclusiva (default de la plantilla).
  const permiteSolape = etapa.permite_solape ?? plantilla.permite_solape ?? false
  const exclusiva = etapa.atencion_exclusiva ?? plantilla.atencion_exclusiva ?? false

  // Sustitución de máquina habilitada por resolución asistida (puede usar otra del grupo).
  const permitirSustitucion = overrides.sustituirMaquina?.includes(etapa.id) ?? false

  // Barrido temporal: ubicar en el horario MÁS TEMPRANO posible (o probar solo el PIN de hora si
  // existe). En cada instante se prefiere al empleado preferido si está disponible; si no lo
  // está y la etapa permite reemplazo, lo hace cualquier otro disponible (NO se espera al
  // titular). Si puede_reemplazarse es false, solo el titular.
  let hit: { t: number; intento: ResultadoIntento } | null = null
  if (pinHora) {
    // Si hay PIN de hora, ese es el único instante a probar.
    const intento = intentarColocar(pinHora.inicioMin, etapa, empleados, empById, maquinas, cal, pin?.empleadoId, permiteSolape, exclusiva, permitirSustitucion, preferenciaProceso)
    if (intento.ok) hit = { t: pinHora.inicioMin, intento }
  } else {
    for (let t = earliest; t <= latest; t++) {
      const intento = intentarColocar(t, etapa, empleados, empById, maquinas, cal, pin?.empleadoId, permiteSolape, exclusiva, permitirSustitucion, preferenciaProceso)
      if (intento.ok) { hit = { t, intento }; break }
    }
  }
  if (hit) {
    // Commit (la etiqueta permite nombrar al "culpable" si otra etapa choca con ésta)
    const etiqueta = `${inst.plantillaNombre} · ${etapa.nombre} (lote ${lote})`
    inst.inicioAbs = hit.t
    inst.finAbs = hit.t + dur
    inst.recursosAbs = hit.intento.recursosAbs!
    inst.asignaciones = hit.intento.asignaciones!
    inst.estado = 'colocada'
    for (const r of inst.recursosAbs) cal.reservarMaquina(r.maquinaId, r.intervalo, r.uso, etiqueta, inst.plantillaId)
    for (const a of inst.asignaciones) for (const iv of a.ventanasAbs) cal.reservarEmpleado(a.empleadoId, iv, etiqueta, inst.plantillaId, permiteSolape, exclusiva)

    // #25 Ayudantes fijados (resolución manual): sumar empleados adicionales al principal SI están disponibles.
    // Cubren todo el rango [inicio, fin] de la etapa. Si alguno no está disponible, se ignora silenciosamente.
    const ayudantesOv = overrides.ayudantesFijados?.find(a =>
      a.plantillaId === plantilla.id && a.lote === lote && a.etapaOrden === etapa.orden)
    if (ayudantesOv) {
      const ventanaAyudante: IntervaloAbs = { inicio: hit.t, fin: hit.t + dur }
      for (const empId of ayudantesOv.empleadosIds) {
        if (inst.asignaciones.some(a => a.empleadoId === empId)) continue   // ya está como principal
        const emp = empById.get(empId)
        if (!emp) continue
        if (!ventanaEnUnaFranja(emp, ventanaAyudante)) continue
        if (!cal.empleadoLibre(empId, [ventanaAyudante], permiteSolape, exclusiva)) continue
        inst.asignaciones.push({
          slotId: `ayudante:${empId}`,
          rol: 'ayudante',
          empleadoId: empId,
          empleadoNombre: emp.nombre_completo,
          ventanasAbs: [ventanaAyudante],
          esReemplazo: false,
          enFranjaExtra: emp.franjas.some(f => f.origen === 'extra' && f.desde <= hit.t && f.hasta >= hit.t + dur)
        })
        cal.reservarEmpleado(empId, ventanaAyudante, etiqueta + ' · ayuda', inst.plantillaId, permiteSolape, exclusiva)
      }
    }
    return true
  }

  // No se pudo ubicar: capturar el motivo. Si hay PIN de hora, el fallo es exactamente en esa
  // hora; si no, escanear desde earliest para encontrar la primera causa.
  let primerFallo: ResultadoIntento | null = null
  if (pinHora) {
    primerFallo = intentarColocar(pinHora.inicioMin, etapa, empleados, empById, maquinas, cal, pin?.empleadoId, permiteSolape, exclusiva, permitirSustitucion, preferenciaProceso)
  } else {
    for (let t = earliest; t <= latest; t++) {
      const intento = intentarColocar(t, etapa, empleados, empById, maquinas, cal, pin?.empleadoId, permiteSolape, exclusiva, permitirSustitucion, preferenciaProceso)
      if (!intento.ok) { primerFallo = intento; break }
    }
  }

  const ventanaTxt = `${minLabel(earliest)}–${minLabel(latest + dur)}`
  const ventana: IntervaloAbs = { inicio: earliest, fin: latest + dur }
  if (primerFallo?.motivo === 'maquina_ocupada') {
    const culpables = primerFallo.culpables ?? []
    const usan = culpables.length > 0 ? ` La está usando: ${culpables.join('; ')}.` : ''
    // Plantillas culpables que ocupan las máquinas de esta etapa dentro de la ventana.
    const culpablesPlantillaIds = [...new Set(
      recursosDeEtapa(etapa).flatMap(r =>
        maquinasCandidatas(r.maquina_id, maquinas, permitirSustitucion).flatMap(m => cal.plantillasMaquina(m.id, [ventana]))
      )
    )].filter(id => id !== plantilla.id)
    decisiones.push(`✗ Máquina "${primerFallo.detalle}" ocupada en toda la ventana.`)
    inst.conflicto = {
      motivo: 'maquina_ocupada',
      mensaje: `La máquina "${primerFallo.detalle}" está ocupada durante toda la ventana posible de esta etapa (${ventanaTxt}), así que no hay momento libre para hacerla.${usan}`,
      culpables,
      culpablesPlantillaIds,
      decisionesScheduler: [...decisiones]
    }
  } else if (primerFallo?.motivo === 'empleado_no_disponible') {
    // Explicar qué ocupa a cada empleado preferido dentro de la ventana (nombrar al "culpable").
    const slots = slotsDeEtapa(etapa, preferenciaProceso)
    const habilTxt = slots.some(s => s.habilidad_id) ? ' con la habilidad requerida' : ''
    const detalles: string[] = []
    const culpables = new Set<string>()
    const culpablesPlantillaIds = new Set<string>()
    for (const s of slots) {
      if (!s.empleado_preferido_id) continue
      const emp = empById.get(s.empleado_preferido_id)
      if (!emp) continue
      const nombre = emp.nombre_completo.split(' ')[0]
      const ocupa = cal.competidoresEmpleado(emp.id, [ventana])
      ocupa.forEach(c => culpables.add(c))
      cal.plantillasEmpleado(emp.id, [ventana]).forEach(p => { if (p !== plantilla.id) culpablesPlantillaIds.add(p) })
      detalles.push(ocupa.length > 0 ? `${nombre} está ocupado con ${ocupa.join(', ')}` : `${nombre} está fuera de su turno en ese horario`)
    }
    const detalleTxt = detalles.length > 0 ? ` ${detalles.join('; ')}.` : ''
    // Para "traer empleado el tiempo justo": de los preferidos bloqueados, el que más tiempo
    // ocupa el proceso culpable (p.ej. cuánto tarda la crema que hace Sebastián). Así se lo trae
    // justo ese tiempo antes del tope, en vez de a las 03:00.
    let preferidoBloqueadoId: string | undefined
    let leadBloqueo = 0
    for (const s of slots) {
      if (!s.empleado_preferido_id) continue
      const span = cal.spanOcupacionPlantillasEnEmpleado([...culpablesPlantillaIds], s.empleado_preferido_id)
      if (span > leadBloqueo) { leadBloqueo = span; preferidoBloqueadoId = s.empleado_preferido_id }
    }
    decisiones.push(`✗ Empleado no disponible: ${detalleTxt.trim() || 'ninguno cumple los requisitos.'}`)
    inst.conflicto = {
      motivo: 'empleado_no_disponible',
      culpablesPlantillaIds: [...culpablesPlantillaIds],
      mensaje: `No hay ningún empleado${habilTxt} libre en toda la ventana posible de esta etapa (${ventanaTxt}).${detalleTxt}`,
      culpables: [...culpables],
      desdeColocacion: earliest,
      topeColocacion: latest,
      leadBloqueo: leadBloqueo > 0 ? leadBloqueo : undefined,
      preferidoBloqueadoId,
      decisionesScheduler: [...decisiones]
    }
  } else {
    decisiones.push(`✗ No se encontró ningún momento libre.`)
    inst.conflicto = {
      motivo: 'ventana_horaria',
      mensaje: `No se encontró ningún momento libre dentro de su ventana (${ventanaTxt}).`,
      culpables: [],
      decisionesScheduler: [...decisiones]
    }
  }
  return false
}

interface ResultadoIntento {
  ok: boolean
  inicioAbs?: number
  recursosAbs?: RecursoAbs[]
  asignaciones?: AsignacionEtapa[]
  motivo?: MotivoConflicto
  detalle?: string       // máquina o descripción del empleado faltante
  culpables?: string[]   // etiquetas de tareas que ocupan el recurso
}

// Intenta colocar la etapa en el instante t (sin mutar el calendario).
function intentarColocar(
  t: number,
  etapa: PlantillaEtapa,
  empleados: EmpleadoScheduler[],
  empById: Map<string, EmpleadoScheduler>,
  maquinas: Maquina[],
  cal: CalendarioOcupacion,
  pinEmpleadoId: string | undefined,
  permiteSolape: boolean,
  exclusiva: boolean,
  permitirSustitucion = false,
  preferenciaProceso: PreferenciaProceso = null
): ResultadoIntento {
  // 1) Máquinas. `usoLocal` descuenta lo ya comprometido por ESTA misma etapa, para no
  // mandar dos recursos de la etapa a la misma máquina física (sobre todo con grupos).
  const recursosAbs: RecursoAbs[] = []
  const usoLocal = new Map<string, number>()
  for (const r of recursosDeEtapa(etapa)) {
    const iv: IntervaloAbs = { inicio: t + r.desde, fin: t + r.hasta }
    const candidatas = maquinasCandidatas(r.maquina_id, maquinas, permitirSustitucion)
    const elegida = candidatas.find(m => cal.maxUsoMaquina(m.id, iv) + (usoLocal.get(m.id) ?? 0) + r.uso_recurso <= m.cantidad + 1e-9)
    if (!elegida) {
      const maqNombre = maquinas.find(m => m.id === r.maquina_id)?.nombre ?? 'la máquina requerida'
      const culpables = [...new Set(candidatas.flatMap(m => cal.competidoresMaquina(m.id, iv)))]
      return { ok: false, motivo: 'maquina_ocupada', detalle: maqNombre, culpables }
    }
    usoLocal.set(elegida.id, (usoLocal.get(elegida.id) ?? 0) + r.uso_recurso)
    recursosAbs.push({ maquinaId: elegida.id, maquinaNombre: elegida.nombre, uso: r.uso_recurso, intervalo: iv })
  }

  // 2) Empleados (slots), con reemplazo por habilidad
  const asignaciones: AsignacionEtapa[] = []
  const usadosEnEtapa = new Set<string>()
  for (const slot of slotsDeEtapa(etapa, preferenciaProceso)) {
    if (slot.ventanas.length === 0) continue  // slot sin presencia de empleado
    const ivs: IntervaloAbs[] = slot.ventanas.map(v => ({ inicio: t + v.desde, fin: t + v.hasta }))

    const factible = (emp: EmpleadoScheduler): boolean => {
      if (usadosEnEtapa.has(emp.id)) return false
      if (slot.habilidad_id && !emp.habilidades.has(slot.habilidad_id)) return false
      if (!ivs.every(iv => ventanaEnUnaFranja(emp, iv))) return false
      return cal.empleadoLibre(emp.id, ivs, permiteSolape, exclusiva)
    }

    let elegido: EmpleadoScheduler | undefined
    const preferidoId = pinEmpleadoId || slot.empleado_preferido_id
    if (preferidoId) {
      const pref = empById.get(preferidoId)
      if (pref && factible(pref)) {
        elegido = pref
      } else if (!pinEmpleadoId && (slot.puede_reemplazarse ?? true)) {
        elegido = empleados.filter(factible).sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo))[0]
      }
    } else {
      elegido = empleados.filter(factible).sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo))[0]
    }

    if (!elegido) {
      const reqTxt = slot.habilidad_id ? 'con la habilidad requerida' : 'disponible en su turno'
      const rolTxt = slot.rol === 'ayudante' ? 'ayudante ' : ''
      const preferido = preferidoId ? empById.get(preferidoId) : undefined
      const prefTxt = preferido ? ` (el preferido ${preferido.nombre_completo.split(' ')[0]} está ocupado o fuera de turno)` : ''
      return { ok: false, motivo: 'empleado_no_disponible', detalle: `${rolTxt}${reqTxt}${prefTxt}` }
    }
    usadosEnEtapa.add(elegido.id)
    asignaciones.push({
      slotId: slot.id,
      rol: slot.rol,
      empleadoId: elegido.id,
      empleadoNombre: elegido.nombre_completo,
      ventanasAbs: ivs,
      esReemplazo: !!preferidoId && elegido.id !== preferidoId,
      enFranjaExtra: ivs.some(iv => franjaExtraDe(elegido!, iv))
    })
  }

  return { ok: true, inicioAbs: t, recursosAbs, asignaciones }
}

function minLabel(m: number): string {
  const mm = ((Math.round(m) % 1440) + 1440) % 1440
  return String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0')
}

// ============ Orquestación (carga datos, genera, materializa) ============

export interface GeneracionPreparada {
  ctx: ContextoScheduler       // contexto cargado, para re-simular soluciones en memoria
  resultado: ResultadoScheduler
  idsReemplazables: string[]   // tareas con plantilla_id no nulo y no bloqueadas (se reemplazan al aplicar)
}

// Carga el contexto del día y corre el generador. NO toca la BD.
export async function generarParaDia(dia: number, overrides: SchedulerOverrides = {}): Promise<GeneracionPreparada> {
  const [planDiaItems, plantillas, maquinas, empleados, tareas, empsConLineas, rango] = await Promise.all([
    planificacionService.listarPlanDia(dia),
    planificacionService.listarPlantillasConEtapas(),
    planificacionService.listarMaquinas(),
    planificacionService.listarEmpleadosParaScheduler(dia),
    cronogramaService.listarTareas(dia),
    cronogramaService.listarEmpleadosConLineas(dia),
    cronogramaService.obtenerRangoHorario(dia)
  ])

  const diaInicio = rango ? timeToMin(rango.hora_inicio) : 240  // default 04:00

  const lineaToEmp = new Map<string, string>()
  for (const e of empsConLineas) for (const l of e.lineas) lineaToEmp.set(l.id, e.id)

  // Conservar: tareas manuales (sin plantilla), bloqueadas o provisorias (resolución manual de
  // conflicto sin confirmar). Reemplazar: el resto de las generadas.
  const conservadas = tareas.filter(t => t.plantilla_id === null || t.bloqueada || t.es_provisoria)
  const reemplazables = tareas.filter(t => t.plantilla_id !== null && !t.bloqueada && !t.es_provisoria)

  const ocupacionMaquinasInicial = conservadas.flatMap(t =>
    (t.recursos_programados || []).map(r => ({
      maquinaId: r.maquina_id,
      intervalo: { inicio: timeToMin(r.hora_inicio), fin: timeToMin(r.hora_fin) },
      uso: 1,
      etiqueta: t.descripcion || 'tarea existente',
      plantillaId: t.plantilla_id ?? undefined
    }))
  )
  const ocupacionEmpleadosInicial = conservadas
    .filter(t => t.linea_id && lineaToEmp.has(t.linea_id))
    .map(t => ({
      empleadoId: lineaToEmp.get(t.linea_id!)!,
      intervalo: { inicio: timeToMin(t.hora_inicio), fin: timeToMin(t.hora_fin) },
      etiqueta: t.descripcion || 'tarea existente',
      plantillaId: t.plantilla_id ?? undefined,
      permiteSolape: t.permite_solape ?? false,
      exclusiva: false
    }))

  const ctx: ContextoScheduler = {
    dia,
    diaInicio,
    plantillasConEtapas: plantillas,
    planDia: planDiaItems.map(p => ({
      plantillaId: p.plantilla_id,
      cantidadLotes: p.cantidad_lotes,
      prioridad: p.prioridad,
      inicioMinOverride: timeOrNull(p.hora_inicio_min),
      inicioMaxOverride: timeOrNull(p.hora_inicio_max),
      finMaxOverride: timeOrNull(p.hora_fin_max),
      empleadoPreferidoModo: p.empleado_preferido_modo ?? null,
      empleadoPreferidoOverride: p.empleado_preferido_override_id ?? null
    })),
    maquinas,
    empleados,
    ocupacionMaquinasInicial,
    ocupacionEmpleadosInicial
  }

  const resultado = generarCronograma(ctx, overrides)
  return { ctx, resultado, idsReemplazables: reemplazables.map(t => t.id) }
}

// Aplica el resultado: backup, borra reemplazables, crea las tareas colocadas, aplica solape.
export interface AplicarOpts {
  // Marca todas las tareas creadas como provisorias (resolución manual pendiente de confirmar).
  esProvisoria?: boolean
  // Nota del usuario que se guarda en notas_provisoria de cada tarea creada.
  notasProvisoria?: string | null
}

export async function aplicarResultado(
  dia: number,
  resultado: ResultadoScheduler,
  idsReemplazables: string[],
  opts?: AplicarOpts
): Promise<void> {
  await cronogramaService.guardarVersion(
    dia,
    `Backup pre-generación ${new Date().toLocaleString('es-AR')}`,
    'Backup automático antes de generar el cronograma',
    ''
  )
  for (const id of idsReemplazables) await cronogramaService.eliminarTarea(id)

  for (const inst of resultado.instancias) {
    if (inst.estado === 'colocada') await materializarInstancia(inst, dia, undefined, opts)
  }

  // Penalización por solapamiento sobre el resultado final
  const [tareas, empleados, config] = await Promise.all([
    cronogramaService.listarTareas(dia),
    cronogramaService.listarEmpleadosConLineas(dia),
    configuracionService.obtenerConfiguracionSolape()
  ])
  const cambios = calcularCambiosSolape(tareas, empleados, config)
  await Promise.all(cambios.map(c =>
    cronogramaService.actualizarTarea(c.id, { hora_fin: c.hora_fin, duracion_base_min: c.duracion_base_min })
  ))

  // Sembrar el estado generado como base del historial, para que "deshacer" tras mover vuelva a este
  // cronograma (y no a un estado viejo, que vaciaba el día). Se re-leen las tareas porque el ajuste de
  // solape las modificó.
  const tareasFinales = await cronogramaService.listarTareas(dia)
  const lineasFinales = empleados.flatMap(e => e.lineas)
  await cronogramaHistorialService.registrarAccion(dia, tareasFinales, 'Cronograma generado', lineasFinales)
}

// ¿Las ventanas cubren CONTINUAMENTE el intervalo [inicio, fin] (sin huecos)? Si no, la etapa es de
// "atención puntual": el empleado solo está presente en ratos sueltos (p.ej. arrancar y sacar) y queda
// libre en el medio.
function cubreContinuo(ventanas: IntervaloAbs[], inicio: number, fin: number): boolean {
  if (ventanas.length === 0) return false
  let cursor = inicio
  for (const v of [...ventanas].sort((a, b) => a.inicio - b.inicio)) {
    if (v.inicio > cursor) return false  // hueco antes de esta ventana
    cursor = Math.max(cursor, v.fin)
  }
  return cursor >= fin
}

async function materializarInstancia(inst: InstanciaEtapa, dia: number, grupoIdCadena?: string, opts?: AplicarOpts): Promise<void> {
  const esProvisoria = opts?.esProvisoria === true
  const notasProvisoria = opts?.notasProvisoria ?? null
  const dur = inst.finAbs! - inst.inicioAbs!
  const recursos_programados: RecursoProgramadoCronograma[] = inst.recursosAbs.map(r => ({
    maquina_id: r.maquinaId,
    maquina_nombre: r.maquinaNombre,
    hora_inicio: minToTime(r.intervalo.inicio),
    hora_fin: minToTime(r.intervalo.fin),
    uso: r.uso
  }))

  const principal = inst.asignaciones.find(a => a.rol === 'principal') ?? inst.asignaciones[0]

  // Atención puntual: hay empleado, pero su presencia NO cubre toda la etapa (queda libre en el medio).
  // Se materializa el "cuerpo del proceso" (autónomo, con la máquina) + un bloque corto por cada ventana
  // de presencia (toques), todos vinculados con un mismo grupo.
  if (principal && !cubreContinuo(principal.ventanasAbs, inst.inicioAbs!, inst.finAbs!)) {
    // Si la etapa pertenece a una cadena, todo (cuerpo + toques + resto de la cadena) comparte ese
    // grupo; si está suelta, cuerpo y toques se agrupan entre sí con uno propio.
    const grupoId = grupoIdCadena ?? generarId()

    // Cuerpo del proceso: ocupa la máquina toda la duración, sin empleado.
    await cronogramaService.crearTarea({
      linea_id: null,
      dia_semana: dia,
      hora_inicio: minToTime(inst.inicioAbs!),
      hora_fin: minToTime(inst.finAbs!),
      descripcion: `${inst.etapa.nombre} · ${inst.plantillaNombre}`,
      color: inst.etapa.color ?? null,
      plantilla_id: inst.plantillaId,
      etapa_orden: inst.etapa.orden,
      lote: inst.lote,
      dependencias: [],
      prerequisitos: [],
      permite_solape: inst.etapa.permite_solape ?? false,
      duracion_base_min: dur,
      recursos_programados,
      grupo_id: grupoId,
      tamano: 5,
      fila: 0,
      es_provisoria: esProvisoria,
      notas_provisoria: notasProvisoria
    })

    // Toques: un bloque corto por cada ventana de cada asignación (principal + ayudantes). Sin máquina
    // (ya va en el cuerpo) para no duplicarla en "Recursos de máquinas".
    for (const a of inst.asignaciones) {
      const li = inst.etapa.permite_solape
        ? await cronogramaService.asegurarLineaParalela(a.empleadoId, dia)
        : await cronogramaService.asegurarLineaExiste(a.empleadoId, dia)
      const ventanas = [...a.ventanasAbs].sort((x, y) => x.inicio - y.inicio)
      for (let i = 0; i < ventanas.length; i++) {
        const v = ventanas[i]
        const rol = ventanas.length > 1 && i === 0 ? 'Arrancar · '
          : ventanas.length > 1 && i === ventanas.length - 1 ? 'Finalizar · '
          : ''
        await cronogramaService.crearTarea({
          linea_id: li,
          dia_semana: dia,
          hora_inicio: minToTime(v.inicio),
          hora_fin: minToTime(v.fin),
          descripcion: `${rol}${inst.etapa.nombre} · ${inst.plantillaNombre}`,
          color: inst.etapa.color ?? null,
          plantilla_id: inst.plantillaId,
          etapa_orden: inst.etapa.orden,
          lote: inst.lote,
          permite_solape: inst.etapa.permite_solape ?? false,
          duracion_base_min: v.fin - v.inicio,
          grupo_id: grupoId,
          tamano: 5,
          fila: 0,
          es_provisoria: esProvisoria,
          notas_provisoria: notasProvisoria
        })
      }
    }
    return
  }

  let lineaId: string | null = null
  if (principal) {
    lineaId = inst.etapa.permite_solape
      ? await cronogramaService.asegurarLineaParalela(principal.empleadoId, dia)
      : await cronogramaService.asegurarLineaExiste(principal.empleadoId, dia)
  }

  await cronogramaService.crearTarea({
    linea_id: lineaId,
    dia_semana: dia,
    hora_inicio: minToTime(inst.inicioAbs!),
    hora_fin: minToTime(inst.finAbs!),
    descripcion: `${inst.etapa.nombre} · ${inst.plantillaNombre}`,
    color: inst.etapa.color ?? null,
    plantilla_id: inst.plantillaId,
    etapa_orden: inst.etapa.orden,
    lote: inst.lote,
    // cronograma_tareas.dependencias/prerequisitos son integer[] y ya no las lee nadie
    // (se quitó el Modo Inteligente); la cadena vive en la plantilla por etapa.id.
    dependencias: [],
    prerequisitos: [],
    permite_solape: inst.etapa.permite_solape ?? false,
    duracion_base_min: dur,
    recursos_programados,
    grupo_id: grupoIdCadena ?? null,
    tamano: 5,
    fila: 0,
    es_provisoria: esProvisoria,
    notas_provisoria: notasProvisoria
  })

  // Ayudantes: un bloque por cada asignación adicional, en la línea del ayudante.
  for (const a of inst.asignaciones) {
    if (a === principal) continue
    const li = inst.etapa.permite_solape
      ? await cronogramaService.asegurarLineaParalela(a.empleadoId, dia)
      : await cronogramaService.asegurarLineaExiste(a.empleadoId, dia)
    const ini = Math.min(...a.ventanasAbs.map(v => v.inicio))
    const fin = Math.max(...a.ventanasAbs.map(v => v.fin))
    await cronogramaService.crearTarea({
      linea_id: li,
      dia_semana: dia,
      hora_inicio: minToTime(ini),
      hora_fin: minToTime(fin),
      descripcion: `${inst.etapa.nombre} · ${inst.plantillaNombre} · ayuda`,
      color: inst.etapa.color ?? null,
      plantilla_id: inst.plantillaId,
      etapa_orden: inst.etapa.orden,
      lote: inst.lote,
      permite_solape: inst.etapa.permite_solape ?? false,
      duracion_base_min: fin - ini,
      grupo_id: grupoIdCadena ?? null,
      tamano: 5,
      fila: 0,
      es_provisoria: esProvisoria,
      notas_provisoria: notasProvisoria
    })
  }
}

// ============ Fase 4: resolución asistida ============

// Fusiona dos overrides (delta sobre base) de forma inmutable.
export function fusionarOverrides(base: SchedulerOverrides, delta: SchedulerOverrides): SchedulerOverrides {
  const franjasExtra = { ...(base.franjasExtra || {}) }
  for (const [emp, fr] of Object.entries(delta.franjasExtra || {})) {
    franjasExtra[emp] = [...(franjasExtra[emp] || []), ...fr]
  }
  return {
    franjasExtra,
    prioridadPlantilla: { ...(base.prioridadPlantilla || {}), ...(delta.prioridadPlantilla || {}) },
    relajarRestriccion: { ...(base.relajarRestriccion || {}), ...(delta.relajarRestriccion || {}) },
    relajarTopeInicio: [...(base.relajarTopeInicio || []), ...(delta.relajarTopeInicio || [])],
    relajarInicioPlan: [...(base.relajarInicioPlan || []), ...(delta.relajarInicioPlan || [])],
    excluirPlantillas: [...(base.excluirPlantillas || []), ...(delta.excluirPlantillas || [])],
    asignacionFijada: [...(base.asignacionFijada || []), ...(delta.asignacionFijada || [])],
    sustituirMaquina: [...(base.sustituirMaquina || []), ...(delta.sustituirMaquina || [])],
    inicioFijado: [...(base.inicioFijado || []), ...(delta.inicioFijado || [])],
    secuenciaProcesos: [...(base.secuenciaProcesos || []), ...(delta.secuenciaProcesos || [])],
    duracionFijada: [...(base.duracionFijada || []), ...(delta.duracionFijada || [])],
    ayudantesFijados: [...(base.ayudantesFijados || []), ...(delta.ayudantesFijados || [])]
  }
}

// Métricas de una jornada simulada: cierre, conflictos y carga (incl. horas fuera de turno).
export function calcularMetricasJornada(resultado: ResultadoScheduler, empleados: EmpleadoScheduler[]): MetricasJornada {
  const carga = new Map<string, { minutos: number; fuera: number }>()
  for (const inst of resultado.instancias) {
    if (inst.estado !== 'colocada') continue
    for (const a of inst.asignaciones) {
      const dur = a.ventanasAbs.reduce((s, v) => s + (v.fin - v.inicio), 0)
      const acc = carga.get(a.empleadoId) || { minutos: 0, fuera: 0 }
      acc.minutos += dur
      if (a.enFranjaExtra) acc.fuera += dur
      carga.set(a.empleadoId, acc)
    }
  }
  const cargaPorEmpleado = empleados
    .map(e => ({
      empleadoId: e.id,
      nombre: e.nombre_completo,
      minutos: carga.get(e.id)?.minutos ?? 0,
      minutosFueraTurno: carga.get(e.id)?.fuera ?? 0
    }))
    .filter(c => c.minutos > 0)
  return {
    cierreJornada: resultado.cierreJornada,
    conflictos: resultado.conflictos.filter(c => !c.cascada).length,
    cargaPorEmpleado
  }
}

// Genera soluciones candidatas para un conflicto, cada una YA simulada sobre el contexto.
// baseOverrides = overrides ya aplicados (para que la cascada acumule).
export function generarSolucionesConflicto(
  conflicto: InstanciaEtapa,
  ctx: ContextoScheduler,
  baseOverrides: SchedulerOverrides
): SolucionConflicto[] {
  const soluciones: SolucionConflicto[] = []
  const etapa = conflicto.etapa
  // Preferido del proceso (con el override del día) para reflejar la jerarquía también en las soluciones.
  const plantillaDelConflicto = ctx.plantillasConEtapas.find(p => p.id === conflicto.plantillaId)
  const itemDelConflicto = ctx.planDia.find(p => p.plantillaId === conflicto.plantillaId)
  const preferenciaProceso = plantillaDelConflicto
    ? resolverPreferenciaProceso(itemDelConflicto ?? {}, plantillaDelConflicto)
    : null

  const simular = (delta: SchedulerOverrides, tipo: SolucionConflicto['tipo'], grupo: SolucionConflicto['grupo'], descripcion: string) => {
    const ov = fusionarOverrides(baseOverrides, delta)
    const resultado = generarCronograma(ctx, ov)
    soluciones.push({
      id: `${tipo}:${descripcion}`,
      tipo,
      grupo,
      descripcion,
      overrideDelta: delta,
      resultado,
      metricas: calcularMetricasJornada(resultado, ctx.empleados)
    })
  }

  // 1) Actuar sobre las plantillas CULPABLES (las que ocupan el recurso): bajar prioridad / sacar del plan.
  const nombrePlantilla = (id: string) => ctx.plantillasConEtapas.find(p => p.id === id)?.nombre ?? 'proceso'
  const culpablesIds = (conflicto.conflicto?.culpablesPlantillaIds ?? []).filter(id => id !== conflicto.plantillaId)
  for (const culpableId of [...new Set(culpablesIds)]) {
    const nombre = nombrePlantilla(culpableId)
    simular({ prioridadPlantilla: { [culpableId]: 1 } }, 'bajar_prioridad', 'culpable', `Bajar prioridad de "${nombre}"`)
    simular({ excluirPlantillas: [culpableId] }, 'excluir', 'culpable', `Sacar "${nombre}" del plan`)
  }

  // 1b) Sustituir máquina (el fix más barato): si choca por máquina ocupada y esa máquina pertenece
  //     a un grupo con otra máquina activa, ofrecer usar la equivalente.
  if (conflicto.conflicto?.motivo === 'maquina_ocupada') {
    const hayEquivalente = [...new Set(recursosDeEtapa(etapa).map(r => r.maquina_id))].some(id => {
      const m = ctx.maquinas.find(x => x.id === id)
      return !!m?.grupo_id && ctx.maquinas.some(o => o.id !== m.id && o.activa && o.grupo_id === m.grupo_id)
    })
    if (hayEquivalente) {
      simular({ sustituirMaquina: [etapa.id] }, 'sustituir_maquina', 'maquina', 'Usar otra máquina equivalente del grupo')
    }
  }

  // 2) Extender el turno de un empleado (para conflictos de empleado): franja extra + PIN.
  // Dos modos:
  //   A) "Extender turno de X" — X es el preferido de la fijada y hace AMBAS (culpable + fijada).
  //   B) "Adelantar entrada de Y" — Y NO es el preferido de la fijada; sólo hace la culpable,
  //      la fijada queda para su preferido en su horario normal. El turno de Y se adelanta y
  //      sigue activo hasta su fin de turno normal sin huecos.
  if (conflicto.conflicto?.motivo === 'empleado_no_disponible') {
    const slots = slotsDeEtapa(etapa, preferenciaProceso)
    const habilidadReq = slots.find(s => s.ventanas.length > 0)?.habilidad_id ?? null
    const preferidoEtapaId = slots.find(s => s.empleado_preferido_id)?.empleado_preferido_id ?? null
    const candidatos = ctx.empleados.filter(e => !habilidadReq || e.habilidades.has(habilidadReq))
    const desde0 = conflicto.conflicto.desdeColocacion  // primer minuto posible de la tarea
    const tope = conflicto.conflicto.topeColocacion      // último minuto posible de inicio
    const leadPreferido = conflicto.conflicto.leadBloqueo ?? 0
    const preferidoBloqueadoId = conflicto.conflicto.preferidoBloqueadoId
    const dur = etapa.duracion_proceso
    const justo = desde0 != null && tope != null

    // Empleado preferido de la fijada y su inicio de turno normal (si tiene turno hoy).
    const preferidoFijadaEmp = preferidoEtapaId ? ctx.empleados.find(e => e.id === preferidoEtapaId) : null
    const turnosPref = preferidoFijadaEmp?.franjas.filter(f => f.origen === 'turno') ?? []
    const turnoInicioPref = turnosPref.length > 0 ? Math.min(...turnosPref.map(f => f.desde)) : null

    // Ancla óptima: arrancar la fijada en el inicio del turno del preferido de la fijada,
    // clampeada a la ventana legítima [desde0, tope]. Si no hay preferido o no tiene turno
    // hoy, caer a desde0 (comportamiento previo). Sin ancla la "extensión" se calcula desde
    // el primer minuto posible.
    const anclaIdeal = turnoInicioPref ?? desde0
    const ancla = justo && anclaIdeal != null
      ? Math.max(desde0!, Math.min(tope!, anclaIdeal))
      : (desde0 ?? 0)

    // Minutos de [ini,fin] dentro del turno NORMAL del empleado (no cuentan como hora extra).
    const minEnTurno = (emp: EmpleadoScheduler, ini: number, fin: number) =>
      emp.franjas.filter(f => f.origen === 'turno')
        .reduce((s, f) => s + Math.max(0, Math.min(fin, f.hasta) - Math.max(ini, f.desde)), 0)
    // Fin del turno normal más cercano antes de que arranque la tarea (para medir el hueco muerto).
    const finTurnoPrevio = (emp: EmpleadoScheduler, t0: number): number | null => {
      const fines = emp.franjas.filter(f => f.origen === 'turno' && f.hasta <= t0).map(f => f.hasta)
      return fines.length ? Math.max(...fines) : null
    }
    // Fin del turno normal del empleado (último minuto de su turno hoy; 0 si día libre).
    const finTurnoNormal = (emp: EmpleadoScheduler) =>
      emp.franjas.filter(f => f.origen === 'turno').reduce((m, f) => Math.max(m, f.hasta), 0)
    const nombrePrefFijada = preferidoFijadaEmp?.nombre_completo.split(' ')[0] ?? null

    const opciones: { sol: SolucionConflicto; empId: string; costoExtra: number; hueco: number }[] = []
    for (const emp of candidatos) {
      const esPreferidoFijada = emp.id === preferidoEtapaId
      const esPreferidoBloqueado = emp.id === preferidoBloqueadoId
      const lead = esPreferidoBloqueado ? leadPreferido : 0
      const fTN = finTurnoNormal(emp)
      const diaLibre = fTN === 0

      const nombre = emp.nombre_completo.split(' ')[0]

      if (esPreferidoFijada || diaLibre) {
        // Modo A: este empleado hace la fijada (con PIN). Si está bloqueado por una culpable,
        // se adelanta `lead` min para que la culpable corra en su tiempo traído (las franjas
        // extra son globales). El extremo superior es max(ancla+dur, finTurnoNormal) para
        // que la franja se enchufe de corrido con el turno normal sin recortar nada.
        const desde = Math.max(0, ancla - lead)
        const fin = Math.max(ancla + dur, fTN > 0 ? fTN : ancla + dur)
        const franja: FranjaDisponibilidad = { desde, hasta: fin, origen: 'extra', etiqueta: 'Turno extendido' }

        const costoExtra = Math.max(0, (fin - desde) - minEnTurno(emp, desde, fin))
        const fp = finTurnoPrevio(emp, desde)
        const hueco = fp != null ? Math.max(0, desde - fp) : 0

        const descripcion = diaLibre
          ? `Hacer venir a ${nombre} en su día libre (entra ${minLabel(desde)}, arranca ${etapa.nombre} a las ${minLabel(ancla)})`
          : lead > 0
            ? `Extender turno de ${nombre}: entra ${minLabel(desde)} para liberar la otra tarea y arranca ${etapa.nombre} a las ${minLabel(ancla)} (+${lead} min extra)`
            : `Extender turno de ${nombre}: entra ${minLabel(desde)} para hacer ${etapa.nombre}`

        simular(
          {
            franjasExtra: { [emp.id]: [franja] },
            asignacionFijada: [{ plantillaId: conflicto.plantillaId, lote: conflicto.lote, etapaOrden: etapa.orden, empleadoId: emp.id }]
          },
          'traer_empleado',
          'traer',
          descripcion
        )
        const sol = soluciones[soluciones.length - 1]
        sol.costoExtraMin = costoExtra
        sol.huecoMuertoMin = hueco
        opciones.push({ sol, empId: emp.id, costoExtra, hueco })
      } else {
        // Modo B: este empleado NO es el preferido de la fijada. Lo adelantamos para que haga
        // SÓLO la culpable (gracias a que las franjas extra son globales, el scheduler le
        // asignará la culpable porque podría ser su preferida o reemplazo). La fijada queda
        // para el preferido en su horario normal. NO se pinea la fijada a este empleado.
        // Sólo aplica si hay culpable identificada (lead > 0).
        if (leadPreferido === 0) continue

        const desde = Math.max(0, ancla - leadPreferido)
        const fin = Math.max(ancla, fTN)
        const franja: FranjaDisponibilidad = { desde, hasta: fin, origen: 'extra', etiqueta: 'Turno extendido' }

        const costoExtra = Math.max(0, (fin - desde) - minEnTurno(emp, desde, fin))
        const fp = finTurnoPrevio(emp, desde)
        const hueco = fp != null ? Math.max(0, desde - fp) : 0

        const descripcion = nombrePrefFijada
          ? `Adelantar entrada de ${nombre} a las ${minLabel(desde)} para que haga el proceso culpable (${etapa.nombre} la sigue haciendo ${nombrePrefFijada} a las ${minLabel(ancla)})`
          : `Adelantar entrada de ${nombre} a las ${minLabel(desde)} para que haga el proceso culpable`

        simular(
          { franjasExtra: { [emp.id]: [franja] } },   // sin PIN de fijada
          'traer_empleado',
          'traer',
          descripcion
        )
        const sol = soluciones[soluciones.length - 1]
        sol.costoExtraMin = costoExtra
        sol.huecoMuertoMin = hueco
        opciones.push({ sol, empId: emp.id, costoExtra, hueco })
      }
    }

    // Recomendado: el de menos hueco muerto, luego menos hora extra; desempate por preferido.
    if (opciones.length > 0) {
      const ranqueado = [...opciones].sort((a, b) =>
        a.hueco - b.hueco ||
        a.costoExtra - b.costoExtra ||
        Number(b.empId === preferidoEtapaId) - Number(a.empId === preferidoEtapaId)
      )
      ranqueado[0].sol.recomendada = true
    }
  }

  // 3) Relajar restricciones horarias de la etapa (separadas para que se vea QUÉ se toca).
  if (etapa.hora_inicio_max != null) {
    simular(
      { relajarRestriccion: { [etapa.id]: { hora_inicio_max: null } } },
      'relajar',
      'relajar',
      'Permitir que la etapa empiece más tarde (sacar su tope de inicio)'
    )
  }
  if (etapa.hora_fin_max != null) {
    simular(
      { relajarRestriccion: { [etapa.id]: { hora_fin_max: null } } },
      'relajar',
      'relajar',
      'Permitir que la etapa termine más tarde (mueve la entrega)'
    )
    // Mover la entrega es más caro comercialmente que solo arrancar más tarde.
    soluciones[soluciones.length - 1].costoNegocio = 3
  }

  // 4) Actuar sobre la propia etapa/proceso en conflicto.
  // 4a) Si el proceso tiene tope de inicio (lo obliga a arrancar temprano), permitir que empiece
  //     más tarde → así puede correrse a después de la culpable cuando se liberen los recursos.
  const plantillaConflicto = ctx.plantillasConEtapas.find(p => p.id === conflicto.plantillaId)
  // Si el plan del día (o la plantilla) obliga a "no empezar antes de X", ofrecer quitar esa
  // restricción para poder ubicar la etapa más temprano, dentro del turno normal de los empleados.
  const planItem = ctx.planDia.find(p => p.plantillaId === conflicto.plantillaId)
  const tieneInicioPlan = (planItem?.inicioMinOverride ?? null) != null || !!plantillaConflicto?.hora_inicio_min
  if (tieneInicioPlan) {
    simular(
      { relajarInicioPlan: [conflicto.plantillaId] },
      'relajar',
      'relajar',
      `Quitar la restricción "no empezar antes" de "${conflicto.plantillaNombre}"`
    )
  }
  if (plantillaConflicto?.hora_inicio_max) {
    simular(
      { relajarTopeInicio: [conflicto.plantillaId] },
      'relajar',
      'proceso',
      `Permitir que "${conflicto.plantillaNombre}" empiece más tarde (sacar el tope de inicio)`
    )
  }
  // 4b) Postergar/sacar el propio proceso.
  simular(
    { prioridadPlantilla: { [conflicto.plantillaId]: 1 } },
    'bajar_prioridad',
    'proceso',
    `Bajar prioridad de "${conflicto.plantillaNombre}"`
  )
  simular(
    { excluirPlantillas: [conflicto.plantillaId] },
    'excluir',
    'proceso',
    `Sacar "${conflicto.plantillaNombre}" del plan`
  )

  // Costo de negocio por tipo (menor = más barato/preferible). La hora extra (2) va SIEMPRE por
  // encima de postergar (4) o sacar un producto (5): producir es prioridad.
  const RANGO_TIPO: Record<SolucionConflicto['tipo'], number> = {
    sustituir_maquina: 0, relajar: 1, traer_empleado: 2, bajar_prioridad: 4, excluir: 5
  }
  const costoNegocioDe = (s: SolucionConflicto) => s.costoNegocio ?? RANGO_TIPO[s.tipo]

  // Marcar las opciones que dejan un producto fuera (pérdida comercial), para mostrarlo y rankearlo.
  for (const s of soluciones) {
    if (s.tipo === 'excluir' || s.tipo === 'bajar_prioridad') s.dejaProductoFuera = true
  }

  // Ranqueo de negocio: 1) menos conflictos; 2) más barato (sustituir<relajar<extra<entrega<postergar<sacar);
  //                     3) menos hora extra; 4) cierre más temprano.
  const fuera = (s: SolucionConflicto) => s.metricas.cargaPorEmpleado.reduce((acc, c) => acc + c.minutosFueraTurno, 0)
  soluciones.sort((a, b) =>
    a.metricas.conflictos - b.metricas.conflictos ||
    costoNegocioDe(a) - costoNegocioDe(b) ||
    (a.costoExtraMin ?? fuera(a)) - (b.costoExtraMin ?? fuera(b)) ||
    (a.metricas.cierreJornada ?? 0) - (b.metricas.cierreJornada ?? 0)
  )

  // Dedup por firma. Para máquina/extender/relajar cada descripción es una acción distinta (se
  // conserva); para culpable/proceso se colapsan las que dan exactamente el mismo resultado.
  const vistos = new Set<string>()
  const filtradas = soluciones.filter(s => {
    const firma = (s.grupo === 'culpable' || s.grupo === 'proceso')
      ? `${s.grupo}|${s.metricas.conflictos}|${s.metricas.cierreJornada}|${fuera(s)}`
      : `${s.grupo}|${s.descripcion}`
    if (vistos.has(firma)) return false
    vistos.add(firma)
    return true
  })

  // Recomendación: si el preferido de la etapa no quedó marcado (no era candidato), recomendar
  // la primera opción de "extender turno" en el ranqueo (la de menor impacto).
  const extender = filtradas.filter(s => s.grupo === 'traer')
  if (extender.length > 0 && !extender.some(s => s.recomendada)) extender[0].recomendada = true

  return filtradas
}

