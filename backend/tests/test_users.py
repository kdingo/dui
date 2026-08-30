from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from app.auth.users import UserStore
from app.config import Settings


SAMPLE_USERS = """
users:
  - username: admin
    password_hash: "$2b$12$ohp6YNtSdChGAbL0l4NS3e2TaY0u7Z/Hj54THcrEgX7mayvFD2IUG"
    role: admin
session:
  ttl_hours: 24
"""


class UserStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        data_dir = Path(self.tmp.name)
        users_file = data_dir / "users.yaml"
        users_file.write_text(SAMPLE_USERS, encoding="utf-8")
        self.store = UserStore(Settings(data_dir=data_dir, users_file=users_file))

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_create_and_list(self) -> None:
        self.store.create_user("viewer1", "secret", "viewer")
        names = {u["username"]: u["role"] for u in self.store.list_users()}
        self.assertEqual(names["admin"], "admin")
        self.assertEqual(names["viewer1"], "viewer")

    def test_duplicate_username_rejected(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            self.store.create_user("admin", "secret", "viewer")
        self.assertEqual(raised.exception.status_code, 400)

    def test_cannot_delete_last_admin(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            self.store.delete_user("admin")
        self.assertEqual(raised.exception.status_code, 400)

    def test_cannot_demote_last_admin(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            self.store.update_user("admin", role="viewer")
        self.assertEqual(raised.exception.status_code, 400)

    def test_delete_viewer(self) -> None:
        self.store.create_user("viewer1", "secret", "viewer")
        self.store.delete_user("viewer1")
        names = [u["username"] for u in self.store.list_users()]
        self.assertEqual(names, ["admin"])


if __name__ == "__main__":
    unittest.main()
