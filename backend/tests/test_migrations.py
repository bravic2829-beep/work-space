from tests.helpers import current_versions, head_revision, run_alembic


async def test_upgrade_head_then_downgrade_base(temp_database_url: str) -> None:
    head = head_revision()

    up = run_alembic(temp_database_url, "upgrade", "head")
    assert up.returncode == 0, up.stderr
    assert await current_versions(temp_database_url) == [head]

    down = run_alembic(temp_database_url, "downgrade", "base")
    assert down.returncode == 0, down.stderr
    assert await current_versions(temp_database_url) == []

    again = run_alembic(temp_database_url, "upgrade", "head")
    assert again.returncode == 0, again.stderr
    assert await current_versions(temp_database_url) == [head]


async def test_every_migration_can_be_reverted_one_step_at_a_time(
    temp_database_url: str,
) -> None:
    assert run_alembic(temp_database_url, "upgrade", "head").returncode == 0
    # Walk down one revision at a time: each downgrade must work on its own.
    while await current_versions(temp_database_url):
        step = run_alembic(temp_database_url, "downgrade", "-1")
        assert step.returncode == 0, step.stderr


async def test_models_match_migrations(migrated_database_url: str) -> None:
    # `alembic check` fails when the models and the migrated schema differ,
    # so a forgotten migration is caught in CI.
    check = run_alembic(migrated_database_url, "check")
    assert check.returncode == 0, check.stdout + check.stderr


def test_there_is_a_single_migration_head() -> None:
    # Two branches creating a migration at once produce two heads. Fail early with a clear
    # message (see ADR 0004: only one person creates a migration at a time).
    heads = run_alembic("postgresql+asyncpg://u:p@127.0.0.1:1/db", "heads")
    assert heads.returncode == 0, heads.stderr
    assert len([line for line in heads.stdout.splitlines() if "(head)" in line]) == 1
