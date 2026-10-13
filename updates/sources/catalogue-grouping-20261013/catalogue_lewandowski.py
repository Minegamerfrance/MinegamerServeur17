import copy
import json

ASSET_ID = 188545
RESOURCE_ID = ASSET_ID + 32 * 16777216
NATIVE_ID = 500005
NATIVE_RESOURCE_ID = NATIVE_ID + 32 * 16777216
PORTRAIT_ALIASES = {NATIVE_ID, NATIVE_RESOURCE_ID}
RARITY = 51
ITEM_ID = 2
CLAIM_KEY = "easfc_catalog_lewandowski_flashback_85_claimed"
IMAGE_PATH = "/pow/imgAssets/mng/lewandowski-flashback.png"
REWARD = {
    "id": ITEM_ID, "itemId": ITEM_ID, "catalogId": 0,
    "name": "Lewandowski Flashback 85", "description": "Récompense du niveau 10",
    "level": 10, "requiredLevel": 10, "rewardType": "player", "awardType": "item",
    "awardValue": RESOURCE_ID, "awardCount": 1, "price": 0, "cost": 0, "userLimit": 1,
    "prices": [{"currency": "pow_funds", "price": 0}],
    "attributes": [
        {"name": "itemName", "value": "Lewandowski Flashback 85"},
        {"name": "itemDescription", "value": "Recevez Robert Lewandowski Flashback 85 dans les éléments non attribués de FUT. Non échangeable, récupérable une seule fois."},
        {"name": "unlockLevel", "value": "10"},
        {"name": "typeId", "value": str(ITEM_ID)},
        {"name": "catalogueType", "value": "1"},
        {"name": "subCatalogueType", "value": "1"},
        {"name": "isConsumable", "value": "1"},
        {"name": "ungiftable", "value": "1"},
        {"name": "AssetUrl", "value": IMAGE_PATH.lstrip("/")},
    ],
}


def install_player(module):
    existing = module.PLAYER_DB.get(RESOURCE_ID)
    if existing and (existing.get("assetId") != ASSET_ID or existing.get("availability") != "easfc_catalogue"):
        raise ValueError("Catalogue Lewandowski resource collision")
    player = copy.deepcopy(module.PLAYER_DB[ASSET_ID])
    face = [82, 85, 72, 84, 54, 81]
    player["attributes"].update(
        acceleration=82, sprintSpeed=82, positioning=87, finishing=87, shotPower=86,
        longShots=81, volleys=82, penalties=79, vision=74, crossing=61, freeKickAccuracy=70,
        shortPassing=82, longPassing=62, curve=72, agility=78, balance=80, reactions=85,
        ballControl=86, dribbling=85, composure=82, interceptions=50, headingAccuracy=72,
        marking=48, standingTackle=58, slidingTackle=47, jumping=82, stamina=79,
        strength=83, aggression=78)
    player.pop("wefutCard", None)
    player.update(resourceId=RESOURCE_ID, rating=85, face=face, preferredPosition="ST",
                  rareflag=RARITY, rarityName="Flashback", rarityClass="flashback", cardsubtypeid=0,
                  tier="gold", special=True, untradeable=True, packEligible=False,
                  marketEligible=False, rewardEligible=True, obtainable=True,
                  availability="easfc_catalogue", baseResourceId=ASSET_ID, dynamicPortrait=True,
                  weakFoot=4, skillMoves=3)
    module.PLAYER_DB[RESOURCE_ID] = player
    if hasattr(module, "_native_player_asset_id") and not getattr(module, "_mng_catalogue_lewandowski_identity", False):
        original_asset = module._native_player_asset_id

        def native_asset(meta, fallback):
            if int(meta.get("resourceId", fallback)) == RESOURCE_ID:
                return ASSET_ID
            return original_asset(meta, fallback)

        module._native_player_asset_id = native_asset
        if NATIVE_RESOURCE_ID in module.PLAYER_DB:
            raise ValueError("Catalogue Lewandowski native resource collision")
        module.PLAYER_RESOURCE_ALIASES.update({alias: RESOURCE_ID for alias in PORTRAIT_ALIASES})
        original_item = module._native_player_item
        original_pack_item = module._native_pack_item

        def native_identity(item, result):
            if module.canonical_player_resource_id(int(item.get("resourceId", 0))) == RESOURCE_ID:
                result.update(resourceId=RESOURCE_ID, assetId=ASSET_ID, rating=85,
                              rareflag=RARITY, weakFoot=4, skillMoves=3,
                              attributeList=module.player_attribute_list(RESOURCE_ID))
            return result

        def native_item(item):
            return native_identity(item, original_item(item))

        def native_pack_item(item):
            return native_identity(item, original_pack_item(item))

        module._native_player_item = native_item
        module._native_pack_item = native_pack_item
        module._mng_catalogue_lewandowski_identity = True
    if hasattr(module, "STATE"):
        refresh_owned_items(module.STATE)


def refresh_owned_items(state):
    with state.lock:
        connection = state.conn
        connection.execute("BEGIN IMMEDIATE")
        try:
            rows = connection.execute("SELECT id,data FROM items WHERE resource_id=?", (RESOURCE_ID,)).fetchall()
            for item_id, data in rows:
                item = json.loads(data)
                reference = state.build_player_item(RESOURCE_ID, item_id, item.get("pile", "club"))
                for field in ("assetId", "rating", "rareflag", "rare_flag", "attributeList", "weakFoot", "skillMoves"):
                    if field in reference:
                        item[field] = reference[field]
                item.update(untradeable=True, discardValue=0)
                if item != json.loads(data):
                    connection.execute("UPDATE items SET data=? WHERE id=?", (json.dumps(item), item_id))
            connection.commit()
        except Exception:
            connection.rollback()
            raise


def claim(state):
    with state.lock:
        connection = state.conn
        connection.execute("BEGIN IMMEDIATE")
        try:
            prior = connection.execute("SELECT value FROM kv WHERE key=?", (CLAIM_KEY,)).fetchone()
            if prior:
                connection.commit()
                return {"success": True, "alreadyClaimed": True, "message": "Récompense déjà récupérée."}
            counter = connection.execute("SELECT value FROM kv WHERE key='next_item_id'").fetchone()
            maximum = connection.execute("SELECT COALESCE(MAX(id),0) FROM items").fetchone()[0]
            item_id = max(int(json.loads(counter[0])) if counter else 900000000000, maximum) + 1
            item = state.build_player_item(RESOURCE_ID, item_id, "unassigned")
            item.update(untradeable=True, discardValue=0)
            connection.execute("INSERT INTO items(id,resource_id,pile,data) VALUES(?,?,?,?)",
                               (item_id, RESOURCE_ID, "unassigned", json.dumps(item)))
            connection.execute("INSERT INTO kv(key,value) VALUES('next_item_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                               (json.dumps(item_id),))
            connection.execute("INSERT INTO kv(key,value) VALUES(?,?)", (CLAIM_KEY, json.dumps(item_id)))
            connection.commit()
            return {"success": True, "alreadyClaimed": False, "itemData": [item],
                    "message": "Lewandowski Flashback 85 récupéré. Retrouvez-le dans les éléments non attribués de FUT."}
        except Exception:
            connection.rollback()
            raise
