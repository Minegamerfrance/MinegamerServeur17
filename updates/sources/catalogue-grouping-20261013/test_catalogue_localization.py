import json
import unittest

import catalogue_grouping
import catalogue_localization
from test_fifa20_easfc_catalog import CatalogueTests


class CatalogueLocalizationTests(CatalogueTests):
    def test_every_translation_uses_native_item_descriptions_without_mutating_french(self):
        for locale in catalogue_localization.TEXTS:
            items = self.request(f"/pow/store/game/fifa20/catalog/0/item/list?locale={locale}")["items"]
            for item_id, index in ((2, 0), (15, 1)):
                item = next(item for item in items if item["itemId"] == item_id)
                attributes = {entry["name"]: entry["value"] for entry in item["attributes"]}
                self.assertEqual(attributes["itemDescription"], catalogue_localization.TEXTS[locale][index])
        self.assertIn("Choisi par Dante_GFX", self.request("/pow/store/game/fifa20/catalog/0/item/list")["items"][-1]["description"])

    def test_native_auth_locale_is_remembered_but_explicit_language_wins(self):
        self.module.route_fut("POST", "//pow/auth", {}, b'{"locale":"en-US"}')
        self.assertIn("Selected by", self.request("/pow/store/game/fifa20/catalog/0/item/list")["items"][-1]["description"])
        self.assertIn("Ausgewählt", self.request("/pow/store/game/fifa20/catalog/0/item/list?lang=de_DE")["items"][-1]["description"])
        status, _, body = self.module.route_fut("GET", "/pow/store/game/fifa20/catalog/0/item/list", {"Accept-Language": "es-ES"}, b"")
        self.assertEqual(status, 200)
        self.assertIn("Elegido", json.loads(body)["items"][-1]["description"])

    def test_shared_icon_does_not_share_claim_or_inventory_identity(self):
        (self.data_dir / "easfc-profile.json").write_text(json.dumps({"level": 15}), encoding="utf-8")
        request = b'{"currency":"pow_funds","quantity":1}'
        status, _, body = self.module.route_fut("POST", "/pow/store/catalog/0/item/2?locale=en", {}, request)
        self.assertEqual(status, 200)
        self.assertIn("redeemed", json.loads(body)["message"])
        items = self.request("/pow/store/game/fifa20/catalog/0/item/list")["items"]
        self.assertTrue(items[9]["locked"])
        self.assertFalse(items[10]["locked"])
        self.module.route_fut("POST", "/pow/store/catalog/0/item/15", {}, request)
        self.assertEqual({item["itemId"] for item in self.request("/pow/inventory/item/list")["items"]}, {2, 15})

    def test_legacy_filters_are_redirected_without_changing_unrelated_players(self):
        path = "/ut/ut/game/fifa20/defid?defId=500006&excldef=554148134,213565"
        normalized = catalogue_grouping.normalize_path(path)
        self.assertIn("defId=158625", normalized)
        self.assertIn("excldef=553806753%2C213565", normalized)
        self.assertEqual(catalogue_grouping.normalize_path("/ut/game/fifa20/defid?defId=213565"), "/ut/game/fifa20/defid?defId=213565")


if __name__ == "__main__":
    unittest.main()
