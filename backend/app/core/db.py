from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def create_engine(database_url: str) -> AsyncEngine:
    # pool_pre_ping drops dead connections (e.g. after the database restarts).
    #
    # plan_cache_mode: the record list filters and sorts on `data ->> <field id>`, where the
    # field id is a bound parameter. After five runs PostgreSQL would switch to a generic plan,
    # which cannot use an index on that expression (the id is not known when planning), and a
    # list that took 4 ms took hundreds of ms (docs/adr/0002). A plan made for each run sees the
    # real id. Planning costs about 0.1 ms.
    return create_async_engine(
        database_url,
        pool_pre_ping=True,
        connect_args={"server_settings": {"plan_cache_mode": "force_custom_plan"}},
    )


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    # expire_on_commit=False avoids implicit lazy loads after commit, which break in async code.
    return async_sessionmaker(engine, expire_on_commit=False)
