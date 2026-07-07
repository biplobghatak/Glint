from fastapi.testclient import TestClient

import app as app_module
from app import app, ScrapeError

client = TestClient(app)


def test_endpoint_rejects_missing_or_wrong_secret(monkeypatch):
    monkeypatch.setattr(app_module, "CRAWL_SECRET", "topsecret")
    r_missing = client.post("/scrape", json={"url": "https://example.com"})
    assert r_missing.status_code == 401
    r_wrong = client.post(
        "/scrape",
        json={"url": "https://example.com"},
        headers={"X-Crawl-Secret": "wrong"},
    )
    assert r_wrong.status_code == 401


def test_endpoint_returns_content_on_success(monkeypatch):
    monkeypatch.setattr(app_module, "CRAWL_SECRET", "topsecret")

    async def fake_scrape(url, timeout_s=25.0):
        return "cleaned markdown content"

    monkeypatch.setattr(app_module, "scrape_homepage", fake_scrape)
    r = client.post(
        "/scrape",
        json={"url": "https://example.com"},
        headers={"X-Crawl-Secret": "topsecret"},
    )
    assert r.status_code == 200
    assert r.json() == {"content": "cleaned markdown content"}


def test_endpoint_maps_scrape_error_to_502(monkeypatch):
    monkeypatch.setattr(app_module, "CRAWL_SECRET", "topsecret")

    async def fake_scrape(url, timeout_s=25.0):
        raise ScrapeError("render failed")

    monkeypatch.setattr(app_module, "scrape_homepage", fake_scrape)
    r = client.post(
        "/scrape",
        json={"url": "https://example.com"},
        headers={"X-Crawl-Secret": "topsecret"},
    )
    assert r.status_code == 502
    assert "error" in r.json()


def test_health_ok():
    assert client.get("/health").json() == {"ok": True}
