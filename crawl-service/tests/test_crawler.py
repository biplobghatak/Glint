import pytest

from crawler import scrape_homepage, ScrapeError

# A self-contained fixture rendered via Crawl4AI's raw:// scheme — no network.
FIXTURE_HTML = (
    "<html><head><title>Acme Analytics</title></head><body>"
    "<nav>Home About Pricing</nav>"
    "<main><h1>Acme Analytics</h1>"
    "<p>Acme Analytics helps B2B revenue teams forecast pipeline and "
    "spot at-risk deals before they slip. Sales leaders use Acme to "
    "replace spreadsheet guesswork with model-driven forecasts that "
    "update as deals move through the funnel.</p></main>"
    "<footer>Copyright Acme</footer></body></html>"
)


async def test_scrape_extracts_markdown():
    content = await scrape_homepage(f"raw://{FIXTURE_HTML}")
    assert "Acme Analytics" in content
    assert "forecast pipeline" in content
    assert len(content) > 100


async def test_scrape_unreachable_url_raises():
    # Port 1 on loopback refuses immediately — a fast, deterministic failure.
    with pytest.raises(ScrapeError):
        await scrape_homepage("http://127.0.0.1:1/", timeout_s=5)
