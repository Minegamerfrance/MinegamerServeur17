import concurrent.futures
import json
import logging
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

import catalogue_xp


class CatalogueXpTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "data/easfc-profile.json"
        self.connection = sqlite3.connect(Path(self.temporary.name) / "state.sqlite3", check_same_thread=False)
        self.addCleanup(self.connection.close)
        self.connection.execute("CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        self.state = SimpleNamespace(conn=self.connection, lock=threading.RLock())

    def test_levels_persist_and_retries_do_not_award(self):
        for number in range(10):
            self.assertEqual(catalogue_xp.award(self.state, self.path, f"match:{number + 1}", "LOSS"), 100)
        self.assertEqual(catalogue_xp.profile(self.state, self.path),
                         {"level": 2, "xp": 1000, "currLevelExpMin": 1000, "currLevelExpMax": 2000})
        self.assertEqual(catalogue_xp.award(self.state, self.path, "match:1", "LOSS"), 0)
        reopened = sqlite3.connect(Path(self.temporary.name) / "state.sqlite3")
        self.addCleanup(reopened.close)
        self.assertEqual(catalogue_xp.profile(SimpleNamespace(conn=reopened, lock=threading.RLock()), self.path)["xp"], 1000)

    def test_native_and_fut_report_share_award_and_win_bonus(self):
        self.assertEqual(catalogue_xp.award(self.state, self.path, "report:123"), 100)
        self.assertEqual(catalogue_xp.award(self.state, self.path, "squad_battles:123", "WIN"), 50)
        self.assertEqual(catalogue_xp.award(self.state, self.path, "report:123"), 0)
        self.assertEqual(catalogue_xp.profile(self.state, self.path)["xp"], 150)

    def test_concurrent_retry_and_invalid_key(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            amounts = list(executor.map(lambda number: catalogue_xp.award(self.state, self.path, "same-match", "WIN"), range(12)))
        self.assertEqual(sum(amounts), 150)
        self.assertEqual(catalogue_xp.award(self.state, self.path, None, "WIN"), 0)

    def test_legacy_level_is_preserved_and_corruption_not_overwritten(self):
        self.path.parent.mkdir()
        self.path.write_text(json.dumps({"level": 5}), encoding="utf-8")
        catalogue_xp.award(self.state, self.path, "legacy-match")
        self.assertEqual(catalogue_xp.profile(self.state, self.path)["xp"], 4100)
        self.connection.execute("DELETE FROM kv")
        self.connection.commit()
        self.path.write_text("broken", encoding="utf-8")
        with self.assertRaises(ValueError):
            catalogue_xp.award(self.state, self.path, "invalid-profile")
        self.assertEqual(self.path.read_text(), "broken")
        self.assertIsNone(self.connection.execute("SELECT xp FROM mng_catalogue_xp_events WHERE event_key='invalid-profile'").fetchone())

    def test_report_hook_preserves_response_and_rejects_unfinished_reports(self):
        class State:
            def record_global_match(self, result, event_key=None):
                return result in {"WIN", "LOSS", "DRAW"} and bool(event_key)

        module = SimpleNamespace(State=State, STATE=self.state, RUNTIME_ROOT=Path(self.temporary.name),
                                 log=logging.getLogger("catalogue.test"),
                                 _blaze_game_report_result_payload=lambda request: b"unchanged",
                                 _tdf_get_int=lambda request, field: request.get(field),
                                 _tdf_get_string=lambda request, field: request.get(field))
        catalogue_xp.install(module)
        for request in ({"GRID": 1}, {"GRID": 1, "FNSH": 2, "GTYP": "career"}, {"GRID": 0, "FNSH": 1, "GTYP": "kickoff"}):
            self.assertEqual(module._blaze_game_report_result_payload(request), b"unchanged")
        self.assertEqual(catalogue_xp.profile(self.state, self.path)["xp"], 0)
        request = {"GRID": 123, "FNSH": 1, "GTYP": "career"}
        self.assertEqual(module._blaze_game_report_result_payload(request), b"unchanged")
        module._blaze_game_report_result_payload(request)
        self.assertEqual(catalogue_xp.profile(self.state, self.path)["xp"], 100)


if __name__ == "__main__":
    unittest.main()
