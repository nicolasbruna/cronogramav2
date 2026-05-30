// Headers CORS reutilizables para las Edge Functions.
// Origin '*' es aceptable porque la función exige un JWT válido (verify_jwt = true).
// Endurecer al dominio exacto de Vercel en producción si se quiere.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
