"""Files attached to a task: who may add, see, download and remove them."""

from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.test_sheets import add_member, make_sheet
from tests.work_world import Work

XLSX = b"PK\x03\x04 pretend this is an Excel file " * 20


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def upload(
    board: Board,
    task: dict[str, Any],
    who: str = "admin",
    *,
    name: str = "SKU_prices.xlsx",
    content: bytes = XLSX,
    column: str = "Files",
) -> Any:
    work = board.work
    return await work.client.request(
        "POST",
        f"/api/v1/records/{task['id']}/attachments",
        content=content,
        headers={
            **work.h[who],
            "X-File-Name": quote(name),
            "Content-Type": "application/octet-stream",
        },
        params={"field_id": board.f[column]},
    )


async def files_of(board: Board, task: dict[str, Any], who: str = "admin") -> list[dict[str, Any]]:
    response = await board.work.api("GET", f"/records/{task['id']}", who)
    assert response.status_code == 200, response.text
    value = response.json()["data"].get(board.f["Files"])
    assert value is not None, "the files column is missing from the answer"
    files: list[dict[str, Any]] = value
    return files


def on_disk(files_dir: Path) -> list[Path]:
    return [p for p in files_dir.rglob("*") if p.is_file()] if files_dir.exists() else []


# --- adding and downloading -------------------------------------------------------------------


async def test_a_file_is_added_listed_and_downloaded_with_its_own_name(
    board: Board, files_dir: Path
) -> None:
    work = board.work
    task = await board.create(Name="SKU prices")
    done = await upload(board, task, name="Bảng giá SKU.xlsx")
    assert done.status_code == 201, done.text

    [file] = done.json()["data"][board.f["Files"]]
    assert file["name"] == "Bảng giá SKU.xlsx"
    assert file["size"] == len(XLSX)
    assert file["content_type"].startswith("application/")
    # Adding a file is not a change of the cells: the version stays, so nobody gets a conflict.
    assert done.json()["version"] == task["version"]
    assert [f["id"] for f in await files_of(board, task)] == [file["id"]]
    assert len(on_disk(files_dir)) == 1

    got = await work.api("GET", f"/attachments/{file['id']}")
    assert got.status_code == 200
    assert got.content == XLSX
    # A download, never shown inside the page; the browser gets the real name back.
    disposition = got.headers["content-disposition"]
    assert disposition.startswith("attachment")
    assert quote("Bảng giá SKU.xlsx") in disposition
    assert got.headers["x-content-type-options"] == "nosniff"
    assert "no-store" in got.headers["cache-control"]


async def test_the_files_come_with_every_list_of_records(board: Board) -> None:
    task = await board.create(Name="With files")
    await board.create(Name="Without")
    await upload(board, task, name="a.pdf")
    await upload(board, task, name="b.docx")
    listed = (await board.work.api("GET", f"/tables/{board.id}/records")).json()["items"]
    by_name = {r["data"][board.f["Name"]]: r["data"][board.f["Files"]] for r in listed}
    assert [f["name"] for f in by_name["With files"]] == ["a.pdf", "b.docx"]
    assert by_name["Without"] == []


async def test_the_files_column_cannot_be_written_as_a_cell(board: Board) -> None:
    task = await board.create(Name="Plan")
    response = await board.patch(task, "admin", Files=[{"name": "fake.xlsx"}])
    assert_problem(response, 422)
    assert (
        await board.work.api(
            "POST",
            f"/tables/{board.id}/records",
            json={"data": {board.f["Name"]: "x", board.f["Files"]: []}},
        )
    ).status_code == 422


async def test_a_files_column_cannot_be_filtered(board: Board) -> None:
    await board.create(Name="Plan")
    response = await board.work.api(
        "GET",
        f"/tables/{board.id}/records",
        params={"filter": f'[{{"field": "{board.f["Files"]}", "op": "is_empty"}}]'},
    )
    assert_problem(response, 422)


# --- what is accepted -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name", ["virus.exe", "page.html", "image.svg", "run.ps1", "app.js", "x.bat"]
)
async def test_files_that_could_run_are_refused(board: Board, files_dir: Path, name: str) -> None:
    task = await board.create(Name="Plan")
    assert_problem(await upload(board, task, name=name), 415)
    assert on_disk(files_dir) == []


@pytest.mark.parametrize("name", ["noextension", ".xlsx", "  .pdf", "..", ""])
async def test_a_file_needs_a_name_and_an_extension(board: Board, name: str) -> None:
    task = await board.create(Name="Plan")
    assert_problem(await upload(board, task, name=name), 422)


