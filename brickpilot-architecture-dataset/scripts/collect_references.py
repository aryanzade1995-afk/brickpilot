#!/usr/bin/env python3
"""
collect_references — §2 the licence-aware harvester.

Searches OPEN / PERMISSIVE sources only and records the full licence
record for every candidate:

  * Openverse   (api.openverse.org)  — CC0 / PDM / CC-BY / CC-BY-SA, photos
  * Wikimedia Commons (commons.wikimedia.org) — public domain + CC

Google Images is NOT scraped. For every image we store:
  source_url, source_domain, license, license_url, creator,
  attribution_required, commercial_use_allowed, modification_allowed,
  date_collected, license_status.

Unverifiable licence -> license_status = "unknown"; such images are kept
in raw/ and marked, never silently promoted to a commercial-use asset.

    python collect_references.py --dry-run                 # list candidates only
    python collect_references.py --yes --limit 120         # actually download
    python collect_references.py --yes --source openverse --max-per-query 3

Deps: requests (present).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import date
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
META = os.path.normpath(os.path.join(HERE, "..", "metadata"))
RAW = os.path.normpath(os.path.join(HERE, "..", "raw"))

try:
    import requests  # type: ignore
except Exception:
    requests = None  # type: ignore

UA = "BrickPilotDatasetBot/1.0 (https://github.com/aryanzade1995-afk/brickpilot; research use)"

_commons_backoff = [1.0]  # grows on 429, shrinks on success

# CC licence -> (attribution_required, commercial_ok, modification_ok, status)
LICENSE_RULES = {
    "cc0": (False, True, True, "verified_open"),
    "pdm": (False, True, True, "verified_open"),
    "publicdomain": (False, True, True, "verified_open"),
    "by": (True, True, True, "verified_permissive"),
    "by-sa": (True, True, True, "verified_permissive"),
    "by-nd": (True, True, False, "verified_permissive"),
    "by-nc": (True, False, True, "unknown"),
    "by-nc-sa": (True, False, True, "unknown"),
    "by-nc-nd": (True, False, False, "unknown"),
}
LICENSE_URL = {
    "cc0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "pdm": "https://creativecommons.org/publicdomain/mark/1.0/",
    "by": "https://creativecommons.org/licenses/by/4.0/",
    "by-sa": "https://creativecommons.org/licenses/by-sa/4.0/",
}


def licence_record(code: str, url: str, creator: str, source_url: str) -> dict:
    code = (code or "").lower().strip()
    attr, comm, mod, status = LICENSE_RULES.get(code, (True, False, False, "unknown"))
    return {
        "url": source_url,
        "domain": urlparse(source_url).netloc,
        "license": code.upper() or "unknown",
        "licenseUrl": url or LICENSE_URL.get(code, ""),
        "creator": creator or "unknown",
        "attributionRequired": attr,
        "commercialUseAllowed": comm,
        "modificationAllowed": mod,
        "dateCollected": date.today().isoformat(),
        "licenseStatus": status,
    }


def search_openverse(query: str, n: int) -> list[dict]:
    if requests is None:
        return []
    try:
        r = requests.get(
            "https://api.openverse.org/v1/images/",
            params={
                "q": query,
                "license_type": "commercial,modification",
                "category": "photograph",
                "page_size": min(n, 20),
                "mature": "false",
            },
            headers={"User-Agent": UA},
            timeout=30,
        )
        r.raise_for_status()
        out = []
        for it in r.json().get("results", []):
            rec = licence_record(
                it.get("license", ""),
                it.get("license_url", ""),
                it.get("creator", ""),
                it.get("foreign_landing_url") or it.get("url", ""),
            )
            out.append({"query": query, "image_url": it.get("url"), "title": it.get("title", ""), "source": "openverse", "license_record": rec})
        return out
    except Exception as e:  # noqa: BLE001
        print(f"! openverse '{query}': {e}", file=sys.stderr)
        return []


def search_commons(query: str, n: int) -> list[dict]:
    if requests is None:
        return []
    try:
        time.sleep(_commons_backoff[0])
        r = requests.get(
            "https://commons.wikimedia.org/w/api.php",
            params={
                "action": "query", "format": "json", "generator": "search",
                "gsrsearch": f'{query} villa|house|residence -floorplan -"floor plan"', "gsrnamespace": 6, "gsrlimit": min(n, 20),
                "prop": "imageinfo", "iiprop": "url|extmetadata|size|mime", "iiurlwidth": 1600,
            },
            headers={"User-Agent": UA, "Api-User-Agent": UA},
            timeout=30,
        )
        if r.status_code == 429:
            _commons_backoff[0] = min(30.0, _commons_backoff[0] * 2)
            print(f"  (commons 429 — backoff now {_commons_backoff[0]:.0f}s)", flush=True)
            return []
        r.raise_for_status()
        _commons_backoff[0] = max(1.0, _commons_backoff[0] * 0.85)
        pages = (r.json().get("query") or {}).get("pages", {})
        out = []
        for p in pages.values():
            info = (p.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata", {})
            lic = (meta.get("LicenseShortName", {}).get("value") or "").lower()
            code = "cc0" if "cc0" in lic else "pdm" if "public domain" in lic else "by-sa" if "share alike" in lic else "by" if lic.startswith("cc by") else lic
            rec = licence_record(
                code if code in LICENSE_RULES else "unknown",
                meta.get("LicenseUrl", {}).get("value", ""),
                (meta.get("Artist", {}).get("value") or "").strip(),
                info.get("descriptionurl", ""),
            )
            out.append({"query": query, "image_url": info.get("thumburl") or info.get("url"), "title": p.get("title", ""), "source": "wikimedia_commons", "license_record": rec})
        return out
    except Exception as e:  # noqa: BLE001
        print(f"! commons '{query}': {e}", file=sys.stderr)
        return []


def download(url: str, dest_dir: str) -> tuple[str, int] | None:
    if requests is None or not url:
        return None
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=60)
        r.raise_for_status()
        data = r.content
        if len(data) < 8000:
            return None
        ext = ".png" if data[:8] == b"\x89PNG\r\n\x1a\n" else ".jpg"
        name = hashlib.sha1(url.encode()).hexdigest()[:16] + ext
        os.makedirs(dest_dir, exist_ok=True)
        path = os.path.join(dest_dir, name)
        with open(path, "wb") as fh:
            fh.write(data)
        return name, len(data)
    except Exception as e:  # noqa: BLE001
        print(f"! download {url}: {e}", file=sys.stderr)
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", default=os.path.join(META, "queries.json"))
    ap.add_argument("--source", choices=["all", "openverse", "commons"], default="all")
    ap.add_argument("--max-per-query", type=int, default=4)
    ap.add_argument("--limit", type=int, default=150, help="max images to actually download")
    ap.add_argument("--max-queries", type=int, default=120, help="stop after this many queries (bounds runtime)")
    ap.add_argument("--shuffle", action="store_true", help="randomise query order (partial runs stay varied)")
    ap.add_argument("--permissive-only", action="store_true", help="skip anything not verified_open/permissive")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--yes", action="store_true", help="required to actually download")
    args = ap.parse_args()

    if requests is None:
        sys.exit("`requests` not available - pip install requests")
    if not os.path.exists(args.queries):
        sys.exit("queries.json missing - run generate_search_queries.py first")
    with open(args.queries, encoding="utf-8") as fh:
        queries = [q["q"] for q in json.load(fh)["queries"]]
    if args.shuffle:
        import random

        random.Random(1).shuffle(queries)
    queries = queries[: args.max_queries]

    manifest_path = os.path.join(RAW, "collected.json")
    collected: list[dict] = []
    if os.path.exists(manifest_path):
        collected = json.load(open(manifest_path, encoding="utf-8")).get("items", [])
    seen_urls = {c["image_url"] for c in collected}

    candidates: list[dict] = []
    for qi, q in enumerate(queries):
        hits: list[dict] = []
        if args.source in ("all", "openverse"):
            hits += search_openverse(q, args.max_per_query)
        if args.source in ("all", "commons"):
            hits += search_commons(q, args.max_per_query)
        added = 0
        for h in hits:
            if h["image_url"] in seen_urls:
                continue
            if args.permissive_only and h["license_record"]["licenseStatus"] not in ("verified_open", "verified_permissive"):
                continue
            seen_urls.add(h["image_url"])
            candidates.append(h)
            added += 1
        print(f"  [{qi + 1}/{len(queries)}] {q[:48]:48}  +{added}  (total {len(candidates)})", flush=True)
        time.sleep(0.3)
        if len(candidates) >= args.limit:
            break

    print(f"{len(candidates)} new candidates from {len(queries)} queries")
    by_status: dict[str, int] = {}
    for c in candidates:
        s = c["license_record"]["licenseStatus"]
        by_status[s] = by_status.get(s, 0) + 1
    for s in sorted(by_status):
        print(f"  {s:22} {by_status[s]}")

    if args.dry_run or not args.yes:
        print("\n(dry run - pass --yes to download. Images land in raw/, licence records in raw/collected.json)")
        with open(os.path.join(RAW, "candidates.json"), "w", encoding="utf-8") as fh:
            json.dump({"generated": date.today().isoformat(), "candidates": candidates}, fh, indent=2)
        return

    n = 0
    for c in candidates[: args.limit]:
        got = download(c["image_url"], RAW)
        if not got:
            continue
        name, size = got
        collected.append({**c, "file": name, "bytes": size})
        n += 1
        print(f"  v  {name}  {size // 1024} KB  [{c['license_record']['license']}]  {c['title'][:50]}")
        time.sleep(0.3)

    os.makedirs(RAW, exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump({"updated": date.today().isoformat(), "count": len(collected), "items": collected}, fh, indent=2)
        fh.write("\n")
    print(f"\ndownloaded {n} images -> raw/  ({len(collected)} total in collected.json)")
    print("next: python analyze_reference.py on each, then generate_metadata.py")


if __name__ == "__main__":
    main()
