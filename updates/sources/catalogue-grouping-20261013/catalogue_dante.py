import copy
import json


ASSET_ID = 158625
RESOURCE_ID = ASSET_ID + 33 * 16777216
NATIVE_ID = 500006
NATIVE_RESOURCE_ID = NATIVE_ID + 33 * 16777216
PORTRAIT_ALIASES = {NATIVE_ID, NATIVE_RESOURCE_ID}
RARITY = 90
ITEM_ID = 15
ICON_TYPE_ID = 2
CLAIM_KEY = "easfc_catalog_dante_moments_86_claimed"
IMAGE_PATH = "/pow/imgAssets/store_large/storeitem_large_15.dds"
SMALL_IMAGE_PATH = "/pow/imgAssets/store_small/storeitem_small_15.dds"
REWARD = {
    "id": ITEM_ID, "itemId": ITEM_ID, "catalogId": 0,
    "name": "Dante Moments", "description": "Choisi par Dante_GFX, en l’honneur du triplé remporté avec le FC Bayern lors de la saison 2012-2013.",
    "level": 15, "requiredLevel": 15, "rewardType": "player", "awardType": "item",
    "awardValue": RESOURCE_ID, "awardCount": 1, "price": 0, "cost": 0, "userLimit": 1,
    "prices": [{"currency": "pow_funds", "price": 0}],
    "attributes": [
        {"name": "itemName", "value": "Dante Moments"},
        {"name": "itemDescription", "value": "Choisi par Dante_GFX, en l’honneur du triplé remporté avec le FC Bayern lors de la saison 2012-2013."},
        {"name": "unlockLevel", "value": "15"},
        {"name": "typeId", "value": str(ICON_TYPE_ID)},
        {"name": "catalogueType", "value": "1"},
        {"name": "subCatalogueType", "value": "1"},
        {"name": "isConsumable", "value": "1"},
        {"name": "ungiftable", "value": "1"},
        {"name": "AssetUrl", "value": IMAGE_PATH.lstrip("/")},
    ],
}


def install_player(module):
    if RESOURCE_ID in module.PLAYER_DB:
        raise ValueError("Catalogue Dante resource collision")
    player = copy.deepcopy(module.PLAYER_DB[ASSET_ID])
    player["attributes"].update(
        acceleration=68, sprintSpeed=72, positioning=50, finishing=55, shotPower=85,
        longShots=60, volleys=60, penalties=60, vision=75, crossing=64, freeKickAccuracy=55,
        shortPassing=82, longPassing=85, curve=60, agility=58, balance=62, reactions=82,
        ballControl=78, dribbling=71, composure=84, interceptions=86, headingAccuracy=88,
        marking=87, standingTackle=89, slidingTackle=85, jumping=82, stamina=76,
        strength=90, aggression=85)
    player.pop("wefutCard", None)
    player.pop("nativeDatabase", None)
    player.update(resourceId=RESOURCE_ID, rating=86, face=[70, 62, 75, 72, 87, 85],
                  preferredPosition="CB", teamid=21, teamName="FC Bayern München",
                  leagueId=19, leagueName="Germany 1. Bundesliga", rareflag=RARITY,
                  rarityName="Player Moments", rarityClass="player_moments", cardsubtypeid=0,
                  tier="gold", special=True, untradeable=True, packEligible=False,
                  marketEligible=False, rewardEligible=True, obtainable=True,
                  availability="easfc_catalogue", baseResourceId=ASSET_ID, dynamicPortrait=True)
    module.PLAYER_DB[RESOURCE_ID] = player
    if hasattr(module, "_native_player_asset_id"):
        if NATIVE_RESOURCE_ID in module.PLAYER_DB or any(alias in module.PLAYER_RESOURCE_ALIASES for alias in PORTRAIT_ALIASES):
            raise ValueError("Catalogue Dante native resource collision")
        original_asset = module._native_player_asset_id

        def native_asset(meta, fallback):
            if int(meta.get("resourceId", fallback)) == RESOURCE_ID:
                return ASSET_ID
            return original_asset(meta, fallback)

        module._native_player_asset_id = native_asset
        module.PLAYER_RESOURCE_ALIASES.update({alias: RESOURCE_ID for alias in PORTRAIT_ALIASES})
        original_item = module._native_player_item
        original_pack_item = module._native_pack_item

        def native_identity(item, result):
            if module.canonical_player_resource_id(int(item.get("resourceId", 0))) == RESOURCE_ID:
                result.update(resourceId=RESOURCE_ID, assetId=ASSET_ID, rating=86,
                              rareflag=RARITY, attributeList=module.player_attribute_list(RESOURCE_ID))
            return result

        def native_item(item):
            return native_identity(item, original_item(item))

        def native_pack_item(item):
            return native_identity(item, original_pack_item(item))

        module._native_player_item = native_item
        module._native_pack_item = native_pack_item


def claim(state):
    with state.lock:
        connection = state.conn
        connection.execute("BEGIN IMMEDIATE")
        try:
            if connection.execute("SELECT value FROM kv WHERE key=?", (CLAIM_KEY,)).fetchone():
                connection.commit()
                return {"success": True, "alreadyClaimed": True, "message": "Récompense déjà récupérée."}
            counter = connection.execute("SELECT value FROM kv WHERE key='next_item_id'").fetchone()
            maximum = connection.execute("SELECT COALESCE(MAX(id),0) FROM items").fetchone()[0]
            item_id = max(int(json.loads(counter[0])) if counter else 900000000000, maximum) + 1
            item = state.build_player_item(RESOURCE_ID, item_id, "unassigned")
            item.update(untradeable=True, discardValue=0)
            owned = connection.execute("SELECT id FROM items WHERE resource_id=? AND pile IN ('club','squad') LIMIT 1", (RESOURCE_ID,)).fetchone()
            if owned:
                item["duplicateId"] = int(owned[0])
            connection.execute("INSERT INTO items(id,resource_id,pile,data) VALUES(?,?,?,?)",
                               (item_id, RESOURCE_ID, "unassigned", json.dumps(item)))
            connection.execute("INSERT INTO kv(key,value) VALUES('next_item_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                               (json.dumps(item_id),))
            connection.execute("INSERT INTO kv(key,value) VALUES(?,?)", (CLAIM_KEY, json.dumps(item_id)))
            connection.commit()
            return {"success": True, "alreadyClaimed": False, "itemData": [item],
                    "message": "Dante Moments 86 récupéré. Retrouvez-le dans les éléments non attribués de FUT."}
        except Exception:
            connection.rollback()
            raise
