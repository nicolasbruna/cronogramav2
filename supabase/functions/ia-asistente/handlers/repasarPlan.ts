import { buildSystem, minToHHMM } from '../prompts.ts'
import { buildToolProponer, TOOL_PROPONER } from '../schema.ts'
import { llamarClaude, extraerToolInput } from '../anthropic.ts'
import { RepasarPlanPayload, RepasarPlanData } from '../types.ts'

export async function repasarPlan(payload: RepasarPlanPayload): Promise<RepasarPlanData> {
  const { metricas, resumenInstancias, conflictos, catalogos } = payload

  const empleadosTxt = catalogos.empleados.map(e => `- ${e.nombre} (id: ${e.id})`).join('\n')
  const plantillasTxt = catalogos.plantillas
    .map(p => `- ${p.nombre} (id: ${p.id}); etapas: ${p.etapas.map(e => `${e.orden}.${e.nombre}`).join(', ')}`)
    .join('\n')

  const cargaTxt = metricas.cargaPorEmpleado
    .map(c => `- ${c.nombre}: ${c.minutos} min${c.minutosFueraTurno > 0 ? ` (${c.minutosFueraTurno} en hora extra)` : ''}`)
    .join('\n')

  const instTxt = resumenInstancias
    .map(i => `- ${i.plantillaNombre} · ${i.etapaNombre} (lote ${i.lote}) ${
      i.estado === 'conflicto' ? '[SIN UBICAR]' : `${minToHHMM(i.inicioAbs)}–${minToHHMM(i.finAbs)}`
    } | emp: ${i.empleados.join(', ') || '—'} | maq: ${i.maquinas.join(', ') || '—'}`)
    .join('\n')

  const conflictosTxt = conflictos.length === 0
    ? '(ninguno)'
    : conflictos.map(c => `- ${c.plantillaNombre} · ${c.etapaNombre} (lote ${c.lote}) [${c.motivo}]: ${c.mensaje}${
        c.culpables.length ? ` | ocupado por: ${c.culpables.join(', ')}` : ''
      }`).join('\n')

  const userMsg = `Repasá este cronograma ya generado por el scheduler y proponé mejores opciones.

## Métricas del plan base
- Cierre de jornada: ${minToHHMM(metricas.cierreJornada)}
- Conflictos: ${metricas.conflictos}
- Carga por empleado:
${cargaTxt || '(sin datos)'}

## Empleados disponibles
${empleadosTxt || '(sin datos)'}

## Procesos del día
${plantillasTxt || '(sin datos)'}

## Tareas colocadas / sin ubicar
${instTxt || '(sin datos)'}

## Conflictos
${conflictosTxt}

Devolvé un diagnóstico y propuestas de mejora concretas con su overrideDelta. Cada propuesta debe
ser un cambio mínimo y bien apuntado (el sistema lo va a simular y descartar si no mejora de verdad).
Si el plan ya está bien y no hay nada que mejorar, devolvé propuestas: [] y un diagnóstico breve.`

  const resp = await llamarClaude({
    system: buildSystem(),
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 2000,
    tools: [buildToolProponer(catalogos)],
    toolChoice: { type: 'tool', name: TOOL_PROPONER },
  })

  const data = extraerToolInput<RepasarPlanData>(resp, TOOL_PROPONER)
  if (!data) throw new Error('La IA no devolvió propuestas en el formato esperado.')
  return { diagnostico: data.diagnostico ?? [], propuestas: data.propuestas ?? [] }
}
