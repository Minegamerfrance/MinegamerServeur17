import json
import os
from pathlib import Path


root = Path(os.environ["MNG_FUT20_ROOT"]).resolve()
assert root != Path(r"C:\Users\Mineg\Downloads\MNG-FUT-V1\fifa20-server").resolve()

from test_fifa20_player_pick_flow import module
import catalogue_xp
from easfc_catalog import LEVEL_PATH


state = module.STATE
legacy_path = Path(module.RUNTIME_ROOT) / "data/easfc-profile.json"
before = catalogue_xp.profile(state, legacy_path)["xp"]
challenge = module.SET_BY_ID[30]["challenges"][0]
challenge_id = challenge["challenge_id"]
path = f"/ut/ut/game/fifa20/sbs/challenge/{challenge_id}/submit"
resources = [int(resource) for resource, player in module.PLAYER_DB.items()
             if 40 <= int(player.get("rating", 0)) <= 64 and not player.get("special")][:11]
assert len(resources) == 11
state.save_sbc_squad(challenge_id, {"players": []}, 11)
status, _, body = module.route_fut("POST", path, {}, b"{}")
assert status != 200 or not json.loads(body).get("challengeComplete")
assert catalogue_xp.profile(state, legacy_path)["xp"] == before
for repetition in range(1, 3):
    items = [state.make_player_item(resource) for resource in resources]
    saved = {"rating": 60, "chemistry": 100,
             "players": [{"id": item["id"], "index": slot} for slot, item in enumerate(items)]}
    valid, checks, item_ids = module._sbc_evaluate(challenge, saved)
    assert valid, checks
    state.save_sbc_squad(challenge_id, saved, 11)
    status, _, body = module.route_fut("POST", path, {}, b"{}")
    result = json.loads(body)
    assert status == 200 and result["challengeComplete"], result
    assert all(state.get_item(identifier) is None for identifier in item_ids)
    assert catalogue_xp.profile(state, legacy_path)["xp"] == before + 5 * repetition, result
    module.route_fut("POST", path, {}, b"{}")
    assert catalogue_xp.profile(state, legacy_path)["xp"] == before + 5 * repetition
status, _, body = module.route_fut("GET", LEVEL_PATH, {}, b"")
assert status == 200 and json.loads(body)["xp"] == before + 10
print("PASS: real repeatable bronze SBC grants 5 catalogue XP per completion, consumes squads, ignores failed retries and exposes persistent XP")
