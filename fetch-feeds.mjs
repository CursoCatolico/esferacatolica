// fetch-feeds.mjs
import { readFileSync, writeFileSync } from 'fs';

const MAX_PER_FEED = 3;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; EsferaCatolica/1.0; +https://wikitolica.com)' };

function isURL(s) {
  try { return /^https?:/.test(new URL(s).protocol); } catch { return false; }
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

function parseRSS(xml) {
  // Detecta Atom por namespace en lugar de buscar <entry> en contenido
  const isAtom = /xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/.test(xml);
  const itemTag = isAtom ? 'entry' : 'item';
  // [^>]* consume atributos del tag raíz sin incluirlos en la captura
  const itemRx = new RegExp(`<${itemTag}[^>]*>([\\s\\S]*?)<\\/${itemTag}>`, 'g');

  const items = [];
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const b     = m[1];
    const title = getTag(b, 'title');

    let url = '';
    if (isAtom) {
      // Atom: <link rel="alternate" href="..."/> o <link href="..."/>
      const lm = b.match(/<link[^>]+href="([^"]+)"/);
      url = lm ? lm[1] : '';
    } else {
      const link = getTag(b, 'link');
      const guid = getTag(b, 'guid');
      url = isURL(link) ? link : isURL(guid) ? guid : '';
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
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(feed, { signal: ctrl.signal, headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml       = await res.text();
    const lastPosts = parseRSS(xml);
    // Reconstruir ISO desde dd/mm/yyyy para ordenar blogs
    const latest = lastPosts[0]?.date
      ? toISO(lastPosts[0].date.split('/').reverse().join('-'))
      : '';
    console.log(`✓ ${name}: ${lastPosts.length} posts`);
    return { name, url, lastPosts, _latest: latest };
  } catch (e) {
    console.warn(`✗ ${name}: ${e.message}`);
    return { name, url, lastPosts: [], _latest: '' };
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
