"""
POST /api/stitch-fiddle/patterns/<id>/refresh: fetch an imported chart
again from its share link and replace the grid and palette.
stitchfiddle.fetch_chart is faked, as in test_stitch_fiddle_routes.py.
"""

import base64

from app import stitchfiddle
from app.extensions import db
from app.models import Pattern

from test_stitch_fiddle_routes import SIZE, _fake_access_denied, _fake_successful_chart, _login, _register, _save_link


def _import_chart(client, monkeypatch, username="owner"):
    monkeypatch.setattr(stitchfiddle, "fetch_chart", _fake_successful_chart)
    email = _register(client, username)
    _login(client, email)
    link = _save_link(client)
    resp = client.post(f"/api/stitch-fiddle/links/{link['id']}/import")
    assert resp.status_code == 201
    return resp.get_json()["pattern"]["id"], email


def _chart(columns, rows, fill=1, palette=None):
    """A fetch_chart result with every cell set to `fill`."""
    encoded = base64.b64encode(bytes([fill]) * (columns * rows)).decode("ascii")
    original = _fake_successful_chart()
    return lambda *_a, **_k: {
        **original,
        "column_count": columns,
        "row_count": rows,
        "grid_rows_field": [f"1:{encoded}"],
        "palette": palette or original["palette"],
    }


def _refresh(client, pattern_id):
    return client.post(f"/api/stitch-fiddle/patterns/{pattern_id}/refresh")


def test_refresh_with_no_change_says_up_to_date(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)

    resp = _refresh(client, pattern_id)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["changed"] is False
    assert body["message"] == "The chart is already up to date."


def test_refresh_replaces_the_grid_and_keeps_edits_elsewhere(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)
    with client.application.app_context():
        pattern = Pattern.query.get(pattern_id)
        pattern.title = "My own title"
        pattern.materials = "My own materials"
        db.session.commit()
    monkeypatch.setattr(stitchfiddle, "fetch_chart", _chart(SIZE["columnCount"], SIZE["rowCount"], fill=0))

    body = _refresh(client, pattern_id).get_json()

    assert body["changed"] is True
    grid = body["pattern"]["chart_grid"]
    assert set(grid["cells"]) == {0}
    assert body["pattern"]["title"] == "My own title"
    assert body["pattern"]["materials"] == "My own materials"


def test_marks_stay_when_the_size_is_unchanged_and_reset_when_it_changes(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)
    client.put(f"/api/patterns/{pattern_id}/chart-marks", json={"marked_cells": [0, 1]})

    monkeypatch.setattr(stitchfiddle, "fetch_chart", _chart(SIZE["columnCount"], SIZE["rowCount"], fill=0))
    assert _refresh(client, pattern_id).get_json()["pattern"]["chart_grid"]["marked_cells"] == [0, 1]

    monkeypatch.setattr(stitchfiddle, "fetch_chart", _chart(3, 2))
    grid = _refresh(client, pattern_id).get_json()["pattern"]["chart_grid"]
    assert (grid["column_count"], grid["row_count"]) == (3, 2)
    assert grid["marked_cells"] == []


def test_a_failed_fetch_leaves_the_chart_alone(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)
    before = client.get(f"/api/patterns/{pattern_id}").get_json()["chart_grid"]
    monkeypatch.setattr(stitchfiddle, "fetch_chart", _fake_access_denied)

    resp = _refresh(client, pattern_id)

    assert resp.status_code == 502
    assert resp.get_json()["code"] == "stitchfiddle_fetch_error"
    assert client.get(f"/api/patterns/{pattern_id}").get_json()["chart_grid"] == before


def test_only_someone_who_can_edit_may_refresh(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)
    assert client.post(f"/api/patterns/{pattern_id}/publish").status_code == 200
    client.post("/api/logout")
    assert _refresh(client, pattern_id).status_code == 401

    _login(client, _register(client, "viewer"))
    resp = _refresh(client, pattern_id)
    assert resp.status_code == 403
    assert resp.get_json()["code"] == "pattern_forbidden"


def test_a_pattern_that_is_not_a_stitch_fiddle_chart_is_refused(client, monkeypatch):
    pattern_id, _ = _import_chart(client, monkeypatch)
    with client.application.app_context():
        Pattern.query.get(pattern_id).original_url = "https://example.com/a-pattern"
        db.session.commit()

    resp = _refresh(client, pattern_id)

    assert resp.status_code == 400
    assert resp.get_json()["code"] == "not_stitchfiddle_chart"
