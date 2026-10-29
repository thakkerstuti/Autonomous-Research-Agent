import os
from dotenv import load_dotenv
from tavily import TavilyClient

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv()

_tavily_client = None

def get_tavily_client():
    global _tavily_client
    if _tavily_client is None:
        key = os.getenv("TAVILY_API_KEY")
        _tavily_client = TavilyClient(api_key=key) if key else None
    return _tavily_client


def search_web(query: str, max_results: int = 5):
    client = get_tavily_client()
    if not client:
        return []
    response = client.search(query=query, max_results=max_results)
    results = []
    for item in response.get("results", []):
        results.append({
            "title": item.get("title"),
            "url": item.get("url"),
            "content": item.get("content"),
        })
    return results
