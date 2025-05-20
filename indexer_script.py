#!/usr/bin/env python3
"""
indexer_live_single_fixed.py

– Single-threaded crawl + index
– Flush index to JSON every FLUSH_EVERY pages
– Only visible text under <body>
– Correct link resolution: use current page URL as base
– Skip non-HTML URLs
– Safe parsing with error catches
– Usage: python indexer_live_single_fixed.py https://your-site.com
"""

import sys
import json
import re
import requests
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from os.path import splitext

# ——— CONFIG ———
if len(sys.argv) < 2:
    print("Usage: python indexer_live_single_fixed.py https://your-site.com")
    sys.exit(1)

START_URL   = sys.argv[1]
DOMAIN      = urlparse(START_URL).netloc
OUTPUT_JSON = 'search_index.json'
FLUSH_EVERY = 50   # write the JSON every 50 pages

# Allowed URL patterns: directories, .html/.htm, or no extension
def is_likely_html(url):
    path = urlparse(url).path
    root, ext = splitext(path)
    if ext in ('', '.html', '.htm'):
        return True
    # trailing slash (directory)
    if path.endswith('/'):
        return True
    return False

# ——— PARSERS ———
class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_body = False
        self.skip    = False
        self.chunks  = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == 'body':
            self.in_body = True
        elif self.in_body and tag in ('script', 'style', 'head'):
            self.skip = True

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag == 'body':
            self.in_body = False
        elif tag in ('script', 'style', 'head'):
            self.skip = False

    def handle_data(self, data):
        if self.in_body and not self.skip:
            self.chunks.append(data)

    def text(self):
        return ' '.join(self.chunks)

class LinkExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'a':
            for (k, v) in attrs:
                if k.lower() == 'href' and v:
                    self.links.append(v)

# ——— HELPERS ———
def tokenize(text):
    return [tok.lower() for tok in re.split(r'\W+', text) if tok]

def flush_index(idx):
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(idx, f)
    print(f"→ Flushed index ({len(idx)} terms) to {OUTPUT_JSON}")

# ——— CRAWL & INDEX ———
def main():
    to_crawl   = [START_URL]
    seen       = set()
    index      = {}
    page_count = 0

    while to_crawl:
        url = to_crawl.pop(0)
        if url in seen:
            continue
        seen.add(url)

        # Skip obviously non-HTML URLs
        if not is_likely_html(url):
            print(f"→ Skipping non-HTML URL: {url}")
            continue

        try:
            r = requests.get(url, timeout=10)
            r.raise_for_status()
        except Exception as e:
            print(f"✗ Failed to fetch: {url}  ({e})")
            continue

        # Skip if content-type isn’t HTML
        content_type = r.headers.get('Content-Type', '')
        if 'text/html' not in content_type:
            print(f"→ Skipping non-HTML content: {url} [{content_type}]")
            continue

        html = r.text

        # Everything from here on is “best-effort” parsing
        try:
            # 1) Extract visible text
            te = TextExtractor()
            te.feed(html)
            tokens = tokenize(te.text())

            # 2) Update inverted index
            for pos, term in enumerate(tokens):
                postings = index.setdefault(term, {})
                postings.setdefault(url, []).append(pos)

            # 3) Enqueue same-domain HTML links
            le = LinkExtractor()
            le.feed(html)
            for href in le.links:
                candidate = href.split('#')[0]
                abs_link  = urljoin(url, candidate)
                if (urlparse(abs_link).netloc == DOMAIN
                    and abs_link not in seen
                    and is_likely_html(abs_link)):
                    to_crawl.append(abs_link)

            page_count += 1
            if page_count % FLUSH_EVERY == 0:
                print(f"Indexed {page_count} pages (queue: {len(to_crawl)})")
                flush_index(index)

        except Exception as e:
            print(f"⚠️  Error parsing/indexing {url}: {e}")
            continue

    # final flush
    print(f"\nDone! Total pages indexed: {page_count}")
    flush_index(index)

if __name__ == '__main__':
    main()
