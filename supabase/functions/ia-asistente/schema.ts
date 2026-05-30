// JSON Schema del tool `proponer_mejoras` (acción repasar_plan).
// Los IDs se restringen con enums DINÁMICOS construidos desde los catálogos del
// request, para que el modelo no pueda inventar empleados/plantillas inexistentes.
import { Tool } from './anthropic.ts'
import { Catalogos } from './types.ts'

export const TOOL_PROPONER = 'proponer_mejoras'
export const TOOL_COMANDO = 'proponer_overrides'

function idEnum(ids: string[]) {
  // Si no hay IDs, dejamos string libre (la validación dura está en el cliente igual).
  return ids.length > 0 ? { type: 'string', enum: ids } : { type: 'string' }
}

// Esquema del overrideDelta (compartido por repasar_plan y comando_overrides).
export function buildOverrideDeltaSchema(catalogos: Catalogos): Record<string, unknown> {
  const empIds = catalogos.empleados.map(e => e.id)
  const plantIds = catalogos.plantillas.map(p => p.id)

  return {
    type: 'object',
    description: 'Cambio mínimo y puntual a aplicar. Usá solo los campos necesarios.',
    additionalProperties: false,
    properties: {
      prioridadPlantilla: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: { plantillaId: idEnum(plantIds), prioridad: { type: 'integer', minimum: 1, maximum: 10 } },
          required: ['plantillaId', 'prioridad'],
        },
      },
      franjasExtra: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            empleadoId: idEnum(empIds),
            desde: { type: 'integer', minimum: 0, maximum: 1439 },
            hasta: { type: 'integer', minimum: 0, maximum: 1439 },
            etiqueta: { type: 'string' },
          },
          required: ['empleadoId', 'desde', 'hasta'],
        },
      },
      inicioFijado: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            plantillaId: idEnum(plantIds), lote: { type: 'integer', minimum: 1 },
            etapaOrden: { type: 'integer', minimum: 1 }, inicioMin: { type: 'integer', minimum: 0, maximum: 1439 },
          },
          required: ['plantillaId', 'lote', 'etapaOrden', 'inicioMin'],
        },
      },
      asignacionFijada: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            plantillaId: idEnum(plantIds), lote: { type: 'integer', minimum: 1 },
            etapaOrden: { type: 'integer', minimum: 1 }, empleadoId: idEnum(empIds),
          },
          required: ['plantillaId', 'lote', 'etapaOrden', 'empleadoId'],
        },
      },
      duracionFijada: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            plantillaId: idEnum(plantIds), lote: { type: 'integer', minimum: 1 },
            etapaOrden: { type: 'integer', minimum: 1 }, duracionMin: { type: 'integer', minimum: 1, maximum: 1439 },
          },
          required: ['plantillaId', 'lote', 'etapaOrden', 'duracionMin'],
        },
      },
      ayudantesFijados: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            plantillaId: idEnum(plantIds), lote: { type: 'integer', minimum: 1 },
            etapaOrden: { type: 'integer', minimum: 1 },
            empleadosIds: { type: 'array', items: idEnum(empIds) },
          },
          required: ['plantillaId', 'lote', 'etapaOrden', 'empleadosIds'],
        },
      },
      secuenciaProcesos: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: { antesPlantillaId: idEnum(plantIds), despuesPlantillaId: idEnum(plantIds) },
          required: ['antesPlantillaId', 'despuesPlantillaId'],
        },
      },
      excluirPlantillas: { type: 'array', items: idEnum(plantIds) },
      sustituirMaquina: { type: 'array', items: { type: 'string' } },
      relajarTopeInicio: { type: 'array', items: idEnum(plantIds) },
      relajarInicioPlan: { type: 'array', items: idEnum(plantIds) },
    },
  }
}

export function buildToolProponer(catalogos: Catalogos): Tool {
  const overrideDelta = buildOverrideDeltaSchema(catalogos)
  return {
    name: TOOL_PROPONER,
    description:
      'Devolvé un diagnóstico del plan y una lista de propuestas de mejora. Cada propuesta tiene un ' +
      'overrideDelta con el cambio mínimo a simular. No inventes IDs: usá solo los de los catálogos.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        diagnostico: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              titulo: { type: 'string' },
              detalle: { type: 'string' },
              severidad: { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['titulo', 'detalle', 'severidad'],
          },
        },
        propuestas: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              titulo: { type: 'string' },
              justificacion: { type: 'string' },
              overrideDelta,
            },
            required: ['titulo', 'justificacion', 'overrideDelta'],
          },
        },
      },
      required: ['diagnostico', 'propuestas'],
    },
  }
}

// Tool para comando_overrides: traduce un pedido en lenguaje natural a un overrideDelta.
export function buildToolComando(catalogos: Catalogos): Tool {
  return {
    name: TOOL_COMANDO,
    description:
      'Traducí el pedido del usuario a un overrideDelta. Usá solo IDs de los catálogos. Si algo es ' +
      'ambiguo o un nombre no existe, no lo inventes: dejalo fuera y avisalo en advertencias.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        overrides: buildOverrideDeltaSchema(catalogos),
        resumenInterpretacion: { type: 'string', description: 'En una frase, qué entendiste que hay que hacer.' },
        advertencias: { type: 'array', items: { type: 'string' } },
      },
      required: ['overrides', 'resumenInterpretacion'],
    },
  }
}
