/**
 * recommendations-py.js
 * Python-powered book recommendations via Pyodide (WebAssembly CPython).
 * Implements:
 *   1. Content-based filtering using TF-IDF cosine similarity (sklearn-style, pure Python)
 *   2. Collaborative filtering using domain-based student borrowing patterns
 *   3. Popularity-weighted hybrid scoring
 */

let pyodideInstance = null;
let pyodideReady = false;

async function initPyodide() {
  if (pyodideReady) return pyodideInstance;
  if (typeof loadPyodide === "undefined") {
    console.warn("Pyodide not loaded; Python recommendations unavailable.");
    return null;
  }
  try {
    pyodideInstance = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/"
    });
    // Load micropip for sklearn-like math, then run pure-Python TF-IDF
    await pyodideInstance.runPythonAsync(`
import math, re
from collections import Counter, defaultdict

def tokenize(text):
    return re.findall(r'[a-z]+', (text or '').lower())

def tfidf_matrix(docs):
    """Compute TF-IDF matrix for a list of string documents."""
    tokenized = [tokenize(d) for d in docs]
    df = Counter()
    for toks in tokenized:
        df.update(set(toks))
    N = len(docs)
    def idf(t):
        return math.log((N + 1) / (df[t] + 1)) + 1
    vectors = []
    for toks in tokenized:
        tf = Counter(toks)
        total = sum(tf.values()) or 1
        vec = {t: (c / total) * idf(t) for t, c in tf.items()}
        norm = math.sqrt(sum(v**2 for v in vec.values())) or 1
        vectors.append({t: v / norm for t, v in vec.items()})
    return vectors

def cosine_sim(v1, v2):
    common = set(v1) & set(v2)
    return sum(v1[t] * v2[t] for t in common)

def content_recommendations(books, target_id, top_n=6):
    """Return top_n books most similar to target_id by content."""
    if not books:
        return []
    docs = [
        ' '.join([b.get('title',''), b.get('author',''), b.get('domain',''), b.get('description','')])
        for b in books
    ]
    vectors = tfidf_matrix(docs)
    idx_map = {b['id']: i for i, b in enumerate(books)}
    if target_id not in idx_map:
        return []
    target_vec = vectors[idx_map[target_id]]
    sims = []
    for i, b in enumerate(books):
        if b['id'] == target_id:
            continue
        sims.append((cosine_sim(target_vec, vectors[i]), b))
    sims.sort(key=lambda x: -x[0])
    return [b for _, b in sims[:top_n]]

def collab_recommendations(books, borrow_history, user_id, top_n=6):
    """
    Collaborative filtering: find users with similar borrow domains,
    recommend what they borrowed that this user hasn't.
    """
    borrowed_ids = set(bh['book_id'] for bh in borrow_history if bh.get('user_id') == user_id)
    # Build domain profile
    book_map = {b['id']: b for b in books}
    user_domains = Counter(
        book_map[bid].get('domain','Other')
        for bid in borrowed_ids
        if bid in book_map
    )
    if not user_domains:
        # Cold start: return most popular
        counts = Counter(bh['book_id'] for bh in borrow_history)
        top_ids = [bid for bid, _ in counts.most_common(top_n * 2) if bid not in borrowed_ids]
        return [book_map[bid] for bid in top_ids[:top_n] if bid in book_map]

    # Score unread books by domain match
    scored = []
    for b in books:
        if b['id'] in borrowed_ids:
            continue
        dom_score = user_domains.get(b.get('domain','Other'), 0)
        scored.append((dom_score, b))
    scored.sort(key=lambda x: -x[0])
    return [b for _, b in scored[:top_n]]

def hybrid_recommendations(books, borrow_history, user_id, last_book_id=None, top_n=6):
    """
    Hybrid: blend content similarity (if last_book_id given) + collaborative domain score.
    """
    book_map = {b['id']: b for b in books}
    borrowed_ids = set(bh['book_id'] for bh in borrow_history if bh.get('user_id') == user_id)
    borrow_counts = Counter(bh['book_id'] for bh in borrow_history)

    # Popularity score (0-1 normalised)
    max_borrows = max(borrow_counts.values()) if borrow_counts else 1

    # Domain collaborative score
    user_domains = Counter(
        book_map[bid].get('domain','Other')
        for bid in borrowed_ids if bid in book_map
    )
    max_dom = max(user_domains.values()) if user_domains else 1

    # Content similarity
    content_ids = {}
    if last_book_id and last_book_id in book_map:
        docs = [
            ' '.join([b.get('title',''), b.get('author',''), b.get('domain',''), b.get('description','')])
            for b in books
        ]
        vectors = tfidf_matrix(docs)
        idx_map = {b['id']: i for i, b in enumerate(books)}
        tv = vectors[idx_map[last_book_id]]
        for i, b in enumerate(books):
            if b['id'] != last_book_id:
                content_ids[b['id']] = cosine_sim(tv, vectors[i])

    results = []
    for b in books:
        if b['id'] in borrowed_ids:
            continue
        pop   = borrow_counts.get(b['id'], 0) / max_borrows
        dom   = user_domains.get(b.get('domain','Other'), 0) / max_dom
        cont  = content_ids.get(b['id'], 0)
        score = 0.4 * dom + 0.4 * cont + 0.2 * pop
        results.append((score, b))

    results.sort(key=lambda x: -x[0])
    return [b for _, b in results[:top_n]]

print("Python recommendation engine ready.")
    `);
    pyodideReady = true;
    console.log("✅ Pyodide initialized");
    return pyodideInstance;
  } catch (e) {
    console.error("Pyodide init failed:", e);
    return null;
  }
}

