"""
recommendations.py — Libraria Python Recommendation Engine
===========================================================
Standalone version for server-side or batch use.
The same algorithms run in-browser via Pyodide (recommendations-py.js).

Usage:
    python recommendations.py

Requires: pandas, scikit-learn
Install:  pip install pandas scikit-learn
"""

import math
import re
from collections import Counter, defaultdict

import pandas as pd

# ──────────────────────────────────────────────────────────────────────────────
# Pure-Python TF-IDF (mirrors Pyodide version — no sklearn dependency needed)
# ──────────────────────────────────────────────────────────────────────────────

def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z]+", (text or "").lower())


def tfidf_matrix(docs: list[str]) -> list[dict]:
    """Return a list of normalized TF-IDF vectors (one per document)."""
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
        norm = math.sqrt(sum(v ** 2 for v in vec.values())) or 1
        vectors.append({t: v / norm for t, v in vec.items()})
    return vectors


def cosine_sim(v1: dict, v2: dict) -> float:
    common = set(v1) & set(v2)
    return sum(v1[t] * v2[t] for t in common)


# ──────────────────────────────────────────────────────────────────────────────
# sklearn-backed variant (optional, more robust for large corpora)
# ──────────────────────────────────────────────────────────────────────────────
def _try_sklearn_matrix(docs):
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity
        vectorizer = TfidfVectorizer(stop_words="english")
        matrix = vectorizer.fit_transform(docs)
        return matrix, cosine_similarity
    except ImportError:
        return None, None


# ──────────────────────────────────────────────────────────────────────────────
# Content-based filtering
# ──────────────────────────────────────────────────────────────────────────────

def content_recommendations(books: pd.DataFrame, book_id: str, top_n: int = 6) -> pd.DataFrame:
    """Return top_n books most similar to book_id by content (title+author+domain+description)."""
    books = books.copy()
    books["features"] = books[["title", "author", "domain", "description"]].fillna("").agg(" ".join, axis=1)

    docs = books["features"].tolist()
    matrix, cos_sim = _try_sklearn_matrix(docs)

    if matrix is not None:
        idx_series = books.index[books["id"] == book_id]
        if idx_series.empty:
            return pd.DataFrame()
        idx = idx_series[0]
        sims = cos_sim(matrix[idx : idx + 1], matrix).flatten()
        similar_idx = sims.argsort()[::-1]
        result = books.iloc[similar_idx]
        result = result[result["id"] != book_id]
        return result[["id", "title", "author", "domain"]].head(top_n)

    # Fallback: pure Python
    vectors = tfidf_matrix(docs)
    ids = books["id"].tolist()
    if book_id not in ids:
        return pd.DataFrame()
    target_vec = vectors[ids.index(book_id)]
    sims = [
        (cosine_sim(target_vec, vectors[i]), row)
        for i, (_, row) in enumerate(books.iterrows())
        if row["id"] != book_id
    ]
    sims.sort(key=lambda x: -x[0])
    top = pd.DataFrame([row for _, row in sims[:top_n]])
    return top[["id", "title", "author", "domain"]] if not top.empty else top


# ──────────────────────────────────────────────────────────────────────────────
# Collaborative filtering (domain-based)
# ──────────────────────────────────────────────────────────────────────────────

def collab_recommendations(books: pd.DataFrame, borrows: pd.DataFrame, user_id: str, top_n: int = 6) -> pd.DataFrame:
    """
    Recommend books based on what users with similar domain interests have borrowed.
    Falls back to popularity ranking for cold-start users.
    """
    user_borrows = borrows[borrows["user_id"] == user_id]["book_id"].tolist()
    user_books = books[books["id"].isin(user_borrows)]
    user_domains = user_books["domain"].value_counts()

    if user_domains.empty:
        # Cold start: return most borrowed books
        popularity = borrows["book_id"].value_counts()
        popular_books = books[~books["id"].isin(user_borrows)].copy()
        popular_books["pop_score"] = popular_books["id"].map(popularity).fillna(0)
        return popular_books.sort_values("pop_score", ascending=False)[["id", "title", "author", "domain"]].head(top_n)

    unread = books[~books["id"].isin(user_borrows)].copy()
    unread["dom_score"] = unread["domain"].map(user_domains).fillna(0)
    return unread.sort_values("dom_score", ascending=False)[["id", "title", "author", "domain"]].head(top_n)


