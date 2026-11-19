#!/usr/bin/env python3
"""
Copy one account's patterns from one Yarnboard database to an account in
another (e.g. dev -> prod), as private patterns of the target account.

Previews by default; writes only with --apply, in one transaction.

  export SOURCE_DATABASE_URL=...   # e.g. the dev database (read only)
  export TARGET_DATABASE_URL=...   # e.g. the prod database
  backend/.venv/bin/python scripts/copy_patterns.py \\
      --source-email someone@example.com --target-email other@example.com
  # check the preview, then add --apply

The URLs are read from the environment and never printed. Both accounts
must already exist. Copied: the pattern itself (text, instructions,
translations, photo, chart). Not copied: shares, progress, notifications,
Stitch Fiddle links. A pattern whose source link the target account
already has is skipped, so running it twice copies nothing new.
"""

import argparse
import os
import sys

from sqlalchemy import MetaData, create_engine, func, select

SKIP_COLUMNS = {"id", "uploader_id", "is_public", "created_at"}


def engine_for(env_name: str):
    url = os.environ.get(env_name)
    if not url:
        sys.exit(f"{env_name} is not set.")
    # Render/Neon hand out postgres:// URLs; SQLAlchemy wants postgresql://.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return create_engine(url)


def user_id(conn, users, email: str, label: str) -> int:
    row = conn.execute(
        select(users.c.id).where(func.lower(users.c.email) == email.strip().lower())
    ).first()
    if row is None:
        sys.exit(f"No account with that email in the {label} database.")
    return row.id


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source-email", required=True)
    parser.add_argument("--target-email", required=True)
    parser.add_argument("--apply", action="store_true", help="actually write (default: preview only)")
    args = parser.parse_args()

    source, target = engine_for("SOURCE_DATABASE_URL"), engine_for("TARGET_DATABASE_URL")
    if source.url == target.url:
        sys.exit("SOURCE_DATABASE_URL and TARGET_DATABASE_URL are the same database.")

    src_meta, dst_meta = MetaData(), MetaData()
    src_meta.reflect(source, only=["user", "pattern"])
    dst_meta.reflect(target, only=["user", "pattern"])
    src_patterns, dst_patterns = src_meta.tables["pattern"], dst_meta.tables["pattern"]

    # Only columns both databases have (prod may lag a migration behind).
    columns = [
        c.name for c in src_patterns.columns
        if c.name in dst_patterns.columns and c.name not in SKIP_COLUMNS
    ]
    dropped = sorted(
        c.name for c in src_patterns.columns
        if c.name not in dst_patterns.columns and c.name not in SKIP_COLUMNS
    )

    with source.connect() as src:
        source_user = user_id(src, src_meta.tables["user"], args.source_email, "source")
        rows = src.execute(
            select(*[src_patterns.c[name] for name in columns])
            .where(src_patterns.c.uploader_id == source_user)
            .order_by(src_patterns.c.id)
        ).mappings().all()

    with target.connect() as dst:
        target_user = user_id(dst, dst_meta.tables["user"], args.target_email, "target")
        existing = set(dst.scalars(
            select(dst_patterns.c.original_url).where(dst_patterns.c.uploader_id == target_user)
        ))
        to_copy = [r for r in rows if r["original_url"] not in existing]
        skipped = [r for r in rows if r["original_url"] in existing]

        print(f"Source account has {len(rows)} pattern(s).")
        for r in to_copy:
            print(f"  copy  {r['title']}")
        for r in skipped:
            print(f"  skip  {r['title']}  (target already has it)")
        if dropped:
            print(f"Not in the target database, left out: {', '.join(dropped)}")

        if not args.apply:
            print(f"\nPreview only: {len(to_copy)} would be copied as private patterns. Add --apply to write.")
            return

        # All or nothing: one transaction, committed only if every insert works.
        for r in to_copy:
            dst.execute(dst_patterns.insert().values(**dict(r), uploader_id=target_user, is_public=False))
        dst.commit()
        print(f"\nCopied {len(to_copy)} pattern(s) as private patterns of the target account.")


if __name__ == "__main__":
    main()
