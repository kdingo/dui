from __future__ import annotations

import os
import string
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.auth.users import hash_password
from app.config import get_settings
from app.dhcp.models import DhcpHost
from app.errors import MESSAGES, AppError, format_message, to_http
from app.main import app
from app.routes import auth as auth_routes

ADMIN_PW = "correct-horse-battery"


class ErrorCodeTests(unittest.TestCase):
    def test_every_template_formats_with_its_own_placeholders(self) -> None:
        for code, template in MESSAGES.items():
            names = [field for _, field, _, _ in string.Formatter().parse(template) if field]
            self.assertEqual(format_message(code, {n: "x" for n in names}).count("{"), 0, code)

    def test_validation_error_keeps_item_codes(self) -> None:
        with self.assertRaises(ValidationError) as ctx:
            DhcpHost(id="h", name="pc", hardware_address="nope", fixed_address="10.0.0.5")
        error = to_http(ctx.exception)
        self.assertIsInstance(error, AppError)
        assert isinstance(error, AppError)
        self.assertEqual(error.code, "config.invalid")
        self.assertEqual(error.errors[0]["type"], "validation.mac")
        self.assertEqual(error.errors[0]["ctx"], {"value": "nope"})


class ErrorResponseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data_dir = Path(self.tmp.name)
        env = patch.dict(os.environ, {"DUI_DATA_DIR": str(self.data_dir)})
        env.start()
        self.addCleanup(env.stop)
        get_settings.cache_clear()
        self.addCleanup(get_settings.cache_clear)
        auth_routes.rate_limiter._attempts.clear()
        users = [{"username": "admin", "role": "admin", "password_hash": hash_password(ADMIN_PW)}]
        (self.data_dir / "users.yaml").write_text(yaml.safe_dump({"users": users}), encoding="utf-8")
        self.client = TestClient(app)
        response = self.client.post("/api/auth/login", json={"username": "admin", "password": ADMIN_PW})
        self.client.headers["X-CSRF-Token"] = response.json()["csrf_token"]

    def test_app_error_carries_code_and_params(self) -> None:
        response = self.client.post(
            "/api/auth/users", json={"username": "admin", "role": "viewer", "password": "another-long-pass"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json(),
            {"detail": "User admin already exists", "code": "user.exists", "params": {"username": "admin"}},
        )

    def test_auth_errors_are_coded(self) -> None:
        response = TestClient(app).get("/api/auth/me")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "auth.not_authenticated")

    def test_field_validation_422_uses_custom_type(self) -> None:
        response = self.client.post(
            "/api/config/hosts", json={"name": "pc", "hardware_address": "zz", "fixed_address": "10.0.0.5"}
        )
        self.assertEqual(response.status_code, 422)
        item = response.json()["detail"][0]
        self.assertEqual(item["type"], "validation.mac")
        self.assertEqual(item["ctx"], {"value": "zz"})

    def test_domain_value_error_is_coded(self) -> None:
        response = self.client.post("/api/config/import", json={"content": "on commit {\n}\n"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "config.unsupported_block")
        self.assertEqual(response.json()["params"], {"line": "on commit {"})

    def test_bad_zip_is_coded(self) -> None:
        response = self.client.post(
            "/api/config/import-zip", files={"file": ("x.zip", b"not a zip", "application/zip")}
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "import.zip_invalid")

    def test_missing_snapshot_is_coded_404(self) -> None:
        response = self.client.delete("/api/snapshots/20000101T000000Z")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "snapshot.not_found")
        self.assertEqual(response.json()["params"], {"id": "20000101T000000Z"})


if __name__ == "__main__":
    unittest.main()
