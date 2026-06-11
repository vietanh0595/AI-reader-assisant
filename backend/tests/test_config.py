from backend.app.config import Settings


def test_settings_reads_database_and_oidc(monkeypatch):
    monkeypatch.setattr("backend.app.config.load_project_env_files", lambda: None)
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://reader:reader@localhost:5432/reader")
    monkeypatch.setenv("OIDC_ISSUER_URL", "https://login.example.com/")
    monkeypatch.setenv("OIDC_AUDIENCE", "ai-reader-api")
    monkeypatch.setenv("OIDC_JWKS_URL", "https://login.example.com/.well-known/jwks.json")
    settings = Settings.from_env()
    assert settings.database_url.endswith("/reader")
    assert settings.oidc_issuer_url == "https://login.example.com/"
    assert settings.oidc_audience == "ai-reader-api"
    assert settings.oidc_jwks_url.endswith("jwks.json")


def test_require_auth_settings_reports_missing_values(monkeypatch):
    monkeypatch.setattr("backend.app.config.load_project_env_files", lambda: None)
    for name in ("OIDC_ISSUER_URL", "OIDC_AUDIENCE", "OIDC_JWKS_URL"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings.from_env()
    try:
        settings.require_oidc_settings()
    except RuntimeError as exc:
        message = str(exc)
        assert "OIDC_ISSUER_URL" in message
        assert "OIDC_AUDIENCE" in message
        assert "OIDC_JWKS_URL" in message
    else:
        raise AssertionError("Expected missing OIDC settings to fail")


def test_require_oidc_settings_returns_configured_values(monkeypatch):
    monkeypatch.setattr("backend.app.config.load_project_env_files", lambda: None)
    monkeypatch.setenv("OIDC_ISSUER_URL", "https://login.example.com/")
    monkeypatch.setenv("OIDC_AUDIENCE", "ai-reader-api")
    monkeypatch.setenv("OIDC_JWKS_URL", "https://login.example.com/.well-known/jwks.json")

    oidc_settings = Settings.from_env().require_oidc_settings()

    assert oidc_settings.issuer_url == "https://login.example.com/"
    assert oidc_settings.audience == "ai-reader-api"
    assert oidc_settings.jwks_url == "https://login.example.com/.well-known/jwks.json"
