import json
import logging
import sqlite3
import threading
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import catalogue_lewandowski
import catalogue_progression

from easfc_catalog import (CATALOG_NAME, CATALOG_PATH, FUT_COIN_REWARD, LEVEL_PATH, REWARD_CLAIM,
                           WEIGHT_PATH, install)


class CatalogueTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.original_calls = []

        def original(*arguments):
            self.original_calls.append(arguments)
            return 200, {}, b"original-response"

        self.data_dir = Path(self.temporary.name) / "data"
        self.data_dir.mkdir()
        connection = sqlite3.connect(":memory:")
        connection.execute("CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        connection.execute("CREATE TABLE items(id INTEGER PRIMARY KEY, resource_id INTEGER, pile TEXT, data TEXT)")
        connection.execute("CREATE TABLE unopened_packs(id INTEGER PRIMARY KEY, pack_id INTEGER, data TEXT)")
        connection.execute("INSERT INTO kv(key,value) VALUES('credits','1000')")
        connection.commit()
        self.state = SimpleNamespace(conn=connection, lock=threading.RLock())
        self.state.build_player_item = lambda resource, item_id, pile: {"id": item_id, "resourceId": resource, "pile": pile, "rating": 85}
        self.module = SimpleNamespace(RUNTIME_ROOT=Path(self.temporary.name), route_fut=original,
                                      json_bytes=lambda value: json.dumps(value).encode(),
                                      log=logging.getLogger("test.easfc"), STATE=self.state,
                                      CFG={"nucleus_id": 123456})
        install(self.module)

    def tearDown(self):
        self.state.conn.close()

    def request(self, path):
        status, headers, body = self.module.route_fut("GET", path, {}, b"")
        self.assertEqual(status, 200)
        return json.loads(body)

    def test_catalogue_is_not_fut_store(self):
        payload = self.request(CATALOG_PATH)
        self.assertEqual(payload["totalCount"], 1)
        self.assertEqual(payload["catalogList"], payload["catalogs"])
        self.assertNotIn("FUT", payload["catalogs"][0]["name"])
        self.assertEqual(payload["catalogs"][0]["name"], "EASFC Store FIFA20 PC")
        self.assertEqual(payload["catalogs"][0]["name"], CATALOG_NAME)

    def test_catalogue_lists_level_one_fut_coin_reward(self):
        payload = self.request("/pow/store/game/fifa20/catalog/0/item/list?offset=0")
        self.assertEqual(payload["totalCount"], 11)
        self.assertEqual(payload["items"][0]["name"], "500 crédits FUT")
        self.assertEqual(payload["items"][0]["requiredLevel"], 1)
        self.assertEqual(payload["items"][0]["awardValue"], 500)

    def test_native_ownership_ids_remain_distinct_with_shared_player_icon(self):
        items = self.request("/pow/store/game/fifa20/catalog/0/item/list")["items"]
        types = [{attribute["name"]: attribute["value"] for attribute in item["attributes"]}["typeId"] for item in items]
        self.assertEqual(len({item["itemId"] for item in items}), 11)
        self.assertEqual(types[9], types[10])
        self.module.route_fut("POST", "/pow/store/catalog/0/item/1", {}, b'{"currency":"pow_funds","quantity":1}')
        inventory = self.request("/pow/inventory/item/list")["items"]
        self.assertEqual({attribute["name"]: attribute["value"] for attribute in inventory[0]["attributes"]}["typeId"], "1")
        self.assertFalse(self.request("/pow/store/game/fifa20/catalog/0/item/list")["items"][1]["locked"])

    def test_unrelated_lists_stay_empty(self):
        for path in ["/pow/store/gift/list", "/pow/inventory/item/list"]:
            payload = self.request(path + "?offset=0")
            self.assertEqual(payload["totalCount"], 0)
            self.assertEqual(payload["items"], [])
            self.assertTrue(payload["endOfList"])

    def test_native_article_metadata_and_price(self):
        item = self.request("/pow/store/game/fifa20/catalog/0/item/list")["items"][0]
        attributes = {entry["name"]: entry["value"] for entry in item["attributes"]}
        self.assertEqual(attributes["itemName"], "500 crédits FUT")
        self.assertEqual(attributes["unlockLevel"], "1")
        self.assertEqual(attributes["ungiftable"], "1")
        self.assertTrue(all(isinstance(entry["value"], str) for entry in item["attributes"]))
        self.assertEqual(item["prices"], [{"currency": "pow_funds", "price": 0}])

    def test_native_level_uses_users_and_nucleus_identity(self):
        payload = self.request(LEVEL_PATH + "?self=true")
        expected = {"nucId": 123456, "level": 1, "xp": 0,
                    "xpCapCurrLevel": 0, "xpCapNextLevel": 1000}
        self.assertEqual(payload["users"], [expected, dict(expected, nucId=0)])

    def test_native_offline_identity_is_not_duplicated(self):
        self.module.CFG["nucleus_id"] = 0
        self.assertEqual(len(self.request(LEVEL_PATH)["users"]), 1)

    def test_native_weight_selects_fifa_businessunit(self):
        self.assertEqual(self.request(WEIGHT_PATH)["tierweights"], [
            {"tiergroup": "businessunit", "tiername": "fifa",
             "weights": [{"gametitle": "fifa20", "weight": 1}]}])

    def test_native_purchase_grants_once_and_reports_success(self):
        body = json.dumps({"currency": "pow_funds", "quantity": 1}).encode()
        path = "/pow/store/catalog/0/item/1"
        for already_claimed in (False, True):
            status, _, response = self.module.route_fut("POST", path, {}, body)
            payload = json.loads(response)
            self.assertEqual(status, 200)
            self.assertEqual(payload["reason"], "purchase_successful")
            self.assertEqual(payload["priceTotal"], 0)
            self.assertEqual(payload["accountBalance"], 0)
            self.assertEqual(payload["alreadyClaimed"], already_claimed)
            self.assertEqual(payload["credits"], 1500)

    def test_native_invalid_purchase_does_not_grant(self):
        for body in [b"{", b"null", b"[]", b'{}',
                     b'{"currency":"FUT","quantity":1}',
                     b'{"currency":"pow_funds","quantity":true}',
                     b'{"currency":"pow_funds","quantity":2}']:
            status, _, _ = self.module.route_fut("POST", "/pow/store/catalog/0/item/1", {}, body)
            self.assertEqual(status, 400)
        credits = self.state.conn.execute("SELECT value FROM kv WHERE key='credits'").fetchone()[0]
        self.assertEqual(json.loads(credits), 1000)

    def test_catalogue_pagination_has_no_repeated_reward(self):
        self.assertEqual(len(self.request("/pow/store/game/fifa20/catalog/0/item/list?offset=0&count=1")["items"]), 1)
        self.assertEqual(self.request("/pow/store/game/fifa20/catalog/0/item/list?offset=1&count=49")["items"][0]["itemId"], 102)
        self.assertEqual(self.request("/pow/store/game/fifa20/catalog/0/item/list?offset=10&count=49")["items"][0]["name"], "Dante Moments")
        self.assertEqual(self.request("/pow/store/game/fifa20/catalog/0/item/list?offset=11&count=49")["items"], [])
        payload = self.request("/pow/store/game/fifa20/catalog/0/item/list")
        self.assertNotIn("itemList", payload)
        for query in ["offset=-1", "offset=bad", "count=0", "count=1001"]:
            status, _, _ = self.module.route_fut("GET", "/pow/store/game/fifa20/catalog/0/item/list?" + query, {}, b"")
            self.assertEqual(status, 400)

    def test_claimed_reward_is_owned_and_locked_without_extra_credits(self):
        path = "/pow/store/catalog/0/item/1"
        body = b'{"currency":"pow_funds","quantity":1}'
        self.module.route_fut("POST", path, {}, body)
        inventory = self.request("/pow/inventory/item/list")
        self.assertEqual(inventory["items"][0]["itemId"], 1)
        self.assertEqual(inventory["items"][0]["quantity"], 1)
        self.assertTrue(self.request("/pow/store/game/fifa20/catalog/0/item/list")["items"][0]["locked"])
        response = json.loads(self.module.route_fut("POST", path, {}, body)[2])
        self.assertEqual(response["message"], "Récompense déjà récupérée.")
        self.assertEqual(response["credits"], 1500)

    def test_level_one_reward_is_claimed_once_as_fut_coins(self):
        path = f"/pow/store/game/fifa20/catalog/0/item/{FUT_COIN_REWARD['itemId']}/redeem"
        first = self.module.route_fut("POST", path, {}, b"")
        first_payload = json.loads(first[2])
        self.assertEqual(first[0], 200)
        self.assertFalse(first_payload["alreadyClaimed"])
        self.assertEqual(first_payload["credits"], 1500)
        self.assertEqual(first_payload["awardedPrizes"][0]["awardValue"], 500)
        second = self.module.route_fut("POST", path, {}, b"")
        second_payload = json.loads(second[2])
        self.assertEqual(second[0], 200)
        self.assertTrue(second_payload["alreadyClaimed"])
        self.assertEqual(second_payload["credits"], 1500)
        self.assertEqual(self.state.conn.execute("SELECT value FROM kv WHERE key='credits'").fetchone()[0], "1500")

    def test_unknown_catalog_reward_is_rejected(self):
        status, _, body = self.module.route_fut("POST", "/pow/store/game/fifa20/catalog/0/item/99/redeem", {}, b"")
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(body)["error"], "CATALOG_ITEM_NOT_FOUND")

    def test_lewandowski_is_received_once_in_unassigned_without_spending_coins(self):
        (self.data_dir / "easfc-profile.json").write_text(json.dumps({"level": 10}))
        path = "/pow/store/catalog/0/item/2"
        purchase = b'{"currency":"pow_funds","quantity":1}'
        first = json.loads(self.module.route_fut("POST", path, {}, purchase)[2])
        self.assertFalse(first["alreadyClaimed"])
        item = first["itemData"][0]
        self.assertEqual(item["resourceId"], catalogue_lewandowski.RESOURCE_ID)
        self.assertEqual(item["pile"], "unassigned")
        self.assertTrue(item["untradeable"])
        self.assertEqual(item["discardValue"], 0)
        second = json.loads(self.module.route_fut("POST", path, {}, purchase)[2])
        self.assertTrue(second["alreadyClaimed"])
        self.assertEqual(self.state.conn.execute("SELECT COUNT(*) FROM items").fetchone()[0], 1)
        self.assertEqual(self.state.conn.execute("SELECT value FROM kv WHERE key='credits'").fetchone()[0], "1000")
        self.assertTrue(next(item for item in self.request("/pow/store/game/fifa20/catalog/0/item/list")["items"] if item["itemId"] == catalogue_lewandowski.ITEM_ID)["locked"])
        self.assertEqual(self.request("/pow/inventory/item/list")["items"][0]["itemId"], 2)

    def test_player_grant_rolls_back_on_item_insert_failure(self):
        self.state.conn.execute("CREATE TRIGGER fail_grant BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            catalogue_lewandowski.claim(self.state)
        self.assertIsNone(self.state.conn.execute("SELECT value FROM kv WHERE key=?", (catalogue_lewandowski.CLAIM_KEY,)).fetchone())
        self.assertEqual(self.state.conn.execute("SELECT COUNT(*) FROM items").fetchone()[0], 0)

    def test_owned_player_refresh_preserves_progress_and_claim(self):
        result = catalogue_lewandowski.claim(self.state)
        item = result["itemData"][0]
        item.update(contracts=12, goals=7, rareflag=32)
        self.state.conn.execute("UPDATE items SET data=? WHERE id=?", (json.dumps(item), item["id"]))
        self.state.conn.commit()
        self.state.build_player_item = lambda resource, item_id, pile: {"assetId": 500005, "rating": 85, "rareflag": 51, "weakFoot": 4, "skillMoves": 3}
        catalogue_lewandowski.refresh_owned_items(self.state)
        saved = json.loads(self.state.conn.execute("SELECT data FROM items WHERE id=?", (item["id"],)).fetchone()[0])
        self.assertEqual((saved["contracts"], saved["goals"], saved["id"]), (12, 7, item["id"]))
        self.assertEqual((saved["assetId"], saved["rareflag"], saved["weakFoot"], saved["skillMoves"]), (500005, 51, 4, 3))
        self.assertTrue(catalogue_lewandowski.claim(self.state)["alreadyClaimed"])

    def test_catalogue_levels_and_rewards(self):
        entries = self.request("/pow/store/game/fifa20/catalog/0/item/list")["items"]
        self.assertEqual([entry["level"] for entry in entries], list(range(1, 11)) + [15])
        self.assertEqual(entries[4]["rewardType"], "boost")
        self.assertEqual(entries[9]["name"], "Lewandowski Flashback 85")
        self.assertEqual(entries[-1]["name"], "Dante Moments")
        for entry in entries:
            attributes = {field["name"]: field["value"] for field in entry["attributes"]}
            self.assertEqual(attributes["isConsumable"], "1")

    def test_pack_claims_respect_level_and_do_not_repeat(self):
        purchase = b'{"currency":"pow_funds","quantity":1}'
        self.assertEqual(self.module.route_fut("POST", "/pow/store/catalog/0/item/102", {}, purchase)[0], 403)
        (self.data_dir / "easfc-profile.json").write_text(json.dumps({"level": 10}))
        for level in catalogue_progression.PACK_LEVELS:
            path = f"/pow/store/catalog/0/item/{100 + level}"
            for already in (False, True):
                response = self.module.route_fut("POST", path, {}, purchase)
                self.assertEqual(response[0], 200)
                self.assertEqual(json.loads(response[2])["alreadyClaimed"], already)
        self.assertEqual(self.state.conn.execute("SELECT COUNT(*) FROM unopened_packs WHERE pack_id=?", (1046,)).fetchone()[0], 7)

    def test_boost_pays_five_distinct_matches_and_cannot_reset(self):
        self.assertEqual(catalogue_progression.apply_boost(self.state, "before"), 0)
        catalogue_progression.claim(self.state, 5)
        for match in range(5):
            self.assertEqual(catalogue_progression.apply_boost(self.state, str(match)), 500)
            self.assertEqual(catalogue_progression.apply_boost(self.state, str(match)), 0)
        self.assertEqual(catalogue_progression.apply_boost(self.state, "sixth"), 0)
        self.assertTrue(catalogue_progression.claim(self.state, 5)["alreadyClaimed"])
        self.assertEqual(catalogue_progression.apply_boost(self.state, "seventh"), 0)
        self.assertEqual(self.state.conn.execute("SELECT value FROM kv WHERE key='credits'").fetchone()[0], "3500")

    def test_invalid_profile_does_not_grant_reward(self):
        path = Path(self.temporary.name) / "data" / "easfc-profile.json"
        path.write_text(json.dumps({"level": 0, "xp": 0, "currLevelExpMin": 0, "currLevelExpMax": 1000}))
        status, _, body = self.module.route_fut(
            "POST", f"/pow/store/game/fifa20/catalog/0/item/{FUT_COIN_REWARD['itemId']}/redeem", {}, b"")
        self.assertEqual(status, 503)
        self.assertEqual(json.loads(body)["error"], "EASFC_PROFILE_INVALID")
        self.assertEqual(self.state.conn.execute("SELECT value FROM kv WHERE key='credits'").fetchone()[0], "1000")

    def test_unrecognized_catalog_remains_empty(self):
        path = "/pow/store/game/fifa20/catalog/99/item/list"
        status, _, body = self.module.route_fut("GET", path, {}, b"")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["items"], [])
        self.assertEqual(json.loads(body)["totalCount"], 0)

    def test_lists_keep_existing_empty_shape(self):
        for path in ["/pow/store/gift/list", "/pow/inventory/item/list"]:
            payload = self.request(path + "?offset=0")
            self.assertEqual(payload["totalCount"], 0)
            self.assertEqual(payload["items"], [])
            self.assertTrue(payload["endOfList"])

    def test_fut_and_bank_are_untouched(self):
        for path in ["/ut/game/fifa20/hub", "/pow/bank/user/account", "/pow/auth",
                     "/pow/store/game/fifa17/catalog/list"]:
            self.assertEqual(self.module.route_fut("GET", path, {}, b"")[2], b"original-response")
        self.assertEqual(len(self.original_calls), 4)
        self.assertEqual(list(self.data_dir.iterdir()), [])

    def test_level_is_separate_from_fut_and_does_not_claim_import(self):
        self.assertEqual(self.request(LEVEL_PATH)["level"], 1)
        self.assertEqual(self.request(LEVEL_PATH)["xp"], 0)
        self.assertEqual(self.request(WEIGHT_PATH)["totalCount"], 1)
        self.assertEqual(list(self.data_dir.iterdir()), [])

    def test_saved_profile_is_preserved(self):
        path = self.data_dir / "easfc-profile.json"
        contents = json.dumps({"level": 3, "xp": 2400, "currLevelExpMin": 2000, "currLevelExpMax": 3000})
        path.write_text(contents)
        self.assertEqual(self.request(LEVEL_PATH)["xp"], 2400)
        self.assertEqual(path.read_text(), contents)

    def test_invalid_profile_fails_without_overwriting(self):
        path = self.data_dir / "easfc-profile.json"
        path.write_text('{"level": -1}')
        self.assertEqual(self.module.route_fut("GET", LEVEL_PATH, {}, b"")[0], 503)
        self.assertEqual(path.read_text(), '{"level": -1}')

    def test_install_is_idempotent_and_posts_pass_through(self):
        wrapped = self.module.route_fut
        install(self.module)
        self.assertIs(self.module.route_fut, wrapped)
        self.assertEqual(self.module.route_fut("POST", CATALOG_PATH, {}, b"")[2], b"original-response")
        self.assertEqual(self.request("/" + CATALOG_PATH)["totalCount"], 1)


if __name__ == "__main__":
    unittest.main()