async def test_a_name_cannot_choose_where_the_file_goes(board: Board, files_dir: Path) -> None:
    task = await board.create(Name="Plan")
    for evil in ("../../etc/passwd.txt", "..\\..\\windows\\hosts.txt", "/abs/path/report.pdf"):
        done = await upload(board, task, name=evil)
        assert done.status_code == 201, (evil, done.text)
    names = [f["name"] for f in await files_of(board, task)]
    assert names == ["passwd.txt", "hosts.txt", "report.pdf"]
    # Everything is inside the files folder, under random names.
    assert all(files_dir in p.parents for p in on_disk(files_dir))
    assert all(p.name not in names for p in on_disk(files_dir))


async def test_a_file_that_is_too_big_or_empty_is_refused_and_leaves_nothing(
    board: Board, files_dir: Path
) -> None:
    task = await board.create(Name="Plan")
    assert_problem(await upload(board, task, content=b"x" * 50_001), 413)
    assert_problem(await upload(board, task, content=b""), 422)
    assert on_disk(files_dir) == []
    assert await files_of(board, task) == []
    assert (await upload(board, task, content=b"x" * 50_000)).status_code == 201


async def test_a_column_holds_a_limited_number_of_files(board: Board) -> None:
    task = await board.create(Name="Plan")
    for number in range(20):
        assert (await upload(board, task, name=f"f{number}.txt", content=b"x")).status_code == 201
    assert_problem(await upload(board, task, name="one-more.txt", content=b"x"), 409)


async def test_only_a_files_column_takes_files(board: Board) -> None:
    task = await board.create(Name="Plan")
    assert_problem(await upload(board, task, column="Result"), 404)


# --- who may do what --------------------------------------------------------------------------


async def test_a_workspace_viewer_downloads_but_does_not_add_or_remove(board: Board) -> None:
    work = board.work
    task = await board.create(Name="Plan")
    [file] = (await upload(board, task)).json()["data"][board.f["Files"]]

    assert_problem(await upload(board, task, "viewer"), 403)
    assert_problem(await upload(board, task, "commenter"), 403)
    assert (await work.api("GET", f"/attachments/{file['id']}", "viewer")).content == XLSX
    assert_problem(await work.api("DELETE", f"/attachments/{file['id']}", "viewer"), 403)
    assert len(await files_of(board, task, "viewer")) == 1
    # An editor may.
    assert (await upload(board, task, "editor", name="mine.pdf")).status_code == 201


async def test_a_stranger_cannot_see_add_or_download(board: Board) -> None:
    work = board.work
    task = await board.create(Name="Private", Assignee=[board.user("member")])
    [file] = (await upload(board, task)).json()["data"][board.f["Files"]]
    assert_problem(await upload(board, task, "member2"), 403)
    assert_problem(await work.api("GET", f"/attachments/{file['id']}", "member2"), 403)
    assert_problem(await work.api("DELETE", f"/attachments/{file['id']}", "member2"), 403)
    assert_problem(await work.api("GET", f"/attachments/{file['id']}", "other_admin"), 404)


async def test_a_column_hidden_from_a_person_does_not_exist_for_them(board: Board) -> None:
    work = board.work
    task = await board.create(Name="Plan")
    [file] = (await upload(board, task)).json()["data"][board.f["Files"]]
    await work.api(
        "PUT",
        f"/fields/{board.f['Files']}/access/{board.user('viewer')}",
        json={"access": "hidden"},
    )
    seen = (await work.api("GET", f"/records/{task['id']}", "viewer")).json()
    assert board.f["Files"] not in seen["data"]
    assert_problem(await work.api("GET", f"/attachments/{file['id']}", "viewer"), 404)
    assert_problem(await upload(board, task, "viewer"), 404)
    assert_problem(await work.api("DELETE", f"/attachments/{file['id']}", "viewer"), 404)
    # The history does not give the file name away either.
    names = [
        c["field_name"]
        for e in (await work.api("GET", f"/records/{task['id']}/activity", "viewer")).json()
        for c in e["changes"]
    ]
    assert "Files" not in names
    # Everybody else still has it.
    assert len(await files_of(board, task, "editor")) == 1


async def test_a_read_rule_on_the_column_stops_an_editor_from_adding(board: Board) -> None:
    task = await board.create(Name="Plan")
    await board.work.api(
        "PUT",
        f"/fields/{board.f['Files']}/access/{board.user('editor')}",
        json={"access": "read"},
    )
    assert_problem(await upload(board, task, "editor"), 403)
    assert len(await files_of(board, task, "editor")) == 0


