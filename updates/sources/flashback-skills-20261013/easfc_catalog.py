import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import catalogue_lewandowski
import catalogue_progression
import catalogue_xp
import catalogue_dante
import catalogue_localization
import catalogue_grouping


CATALOG_PATH = "/pow/store/game/fifa20/catalog/list"
LEVEL_PATH = "/pow/lvl/user/tiergp/businessunit/tiertp/fifa"
WEIGHT_PATH = "/pow/lvl/weight/tiergp/businessunit/tiertp/fifa"
ITEM_LIST = re.compile(r"^/pow/store/game/fifa20/catalog/(\d+)/item/list$")
REWARD_CLAIM = re.compile(r"^/pow/store/game/fifa20/catalog/(\d+)/item/(\d+)(?:/(?:claim|purchase|redeem))?$")
NATIVE_REWARD_CLAIM = re.compile(r"^/pow/store/catalog/(\d+)/item/(\d+)$")
CATALOG_ID = 0
CATALOG_NAME = "EASFC Store FIFA20 PC"
FUT_COIN_REWARD_ID = 1
FUT_COIN_REWARD = {
    "id": FUT_COIN_REWARD_ID,
    "itemId": FUT_COIN_REWARD_ID,
    "catalogId": CATALOG_ID,
    "name": "500 crédits FUT",
    "description": "Récompense du niveau 1",
    "level": 1,
    "requiredLevel": 1,
    "rewardType": "coin",
    "awardType": "coin",
    "awardValue": 500,
    "awardCount": 1,
    "currency": "FUT",
    "price": 0,
    "cost": 0,
    "userLimit": 1,
    "prices": [{"currency": "pow_funds", "price": 0}],
    "attributes": [
        {"name": "itemName", "value": "500 crédits FUT"},
        {"name": "itemDescription", "value": "Recevez 500 crédits Ultimate Team. Récompense du niveau 1, récupérable une seule fois."},
        {"name": "unlockLevel", "value": "1"},
        {"name": "typeId", "value": str(FUT_COIN_REWARD_ID)},
        {"name": "catalogueType", "value": "1"},
        {"name": "subCatalogueType", "value": "1"},
        {"name": "isConsumable", "value": "1"},
        {"name": "ungiftable", "value": "1"},
        {"name": "AssetUrl", "value": "pow/imgAssets/logos/EASFC_Logo.dds"},
    ],
}
CLAIM_KEY = "easfc_catalog_level_1_500_fut_credits_claimed"


def read_profile(path):
    profile = {"level": 1, "xp": 0, "currLevelExpMin": 0, "currLevelExpMax": 1000}
    if path.exists():
        saved = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(saved, dict):
            raise ValueError("Invalid EAS FC profile document")
        for field in profile:
            value = saved.get(field, profile[field])
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"Invalid EAS FC profile field: {field}")
            profile[field] = value
        if profile["level"] < 1 or profile["currLevelExpMax"] <= profile["currLevelExpMin"]:
            raise ValueError("Invalid EAS FC level range")
    return profile


