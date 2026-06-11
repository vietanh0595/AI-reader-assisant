from backend.app.config import Settings


def test_settings_reads_database_and_oidc(monkeypatch):
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
    for name in ("OIDC_ISSUER_URL", "OIDC_AUDIENCE", "OIDC_JWKS_URL"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings.from_env()
    try:
        settings.require_oidc_settings()
    except RuntimeError as exc:
        assert "OIDC_ISSUER_URL" in str(exc)
    else:
        raise AssertionError("Expected missing OIDC settings to fail")
