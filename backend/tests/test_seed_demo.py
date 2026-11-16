"""`python -m app.cli seed-demo`: the Vietnamese sample, written through the real services."""

import subprocess
import sys

from tests.api_helpers import db_fetch
from tests.helpers import BACKEND_DIR, subprocess_env

PASSWORD = "sample-password-1"


def cli(database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "app.cli", *args],
        cwd=BACKEND_DIR,
        env=subprocess_env(database_url, SEED_ADMIN_PASSWORD=PASSWORD, SEED_DEMO_PASSWORD=PASSWORD),
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        check=False,
    )


async def count(database_url: str, sql: str) -> int:
    rows = await db_fetch(database_url, sql)
    return int(rows[0]["n"])


async def test_the_sample_needs_an_owner_first(migrated_database_url: str) -> None:
    refused = cli(migrated_database_url, "seed-demo")
    assert refused.returncode == 1
    assert "Super Admin" in refused.stderr


async def test_the_sample_is_written_once(migrated_database_url: str) -> None:
    url = migrated_database_url
    owner = cli(url, "seed-superadmin", "--employee-code", "ADMIN001", "--full-name", "Chủ")
    assert owner.returncode == 0, owner.stderr

    done = cli(url, "seed-demo")
    assert done.returncode == 0, done.stderr
    assert "Sample ready" in done.stdout
    assert await count(url, "SELECT count(*) AS n FROM sheets") == 3
    assert await count(url, "SELECT count(*) AS n FROM sheet_members WHERE role = 'manager'") == 3
    assert await count(url, "SELECT count(*) AS n FROM records") == 6
    assert await count(url, "SELECT count(*) AS n FROM activity_log WHERE action = 'created'") == 6
    titles = await db_fetch(
        url,
        "SELECT r.data ->> f.id::text AS title FROM records r"
        " JOIN fields f ON f.table_id = r.table_id AND f.name = 'Name'",
    )
    assert "Đối soát doanh thu Shopee tháng 10" in {t["title"] for t in titles}
    # Every task is visible to its sheet's manager through the sheet.
    assert await count(url, "SELECT count(*) AS n FROM record_viewers WHERE reason = 'sheet'") >= 6

    again = cli(url, "seed-demo")
    assert again.returncode == 0
    assert "already exists" in again.stdout
    assert await count(url, "SELECT count(*) AS n FROM records") == 6
