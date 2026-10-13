import json
import os
import sys
from pathlib import Path


root = Path(os.environ["MNG_FUT20_ROOT"]).resolve()
assert root != Path(r"C:\Users\Mineg\Downloads\MNG-FUT-V1\fifa20-server").resolve()
sys.path.insert(0, str(Path(__file__).resolve().parent / "tools"))
from test_fifa20_player_pick_flow import module
import catalogue_dante
import catalogue_lewandowski
from fifa20_fut_roster import player_records
from squad_payload import decompress, read_database


for card in (catalogue_dante, catalogue_lewandowski):
    item = module.STATE.build_player_item(card.RESOURCE_ID, 999999999, "club")
    wire = module._native_player_item(item)
    assert wire["resourceId"] == card.RESOURCE_ID and wire["assetId"] == card.ASSET_ID
    assert wire["rating"] == (86 if card is catalogue_dante else 85)
    responses = []
    for definition in (card.ASSET_ID, card.NATIVE_ID):
        status, _, body = module.route_fut("GET", f"/ut/game/fifa20/defid?type=player&count=100&defId={definition}&level=any", {}, b"")
        assert status == 200
        responses.append(json.loads(body))
    assert responses[0] == responses[1], responses
    assert str(card.RESOURCE_ID) in json.dumps(responses[0]), responses[0]
before = read_database(decompress((root / "assets/squads/mng-identities-2053.bin").read_bytes()))
after = read_database(decompress((root / "assets/squads/mng-identities-2054.bin").read_bytes()))
old = player_records(next(table for table in before if table["shortname"] == "CZUM"))
new = player_records(next(table for table in after if table["shortname"] == "CZUM"))
assert set(old) - set(new) == {500005, 500006}
assert all(old[identifier] == record for identifier, record in new.items())
assert new[158625] == old[158625] and new[188545] == old[188545]
print("PASS: original player grouping, base and special variants searchable, legacy filters accepted, no new players and existing player records preserved")
