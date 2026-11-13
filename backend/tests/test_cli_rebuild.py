import subprocess
import sys
import uuid

from tests.api_helpers import db_execute, db_fetch
from tests.helpers import BACKEND_DIR, subprocess_env
from tests.test_records import Board
from tests.work_world import Work


def run_cli(database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "app.cli", "rebuild-record-viewers", *args],
        cwd=BACKEND_DIR,
        env=subprocess_env(database_url),
        capture_output=True,
        text=True,
        check=False,
    )


async def viewers(database_url: str) -> set[tuple[str, str]]:
    rows = await db_fetch(database_url, "SELECT record_id, user_id, source_key FROM record_viewers")
    return {(f"{r['record_id']}:{r['user_id']}", r["source_key"]) for r in rows}


async def test_the_command_repairs_a_viewers_table_that_drifted(
    work: Work, migrated_database_url: str
) -> None:
    board = Board(work, await work.make_table(await work.make_base(), "Tasks", template="tasks"))
    await board.create(Name="A", Assignee=[board.user("member")])
    await board.create(Name="B", Assignee=[board.user("member2")], Follower=[board.user("viewer")])
    correct = await viewers(migrated_database_url)
    assert len(correct) == 5  # two creators, two assignees, one follower

    # Break it in the three ways it could go wrong: a missing row, a stale row, a wrong row.
    await db_execute(migrated_database_url, "DELETE FROM record_viewers WHERE reason = 'field'")
    await db_execute(
        migrated_database_url,
        "INSERT INTO record_viewers (record_id, user_id, source_key, reason)"
        " SELECT id, $1, 'creator', 'creator' FROM records LIMIT 1",
        work.users["member2"],
    )
    assert await viewers(migrated_database_url) != correct

    done = run_cli(migrated_database_url)
    assert done.returncode == 0, done.stderr
    assert "2 record(s) in 1 table(s)" in done.stdout
    assert await viewers(migrated_database_url) == correct


async def test_it_can_be_limited_to_one_table(work: Work, migrated_database_url: str) -> None:
    base_id = await work.make_base()
    first = Board(work, await work.make_table(base_id, "One", template="tasks"))
    second = Board(work, await work.make_table(base_id, "Two", template="tasks"))
    await first.create(Name="A", Assignee=[first.user("member")])
    await second.create(Name="B", Assignee=[second.user("member")])
    await db_execute(migrated_database_url, "DELETE FROM record_viewers WHERE reason = 'field'")

    done = run_cli(migrated_database_url, "--table-id", first.id)
    assert done.returncode == 0, done.stderr
    rows = await db_fetch(
        migrated_database_url,
        "SELECT r.table_id FROM record_viewers v JOIN records r ON r.id = v.record_id"
        " WHERE v.reason = 'field'",
    )
    assert {str(r["table_id"]) for r in rows} == {first.id}  # the other table was left alone


async def test_it_refuses_an_unknown_table(work: Work, migrated_database_url: str) -> None:
    done = run_cli(migrated_database_url, "--table-id", str(uuid.uuid4()))
    assert done.returncode == 1
    assert "no live table" in done.stderr
    assert run_cli(migrated_database_url, "--table-id", "nonsense").returncode == 2