async def test_the_sheet_owner_adds_files_and_a_sheet_viewer_only_downloads(board: Board) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    await add_member(work, sheet["id"], "member2", "viewer")
    task = await board.create(Name="Count stock", Assignee=[board.user("member")])

    mine = await upload(board, task, "member", name="count.xlsx")
    assert mine.status_code == 201, mine.text
    [file] = mine.json()["data"][board.f["Files"]]
    assert (await work.api("GET", f"/attachments/{file['id']}", "member2")).content == XLSX
    assert_problem(await upload(board, task, "member2"), 403)
    assert_problem(await work.api("DELETE", f"/attachments/{file['id']}", "member2"), 403)
    # The owner may take their own file out again.
    assert (await work.api("DELETE", f"/attachments/{file['id']}", "member")).status_code == 200


async def test_the_admin_can_do_everything(board: Board) -> None:
    task = await board.create("editor", Name="Not the admin's")
    [file] = (await upload(board, task, "editor")).json()["data"][board.f["Files"]]
    assert (await board.work.api("DELETE", f"/attachments/{file['id']}")).status_code == 200


# --- removing, history, clean-up ----------------------------------------------------------------


async def test_removing_a_file_deletes_it_from_the_disk_and_is_written_down(
    board: Board, files_dir: Path
) -> None:
    work = board.work
    task = await board.create(Name="Plan")
    [file] = (await upload(board, task, name="old.pdf")).json()["data"][board.f["Files"]]
    assert len(on_disk(files_dir)) == 1

    gone = await work.api("DELETE", f"/attachments/{file['id']}")
    assert gone.status_code == 200
    assert gone.json()["data"][board.f["Files"]] == []
    assert on_disk(files_dir) == []
    assert_problem(await work.api("GET", f"/attachments/{file['id']}"), 404)

    entries = (await work.api("GET", f"/records/{task['id']}/activity")).json()
    assert [e["action"] for e in entries] == ["attachment_removed", "attachment_added", "created"]
    assert entries[1]["changes"][0]["after"] == "old.pdf"
    assert entries[0]["changes"][0]["before"] == "old.pdf"


async def test_deleting_the_task_deletes_its_files(board: Board, files_dir: Path) -> None:
    task = await board.create(Name="Plan")
    await upload(board, task, name="a.pdf")
    await upload(board, task, name="b.pdf")
    assert len(on_disk(files_dir)) == 2
    assert (await board.work.api("DELETE", f"/records/{task['id']}")).status_code == 204
    assert on_disk(files_dir) == []


async def test_a_file_that_vanished_from_the_disk_is_a_clean_404(
    board: Board, files_dir: Path
) -> None:
    task = await board.create(Name="Plan")
    [file] = (await upload(board, task)).json()["data"][board.f["Files"]]
    for path in on_disk(files_dir):
        path.unlink()
    assert_problem(await board.work.api("GET", f"/attachments/{file['id']}"), 404)


# --- what a files column accepts (config.max_files, config.accept) ----------------------------


async def test_a_files_column_can_limit_how_many_files_it_holds(board: Board) -> None:
    task = await board.create(Name="Limited")
    response = await board.work.api(
        "PATCH", f"/fields/{board.f['Files']}", json={"config": {"max_files": 2}}
    )
    assert response.status_code == 200, response.text
    assert response.json()["config"] == {"max_files": 2}
    assert (await upload(board, task, name="a.pdf")).status_code == 201
    assert (await upload(board, task, name="b.pdf")).status_code == 201
    third = await upload(board, task, name="c.pdf")
    body = assert_problem(third, 409)
    assert "At most 2" in str(body["detail"])


async def test_a_files_column_can_limit_the_kind_of_file(board: Board) -> None:
    task = await board.create(Name="Pictures only")
    response = await board.work.api(
        "PATCH", f"/fields/{board.f['Files']}", json={"config": {"accept": [".pdf", "image/*"]}}
    )
    assert response.status_code == 200, response.text
    assert (await upload(board, task, name="a.pdf")).status_code == 201
    assert (await upload(board, task, name="photo.png")).status_code == 201
    refused = await upload(board, task, name="sheet.xlsx")
    assert_problem(refused, 415)
    assert [f["name"] for f in await files_of(board, task)] == ["a.pdf", "photo.png"]
