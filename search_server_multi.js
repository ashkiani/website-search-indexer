/**
 * searchServer_multi.js
 *
 * Node.js search API that loads multiple JSON index files from a directory,
 * searches them in parallel, and serves highlighted snippet results.
 *
 * Usage:
 *   npm install express @ashkiani/express-responses
 *   INDEX_DIR=./indexes SITE_URL=https://your-site.com node searchServer_multi.js
 */

import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import { sendJsonResponse } from '@ashkiani/express-responses';

// —— CONFIG ——
const INDEX_DIR = process.env.INDEX_DIR || path.join(process.cwd(), 'indexes');
const SITE_URL  = process.env.SITE_URL || 'https://your-site.com';
const PORT      = process.env.PORT     || 3000;

// —— LOAD MULTIPLE INDEXES ——
async function loadIndexes() {
  try {
    const files = await fs.promises.readdir(INDEX_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const indexes = await Promise.all(
      jsonFiles.map(async file => ({
        name: file,
        data: JSON.parse(
          await fs.promises.readFile(path.join(INDEX_DIR, file), 'utf8')
        )
      }))
    );
    indexes.forEach(idx => {
      console.log(`Loaded index ${idx.name}: ${Object.keys(idx.data).length} terms`);
    });
    return indexes;
  } catch (err) {
    console.error(`❌ Failed to load indexes from ${INDEX_DIR}:`, err);
    process.exit(1);
  }
}

// —— HELPERS ——

// 1) Strip <head>, <script>, <style>, grab only what's inside <body>, then drop all tags
function extractVisible(html) {
  const cleaned = html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const m = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = m ? m[1] : cleaned;
  return body.replace(/<[^>]+>/g, ' ');
}

// 2) Fetch page via built-in fetch, return visible text
async function fetchVisibleText(relUrl) {
  const full = new URL(relUrl, SITE_URL).toString();
  const res  = await fetch(full);
  if (!res.ok) throw new Error(`Fetch ${full} → ${res.status}`);
  const html = await res.text();
  return extractVisible(html);
}

// 3) Build up to 5 snippets (~120 chars window) around each match
async function buildSnippets(url, terms) {
  const text      = await fetchVisibleText(url);
  const lowerText = text.toLowerCase();
  const snippets  = [];

  for (const term of terms) {
    const t = term.toLowerCase();
    let idx = lowerText.indexOf(t);
    while (idx !== -1 && snippets.length < 5) {
      const start = Math.max(0, idx - 60);
      const end   = Math.min(text.length, idx + t.length + 60);
      let snip = text.slice(start, end);
      snip = snip.replace(
        new RegExp(t, 'gi'),
        match => `<mark>${match}</mark>`
      );
      snippets.push(snip.trim());
      idx = lowerText.indexOf(t, idx + t.length);
    }
    if (snippets.length >= 5) break;
  }
  return snippets;
}

// 4) Tokenize the user's query
function tokenize(q) {
  return (q.toLowerCase().match(/\w+/g) || []);
}

// —— SERVER ——
async function main() {
  const indexList = await loadIndexes();
  const app = express();

  // CORS headers for any origin
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });
  app.use(bodyParser.json());

  app.post('/search', async (req, res) => {
    const query = (req.body.query || '').trim();
    const terms = tokenize(query);
    if (!terms.length) {
      return sendJsonResponse(res, 400, { error: 'Empty query' });
    }

    try {
      // 1) Search all indexes in parallel
      const urlSet = new Set();
      await Promise.all(
        indexList.map(async idx => {
          for (const term of terms) {
            const postings = idx.data[term] || {};
            Object.keys(postings).forEach(url => urlSet.add(url));
          }
        })
      );
      const urls = Array.from(urlSet);

      // 2) Fetch snippets in parallel
      const results = await Promise.all(
        urls.map(async url => ({
          url,
          snippets: await buildSnippets(url, terms)
        }))
      );

      sendJsonResponse(res, 200, { results });
    } catch (err) {
      console.error('Search error:', err);
      sendJsonResponse(res, 500, { error: 'Internal error' });
    }
  });

  app.listen(PORT, () => {
    console.log(`🔍 Search API running on http://localhost:${PORT}`);
    console.log(`→ Serving indexes from ${INDEX_DIR}`);
    console.log(`→ Crawling live pages under ${SITE_URL}`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
