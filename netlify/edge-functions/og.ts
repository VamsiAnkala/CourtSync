// Netlify Edge Function: serves live OpenGraph tags to link-preview crawlers (WhatsApp etc.).
// Real users fall through to the Angular app. Set SUPABASE_URL and SUPABASE_ANON_KEY in Netlify env vars.
import type { Config, Context } from 'https://edge.netlify.com';

const CRAWLER = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot/i;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default async (request: Request, context: Context) => {
  if (!CRAWLER.test(request.headers.get('user-agent') ?? '')) return context.next();

  const url = new URL(request.url);
  const slug = url.pathname.split('/')[2] ?? '';
  const base = Netlify.env.get('SUPABASE_URL');
  const key = Netlify.env.get('SUPABASE_ANON_KEY');
  if (!base || !key || !slug) return context.next();

  try {
    const res = await fetch(`${base}/rest/v1/rpc/public_today_summary`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug }),
    });
    const s = res.ok ? await res.json() : null;
    if (!s) return context.next();

    const title = `${s.playersIn} Playing Today | ${s.courts} Court${s.courts > 1 ? 's' : ''} Active`;
    const desc = `${s.name}: tap to vote I'm In / Out. Court 2 opens at player ${s.playersPerCourt + 1}.`;
    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="CourtSync">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(request.url)}">
<meta name="description" content="${esc(desc)}">
</head><body><a href="${esc(request.url)}">${esc(title)}</a></body></html>`;
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' },
    });
  } catch {
    return context.next();
  }
};

export const config: Config = { path: '/g/*/today' };
