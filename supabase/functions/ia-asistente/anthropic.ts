// Cliente mínimo de la Messages API de Anthropic (fetch directo, sin SDK).
// La key vive solo acá (Deno.env), nunca llega al navegador.

export const MODELO_DEFAULT = 'claude-sonnet-4-6'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const TIMEOUT_MS = 60_000

export interface BloqueSystem {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

export interface Tool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface LlamarOpts {
  system: BloqueSystem[]
  messages: { role: 'user' | 'assistant'; content: unknown }[]
  maxTokens: number
  modelo?: string
  tools?: Tool[]
  toolChoice?: { type: 'tool'; name: string } | { type: 'auto' }
}

export interface RespuestaAnthropic {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
  >
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  stop_reason?: string
}

export class AnthropicError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export async function llamarClaude(opts: LlamarOpts): Promise<RespuestaAnthropic> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new AnthropicError('sin_config', 'Falta ANTHROPIC_API_KEY en el entorno de la función.')

  const body: Record<string, unknown> = {
    model: opts.modelo ?? MODELO_DEFAULT,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: opts.messages,
  }
  if (opts.tools) body.tools = opts.tools
  if (opts.toolChoice) body.tool_choice = opts.toolChoice

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new AnthropicError('timeout', 'La IA tardó demasiado en responder.')
    }
    throw new AnthropicError('servidor', `No se pudo contactar a la IA: ${String(e)}`)
  } finally {
    clearTimeout(t)
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    throw new AnthropicError('servidor', `Anthropic respondió ${resp.status}: ${txt.slice(0, 300)}`)
  }
  return await resp.json() as RespuestaAnthropic
}

// Extrae el input del primer bloque tool_use con el nombre dado.
export function extraerToolInput<T>(resp: RespuestaAnthropic, toolName: string): T | null {
  for (const b of resp.content) {
    if (b.type === 'tool_use' && b.name === toolName) return b.input as T
  }
  return null
}

// Concatena el texto de los bloques de texto.
export function extraerTexto(resp: RespuestaAnthropic): string {
  return resp.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n').trim()
}
