from sqlalchemy import text

from app.core.db import create_engine, create_sessionmaker


async def test_every_connection_plans_each_query_with_its_real_values(
    migrated_database_url: str,
) -> None:
    """The record list filters on `data ->> <field id>` with the id as a bound parameter.

    With the default setting PostgreSQL switches to a generic plan after five runs of the same
    statement, which cannot use an index on that expression (see docs/adr/0002 and
    scripts/benchmark_records.py). This test fails if the setting is dropped from the engine.
    """
    engine = create_engine(migrated_database_url)
    try:
        async with create_sessionmaker(engine)() as session:
            value = (await session.execute(text("SHOW plan_cache_mode"))).scalar_one()
    finally:
        await engine.dispose()
    assert value == "force_custom_plan"
