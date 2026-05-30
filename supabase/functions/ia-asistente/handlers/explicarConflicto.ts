import { buildSystem } from '../prompts.ts'
import { llamarClaude, extraerToolInput } from '../anthropic.ts'
import { Tool } from '../anthropic.ts'
import { ExplicarConflictoPayload, ExplicarConflictoData } from '../types.ts'

const TOOL = 'explicar'

function buildTool(solucionIds: string[]): Tool {
  return {
    name: TOOL,
    description: 'Explicá el conflicto en lenguaje claro y recomendá una de las soluciones por su id.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        explicacion: { type: 'string', description: '1 a 3 frases, claro y simple, por qué quedó sin ubicar.' },
        recomendacionSolucionId: solucionIds.length
          ? { type: ['string', 'null'], enum: [...solucionIds, null] }
          : { type: 'null' },
        porQueRecomendada: { type: 'string', description: 'Por qué conviene esa solución (breve).' },
      },
      required: ['explicacion', 'recomendacionSolucionId', 'porQueRecomendada'],
    },
  }
}

export async function explicarConflicto(payload: ExplicarConflictoPayload): Promise<ExplicarConflictoData> {
  const { conflicto, soluciones } = payload
  const solIds = soluciones.map(s => s.id)

  const solTxt = soluciones.length === 0
    ? '(el motor no encontró soluciones automáticas)'
    : soluciones.map(s => `- id ${s.id} [${s.grupo}]: ${s.descripcion} → quedarían ${s.conflictosRestantes} conflicto(s)${
        s.recomendada ? ' (el motor la marcó recomendada)' : ''
      }${s.costoExtraMin ? `, +${s.costoExtraMin} min hora extra` : ''}${s.dejaProductoFuera ? ', PIERDE producto' : ''}`).join('\n')

  const userMsg = `Explicá este conflicto del cronograma y recomendá la mejor solución.

Proceso: ${conflicto.plantillaNombre} · ${conflicto.etapaNombre} (lote ${conflicto.lote})
Motivo: ${conflicto.motivo}
Mensaje del scheduler: ${conflicto.mensaje}
${conflicto.culpables.length ? `Recurso ocupado por: ${conflicto.culpables.join(', ')}` : ''}
${conflicto.decisionesScheduler?.length ? `\nDecisiones del scheduler:\n${conflicto.decisionesScheduler.map(d => `  • ${d}`).join('\n')}` : ''}

Soluciones que ya generó el motor:
${solTxt}

Explicá en criollo por qué no entra y recomendá una solución por su id (o null si ninguna conviene).`

  const resp = await llamarClaude({
    system: buildSystem(),
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 700,
    tools: [buildTool(solIds)],
    toolChoice: { type: 'tool', name: TOOL },
  })

  const data = extraerToolInput<ExplicarConflictoData>(resp, TOOL)
  if (!data) throw new Error('La IA no devolvió la explicación esperada.')
  return data
}
