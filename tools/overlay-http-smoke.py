"""Verify every OBS overlay route serves the transparent browser source."""
from __future__ import annotations

import json
import os
import sys
import argparse
from urllib.request import Request, urlopen


ROUTES = ("/overlay/vertical", "/overlay/gifts", "/overlay/alerts", "/overlay/chaos")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", default=os.environ.get("CHAOS_TOKEN"), help="Overlay auth token; alternatively set CHAOS_TOKEN")
    args = parser.parse_args()
    if not args.token:
        raise SystemExit("provide --token or set CHAOS_TOKEN")
    results = {}
    for route in ROUTES:
        request = Request(f"http://127.0.0.1:39178{route}?token={args.token}")
        with urlopen(request, timeout=3) as response:
            body = response.read().decode("utf-8")
            content_type = response.headers.get_content_type()
            if response.status != 200 or content_type != "text/html":
                raise AssertionError({"route": route, "status": response.status, "contentType": content_type})
            if 'src="/overlay.js"' not in body or 'href="/overlay.css"' not in body:
                raise AssertionError({"route": route, "error": "overlay assets missing"})
            results[route] = {"status": response.status, "contentType": content_type, "bytes": len(body)}
    with urlopen(Request("http://127.0.0.1:39178/overlay.css"), timeout=3) as response:
        css = response.read().decode("utf-8")
        if response.status != 200 or response.headers.get_content_type() != "text/css":
            raise AssertionError({"asset": "overlay.css", "status": response.status})
        if "background:transparent" not in css and "background: transparent" not in css:
            raise AssertionError({"asset": "overlay.css", "error": "transparent background missing"})
    print(json.dumps(results))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
