import { buildSystem } from '../prompts.ts'
import { buildToolComando, TOOL_COMANDO } from '../schema.ts'
import { llamarClaude, extraerToolInput } from '../anthropic.ts'
import { ComandoOverridesPayload, ComandoOverridesData } from '../types.ts'

export async function comandoOverrides(payload: ComandoOverridesPayload): Promise<ComandoOverridesData> {
  const { comando, contexto } = payload
  const { catalogos, conflictosActuales } = contexto

  const empleadosTxt = catalogos.empleados.map(e => `- ${e.nombre} (id: ${e.id})`).join('\n')
  const plantillasTxt = catalogos.plantillas
    .map(p => `- ${p.nombre} (id: ${p.id}); etapas: ${p.etapas.map(e => `${e.orden}.${e.nombre}`).join(', ')}`)
    .join('\n')
  const conflictosTxt = conflictosActuales.length === 0
    ? '(ninguno)'
    : conflictosActuales.map(c => `- ${c.plantillaNombre} · ${c.etapaNombre} (lote ${c.lote}): ${c.mensaje}`).join('\n')

  const userMsg = `El usuario pidió un cambio sobre el cronograma. Traducilo a un overrideDelta.

Pedido del usuario:
"""${comando}"""

## Empleados (usá estos ids)
${empleadosTxt || '(sin datos)'}

## Procesos del día (usá estos ids; etapaOrden = número de etapa)
${plantillasTxt || '(sin datos)'}

## Conflictos actuales
${conflictosTxt}

Convertí el pedido en un overrideDelta mínimo. Las horas van en minutos del día (ej: 06:00 = 360).
Si el pedido menciona a alguien o algo que no está en las listas, no lo inventes: dejalo fuera y
explicá en advertencias qué no pudiste mapear.`

  const resp = await llamarClaude({
    system: buildSystem(),
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 1024,
    tools: [buildToolComando(catalogos)],
    toolChoice: { type: 'tool', name: TOOL_COMANDO },
  })

  const data = extraerToolInput<ComandoOverridesData>(resp, TOOL_COMANDO)
  if (!data) throw new Error('La IA no devolvió overrides en el formato esperado.')
  return { overrides: data.overrides ?? {}, resumenInterpretacion: data.resumenInterpretacion ?? '', advertencias: data.advertencias }
}
