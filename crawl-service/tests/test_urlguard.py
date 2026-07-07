import pytest

from urlguard import UnsafeUrlError, assert_public_url


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/",
        "gopher://example.com/",
        "no-scheme.example.com",
    ],
)
def test_rejects_non_http_schemes(url):
    with pytest.raises(UnsafeUrlError):
        assert_public_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://169.254.169.254/",  # cloud metadata endpoint
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://[::1]/",
        "http://0.0.0.0/",
    ],
)
def test_rejects_non_public_addresses(url):
    with pytest.raises(UnsafeUrlError):
        assert_public_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://8.8.8.8/",  # public literal IP — no DNS lookup needed
        "https://8.8.8.8/path?q=1",
    ],
)
def test_allows_public_addresses(url):
    assert_public_url(url)  # must not raise


def test_allows_raw_scheme_for_hermetic_tests():
    assert_public_url("raw://<html><body>hi</body></html>")  # must not raise