def install(module):
    if getattr(module, "_mng_easfc_catalog_installed", False):
        return
    original_route = module.route_fut
    profile_path = Path(module.RUNTIME_ROOT) / "data" / "easfc-profile.json"
    auth_language = "fr"
    if hasattr(module, "PLAYER_DB"):
        from catalogue_client_fix import install as install_catalogue_client_fix
        try:
            status = install_catalogue_client_fix(module.RUNTIME_ROOT)
            module.log.info("Catalogue client visibility fix: %s", status)
        except (OSError, ValueError, RuntimeError, KeyError) as error:
            module.log.warning("Catalogue client visibility fix retained original library: %s", error)
        from flashback_skill_fix import install as install_flashback_skill_fix
        try:
            status = install_flashback_skill_fix(module.RUNTIME_ROOT)
            module.log.info("Lewandowski Flashback skills fix: %s", status)
        except (OSError, ValueError, RuntimeError, KeyError) as error:
            module.log.warning("Flashback skills fix retained original library: %s", error)
        catalogue_lewandowski.install_player(module)
        catalogue_dante.install_player(module)
        import release_tuning
        release_tuning.UNAVAILABLE_MARKET_PACK_IDS = release_tuning.UNAVAILABLE_MARKET_PACK_IDS | {catalogue_lewandowski.RESOURCE_ID}
        release_tuning.UNAVAILABLE_MARKET_PACK_IDS = release_tuning.UNAVAILABLE_MARKET_PACK_IDS | {catalogue_dante.RESOURCE_ID}
    rewards = {FUT_COIN_REWARD_ID: FUT_COIN_REWARD, catalogue_lewandowski.ITEM_ID: catalogue_lewandowski.REWARD,
               catalogue_dante.ITEM_ID: catalogue_dante.REWARD, **catalogue_progression.REWARDS}

    def reply(payload, status=200):
        return status, {"Content-Type": "application/json", "Cache-Control": "no-store"}, module.json_bytes(payload)

    def reward_claimed(item_id=FUT_COIN_REWARD_ID):
        key = (catalogue_dante.CLAIM_KEY if item_id == catalogue_dante.ITEM_ID else
               CLAIM_KEY if item_id == FUT_COIN_REWARD_ID else catalogue_lewandowski.CLAIM_KEY
               if item_id == catalogue_lewandowski.ITEM_ID else catalogue_progression.claim_key(item_id))
        with module.STATE.lock:
            return module.STATE.conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone() is not None

    def paged_items(items, raw_path):
        query = parse_qs(urlsplit(raw_path).query, keep_blank_values=True)
        try:
            offset = int(query.get("offset", ["0"])[0])
            count = int(query.get("count", ["49"])[0])
        except ValueError:
            return reply({"error": "INVALID_PAGINATION"}, 400)
        if offset < 0 or count < 1 or count > 1000:
            return reply({"error": "INVALID_PAGINATION"}, 400)
        page = items[offset:offset + count]
        return reply({"items": page, "totalCount": len(items), "endOfList": offset + count >= len(items)})

    def claim_level_one_reward():
        state = module.STATE
        with state.lock:
            connection = state.conn
            connection.execute("BEGIN IMMEDIATE")
            try:
                claimed = connection.execute("SELECT value FROM kv WHERE key=?", (CLAIM_KEY,)).fetchone()
                credits_row = connection.execute("SELECT value FROM kv WHERE key='credits'").fetchone()
                try:
                    credits = int(json.loads(credits_row[0])) if credits_row else 0
                except (TypeError, ValueError, json.JSONDecodeError):
                    credits = int(credits_row[0]) if credits_row else 0
                if claimed:
                    connection.commit()
                    return {"success": True, "alreadyClaimed": True, "credits": credits,
                            "totalCredits": credits, "coins": credits}
                connection.execute(
                    "INSERT INTO kv(key,value) VALUES('credits',?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (json.dumps(credits + FUT_COIN_REWARD["awardValue"]),),
                )
                connection.execute("INSERT INTO kv(key,value) VALUES(?,?)", (CLAIM_KEY, "1"))
                connection.commit()
                credits += FUT_COIN_REWARD["awardValue"]
                return {"success": True, "alreadyClaimed": False,
                        "awardedPrizes": [dict(FUT_COIN_REWARD)], "credits": credits,
                        "totalCredits": credits, "coins": credits}
            except Exception:
                connection.rollback()
                raise

    def route(method, raw_path, headers, body):
        nonlocal auth_language
        raw_path = catalogue_grouping.normalize_path(raw_path)
        normalized = raw_path[1:] if raw_path.startswith("//pow/") else raw_path
        path = urlsplit(normalized).path
        if path == "/pow/auth" and method == "POST":
            response = original_route(method, raw_path, headers, body)
            if response[0] == 200:
                try:
                    authentication = json.loads(body)
                    if isinstance(authentication, dict):
                        auth_language = catalogue_localization.language(authentication.get("locale"), auth_language)
                except (ValueError, UnicodeDecodeError):
                    pass
            return response
        locale = catalogue_localization.request_language(headers, normalized, auth_language)
        portrait = re.fullmatch(r"/fut/playerheads/g4/single/p(\d+)\.dds", path)
        if portrait and int(portrait.group(1)) in catalogue_dante.PORTRAIT_ALIASES:
            return original_route(method, f"/fut/playerheads/g4/single/p{catalogue_dante.RESOURCE_ID}.dds", headers, body)
        if portrait and int(portrait.group(1)) in catalogue_lewandowski.PORTRAIT_ALIASES:
            return original_route(method, f"/fut/playerheads/g4/single/p{catalogue_lewandowski.RESOURCE_ID}.dds", headers, body)
        if path in {catalogue_lewandowski.IMAGE_PATH, catalogue_dante.IMAGE_PATH, catalogue_dante.SMALL_IMAGE_PATH} and method in {"GET", "HEAD"}:
            filename = ("dante-moments.dds" if path == catalogue_dante.IMAGE_PATH else
                        "dante-moments-small.dds" if path == catalogue_dante.SMALL_IMAGE_PATH else
                        "lewandowski-flashback.png")
            image_path = Path(__file__).parent / "assets/easfc" / filename
            if not image_path.is_file():
                return reply({"error": "CATALOG_IMAGE_NOT_FOUND"}, 404)
            image = image_path.read_bytes()
            module.log.info("EASFC catalogue image served path=%s bytes=%d", path, len(image))
            return 200, {"Content-Type": "image/vnd-ms.dds" if image_path.suffix == ".dds" else "image/png", "Cache-Control": "no-cache"}, image if method == "GET" else b""
        if not path.startswith("/pow/"):
            return original_route(method, raw_path, headers, body)
        payload = None
        if method == "GET" and path == CATALOG_PATH:
            catalogs = [{"id": CATALOG_ID, "catalogId": CATALOG_ID, "name": CATALOG_NAME}]
            payload = {"catalogList": catalogs, "catalogs": catalogs, "totalCount": 1}
        elif method == "GET" and (match := ITEM_LIST.fullmatch(path)):
            items = [dict(catalogue_localization.reward(reward, locale), locked=reward_claimed(item_id))
                     for item_id, reward in sorted(rewards.items(), key=lambda entry: entry[1]["level"])] if int(match.group(1)) == CATALOG_ID else []
            return paged_items(items, raw_path)
        elif method in {"POST", "PUT"} and (match := REWARD_CLAIM.fullmatch(path) or NATIVE_REWARD_CLAIM.fullmatch(path)):
            item_id = int(match.group(2))
            if int(match.group(1)) != CATALOG_ID or item_id not in rewards:
                return reply({"success": False, "error": "CATALOG_ITEM_NOT_FOUND"}, 404)
            native_purchase = NATIVE_REWARD_CLAIM.fullmatch(path) is not None
            if native_purchase:
                try:
                    purchase = json.loads(body)
                except (ValueError, UnicodeDecodeError):
                    return reply({"success": False, "error": "INVALID_PURCHASE"}, 400)
                if (not isinstance(purchase, dict) or purchase.get("currency") != "pow_funds"
                        or type(purchase.get("quantity")) is not int or purchase["quantity"] != 1):
                    return reply({"success": False, "error": "INVALID_PURCHASE"}, 400)
            try:
                profile = catalogue_xp.profile(module.STATE, profile_path)
            except (ValueError, OSError):
                module.log.error("EASFC profile rejected; saved data was not changed")
                return reply({"error": "EASFC_PROFILE_INVALID"}, 503)
            if profile["level"] < rewards[item_id]["requiredLevel"] and not reward_claimed(item_id):
                return reply({"success": False, "error": "LEVEL_REQUIREMENT_NOT_MET"}, 403)
            if item_id == FUT_COIN_REWARD_ID:
                result = claim_level_one_reward()
            elif item_id == catalogue_lewandowski.ITEM_ID:
                result = catalogue_lewandowski.claim(module.STATE)
            elif item_id == catalogue_dante.ITEM_ID:
                result = catalogue_dante.claim(module.STATE)
            else:
                result = catalogue_progression.claim(module.STATE, item_id)
            if native_purchase:
                result.update(priceTotal=0, accountBalance=0, reason="purchase_successful")
                if item_id == FUT_COIN_REWARD_ID:
                    result["message"] = "Récompense déjà récupérée." if result["alreadyClaimed"] else "500 crédits FUT récupérés."
            if item_id in {catalogue_lewandowski.ITEM_ID, catalogue_dante.ITEM_ID}:
                result["message"] = catalogue_localization.claim_message(rewards[item_id], result, locale)
            module.log.info("EASFC catalogue reward item=%d alreadyClaimed=%s delivery=%s",
                            item_id, result["alreadyClaimed"],
                            "credits" if item_id == FUT_COIN_REWARD_ID else "unassigned")
            return reply(result)
        elif method == "GET" and path in {"/pow/store/gift/list", "/pow/inventory/item/list"}:
            if path == "/pow/inventory/item/list":
                items = [{"itemId": reward["itemId"], "quantity": 1,
                          "attributes": catalogue_localization.reward(reward, locale)["attributes"] + [{"name": "useCount", "value": "1"}]}
                         for reward in rewards.values()
                         if reward_claimed(reward["itemId"])]
                return paged_items(items, raw_path)
            payload = {"itemList": [], "items": [], "totalCount": 0, "endOfList": True}
            if path == "/pow/store/gift/list":
                payload["giftList"] = []
        elif method == "GET" and path in {LEVEL_PATH, WEIGHT_PATH}:
            try:
                profile = catalogue_xp.profile(module.STATE, profile_path)
            except (ValueError, OSError):
                module.log.error("EASFC profile rejected; saved data was not changed")
                return reply({"error": "EASFC_PROFILE_INVALID"}, 503)
            if path == LEVEL_PATH:
                payload = dict(profile, user=dict(profile), tier=profile["level"], isMaxLevel=False)
                configuration = getattr(module, "CFG", {})
                nucleus_id = configuration.get("nucleus_id")
                if type(nucleus_id) is int and nucleus_id >= 0:
                    payload["users"] = [{
                        "nucId": nucleus_id, "level": profile["level"], "xp": profile["xp"],
                        "xpCapCurrLevel": profile["currLevelExpMin"],
                        "xpCapNextLevel": profile["currLevelExpMax"],
                    }]
                    if nucleus_id != 0:
                        payload["users"].append(dict(payload["users"][0], nucId=0))
            else:
                tier = {"level": profile["level"], "minXp": profile["currLevelExpMin"],
                        "maxXp": profile["currLevelExpMax"] - 1, "weight": 1}
                payload = {
                    "weightList": [tier], "tierList": [tier], "totalCount": 1,
                    "tierweights": [{"tiergroup": "businessunit", "tiername": "fifa",
                                     "weights": [{"gametitle": "fifa20", "weight": 1}]}],
                }
        if payload is None:
            return original_route(method, raw_path, headers, body)
        module.log.info("EASFC catalogue bootstrap method=%s path=%s items=%s clientValidation=pending",
                        method, path, payload.get("totalCount", "profile"))
        return reply(payload)

    module.route_fut = route
    if hasattr(module, "PLAYER_DB"):
        catalogue_progression.install(module)
        catalogue_xp.install(module)
    if hasattr(module, "user_mass_info"):
        from unassigned_entry import install as install_unassigned_entry
        install_unassigned_entry(module)
    from catalogue_diagnostics import install as install_catalogue_diagnostics
    install_catalogue_diagnostics(module)
    module._mng_easfc_catalog_installed = True
    module.log.warning("EASFC catalogue installed: level 1 reward enabled (500 FUT credits)")
