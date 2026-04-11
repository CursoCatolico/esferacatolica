// fetch-feeds.mjs
import { readFileSync, writeFileSync } from 'fs';

const MAX_PER_FEED = 3;

function parseRSS(xml) {
  const get = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
    return m ? m[1].trim() : '';
  };
  const items = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const b = m[1];
    const title = get(b, 'title');
    const url   = get(b, 'link') || get(b, 'guid');
    const raw   = get(b, 'pubDate') || get(b, 'dc:date') || '';
    const d     = raw ? new Date(raw) : null;
    const date  = d && !isNaN(d)
      ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
      : '';
    if (title && url) items.push({ title, url, date });
  }
  return items.slice(0, MAX_PER_FEED);
}

async function fetchBlog({ name, url, feed }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(feed, { signal: ctrl.signal });
    const xml = await res.text();
    const lastPosts = parseRSS(xml);
    console.log(`✓ ${name}: ${lastPosts.length} posts`);
    return { name, url, lastPosts };
  } catch (e) {
    console.warn(`✗ ${name}: ${e.message}`);
    return { name, url, lastPosts: [] };
  } finally {
    clearTimeout(t);
  }
}

const feeds = JSON.parse(readFileSync('feeds.json', 'utf8'));
const blogs = await Promise.all(feeds.map(fetchBlog));

writeFileSync('lastposts.json', JSON.stringify({ updated: new Date().toISOString(), blogs }, null, 2));
console.log(`\n✅ lastposts.json → ${blogs.length} blogs`);
