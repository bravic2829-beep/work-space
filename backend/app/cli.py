"""Command line tools. Run from the backend folder, e.g.:

    uv run python -m app.cli seed-superadmin --employee-code ADMIN001 --full-name "Admin"
    uv run python -m app.cli rebuild-record-viewers [--table-id <uuid>]

The password is read from the SEED_ADMIN_PASSWORD environment variable, or asked on the
terminal. It is never accepted as an argument (it would end up in the shell history).
"""

import argparse
import asyncio
import getpass
import os
import sys
import uuid

from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import create_engine, create_sessionmaker
from app.modules.bases.models import Table
from app.modules.fields import repository as fields_repository
from app.modules.records import visibility
from app.modules.users.service import (
    InvalidSuperAdminInputError,
    OwnerAlreadyExistsError,
    create_super_admin,
)

EXIT_OK = 0
EXIT_REFUSED = 1


def _read_password() -> str:
    from_env = os.environ.get("SEED_ADMIN_PASSWORD")
    if from_env:
        return from_env
    first = getpass.getpass("Password: ")
    if first != getpass.getpass("Repeat password: "):
        raise InvalidSuperAdminInputError("Passwords do not match")
    return first


async def _seed_superadmin(args: argparse.Namespace) -> int:
    database_url = get_settings().database_url
    if not database_url:
        print("DATABASE_URL is not set. Copy .env.example to .env first.", file=sys.stderr)
        return EXIT_REFUSED

    try:
        password = _read_password()
    except InvalidSuperAdminInputError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return EXIT_REFUSED

    engine = create_engine(database_url)
    try:
        async with create_sessionmaker(engine)() as session, session.begin():
            user = await create_super_admin(
                session,
                employee_code=args.employee_code,
                full_name=args.full_name,
                password=password,
                organization_name=args.organization_name,
            )
            code = user.employee_code
    except OwnerAlreadyExistsError:
        print("Refused: an owner already exists. Nothing was changed.", file=sys.stderr)
        return EXIT_REFUSED
    except InvalidSuperAdminInputError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return EXIT_REFUSED
    finally:
        await engine.dispose()

    print(f"Super Admin '{code}' created.")
    return EXIT_OK


async def _rebuild_viewers(args: argparse.Namespace) -> int:
    """Repair `record_viewers` from `records.data` (ADR 0003): for one table or all live tables.

    Safe to run at any time: the rows it writes are exactly what the application would have
    written. Use it if the table is ever suspected to be out of step with the records.
    """
    database_url = get_settings().database_url
    if not database_url:
        print("DATABASE_URL is not set. Copy .env.example to .env first.", file=sys.stderr)
        return EXIT_REFUSED
    engine = create_engine(database_url)
    try:
        async with create_sessionmaker(engine)() as session, session.begin():
            query = select(Table.id).where(Table.deleted_at.is_(None))
            if args.table_id is not None:
                query = query.where(Table.id == args.table_id)
            table_ids = list((await session.execute(query)).scalars())
            if args.table_id is not None and not table_ids:
                print("Refused: no live table has this id.", file=sys.stderr)
                return EXIT_REFUSED
            total = 0
            for table_id in table_ids:
                fields = await fields_repository.list_fields(session, table_id=table_id)
                total += await visibility.rebuild_table(session, table_id, fields)
    finally:
        await engine.dispose()
    print(f"Rebuilt the viewers of {total} record(s) in {len(table_ids)} table(s).")
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)

    seed = commands.add_parser("seed-superadmin", help="Create the first owner account")
    seed.add_argument("--employee-code", required=True)
    seed.add_argument("--full-name", required=True)
    seed.add_argument("--organization-name", default="My Organization")
    seed.set_defaults(run=_seed_superadmin)

    rebuild = commands.add_parser(
        "rebuild-record-viewers", help="Repair record_viewers from the records (ADR 0003)"
    )
    rebuild.add_argument("--table-id", type=uuid.UUID, default=None)
    rebuild.set_defaults(run=_rebuild_viewers)

    args = parser.parse_args(argv)
    exit_code: int = asyncio.run(args.run(args))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