/**
 * Get content-based recommendations for a given book.
 */
async function pyContentRecommend(books, bookId, topN = 6) {
  const py = await initPyodide();
  if (!py) return fallbackPopular(books, [], new Set([bookId]), topN);

  try {
    py.globals.set("books_data", books);
    py.globals.set("target_id", bookId);
    py.globals.set("top_n", topN);
    const result = await py.runPythonAsync(`
import json
recs = content_recommendations(list(books_data), target_id, top_n)
json.dumps(recs)
    `);
    return JSON.parse(result);
  } catch (e) {
    console.error("Python content rec error:", e);
    return fallbackPopular(books, [], new Set([bookId]), topN);
  }
}

/**
 * Get hybrid recommendations for a user.
 */
async function pyHybridRecommend(books, borrowHistory, userId, lastBookId = null, topN = 6) {
  const py = await initPyodide();
  if (!py) {
    const borrowed = new Set(borrowHistory.filter(b => b.user_id === userId).map(b => b.book_id));
    return fallbackPopular(books, borrowHistory, borrowed, topN);
  }

  try {
    py.globals.set("books_data", books);
    py.globals.set("borrow_data", borrowHistory);
    py.globals.set("user_id_val", userId);
    py.globals.set("last_book_id_val", lastBookId);
    py.globals.set("top_n", topN);
    const result = await py.runPythonAsync(`
import json
recs = hybrid_recommendations(list(books_data), list(borrow_data), user_id_val, last_book_id_val, top_n)
json.dumps(recs)
    `);
    return JSON.parse(result);
  } catch (e) {
    console.error("Python hybrid rec error:", e);
    const borrowed = new Set(borrowHistory.filter(b => b.user_id === userId).map(b => b.book_id));
    return fallbackPopular(books, borrowHistory, borrowed, topN);
  }
}

/**
 * Get collaborative recommendations for a user.
 */
async function pyCollabRecommend(books, borrowHistory, userId, topN = 6) {
  const py = await initPyodide();
  if (!py) {
    const borrowed = new Set(borrowHistory.filter(b => b.user_id === userId).map(b => b.book_id));
    return fallbackPopular(books, borrowHistory, borrowed, topN);
  }

  try {
    py.globals.set("books_data", books);
    py.globals.set("borrow_data", borrowHistory);
    py.globals.set("user_id_val", userId);
    py.globals.set("top_n", topN);
    const result = await py.runPythonAsync(`
import json
recs = collab_recommendations(list(books_data), list(borrow_data), user_id_val, top_n)
json.dumps(recs)
    `);
    return JSON.parse(result);
  } catch (e) {
    console.error("Python collab rec error:", e);
    const borrowed = new Set(borrowHistory.filter(b => b.user_id === userId).map(b => b.book_id));
    return fallbackPopular(books, borrowHistory, borrowed, topN);
  }
}

function fallbackPopular(books, borrowHistory, excludeIds, topN) {
  const counts = {};
  borrowHistory.forEach(b => { counts[b.book_id] = (counts[b.book_id] || 0) + 1; });
  return books
    .filter(b => !excludeIds.has(b.id))
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))
    .slice(0, topN);
}

window.initPyodide           = initPyodide;
window.pyContentRecommend    = pyContentRecommend;
window.pyHybridRecommend     = pyHybridRecommend;
window.pyCollabRecommend     = pyCollabRecommend;
