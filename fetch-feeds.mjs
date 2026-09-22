// fetch-feeds.mjs
import { createHash } from 'crypto';
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';

const MAX_PER_FEED    = 1;
const MAX_TITLE       = 320;
const MAX_NAME        = 120;
const MAX_XML_BYTES   = 4 * 1024 * 1024;
const FEED_TIMEOUT    = 30_000;
const FAVICON_TIMEOUT = 15_000;
const RETRY_ATTEMPTS  = 8;
const RETRY_DELAY     = 3_000;

// Categorías bloqueadas (normalizadas sin acentos ni mayúsculas)
const BLOCKED_CATS = new Set(['peliculas y videos', 'video', 'pelicula', 'peliculas', 'videos', 'descarga', 'descargar', 'videos recomendados', 'pelicula recomendada']);

const USER_AGENTS = [
  'Feedly/1.0 (http://www.feedly.com)',
  'Mozilla/5.0 (compatible; feedly-nikon/1.1; +https://feedly.com; 1 subscriber)',
  'FlipboardProxy/1.1; +http://flipboard.com/browserproxy',
  'Mozilla/5.0 (compatible; Wikitolica/1.0; +https://wikitolica.com)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0'
];

const BASE_HEADERS = {
  'Accept':                      'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7',
  'Accept-Language':             'es-ES,es;q=0.9,en;q=0.8',
  'Cache-Control':               'no-cache',
  'Connection':                  'keep-alive',
  'Upgrade-Insecure-Requests':   '1',
  'Sec-Fetch-Dest':              'document',
  'Sec-Fetch-Mode':              'navigate',
  'Sec-Fetch-Site':              'none',
  'Sec-Fetch-User':              '?1',
  'Referer':                     'https://www.google.com/',
  'DNT':                         '1',
  'Priority':                    'u=0, i',
  'sec-ch-ua':                   '"Chromium";v="134", "Google Chrome";v="134", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile':            '?0',
  'sec-ch-ua-platform':          '"Windows"',
  'sec-ch-ua-full-version-list': '"Chromium";v="134.0.0.0", "Google Chrome";v="134.0.0.0", "Not-A.Brand";v="99.0.0.0"'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── utils ──────────────────────────────────────────────────────────────────

// Elimina marcadores CDATA en cualquier posición del contenido
const stripCdata = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

function decodeHTMLEntities(s) {
  return s
    .replace(/&amp;/gi,  '&').replace(/&lt;/gi, '<').replace(/&gt;/gi,   '>')
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    // Fix: entidades decimales (&#123;) y hex (&#x7B;) en una sola pasada
    .replace(/&#(x[\da-fA-F]+|\d+);/gi, (_, n) => {
      const cp = /^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n);
      try { return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : ''; } catch { return ''; }
    });
}

function sanitizeText(s, maxLen = MAX_TITLE) {
  if (typeof s !== 'string') return '';
  // Fix: emojis eliminados dentro del pipeline, antes de trim/slice (no como wrapper externo)
  return decodeHTMLEntities(stripCdata(s))
    .replace(/<[^>]*>/g, '')
    .replace(/&[^;]{1,8};/g, ' ')
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200D\uFE0F]/gu, '')
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

// Normalización para comparar categorías: elimina diacríticos + lowercase
const normalizeForCompare = s =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Fix: \p{L}/\p{Ll} con flag u → cubre todo Unicode (Ü, Ö, Ä, etc.)
function isAllCaps(s) {
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters.length < 4) return false;
  return letters.replace(/\p{Ll}/gu, '').length / letters.length > 0.7;
}

// Fix: lowercase primero → luego capitaliza la primera letra real (no puntuación)
// Ej: «FELIZ DOMINGO» → «Feliz domingo  (antes: «feliz domingo)
const toSentenceCase = s => s.toLowerCase().replace(/\p{L}/u, c => c.toUpperCase());

