"""/api/health: liveness plus true/false config flags for smoke tests."""

from app import create_app


def test_health_reports_missing_config_as_false(client, monkeypatch):
    for name in ("GEMINI_API_KEY", "RESEND_ONBOARDING", "RESEND_NOTIFICATIONS"):
        monkeypatch.delenv(name, raising=False)

    resp = client.get("/api/health")

    assert resp.status_code == 200
    assert resp.get_json() == {
        "status": "ok",
        "config": {
            "gemini": False,
            "email_onboarding": False,
            "email_notifications": False,
            "proxy_secret": False,
            "proxy_verified": False,
        },
    }


def test_health_reports_set_config_without_values(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-test-value")
    monkeypatch.setenv("RESEND_ONBOARDING", "resend-test-value")

    resp = client.get("/api/health")

    body = resp.get_json()
    assert body["config"]["gemini"] is True
    assert body["config"]["email_onboarding"] is True
    assert "test-value" not in resp.get_data(as_text=True)


def _app_with_proxy_secret(tmp_path):
    return create_app(config_overrides={
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'health.db'}",
        "PROXY_SHARED_SECRET": "proxy-test-secret",
    })


def test_health_proxy_verified_only_with_matching_secret(tmp_path):
    client = _app_with_proxy_secret(tmp_path).test_client()

    matched = client.get("/api/health", headers={"X-Yarnboard-Proxy-Secret": "proxy-test-secret"})
    wrong = client.get("/api/health", headers={"X-Yarnboard-Proxy-Secret": "nope"})
    missing = client.get("/api/health")

    assert matched.get_json()["config"]["proxy_secret"] is True
    assert matched.get_json()["config"]["proxy_verified"] is True
    assert wrong.get_json()["config"]["proxy_verified"] is False
    assert missing.get_json()["config"]["proxy_verified"] is False
    assert "proxy-test-secret" not in matched.get_data(as_text=True)
