// fetch-feeds.mjs
import { readFileSync, writeFileSync } from 'fs';

const MAX_PER_FEED    = 5;
const MAX_TITLE       = 300;
const MAX_NAME        = 100;
const MAX_XML_BYTES   = 4 * 1024 * 1024;
const FEED_TIMEOUT    = 30_000;
const FAVICON_TIMEOUT = 15_000;
const RETRY_ATTEMPTS  = 4;
const RETRY_DELAY     = 2_000;

// Sin Accept-Encoding: Node/undici descomprime automáticamente
const USER_AGENTS = [
  // Tu original (por si algún sitio requiere que te identifiques)
  'Mozilla/5.0 (compatible; Wikitolica/1.0; +https://wikitolica.com)',
  // Chrome en Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Safari en Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  // Firefox en Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
];

const BASE_HEADERS = {
  'Accept':          'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Cache-Control':   'no-cache',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── utils ──────────────────────────────────────────────────────────────────

function decodeHTMLEntities(s) {
  return s
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = Number(n);
      try { return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : ''; } catch { return ''; }
    })
    .replace(/&#x([\da-fA-F]+);/gi, (_, h) => {
      const cp = parseInt(h, 16);
      try { return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : ''; } catch { return ''; }
    });
}

function sanitizeText(s, maxLen = MAX_TITLE) {
  if (typeof s !== 'string') return '';
  return decodeHTMLEntities(s)   // decodifica antes de sanitizar
    .replace(/<[^>]*>/g, '')
    .replace(/&[^;]{1,8};/g, ' ') // entidades residuales
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function sanitizeURL(s) {
  if (typeof s !== 'string') return '';
  try {
    const u = new URL(decodeHTMLEntities(s.trim()));
    if (!/^https?:$/.test(u.protocol) || /[<>"'\s]/.test(u.href)) return '';
    return u.href;
  } catch { return ''; }
}

function toISO(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  return isNaN(d) ? '' : d.toISOString();
}

function isoToDisplay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// ── XML decode con charset real ────────────────────────────────────────────

function bufToXml(buf) {
  // Lee el charset del XML declaration antes de decodificar
  const sniff = Buffer.from(buf.slice(0, 512)).toString('latin1');
  const enc   = (sniff.match(/encoding=["']([^"']+)["']/i) || [])[1] || 'utf-8';
  try {
    return new TextDecoder(enc, { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
}

// ── RSS/Atom parser ────────────────────────────────────────────────────────

function getTag(block, tag) {
  const m = block.match(
    new RegExp(`<${tag.replace(':', '\\:')}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag.replace(':', '\\:')}>`)
  );
  return m ? m[1].trim() : '';
}

function getAtomLink(block) {
  for (const m of block.matchAll(/<link([^>]+?)\/?>/gi)) {
    const attrs = m[1];
    if (/rel=["']alternate["']/i.test(attrs) || !/rel=/i.test(attrs)) {
      const hm = attrs.match(/href=["']([^"']+)["']/i);
      if (hm) return hm[1];
    }
  }
  return '';
}

function getRssUrl(b) {
  const link = getTag(b, 'link');
  const guid = getTag(b, 'guid');
  return sanitizeURL(link) ||
    (guid && !/^(tag:|urn:)/.test(guid) ? sanitizeURL(guid) : '');
}

function parseRSS(xml) {
  const isAtom  = xml.includes('xmlns="http://www.w3.org/2005/Atom"');
  const itemTag = isAtom ? 'entry' : 'item';
  const items   = [];

  for (const m of xml.matchAll(new RegExp(`<${itemTag}[\\s>][\\s\\S]*?<\\/${itemTag}>`, 'gi'))) {
    const b     = m[0];
    const title = sanitizeText(getTag(b, 'title'));
    const url   = isAtom ? sanitizeURL(getAtomLink(b)) : getRssUrl(b);
    const iso   = toISO(
      getTag(b, 'pubDate') || getTag(b, 'dc:date') ||
      getTag(b, 'published') || getTag(b, 'updated')
    );
    if (title && url) items.push({ title, url, iso });
  }

  items.sort((a, b) => (b.iso > a.iso ? 1 : -1));
  return items.slice(0, MAX_PER_FEED).map(({ iso, ...rest }) => ({
    ...rest,
    date: isoToDisplay(iso),
  }));
}

// ── fetch ──────────────────────────────────────────────────────────────────

async function fetchWithRetry(url) {
  let lastErr;
  for (let i = 0; i < RETRY_ATTEMPTS; i++) {
    if (i) { await sleep(RETRY_DELAY * i); console.warn(`  ↻ reintento ${i} → ${url}`); }
    
    // Seleccionamos el User-Agent correspondiente al intento actual
    const currentUA = USER_AGENTS[i % USER_AGENTS.length];
    const headers = { ...BASE_HEADERS, 'User-Agent': currentUA };

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FEED_TIMEOUT), headers: headers, redirect: 'follow' });
      
      if (!res.ok) {
        // Errores como 403 o 406 suelen ser bloqueos por User-Agent. NO los marcamos como permanentes.
        // Errores como 404 (No encontrado) sí son permanentes, no tiene sentido reintentar.
        const isBotBlock = res.status === 403 || res.status === 406 || res.status === 401;
        throw Object.assign(new Error(`HTTP ${res.status}`), { permanent: !isBotBlock });
      }
      
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_XML_BYTES) throw Object.assign(new Error('Feed demasiado grande'), { permanent: true });
      return buf;
      
    } catch (e) {
      lastErr = e;
      if (e.permanent) break; // Si es un error 404 o feed muy grande, nos rendimos aquí.
    }
  }
  throw lastErr;
}

async function fetchFavicon(siteUrl, cachedFavicon) {
  if (cachedFavicon) return cachedFavicon;
  try {
    const origin = new URL(siteUrl).origin;
    const url    = `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(origin)}&size=16`;
    const res    = await fetch(url, { signal: AbortSignal.timeout(FAVICON_TIMEOUT) });
    if (!res.ok) return '';
    const buf  = await res.arrayBuffer();
    const mime = (res.headers.get('content-type') || 'image/png').split(';')[0].trim();
    return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
  } catch { return cachedFavicon || ''; }
}

// ── fetchBlog ──────────────────────────────────────────────────────────────

async function fetchBlog({ name, url, feed }, cached) {
  const safeName = sanitizeText(name, MAX_NAME);
  const safeUrl  = sanitizeURL(url);
  const safeFeed = sanitizeURL(feed);

  if (!safeFeed) {
    console.warn(`✗ ${safeName}: feed URL inválida`);
    return { name: safeName, url: safeUrl, favicon: cached?.favicon || '', lastPosts: cached?.lastPosts || [], _latest: '' };
  }

  const faviconP = fetchFavicon(safeUrl, cached?.favicon || '');

  try {
    const [buf, favicon] = await Promise.all([
      fetchWithRetry(safeFeed),
      faviconP.then(f => f || cached?.favicon || ''),
    ]);
    const lastPosts = parseRSS(bufToXml(buf));
    const latest    = lastPosts[0]?.date
      ? toISO(lastPosts[0].date.split('/').reverse().join('-')) : '';
    console.log(`✓ ${safeName}: ${lastPosts.length} posts`);
    return { name: safeName, url: safeUrl, favicon, lastPosts, _latest: latest };
  } catch (e) {
    console.warn(`✗ ${safeName}: ${e.message}`);
    const favicon = await faviconP.catch(() => '') || cached?.favicon || '';
    if (cached) {
      const _latest = cached.lastPosts?.[0]
        ? toISO(cached.lastPosts[0].date.split('/').reverse().join('-')) : '';
      return { ...cached, favicon, _latest };
    }
    return { name: safeName, url: safeUrl, favicon, lastPosts: [], _latest: '' };
  }
}

// ── main ───────────────────────────────────────────────────────────────────

const feeds = JSON.parse(readFileSync('feeds.json', 'utf8'));

let cachedMap = new Map();
try {
  const prev = JSON.parse(readFileSync('lastposts.json', 'utf8'));
  for (const b of prev.blogs ?? []) if (b.url) cachedMap.set(b.url, b);
} catch { /* primera ejecución */ }

const raw = await Promise.all(
  feeds.map(f => fetchBlog(f, cachedMap.get(sanitizeURL(f.url))))
);

const blogs = raw
  .sort((a, b) => (b._latest > a._latest ? 1 : -1))
  .map(({ _latest, ...rest }) => rest);

writeFileSync('lastposts.json', JSON.stringify({ updated: new Date().toISOString(), blogs }, null, 2));
console.log(`\n✅ lastposts.json → ${blogs.length} blogs`);
