// fetch-feeds.mjs
import { readFileSync, writeFileSync } from 'fs';

const MAX_PER_FEED = 3;
const MAX_TITLE    = 300;
const MAX_NAME     = 100;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.178 Mobile Safari/537.36' };
const MAX_XML_BYTES = 2 * 1024 * 1024;

function sanitizeText(s, maxLen = MAX_TITLE) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#\d+|#x[\da-fA-F]+|[a-zA-Z]+);/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function decodeHTMLEntities(s) {
  return s
    .replace(/&amp;/gi,  '&')
    .replace(/&lt;/gi,   '<')
    .replace(/&gt;/gi,   '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")                               // FIX 3
    .replace(/&#(\d+);/g, (_, n) => {                      // FIX 2
      const cp = Number(n);
      try { return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : ''; } catch { return ''; }
    })
    .replace(/&#x([\da-fA-F]+);/gi, (_, h) => {            // FIX 2
      const cp = parseInt(h, 16);
      try { return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : ''; } catch { return ''; }
    });
}

function sanitizeURL(s) {
  if (typeof s !== 'string') return '';
  try {
    const u = new URL(decodeHTMLEntities(s.trim()));
    if (!/^https?:$/.test(u.protocol)) return '';
    if (/[<>"'\s]/.test(u.href)) return '';
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

function getTag(block, tag) {
  const escaped = tag.replace(':', '\\:');
  const m = block.match(new RegExp(`<${escaped}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${escaped}>`));
  return m ? m[1].trim() : '';
}

function getAtomLink(block) {
  // FIX 1: acepta href y rel en cualquier orden
  for (const m of block.matchAll(/<link([^>]+)>/g)) {
    const attrs = m[1];
    if (/rel=["']alternate["']/.test(attrs)) {
      const hm = attrs.match(/href="([^"]+)"/);
      if (hm) return hm[1];
    }
  }
  // fallback: primer href encontrado
  const fb = block.match(/<link[^>]+href="([^"]+)"/);
  return fb ? fb[1] : '';
}

function parseRSS(xml) {
  const isAtom  = /xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/.test(xml);
  const itemTag = isAtom ? 'entry' : 'item';
  const itemRx  = new RegExp(`<${itemTag}[^>]*>([\\s\\S]*?)<\\/${itemTag}>`, 'g');

  const items = [];
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const b     = m[1];
    const title = sanitizeText(getTag(b, 'title'));

    let url = '';
    if (isAtom) {
      url = sanitizeURL(getAtomLink(b));
    } else {
      const link = getTag(b, 'link');
      const guid = getTag(b, 'guid');
      url = sanitizeURL(link) || sanitizeURL(guid);
    }

    const raw = getTag(b, 'pubDate') || getTag(b, 'dc:date') ||
                getTag(b, 'published') || getTag(b, 'updated') || '';
    const iso = toISO(raw);

    if (title && url) items.push({ title, url, iso });
  }

  items.sort((a, b) => (b.iso > a.iso ? 1 : -1));

  return items.slice(0, MAX_PER_FEED).map(({ iso, ...rest }) => ({
    ...rest,
    date: isoToDisplay(iso),
  }));
}

async function fetchBlog({ name, url, feed }) {
  const safeName = sanitizeText(name, MAX_NAME);
  const safeUrl  = sanitizeURL(url);
  const safeFeed = sanitizeURL(feed);

  if (!safeFeed) {
    console.warn(`✗ ${name}: feed URL inválida`);
    return { name: safeName, url: safeUrl, lastPosts: [], _latest: '' };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(safeFeed, { signal: ctrl.signal, headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_XML_BYTES) throw new Error('Feed demasiado grande');
    const xml = new TextDecoder().decode(buf);
    const lastPosts = parseRSS(xml);
    const latest    = lastPosts[0]?.date
      ? toISO(lastPosts[0].date.split('/').reverse().join('-'))
      : '';
    console.log(`✓ ${safeName}: ${lastPosts.length} posts`);
    return { name: safeName, url: safeUrl, lastPosts, _latest: latest };
  } catch (e) {
    console.warn(`✗ ${safeName}: ${e.message}`);
    return { name: safeName, url: safeUrl, lastPosts: [], _latest: '' };
  } finally {
    clearTimeout(t);
  }
}

const feeds = JSON.parse(readFileSync('feeds.json', 'utf8'));
const raw   = await Promise.all(feeds.map(fetchBlog));

const blogs = raw
  .sort((a, b) => (b._latest > a._latest ? 1 : -1))
  .map(({ _latest, ...rest }) => rest);

writeFileSync('lastposts.json', JSON.stringify({ updated: new Date().toISOString(), blogs }, null, 2));
console.log(`\n✅ lastposts.json → ${blogs.length} blogs`);
