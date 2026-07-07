from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


class ScrapeError(Exception):
    """Raised when a page cannot be rendered or yields no usable content."""


async def scrape_homepage(url: str, timeout_s: float = 25.0) -> str:
    """Render `url`'s homepage headlessly and return cleaned markdown.

    Homepage only — no link following. Raises ScrapeError on navigation
    failure, render timeout, or empty extraction.
    """
    browser_config = BrowserConfig(headless=True, verbose=False)
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=int(timeout_s * 1000),
    )
    try:
        async with AsyncWebCrawler(config=browser_config) as crawler:
            result = await crawler.arun(url=url, config=run_config)
    except Exception as exc:  # navigation / render / timeout errors
        raise ScrapeError(str(exc)) from exc

    if not result.success:
        raise ScrapeError(result.error_message or "crawl failed")

    # Crawl4AI 0.4.x returns either a str or a MarkdownGenerationResult;
    # handle both. The markdown generator already omits script/style/nav noise.
    markdown = result.markdown
    content = (getattr(markdown, "raw_markdown", None) or str(markdown or "")).strip()
    if not content:
        raise ScrapeError("no content extracted")
    return content
