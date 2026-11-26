"""
PUT /api/patterns/<id>/chart-marks and the `chart_grid.marked_cells`
field: each user's own marked cells on a Stitch Fiddle chart (see
UserChartProgress in models.py). Charts come from the real import flow,
with stitchfiddle.fetch_chart faked as in test_stitch_fiddle_routes.py.
"""

from app import stitchfiddle
from app.extensions import db
from app.models import Pattern, UserChartProgress

from test_stitch_fiddle_routes import SIZE, _fake_successful_chart, _login, _register, _save_link

CELL_COUNT = SIZE["columnCount"] * SIZE["rowCount"]


def _import_chart(client, monkeypatch, username="owner"):
    monkeypatch.setattr(stitchfiddle, "fetch_chart", _fake_successful_chart)
    email = _register(client, username)
    _login(client, email)
    link = _save_link(client)
    resp = client.post(f"/api/stitch-fiddle/links/{link['id']}/import")
    assert resp.status_code == 201
    return resp.get_json()["pattern"]["id"], email


def _marks(client, pattern_id):
    return client.get(f"/api/patterns/{pattern_id}").get_json()["chart_grid"]["marked_cells"]


def _put(client, pattern_id, cells):
    return client.put(f"/api/patterns/{pattern_id}/chart-marks", json={"marked_cells": cells})


def test_new_chart_has_no_marks(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)

    assert _marks(client, pattern_id) == []


def test_marks_are_saved_sorted_without_duplicates(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)

    resp = _put(client, pattern_id, [5, 0, 5, CELL_COUNT - 1])

    assert resp.status_code == 200
    assert resp.get_json() == {"marked_cells": [0, 5, CELL_COUNT - 1]}
    assert _marks(client, pattern_id) == [0, 5, CELL_COUNT - 1]


def test_an_empty_list_clears_every_mark(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)
    _put(client, pattern_id, [1, 2, 3])

    assert _put(client, pattern_id, []).status_code == 200
    assert _marks(client, pattern_id) == []


def test_invalid_cells_are_rejected(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)

    for bad in ([CELL_COUNT], [-1], ["3"], [True], [1.5], "1,2", None):
        resp = _put(client, pattern_id, bad)
        assert resp.status_code == 400, bad
        assert resp.get_json()["code"] == "invalid_chart_marks"
    assert _marks(client, pattern_id) == []


def test_saving_marks_needs_login(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)
    client.post("/api/logout")

    assert _put(client, pattern_id, [1]).status_code == 401


def test_someone_who_cannot_see_the_pattern_gets_404(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)  # private to its owner
    client.post("/api/logout")
    _login(client, _register(client, "stranger"))

    assert _put(client, pattern_id, [1]).status_code == 404


def test_a_pattern_without_a_chart_is_rejected(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)
    with client.application.app_context():
        Pattern.query.get(pattern_id).chart_grid_data = None
        db.session.commit()

    resp = _put(client, pattern_id, [1])

    assert resp.status_code == 400
    assert resp.get_json()["code"] == "no_chart"


def test_each_user_has_their_own_marks(client, monkeypatch):
    pattern_id, owner_email = _import_chart(client, monkeypatch)
    assert client.post(f"/api/patterns/{pattern_id}/publish").status_code == 200
    _put(client, pattern_id, [1, 2])
    client.post("/api/logout")

    _login(client, _register(client, "crafter"))
    assert _marks(client, pattern_id) == []
    _put(client, pattern_id, [7])
    assert _marks(client, pattern_id) == [7]

    client.post("/api/logout")
    assert _marks(client, pattern_id) == []  # anonymous viewers' marks live in their browser
    _login(client, owner_email)
    assert _marks(client, pattern_id) == [1, 2]


def test_marks_saved_for_a_different_chart_shape_are_ignored(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)
    _put(client, pattern_id, [1, 2])
    with client.application.app_context():
        UserChartProgress.query.filter_by(pattern_id=pattern_id).first().grid_shape = "1x1"
        db.session.commit()

    assert _marks(client, pattern_id) == []
    _put(client, pattern_id, [3])
    assert _marks(client, pattern_id) == [3]


def test_deleting_the_pattern_deletes_its_marks(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)
    _put(client, pattern_id, [1])

    assert client.delete(f"/api/patterns/{pattern_id}").status_code == 200
    with client.application.app_context():
        assert UserChartProgress.query.count() == 0
