import json
import os
from pathlib import Path

from test_fifa20_player_pick_flow import module
from easfc_catalog import LEVEL_PATH
import catalogue_xp


root = Path(os.environ["MNG_FUT20_ROOT"])
assert root != Path(r"C:\Users\Mineg\Downloads\MNG-FUT-V1\fifa20-server")
state = module.STATE
state.conn.execute("DELETE FROM kv WHERE key=?", (catalogue_xp.PROFILE_KEY,))
state.conn.execute("CREATE TABLE IF NOT EXISTS mng_catalogue_xp_events(event_key TEXT PRIMARY KEY, xp INTEGER NOT NULL)")
state.conn.execute("DELETE FROM mng_catalogue_xp_events")
state.conn.commit()
credits = state.credits()
report = (module._tdf_field_int("FNSH", 1)
          + module._tdf_field_group("RPRT", module._tdf_field_int("GRID", 987654321)
                                    + module._tdf_field_str("GTYP", "gametype0")))
response = module._blaze_game_report_result_payload(report)
assert module._tdf_get_int(response, "EROR") == 0
module._blaze_game_report_result_payload(report)
assert state.record_global_match("WIN", "squad_battles:987654321")
assert not state.record_global_match("WIN", "squad_battles:987654321")
for number in range(9):
    assert state.record_global_match("LOSS", f"catalogue-runtime-match-{number}")
status, _, body = module.route_fut("GET", LEVEL_PATH + "?self=true", {}, b"")
payload = json.loads(body)
assert status == 200 and (payload["level"], payload["xp"]) == (2, 1050), payload
assert payload["users"][0]["xpCapNextLevel"] == 2000
assert state.credits() == credits
status, _, _ = module.route_fut("POST", "/pow/store/catalog/0/item/102", {}, b'{"currency":"pow_funds","quantity":1}')
assert status == 200
status, _, _ = module.route_fut("POST", "/pow/store/catalog/0/item/103", {}, b'{"currency":"pow_funds","quantity":1}')
assert status == 403
print("PASS: native TDF, FUT deduplication, persistent catalogue profile, level gates and unchanged credits")
