// Edge Function `ia-asistente`: proxy seguro a Claude para repasar/explicar el
// cronograma. Un solo endpoint con discriminador `accion`.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { RequestIA, RespuestaIA } from './types.ts'
import { repasarPlan } from './handlers/repasarPlan.ts'
import { explicarConflicto } from './handlers/explicarConflicto.ts'
import { AnthropicError } from './anthropic.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: { code: 'metodo', message: 'Solo POST.' } }, 405)

  // --- Auth: verificar el JWT del usuario ---
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData?.user) {
    return json({ ok: false, error: { code: 'auth', message: 'No autenticado.' } }, 401)
  }

  // --- Body ---
  let body: RequestIA
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: { code: 'body', message: 'Body inválido.' } }, 400)
  }
  const { accion, payload } = body
  if (!accion) return json({ ok: false, error: { code: 'body', message: 'Falta "accion".' } }, 400)

  // --- Routing ---
  try {
    let data: unknown
    switch (accion) {
      case 'ping':
        data = { pong: true, user: userData.user.id }
        break
      case 'repasar_plan':
        // deno-lint-ignore no-explicit-any
        data = await repasarPlan(payload as any)
        break
      case 'explicar_conflicto':
        // deno-lint-ignore no-explicit-any
        data = await explicarConflicto(payload as any)
        break
      default:
        return json({ ok: false, error: { code: 'accion', message: `Acción desconocida: ${accion}` } }, 400)
    }
    return json({ ok: true, data } as RespuestaIA<unknown>)
  } catch (e) {
    const code = e instanceof AnthropicError ? e.code : 'servidor'
    const message = e instanceof Error ? e.message : 'Error desconocido.'
    return json({ ok: false, error: { code, message } } as RespuestaIA<unknown>)
  }
})
