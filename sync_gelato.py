"""
Gelato catalog explorer / sync (run from the project dir).

  python3 sync_gelato.py                 -> list all catalogs (probe)
  python3 sync_gelato.py <catalogUid>    -> products in a catalog (count + sample)
  python3 sync_gelato.py product <uid>   -> one product's variants/attributes
  python3 sync_gelato.py dump            -> pull every catalog's product list to
                                            data/gelato_catalog.json (curation source)

The pulled UIDs are the single source of truth — we curate the ~50 from here,
never by hand. The key is read from .env via gelato.py (never printed).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import gelato

OUT = Path(__file__).resolve().parent / "data" / "gelato_catalog.json"


def list_catalogs() -> int:
    cats = gelato.list_catalogs()
    print(f"\nGelato catalogs ({len(cats)}):\n" + "-" * 50)
    for c in cats:
        uid = c.get("catalogUid") or c.get("uid") or c
        title = c.get("title", "") if isinstance(c, dict) else ""
        print(f"  {uid:<28} {title}")
    print("-" * 50)
    print("Next: python3 sync_gelato.py <catalogUid>   to see its products")
    return 0


def show_catalog(uid: str) -> int:
    res = gelato.search_products(uid, limit=100, offset=0)
    products = res.get("products", res if isinstance(res, list) else [])
    total = res.get("hits", res.get("total", len(products))) if isinstance(res, dict) else len(products)
    print(f"\nCatalog '{uid}': ~{total} products (showing {len(products)}):\n" + "-" * 60)
    for p in products[:40]:
        puid = p.get("productUid", "")
        print(f"  {puid}")
    return 0


def show_product(uid: str) -> int:
    p = gelato.get_product(uid)
    print(json.dumps(p, indent=2)[:4000])
    return 0


def dump_all() -> int:
    cats = gelato.list_catalogs()
    out = {"catalogs": []}
    for c in cats:
        cuid = c.get("catalogUid") if isinstance(c, dict) else c
        if not cuid:
            continue
        prods, offset = [], 0
        while True:
            res = gelato.search_products(cuid, limit=100, offset=offset)
            batch = res.get("products", []) if isinstance(res, dict) else []
            prods.extend(batch)
            if len(batch) < 100:
                break
            offset += 100
            if offset > 2000:
                break
        out["catalogs"].append({"catalogUid": cuid, "title": c.get("title", ""),
                                "product_count": len(prods),
                                "product_uids": [p.get("productUid") for p in prods]})
        print(f"  {cuid}: {len(prods)} products")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2))
    print(f"\nWrote {OUT}")
    return 0


def main() -> int:
    if not gelato.has_key():
        print("No GELATO_API_KEY in .env — add it first.")
        return 1
    args = sys.argv[1:]
    try:
        if not args:
            return list_catalogs()
        if args[0] == "dump":
            return dump_all()
        if args[0] == "product" and len(args) > 1:
            return show_product(args[1])
        return show_catalog(args[0])
    except gelato.GelatoError as e:
        print("ERROR:", e)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
