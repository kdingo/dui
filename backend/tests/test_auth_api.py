from __future__ import annotations

import contextlib
import io
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml
from fastapi.testclient import TestClient

from app.auth import cli
from app.auth.users import hash_password
from app.config import get_settings
from app.main import app
from app.routes import auth as auth_routes

ADMIN_PW = "correct-horse-battery"
VIEWER_PW = "viewer-password-123"


class AuthApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.tmp.name)
        env = patch.dict(os.environ, {"DUI_DATA_DIR": str(self.data_dir)})
        env.start()
        self.addCleanup(env.stop)
        get_settings.cache_clear()
        self.addCleanup(get_settings.cache_clear)
        auth_routes.rate_limiter._attempts.clear()
        self.write_users(
            [
                {"username": "admin", "role": "admin", "password_hash": hash_password(ADMIN_PW)},
                {"username": "viewer", "role": "viewer", "password_hash": hash_password(VIEWER_PW)},
            ]
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def write_users(self, users: list[dict]) -> None:
        (self.data_dir / "users.yaml").write_text(yaml.safe_dump({"users": users}), encoding="utf-8")

    def login(self, username: str = "admin", password: str = ADMIN_PW) -> TestClient:
        client = TestClient(app)
        response = client.post("/api/auth/login", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
        return client

    def test_bootstrap_endpoint_is_gone(self) -> None:
        (self.data_dir / "users.yaml").unlink()
        response = TestClient(app).post("/api/auth/bootstrap")
        self.assertEqual(response.status_code, 404)
        self.assertFalse((self.data_dir / "users.yaml").exists())

    def test_no_cors_headers_for_foreign_origin(self) -> None:
        client = self.login()
        response = client.get("/api/auth/me", headers={"Origin": "http://evil.example"})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("access-control-allow-origin", response.headers)
        preflight = client.options(
            "/api/auth/users",
            headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"},
        )
        self.assertNotIn("access-control-allow-origin", preflight.headers)

    def test_cross_site_mutation_blocked_even_with_csrf_token(self) -> None:
        client = self.login()
        response = client.post("/api/auth/logout", headers={"Sec-Fetch-Site": "same-site"})
        self.assertEqual(response.status_code, 403)
        response = client.post("/api/auth/logout", headers={"Sec-Fetch-Site": "same-origin"})
        self.assertEqual(response.status_code, 200)

    def test_demoted_admin_loses_access_immediately(self) -> None:
        victim = self.login()
        other_admin = {"username": "admin2", "role": "admin", "password_hash": hash_password(ADMIN_PW)}
        users = yaml.safe_load((self.data_dir / "users.yaml").read_text())["users"] + [other_admin]
        self.write_users(users)
        admin2 = self.login("admin2")
        self.assertEqual(admin2.patch("/api/auth/users/admin", json={"role": "viewer"}).status_code, 200)
        self.assertEqual(victim.get("/api/auth/users").status_code, 401)

    def test_deleted_user_session_is_rejected(self) -> None:
        viewer = self.login("viewer", VIEWER_PW)
        self.assertEqual(viewer.get("/api/auth/me").status_code, 200)
        admin = self.login()
        self.assertEqual(admin.delete("/api/auth/users/viewer").status_code, 200)
        self.assertEqual(viewer.get("/api/auth/me").status_code, 401)

    def test_logout_revokes_copied_cookie(self) -> None:
        client = self.login()
        stolen = TestClient(app)
        stolen.cookies.set("dui_session", client.cookies.get("dui_session"))
        self.assertEqual(stolen.get("/api/auth/me").status_code, 200)
        self.assertEqual(client.post("/api/auth/logout").status_code, 200)
        self.assertEqual(stolen.get("/api/auth/me").status_code, 401)

    def test_must_change_password_gates_api(self) -> None:
        self.write_users(
            [{"username": "admin", "role": "admin", "password_hash": hash_password(ADMIN_PW), "must_change_password": True}]
        )
        client = TestClient(app)
        login = client.post("/api/auth/login", json={"username": "admin", "password": ADMIN_PW})
        self.assertTrue(login.json()["must_change_password"])
        client.headers["X-CSRF-Token"] = login.json()["csrf_token"]
        self.assertEqual(client.get("/api/dashboard").status_code, 403)
        self.assertTrue(client.get("/api/auth/me").json()["must_change_password"])

        short = client.post("/api/auth/password", json={"current_password": ADMIN_PW, "new_password": "short"})
        self.assertEqual(short.status_code, 400)
        changed = client.post(
            "/api/auth/password", json={"current_password": ADMIN_PW, "new_password": "a-much-better-password"}
        )
        self.assertEqual(changed.status_code, 200, changed.text)
        client.headers["X-CSRF-Token"] = changed.json()["csrf_token"]
        self.assertFalse(client.get("/api/auth/me").json()["must_change_password"])
        self.assertNotEqual(client.get("/api/auth/users").status_code, 403)

    def test_password_policy_on_user_create(self) -> None:
        admin = self.login()
        weak = admin.post("/api/auth/users", json={"username": "bob", "role": "viewer", "password": "secret"})
        self.assertEqual(weak.status_code, 400)
        bad_name = admin.post(
            "/api/auth/users", json={"username": "bob\nrole: admin", "role": "viewer", "password": VIEWER_PW}
        )
        self.assertEqual(bad_name.status_code, 422)

    def test_admin_chooses_password_policy(self) -> None:
        admin = self.login()
        self.assertEqual(admin.get("/api/auth/password-policy").json()["min_length"], 12)
        policy = {"min_length": 14, "require_lowercase": True, "require_uppercase": True,
                  "require_digit": True, "require_symbol": True, "disallow_username": True}
        self.assertEqual(admin.put("/api/auth/password-policy", json=policy).status_code, 200)

        weak = admin.post("/api/auth/users", json={"username": "bob", "role": "viewer", "password": "alllowercase-long"})
        self.assertEqual(weak.status_code, 400)
        self.assertIn("an uppercase letter", weak.json()["detail"])
        self.assertIn("a digit", weak.json()["detail"])
        named = admin.post("/api/auth/users", json={"username": "bob", "role": "viewer", "password": "Bob-Password-1234"})
        self.assertIn("no username", named.json()["detail"])
        strong = admin.post("/api/auth/users", json={"username": "bob", "role": "viewer", "password": "Tr0ub4dor&3-horse"})
        self.assertEqual(strong.status_code, 200, strong.text)
        # Applies to admin resets and self-service changes too.
        self.assertEqual(admin.patch("/api/auth/users/bob", json={"password": "short1A!"}).status_code, 400)

    def test_policy_floor_and_permissions(self) -> None:
        admin = self.login()
        self.assertEqual(admin.put("/api/auth/password-policy", json={"min_length": 4}).status_code, 422)
        viewer = self.login("viewer", VIEWER_PW)
        self.assertEqual(viewer.get("/api/auth/password-policy").status_code, 200)
        self.assertEqual(viewer.put("/api/auth/password-policy", json={"min_length": 8}).status_code, 403)

    def test_relaxed_policy_allows_shorter_password(self) -> None:
        admin = self.login()
        admin.put("/api/auth/password-policy", json={"min_length": 8, "disallow_username": False})
        ok = admin.post("/api/auth/users", json={"username": "kid", "role": "viewer", "password": "eightchr"})
        self.assertEqual(ok.status_code, 200, ok.text)

    def test_spoofed_forwarded_for_does_not_bypass_rate_limit(self) -> None:
        client = TestClient(app)
        statuses = []
        for i in range(8):
            response = client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "wrong"},
                headers={"X-Forwarded-For": f"10.0.0.{i}", "X-Real-IP": f"10.1.0.{i}"},
            )
            statuses.append(response.status_code)
        self.assertIn(429, statuses)

    def test_secret_and_users_file_are_private(self) -> None:
        if sys.platform == "win32":
            self.skipTest("POSIX permissions")
        self.login()
        admin = self.login()
        admin.patch("/api/auth/users/viewer", json={"role": "admin"})
        for name in ("session.secret", "users.yaml"):
            mode = stat.S_IMODE((self.data_dir / name).stat().st_mode)
            self.assertEqual(mode, 0o600, name)


class CliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.tmp.name)
        env = patch.dict(os.environ, {"DUI_DATA_DIR": str(self.data_dir)})
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("DUI_ADMIN_PASSWORD", None)
        get_settings.cache_clear()
        self.addCleanup(get_settings.cache_clear)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_init_generates_one_time_password(self) -> None:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(cli.main(["init"]), 0)
        users = yaml.safe_load((self.data_dir / "users.yaml").read_text())["users"]
        self.assertEqual(users[0]["username"], "admin")
        self.assertTrue(users[0]["must_change_password"])
        self.assertIn("password:", out.getvalue())
        # Second run leaves the existing file alone.
        before = (self.data_dir / "users.yaml").read_text()
        with contextlib.redirect_stdout(io.StringIO()):
            cli.main(["init"])
        self.assertEqual((self.data_dir / "users.yaml").read_text(), before)

    def test_init_flags_published_default_password_on_upgrade(self) -> None:
        users = [
            {"username": "admin", "role": "admin", "password_hash": hash_password("dui")},
            {"username": "ops", "role": "admin", "password_hash": hash_password(ADMIN_PW)},
        ]
        (self.data_dir / "users.yaml").write_text(yaml.safe_dump({"users": users}), encoding="utf-8")
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(cli.main(["init"]), 0)
        saved = {u["username"]: u for u in yaml.safe_load((self.data_dir / "users.yaml").read_text())["users"]}
        self.assertTrue(saved["admin"]["must_change_password"])
        self.assertNotIn("must_change_password", saved["ops"])

    def test_init_rejects_short_env_password(self) -> None:
        with patch.dict(os.environ, {"DUI_ADMIN_PASSWORD": "dui"}), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(cli.main(["init"]), 1)
        self.assertFalse((self.data_dir / "users.yaml").exists())


if __name__ == "__main__":
    unittest.main()
