from __future__ import annotations

import unittest

from app.startup import salvage_config


class SalvageTests(unittest.TestCase):
    def test_drops_only_unsafe_items(self) -> None:
        raw = {
            "option_definitions": ['execute("/bin/sh", "-c", "id");', "one-lease-per-client on;"],
            "global_options": {"domain-name-servers": ["10.0.0.1"], "domain-name": 'x"; include "/etc/shadow'},
            "subnets": [
                {"id": "s1", "network": "10.0.0.0/24", "range": {"start": "10.0.0.10", "end": "10.0.0.20"},
                 "options": {"routers": ["10.0.0.1"]}},
            ],
            "hosts": [
                {"id": "h1", "name": "ok", "hardware_address": "aa:bb:cc:dd:ee:ff", "fixed_address": "10.0.0.5"},
                {"id": "h2", "name": "bad name {", "hardware_address": "aa:bb:cc:dd:ee:01", "fixed_address": "10.0.0.6"},
            ],
            "log_facility": "local7; include x",
        }
        config, dropped = salvage_config(raw)
        self.assertEqual(config.option_definitions, ["one-lease-per-client on;"])
        self.assertEqual(config.global_options, {"domain-name-servers": ["10.0.0.1"]})
        self.assertEqual([s.network for s in config.subnets], ["10.0.0.0/24"])
        self.assertEqual([h.name for h in config.hosts], ["ok"])
        self.assertEqual(config.log_facility, "local7")
        self.assertEqual(len(dropped), 4)

    def test_valid_config_untouched(self) -> None:
        raw = {"subnets": [{"id": "s1", "network": "10.0.0.0/24", "options": {"routers": ["10.0.0.1"]}}]}
        config, dropped = salvage_config(raw)
        self.assertEqual(dropped, [])
        self.assertEqual(config.subnets[0].options, {"routers": ["10.0.0.1"]})


if __name__ == "__main__":
    unittest.main()
