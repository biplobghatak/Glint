import ipaddress
import socket
from urllib.parse import urlparse


class UnsafeUrlError(Exception):
    """Raised when a URL targets a non-public or non-http(s) destination."""


def assert_public_url(url: str) -> None:
    """Reject non-http(s) schemes and hosts that resolve to non-public IPs.

    Mitigates SSRF: the scraper renders arbitrary user-supplied URLs in a
    real headless browser, so block loopback/private/link-local/reserved
    ranges (e.g. cloud metadata at 169.254.169.254) and disallow schemes
    such as file:// . The `raw://` scheme (inline HTML, no network fetch) is
    allowed so hermetic tests can render fixtures offline.

    Note: this guards the *initial* URL only. A page that HTTP-redirects to
    an internal host is not caught here — full redirect-time interception is
    out of scope for this mitigation.
    """
    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    if scheme == "raw":
        return
    if scheme not in ("http", "https"):
        raise UnsafeUrlError(f"unsupported URL scheme: {scheme or '(none)'}")
    host = parsed.hostname
    if not host:
        raise UnsafeUrlError("URL has no host")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise UnsafeUrlError(f"DNS resolution failed for {host}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise UnsafeUrlError(f"blocked non-public address: {ip}")
