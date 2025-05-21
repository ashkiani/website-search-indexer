/**
 * searchServer_multi.js
 *
 * Node.js search API that loads multiple JSON index files from a directory,
 * supports exact phrase search (double-quoted), parallel index lookup, and snippet highlighting.
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

/**
 * Strip <head>, <script>, <style>, grab only what's inside <body>, then drop all tags
 */
function extractVisible(html) {
  const cleaned = html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const m = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = m ? m[1] : cleaned;
  return body.replace(/<[^>]+>/g, ' ');
}

/**
 * Fetch page via built-in fetch, return visible text
 */
async function fetchVisibleText(relUrl) {
  const full = new URL(relUrl, SITE_URL).toString();
  const res  = await fetch(full);
  if (!res.ok) throw new Error(`Fetch ${full} → ${res.status}`);
  const html = await res.text();
  return extractVisible(html);
}

/**
 * Build up to 5 snippets (~120 chars) around each match
 */
async function buildSnippets(url, snippetTerms) {
  const text      = await fetchVisibleText(url);
  const lowerText = text.toLowerCase();
  const snippets  = [];

  for (const term of snippetTerms) {
    const t = term.toLowerCase();
    let idx = lowerText.indexOf(t);
    while (idx !== -1 && snippets.length < 5) {
      const start = Math.max(0, idx - 60);
      const end   = Math.min(text.length, idx + t.length + 60);
      let snip = text.slice(start, end);
      snip = snip.replace(new RegExp(t, 'gi'), m => `<mark>${m}</mark>`);
      snippets.push(snip.trim());
      idx = lowerText.indexOf(t, idx + t.length);
    }
    if (snippets.length >= 5) break;
  }
  return snippets;
}

/**
 * Tokenize the user's query
 */
function tokenize(q) {
  return (q.toLowerCase().match(/\w+/g) || []);
}

/**
 * Exact phrase search using term positions in each index
 */
function searchPhraseIndexes(indexList, terms) {
  const resultUrls = new Set();
  if (!terms.length) return [];
  const [first, ...rest] = terms;
  for (const idx of indexList) {
    const firstPostings = idx.data[first] || {};
    for (const [url, positions] of Object.entries(firstPostings)) {
      for (const p of positions) {
        let match = true;
        for (let i = 0; i < rest.length; i++) {
          const term = rest[i];
          const postings = idx.data[term] || {};
          const posList = postings[url] || [];
          if (!posList.includes(p + i + 1)) {
            match = false;
            break;
          }
        }
        if (match) {
          resultUrls.add(url);
          break;
        }
      }
    }
  }
  return Array.from(resultUrls);
}

/**
 * OR search across all terms and indexes
 */
function searchTermIndexes(indexList, terms) {
  const urlSet = new Set();
  for (const idx of indexList) {
    for (const term of terms) {
      const postings = idx.data[term] || {};
      Object.keys(postings).forEach(url => urlSet.add(url));
    }
  }
  return Array.from(urlSet);
}

// —— SERVER ——
async function main() {
  const indexList = await loadIndexes();
  const app = express();

  // CORS
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });
  app.use(bodyParser.json());

  app.post('/search', async (req, res) => {
    const rawQuery = (req.body.query || '').trim();
    if (!rawQuery) {
      return sendJsonResponse(res, 400, { error: 'Empty query' });
    }

    const isPhrase = rawQuery.startsWith('"') && rawQuery.endsWith('"');
    let phrase = '';
    let terms = [];
    let urls = [];

    if (isPhrase) {
      phrase = rawQuery.slice(1, -1);
      terms = tokenize(phrase);
      urls = searchPhraseIndexes(indexList, terms);
    } else {
      terms = tokenize(rawQuery);
      urls = searchTermIndexes(indexList, terms);
    }

    // Decide snippet terms: entire phrase or individual terms
    const snippetTerms = isPhrase ? [phrase] : terms;

    try {
      const results = await Promise.all(
        urls.map(async url => ({
          url,
          snippets: await buildSnippets(url, snippetTerms)
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