# ──────────────────────────────────────────────────────────────────────────────
# Hybrid (content + collaborative + popularity)
# ──────────────────────────────────────────────────────────────────────────────

def hybrid_recommendations(
    books: pd.DataFrame,
    borrows: pd.DataFrame,
    user_id: str,
    last_book_id: str | None = None,
    top_n: int = 6,
) -> pd.DataFrame:
    """
    Blend:
      40% domain collaborative score
      40% content similarity to last borrowed book
      20% global popularity
    """
    user_borrows = set(borrows[borrows["user_id"] == user_id]["book_id"].tolist())
    unread = books[~books["id"].isin(user_borrows)].copy()

    # Popularity
    popularity = borrows["book_id"].value_counts()
    max_pop = popularity.max() if not popularity.empty else 1
    unread["pop_score"] = unread["id"].map(popularity).fillna(0) / max_pop

    # Collaborative domain score
    user_books = books[books["id"].isin(user_borrows)]
    user_domains = user_books["domain"].value_counts()
    max_dom = user_domains.max() if not user_domains.empty else 1
    unread["dom_score"] = unread["domain"].map(user_domains).fillna(0) / max_dom

    # Content similarity to last book
    content_scores = {}
    if last_book_id and last_book_id in books["id"].values:
        all_books = books.copy()
        all_books["features"] = all_books[["title", "author", "domain", "description"]].fillna("").agg(" ".join, axis=1)
        docs = all_books["features"].tolist()
        vectors = tfidf_matrix(docs)
        ids = all_books["id"].tolist()
        target_vec = vectors[ids.index(last_book_id)]
        for i, bid in enumerate(ids):
            if bid != last_book_id:
                content_scores[bid] = cosine_sim(target_vec, vectors[i])
    unread["content_score"] = unread["id"].map(content_scores).fillna(0)

    unread["hybrid_score"] = (
        0.4 * unread["dom_score"] +
        0.4 * unread["content_score"] +
        0.2 * unread["pop_score"]
    )
    return unread.sort_values("hybrid_score", ascending=False)[["id", "title", "author", "domain"]].head(top_n)


# ──────────────────────────────────────────────────────────────────────────────
# CLI demo
# ──────────────────────────────────────────────────────────────────────────────

def main():
    print("Libraria Recommendation Engine — demo with synthetic data\n")

    books = pd.DataFrame([
        {"id": "b1", "title": "Introduction to Algorithms",     "author": "Cormen",    "domain": "Computer Science",  "description": "algorithms data structures"},
        {"id": "b2", "title": "Clean Code",                     "author": "Martin",    "domain": "Computer Science",  "description": "software engineering best practices"},
        {"id": "b3", "title": "The Pragmatic Programmer",       "author": "Hunt",      "domain": "Computer Science",  "description": "programming career advice"},
        {"id": "b4", "title": "Calculus",                       "author": "Stewart",   "domain": "Mathematics",       "description": "differential integral calculus"},
        {"id": "b5", "title": "Linear Algebra Done Right",      "author": "Axler",     "domain": "Mathematics",       "description": "linear algebra vectors matrices"},
        {"id": "b6", "title": "Sapiens",                        "author": "Harari",    "domain": "History",           "description": "brief history of humankind"},
        {"id": "b7", "title": "1984",                           "author": "Orwell",    "domain": "Literature",        "description": "dystopian political fiction"},
        {"id": "b8", "title": "Thinking Fast and Slow",         "author": "Kahneman",  "domain": "Economics",         "description": "behavioural economics psychology"},
    ])

    borrows = pd.DataFrame([
        {"user_id": "u1", "book_id": "b1"},
        {"user_id": "u1", "book_id": "b2"},
        {"user_id": "u2", "book_id": "b4"},
        {"user_id": "u2", "book_id": "b5"},
        {"user_id": "u3", "book_id": "b1"},
        {"user_id": "u3", "book_id": "b6"},
        {"user_id": "u4", "book_id": "b7"},
    ])

    print("── Content-based (similar to 'Introduction to Algorithms') ──")
    print(content_recommendations(books, "b1", top_n=3).to_string(index=False))

    print("\n── Collaborative (user u1: CS reader) ──")
    print(collab_recommendations(books, borrows, "u1", top_n=3).to_string(index=False))

    print("\n── Hybrid (user u2, last book: Calculus) ──")
    print(hybrid_recommendations(books, borrows, "u2", last_book_id="b4", top_n=3).to_string(index=False))


if __name__ == "__main__":
    main()
