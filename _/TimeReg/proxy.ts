/* Supabase Edge Function — Tripletex proxy for _/TimeReg/index.html
 *
 * Tripletex sends no CORS headers, so the browser can't call it directly. This keeps the
 * employee token on the server and adds CORS for the one origin that needs it.
 *
 * deploy:
 *   supabase functions deploy tripletex --no-verify-jwt
 * secrets:
 *   supabase secrets set TRIPLETEX_EMAIL=you@firma.no TRIPLETEX_TOKEN=<employee token> TR_TIMEREG_KEY=<long random>
 * optional:
 *   TRIPLETEX_BASE=https://tripletex.no/v2   TRIMEREG_ORIGIN=https://aigap.no
 *
 * the page then calls:  <function url>?p=%2Ftimesheet%2Fentry   with header  x-tr-key
 */
const TX = Deno.env.get('TRIPLETEX_BASE') ?? 'https://tripletex.no/v2'
const ALLOW = Deno.env.get('TRIMEREG_ORIGIN') ?? 'https://aigap.no'
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOW,
  'Access-Control-Allow-Headers': 'content-type, x-tr-key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const key = Deno.env.get('TR_TIMEREG_KEY')
  if (key && req.headers.get('x-tr-key') !== key) return json({ message: 'bad or missing x-tr-key' }, 401)

  const p = new URL(req.url).searchParams.get('p') ?? ''
  if (!/^\/[A-Za-z0-9_\-./>]+(\?[A-Za-z0-9_\-%.=&+]*)?$/.test(p)) return json({ message: 'bad path: ' + p }, 400)

  const user = Deno.env.get('TRIPLETEX_EMAIL')
  const token = Deno.env.get('TRIPLETEX_TOKEN')
  if (!user || !token) return json({ message: 'proxy is missing TRIPLETEX_EMAIL / TRIPLETEX_TOKEN' }, 500)

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text()
  const r = await fetch(TX + p, {
    method: req.method,
    headers: {
      Authorization: 'Basic ' + btoa(`${user}:${token}`),
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
  })
  return new Response(await r.text(), {
    status: r.status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })
})
