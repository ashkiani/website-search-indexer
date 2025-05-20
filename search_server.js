/**
 * searchServer_live_fixed.js
 *
 * Live-site search API (no MongoDB, no local copy, no node-fetch).
 * Requires Node v18+ (for built-in fetch).
 *
 * Usage:
 *   npm install express @ashkiani/express-responses
 *   SITE_URL=https://your-site.com node searchServer_live_fixed.js
 */

import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import { URL } from 'url';
import { sendJsonResponse } from '@ashkiani/express-responses';

// —— CONFIG ——
const JSON_PATH = './search_index.json';
const SITE_URL  = process.env.SITE_URL || 'https://your-site.com';

// —— LOAD INDEX ——
let indexData;
try {
  indexData = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  console.log(`✅ Loaded index with ${Object.keys(indexData).length} terms`);
} catch (err) {
  console.error(`❌ Failed to load ${JSON_PATH}:`, err);
  process.exit(1);
}

// —— HELPERS ——

/** Strip <head>, <script>, <style>, grab only what's inside <body>, then drop all tags */
function extractVisible(html) {
  html = html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = m ? m[1] : html;
  return body.replace(/<[^>]+>/g, ' ');
}

/** Fetch page via built-in fetch, return visible text */
async function fetchVisibleText(relUrl) {
  const full = new URL(relUrl, SITE_URL).toString();
  const res  = await fetch(full);
  if (!res.ok) throw new Error(`Fetch ${full} → ${res.status}`);
  const html = await res.text();
  return extractVisible(html);
}

/** Build up to 5 snippets (~120 chars window) around each match */
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
        m => `<mark>${m}</mark>`
      );
      snippets.push(snip.trim());
      idx = lowerText.indexOf(t, idx + t.length);
    }
    if (snippets.length >= 5) break;
  }
  return snippets;
}

/** Tokenize the user’s query */
function tokenize(q) {
  return (q.toLowerCase().match(/\w+/g) || []);
}

/** Lookup URLs in the inverted index */
function searchIndex(terms) {
  const urlSet = new Set();
  for (const term of terms) {
    const postings = indexData[term] || {};
    for (const url of Object.keys(postings)) {
      urlSet.add(url);
    }
  }
  return Array.from(urlSet);
}
import cors from 'cors';

// —— SERVER —— 
async function main() {
  const app = express();
  app.use(cors());                      // ← allow all origins

  app.use(bodyParser.json());

  app.post('/search', async (req, res) => {
    const query = (req.body.query || '').trim();
    const terms = tokenize(query);
    if (!terms.length) {
      return sendJsonResponse(res, 400, { error: 'Empty query' });
    }

    try {
      const urls = searchIndex(terms);
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

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🔍 Search API running on http://localhost:${port}`);
    console.log(`→ Crawling live pages under ${SITE_URL}`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
