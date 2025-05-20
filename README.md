# website-search-indexer

A self-contained toolkit to crawl and index any static website into JSON, serve searches via a lightweight Node.js API, and demo the results in a simple HTML page.

It helps you:

* ✅ Crawl a live site and build an inverted-index JSON
* ✅ Power searches with highlighted snippets via an Express API
* ✅ Showcase results in a plain HTML demo—no frameworks required

Perfect for on-premise site-search proof-of-concepts.

---

## 🚀 Quick Start

### 📌 1. Run the Indexer

```bash
pip install requests
python indexer_script.py https://your-site.com
```

* Crawls from `https://your-site.com`
* Flushes `search_index.json` every 50 pages (adjust `FLUSH_EVERY` in the script)
* Skips non-HTML URLs automatically

### 📌 2. Start the Search Server

```bash
npm install express @ashkiani/express-responses
SITE_URL=https://your-site.com node search_server.js
```

* Listens on `http://localhost:3000/search`
* CORS enabled for browser clients
* Expects `POST { "query": "…" }` → returns `{ results: [ { url, snippets: […] }, … ] }`

### 📌 3. Open the Demo Page

Open `search_demo.html` in your browser (double-click or serve via a static file server). Type a term and click **Search**—results will appear below.

---

## ⚙️ Configuration

* **FLUSH\_EVERY** in `indexer_script.py`: how many pages between JSON flushes
* **SITE\_URL** env var for the demo & server (default `https://your-site.com`)
* **PORT** env var for the server (default `3000`)

---

## 📁 File Overview

| File                           | Description                                                     |
| ------------------------------ | --------------------------------------------------------------- |
| `indexer_script.py`            | Python crawler that builds `search_index.json` from a live site |
| `search_server.js`             | Node.js Express API serving searches with highlighted snippets  |
| `search_demo.html`             | Simple HTML demo with a search box and result rendering         |

---

## 🔐 Requirements

* Python 3.8+
* Node.js 18+
* `npm` for server dependencies
* Internet access (to crawl your target site)

---

## 🙋 Author

Created by [Siavash Ashkiani](https://github.com/ashkiani). Pull requests and suggestions welcome!