// ── date utils ─────────────────────────────────────────────────────────────

const ES_MONTHS = {
  ene:'Jan', feb:'Feb', mar:'Mar', abr:'Apr', may:'May', jun:'Jun',
  jul:'Jul', ago:'Aug', sep:'Sep', oct:'Oct', nov:'Nov', dic:'Dec',
};

function normalizeDate(raw) {
  return raw
    .replace(/^[a-zA-Z]+[.,]+\s*/i, '')
    .replace(/\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\.?\b/gi,
      m => ES_MONTHS[m.toLowerCase().replace('.', '')] || m);
}

function toISO(raw) {
  if (!raw) return '';
  const d = new Date(normalizeDate(raw));
  return isNaN(d) ? '' : d.toISOString();
}

// Fix: getUTCDate/Month/FullYear → evita desfase ±1 día por zona horaria
function isoToDisplay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;
}

// ── XML decode con charset real ────────────────────────────────────────────

function bufToXml(buf) {
  const sniff = Buffer.from(buf.slice(0, 512)).toString('latin1');
  const enc   = (sniff.match(/encoding=["']([^"']+)["']/i) || [])[1] || 'utf-8';
  try {
    return new TextDecoder(enc, { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
}

// ── RSS/Atom parser ────────────────────────────────────────────────────────

// Fix: caché de RegExp compilados — evita new RegExp() en cada ítem × campo
const _reSingle = new Map();
const _reGlobal  = new Map();

function _tagRe(tag, global) {
  const map = global ? _reGlobal : _reSingle;
  if (!map.has(tag)) {
    const esc = tag.replace(':', '\\:');
    // Fix: captura contenido crudo sin intentar parsear CDATA en el regex;
    // stripCdata cubre cualquier posición del marcador (incluso contenido mixto).
    map.set(tag, new RegExp(`<${esc}[^>]*>([\\s\\S]*?)<\\/${esc}>`, global ? 'gi' : 'i'));
  }
  return map.get(tag);
}

function getTag(block, tag) {
  const m = block.match(_tagRe(tag, false));
  return m ? stripCdata(m[1]).trim() : '';
}

// Devuelve todos los valores (p.ej. múltiples <category>), con CDATA eliminado
function getTags(block, tag) {
  return [...block.matchAll(_tagRe(tag, true))].map(m => stripCdata(m[1]).trim());
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
  // [\s>] evita falsos positivos como <items> o <entry-foo>
  const itemRe = new RegExp(`<${itemTag}\\b[\\s\\S]*?<\\/${itemTag}>`, 'gi');
  const items   = [];

  for (const m of xml.matchAll(itemRe)) {
    const b = m[0];

    let title = sanitizeText(getTag(b, 'title'));
    title = title.replace(/Sin\s+Autor$/, '').trim();
    if (isAllCaps(title)) title = toSentenceCase(title);
    title = title.replace(/\p{Lu}{2,}(?:\s+\p{Lu}{2,})*/gu, s => toSentenceCase(s));
    title = title.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    
    // Filtrar por categoría — getTags→stripCdata cubre CDATA en <category>
    const cats = getTags(b, 'category').map(c => normalizeForCompare(sanitizeText(c, 100)));
    if (cats.some(c => BLOCKED_CATS.has(c))) continue;
    
    const url = isAtom ? sanitizeURL(getAtomLink(b)) : getRssUrl(b);
    const iso = toISO(
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
    const { host } = new URL(url);
    const headers  = { ...BASE_HEADERS, 'User-Agent': USER_AGENTS[i % USER_AGENTS.length], 'Host': host };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FEED_TIMEOUT), headers, redirect: 'follow', referrerPolicy: 'strict-origin-when-cross-origin' });
      if (!res.ok) {
        const isBotBlock = res.status === 401 || res.status === 403 || res.status === 406;
        throw Object.assign(new Error(`HTTP ${res.status}`), { permanent: !isBotBlock });
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_XML_BYTES) throw Object.assign(new Error('Feed demasiado grande'), { permanent: true });
      return buf;
    } catch (e) {
      lastErr = e;
      if (e.permanent) break;
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

// ── reparto por dominio ────────────────────────────────────────────────────
// Global lastposts.json = réplica del fichero legacy (widgets viejos cacheados
// siguen viendo lo mismo sin actualizar el .js).
// Por dominio: lastposts-<host>.json con [W + self + 3 invitados] (W: 4
// invitados), máx 5, ordenados por fecha como antes.
// Invitados estables (hash permanente H|C|v1) + recálculo hill-climbing que
// minimiza (1) pares recíprocos, (2) desbalance, (3) cambios vs previo.
// Subir PER_DOMAIN_SALT a 'v2' fuerza una remezcla manual completa.

const PER_DOMAIN_SALT = 'v1';
const GLOBAL_MAX      = 5;
const GUESTS_PER_FILE = 3;
// Host cuyo fichero se replica como lastposts.json global (tiene el widget
// viejo cacheado). Si desaparece: fallback a wikitolica, luego al primero.
const LEGACY_HOST = 'elobservadorenlinea.com';

const blogHost = url => {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
};
const WIKITOLICA_HOST = blogHost('https://www.wikitolica.com/');

const hash32 = s => createHash('sha256').update(s).digest().readUInt32BE(0);
const pairScore = (h, c) => hash32(`${h}|${c}|${PER_DOMAIN_SALT}`);

const slotCount = host => (host === WIKITOLICA_HOST ? GLOBAL_MAX - 1 : GUESTS_PER_FILE);

// Lee asignación previa (membresía, no orden): Map<host, Set<guestHost>>
function loadPrevAssignment() {
  const prev = new Map();
  let files = [];
  try { files = readdirSync('.'); } catch { return prev; }
  for (const f of files) {
    if (!/^lastposts-.+\.json$/.test(f)) continue;
    try {
      const data = JSON.parse(readFileSync(f, 'utf8'));
      const owner = data.forDomain || f.slice('lastposts-'.length, -'.json'.length);
      const set = new Set();
      for (const b of data.blogs ?? []) {
        const h = blogHost(b.url || '');
        if (h && h !== WIKITOLICA_HOST && h !== owner) set.add(h);
      }
      if (owner) prev.set(owner, set);
    } catch { /* fichero corrupto: se ignora y se recalculará */ }
  }
  return prev;
}

function prevAssignmentValid(prev, hosts) {
  if (prev.size !== hosts.length) return false;
  const set = new Set(hosts);
  for (const h of hosts) {
    const g = prev.get(h);
    if (!g || g.size !== Math.min(slotCount(h), hosts.filter(x => x !== WIKITOLICA_HOST && x !== h).length)) return false;
    for (const c of g) if (!set.has(c) || c === WIKITOLICA_HOST || c === h) return false;
  }
  return true;
}

// Métricas (W excluido de reciprocidad y balance por ser obligatorio)
function countReciprocal(assign, hosts) {
  const nonW = hosts.filter(h => h !== WIKITOLICA_HOST);
  let n = 0;
  for (let i = 0; i < nonW.length; i++)
    for (let j = i + 1; j < nonW.length; j++) {
      const a = nonW[i], b = nonW[j];
      if (assign.get(a)?.has(b) && assign.get(b)?.has(a)) n++;
    }
  return n;
}

function appearanceSpread(assign, hosts) {
  const nonW = hosts.filter(h => h !== WIKITOLICA_HOST);
  let lo = Infinity, hi = -Infinity;
  for (const d of nonW) {
    let n = 0;
    for (const h of hosts) if (assign.get(h)?.has(d) || h === d) n++;
    // h===d cuenta la aparición como self; los invitados vía assign
    if (n < lo) lo = n;
    if (n > hi) hi = n;
  }
  return nonW.length ? hi - lo : 0;
}

// Hill-climbing con deltas: cada swap g->c se evalúa sin mutar ni recalcular
// métricas completas. Solo el spread recorre el mapa de apariciones O(N);
// recíprocos y tocados son O(1). Rápido aunque N crezca en el Action.
function buildPerDomainAssignment(hosts, prev) {
  const sorted = [...hosts].sort();
  const nonW = new Set(sorted.filter(h => h !== WIKITOLICA_HOST));
  const candidatesOf = h => sorted.filter(c => c !== WIKITOLICA_HOST && c !== h);
  // Init: anillo sobre orden pseudo-aleatorio permanente → balance casi perfecto
  // y recíprocos mínimos desde el inicio; el hill-climbing solo pule.
  const ring = sorted.filter(h => h !== WIKITOLICA_HOST)
    .sort((a, b) => hash32(`ring|${a}|${PER_DOMAIN_SALT}`) - hash32(`ring|${b}|${PER_DOMAIN_SALT}`) || (a < b ? -1 : 1));
  const assign = new Map();
  for (const h of sorted) {
    if (h === WIKITOLICA_HOST) {
      assign.set(h, new Set(
        candidatesOf(h)
          .sort((a, b) => pairScore(h, b) - pairScore(h, a) || (a < b ? -1 : 1))
          .slice(0, Math.min(slotCount(h), candidatesOf(h).length))
      ));
    } else {
      const guests = [];
      const idx = ring.indexOf(h);
      for (let k = 1; k < ring.length && guests.length < Math.min(slotCount(h), ring.length - 1); k++)
        guests.push(ring[(idx + k) % ring.length]);
      assign.set(h, new Set(guests));
    }
  }

  // Estado incremental
  let rec = 0;
  for (const a of sorted) {
    if (!nonW.has(a)) continue;
    for (const b of assign.get(a))
      if (nonW.has(b) && a < b && assign.get(b)?.has(a)) rec++;
  }
  const app = new Map([...nonW].map(d => [d, 1])); // 1 = aparición como self
  for (const h of sorted) for (const g of assign.get(h)) app.set(g, (app.get(g) ?? 0) + 1);
  const spreadOf = m => {
    let lo = Infinity, hi = -Infinity;
    for (const n of m.values()) { if (n < lo) lo = n; if (n > hi) hi = n; }
    return hi - lo;
  };
  // ¿Difiere el set actual del fichero h respecto al previo?
  const isDirty = (h, set) => {
    const p = prev.get(h);
    return !p || p.size !== set.size || [...set].some(x => !p.has(x));
  };
  let dirty = 0;
  for (const h of sorted) if (isDirty(h, assign.get(h))) dirty++;
  let spread = spreadOf(app);

  const POOL = 12; // candidatos por swap: exacto con N pequeña, heurístico si N crece
  const maxIter = 5 * sorted.length + 50;
  for (let iter = 0; iter < maxIter; iter++) {
    let move = null;
    for (const h of sorted) {
      const cur = assign.get(h);
      if (!cur.size) continue;
      const hNonW = nonW.has(h);
      const wasDirty = isDirty(h, cur);
      const p = prev.get(h);
      const pool = candidatesOf(h).filter(x => !cur.has(x))
        .sort((a, b) => pairScore(h, b) - pairScore(h, a))
        .slice(0, POOL);
      for (const g of [...cur].sort()) {
        const losesRec = hNonW && nonW.has(g) && assign.get(g)?.has(h);
        for (const c of pool) {
          const gainsRec = hNonW && nonW.has(c) && assign.get(c)?.has(h);
          const r = rec - (losesRec ? 1 : 0) + (gainsRec ? 1 : 0);
          if (r > rec) continue; // poda: no mejora el objetivo principal
          let lo = Infinity, hi = -Infinity;
          for (const [d, n] of app) {
            const v = d === g ? n - 1 : d === c ? n + 1 : n;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          const s = hi - lo;
          if (r > rec || (r === rec && s > spread)) continue;
          // Tras el swap el set tendría el mismo tamaño: solo cambia dirty si
          // c no estaba en el previo o algún retenido falta en el previo.
          const nowDirty = !p || p.size !== cur.size || !p.has(c) ||
            [...cur].some(x => x !== g && !p.has(x));
          const d = dirty - (wasDirty ? 1 : 0) + (nowDirty ? 1 : 0);
          if (r === rec && s === spread && d >= dirty) continue;
          if (!move || r < move.r || (r === move.r && (s < move.s || (s === move.s && d < move.d))))
            move = { h, g, c, r, s, d };
        }
      }
    }
    if (!move) break;
    const cur = assign.get(move.h);
    cur.delete(move.g);
    cur.add(move.c);
    rec = move.r;
    app.set(move.g, app.get(move.g) - 1);
    app.set(move.c, (app.get(move.c) ?? 0) + 1);
    dirty = move.d;
    spread = move.s;
  }
  return { assign, metrics: { reciprocal: rec, spread, changed: dirty } };
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

const withLatest = raw.sort((a, b) => (b._latest > a._latest ? 1 : -1));
const blogs = withLatest.map(({ _latest, ...rest }) => rest);
const rankByUrl = new Map(blogs.map((b, i) => [b.url, i]));

const byHost = new Map();
for (const b of blogs) {
  const h = blogHost(b.url);
  if (h && !byHost.has(h)) byHost.set(h, b);
}
const hosts = [...byHost.keys()].sort();
const updated = new Date().toISOString();

// Por dominio: reutilizar membresía si N no cambió; recalcular si hay altas/bajas
const prevAssign = loadPrevAssignment();
let assign, metrics, mode;
if (prevAssignmentValid(prevAssign, hosts)) {
  assign = prevAssign;
  metrics = { reciprocal: countReciprocal(assign, hosts), spread: appearanceSpread(assign, hosts), changed: 0 };
  mode = 'estable (N sin cambios)';
} else {
  ({ assign, metrics } = buildPerDomainAssignment(hosts, prevAssign));
  mode = prevAssign.size ? 'recalculado (alta/baja)' : 'inicial';
}

const fileBlogsByHost = new Map();
for (const h of hosts) {
  const guests = assign.get(h) ?? new Set();
  const wanted = new Set([WIKITOLICA_HOST, h, ...guests]);
  const fileBlogs = [...wanted]
    .map(x => byHost.get(x))
    .filter(Boolean)
    .sort((a, b) => (rankByUrl.get(a.url) ?? 0) - (rankByUrl.get(b.url) ?? 0))
    .slice(0, GLOBAL_MAX);
  fileBlogsByHost.set(h, fileBlogs);
  writeFileSync(`lastposts-${h}.json`, JSON.stringify({ updated, forDomain: h, blogs: fileBlogs }, null, 2));
}
console.log(`✅ lastposts-<dominio>.json → ${hosts.length} ficheros (${mode}) | recíprocos=${metrics.reciprocal} desbalance=${metrics.spread} cambiados=${metrics.changed}`);

// Global = réplica del fichero legacy (widgets viejos cacheados ven lo mismo)
const legacyKey = fileBlogsByHost.has(LEGACY_HOST) ? LEGACY_HOST
  : fileBlogsByHost.has(WIKITOLICA_HOST) ? WIKITOLICA_HOST
  : [...fileBlogsByHost.keys()][0];
const legacyBlogs = legacyKey ? fileBlogsByHost.get(legacyKey) : [];
writeFileSync('lastposts.json', JSON.stringify({ updated, blogs: legacyBlogs }, null, 2));
console.log(`✅ lastposts.json → réplica de lastposts-${legacyKey}.json (${legacyBlogs.length} blogs)`);
