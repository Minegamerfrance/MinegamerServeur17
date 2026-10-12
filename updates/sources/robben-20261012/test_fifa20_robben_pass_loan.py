import json
import os
from pathlib import Path


root = Path(os.environ["MNG_FUT20_ROOT"]).resolve()
if ".test-temp" not in root.parts:
    raise RuntimeError("Run this integration test against an isolated .test-temp server")

from test_fifa20_player_pick_flow import module
from season_pass import LOAN_REWARDS, PLAYER_REWARDS, STATE_KEY, SeasonPass


resource = 16786230
state = module.STATE
season = SeasonPass(module)
assert PLAYER_REWARDS[22] == resource and LOAN_REWARDS[22] == 10
assert module.PLAYER_DB[resource]["rating"] == 86
campaign = season.campaign()
reward = campaign["levels"][21]["rewardOptionList"][0]["awards"][0]
preview = reward["itemData"]
expected = state.build_player_item(resource, 0, "unassigned", 10)
assert reward["awardType"] == "item" and reward["loan"] == 10
assert preview["resourceId"] == resource and preview["rating"] == 86
assert preview["rareflag"] == 12 and preview["assetId"] == 9014
assert preview["loans"] == expected["loans"]
assert preview["untradeable"] and preview["discardValue"] == 0

saved = json.loads(state.conn.execute("SELECT value FROM kv WHERE key=?", (STATE_KEY,)).fetchone()[0])
saved.update(xp=22000, rewardRevision=3, claimedLevels=[1, 8, 18, 22, 38])
state.conn.execute("UPDATE kv SET value=? WHERE key=?", (json.dumps(saved), STATE_KEY))
state.conn.commit()
campaign = season.campaign()
assert not campaign["levels"][21]["isClaimed"]
assert all(campaign["levels"][level - 1]["isClaimed"] for level in (1, 8, 18, 38))
packs_before = state.conn.execute("SELECT COUNT(*) FROM unopened_packs").fetchone()[0]
items_before = state.conn.execute("SELECT COUNT(*) FROM items WHERE resource_id=?", (resource,)).fetchone()[0]
claimed = season.claim_level(22)
assert not claimed["alreadyClaimed"]
item = claimed["itemData"][0]
assert item["resourceId"] == resource and item["rating"] == 86
assert item["pile"] == "unassigned" and item["untradeable"]
assert item["loans"] == expected["loans"]
assert claimed["awardedPrizes"][0]["loan"] == 10
assert state.conn.execute("SELECT COUNT(*) FROM unopened_packs").fetchone()[0] == packs_before
assert state.conn.execute("SELECT COUNT(*) FROM items WHERE resource_id=?", (resource,)).fetchone()[0] == items_before + 1
assert season.claim_level(22)["alreadyClaimed"]
assert SeasonPass(module).claim_level(22)["alreadyClaimed"]
print("Robben level 22 verified: Icon 86, native model ID 9014, 10-match loan, unassigned delivery, migration and retry protection")
