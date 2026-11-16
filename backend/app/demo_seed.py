"""Sample data in Vietnamese, to show the product: a few employees, one task table, their sheets.

Run with `python -m app.cli seed-demo` (see app/cli.py). Safe to run twice: when the sample
workspace already exists nothing is added. Every row is written through the same services the
API uses, so the sample obeys the same rules (permissions, record viewers, history).
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.modules.bases import service as bases
from app.modules.bases.schemas import BaseCreate, TableCreate
from app.modules.organizations import service as departments
from app.modules.organizations.models import DepartmentKind
from app.modules.organizations.schemas import DepartmentCreate
from app.modules.records import service as records
from app.modules.sheets import service as sheets
from app.modules.sheets.models import SheetRole
from app.modules.sheets.schemas import MemberIn, SheetCreate
from app.modules.users import hr_service
from app.modules.users.models import User
from app.modules.users.schemas import UserCreate
from app.modules.workspaces import service as workspaces
from app.modules.workspaces.models import Workspace

WORKSPACE = "Vận hành"

# code, full name, department
PEOPLE = [
    ("QL01", "Phạm Thanh Hạnh", "Kinh doanh"),
    ("NV101", "Nguyễn Văn An", "Kinh doanh"),
    ("NV102", "Trần Thị Bình", "Kế toán"),
    ("NV103", "Lê Minh Châu", "Kho vận"),
]

# name, assignee code, status kind, priority, due in days from today, progress update
TASKS = [
    ("Đối soát doanh thu Shopee tháng 10", "NV101", "in_progress", "High", -2,
     "Đã đối chiếu 70%. Còn thiếu số liệu ngày 28-29 do file xuất bị lỗi."),
    ("Cập nhật đơn giá SKU ngành Gia dụng", "NV101", "review", "Medium", 0,
     "Đã cập nhật 60/60 SKU, gửi bảng giá để duyệt."),
    ("Kiểm tra phí vận chuyển tháng 10", "NV102", "in_progress", "Medium", 1,
     "Đã có báo giá của 2/3 đơn vị vận chuyển."),
    ("Lập báo cáo chi phí quý 4", "NV102", "todo", "High", 5, None),
    ("Bàn giao tài liệu quy trình đổi trả", "NV103", "done", "Low", -3,
     "Đã bàn giao cho bộ phận Chăm sóc khách hàng."),
    ("Kiểm kê kho Bình Dương", "NV103", "todo", "Medium", 7, None),
]  # fmt: skip


@dataclass
class SeedResult:
    created: bool
    people: int
    tasks: int


async def seed_demo(session: AsyncSession, actor: User, password: str) -> SeedResult:
    """Write the sample. `actor` is an organization admin; the caller commits."""
    taken = (
        await session.execute(
            select(Workspace.id).where(
                Workspace.organization_id == actor.organization_id,
                Workspace.name == WORKSPACE,
                Workspace.deleted_at.is_(None),
            )
        )
    ).first()
    if taken is not None:
        return SeedResult(created=False, people=0, tasks=0)

    division = await departments.create_department(
        session, actor, DepartmentCreate(name="Khối Vận hành", kind=DepartmentKind.DIVISION)
    )
    teams: dict[str, uuid.UUID] = {}
    for team in sorted({dept for _, _, dept in PEOPLE}):
        made = await departments.create_department(
            session,
            actor,
            DepartmentCreate(name=team, kind=DepartmentKind.DEPARTMENT, parent_id=division.id),
        )
        teams[team] = made.id

    ids: dict[str, uuid.UUID] = {}
    for code, name, dept in PEOPLE:
        try:
            user = await hr_service.create_user(
                session,
                actor,
                UserCreate(
                    employee_code=code,
                    full_name=name,
                    password=password,
                    department_id=teams[dept],
                    manager_id=ids.get("QL01"),
                ),
            )
        except ProblemError:  # already there: keep it
            user = (
                await session.execute(
                    select(User).where(
                        User.organization_id == actor.organization_id, User.employee_code == code
                    )
                )
            ).scalar_one()
        ids[code] = user.id

    workspace = await workspaces.create_workspace(session, actor, WORKSPACE)
    base = await bases.create_base(
        session, actor, workspace.id, BaseCreate(name="Thương mại điện tử")
    )
    table = await bases.create_table(
        session, actor, base.id, TableCreate(name="Công việc", template="tasks")
    )
    column = {f.name: f for f in table.fields}
    kinds = {o["kind"]: o["id"] for o in column["Status"].config["options"]}
    priority = {o["name"]: o["id"] for o in column["Priority"].config["options"]}

    for code in ("NV101", "NV102", "NV103"):
        await sheets.create_sheet(
            session,
            actor,
            table.id,
            SheetCreate(
                owner_id=ids[code], members=[MemberIn(user_id=ids["QL01"], role=SheetRole.MANAGER)]
            ),
        )

    today = datetime.now(UTC).date()
    for name, code, kind, level, days, progress in TASKS:
        data: dict[str, Any] = {
            str(column["Name"].id): name,
            str(column["Assignee"].id): [str(ids[code])],
            str(column["Status"].id): kinds[kind],
            str(column["Priority"].id): priority[level],
            str(column["Due date"].id): (today + timedelta(days=days)).isoformat(),
        }
        if progress:
            data[str(column["Progress update"].id)] = progress
        await records.create_record(session, actor, table.id, data)

    return SeedResult(created=True, people=len(PEOPLE), tasks=len(TASKS))
