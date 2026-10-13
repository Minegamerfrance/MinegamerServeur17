import concurrent.futures
import json
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


root = Path(os.environ["MNG_FUT20_ROOT"]).resolve()
assert root != Path(r"C:\Users\Mineg\Downloads\MNG-FUT-V1\fifa20-server").resolve()
sys.path.insert(0, str(Path(__file__).resolve().parent / "tools"))

from test_fifa20_player_pick_flow import module
import catalogue_dante
import catalogue_xp
from fifa20_fut_roster import player_records, table_rows
from fifa20_squad_names import columns, integer
from roster_update import load_update
from squad_payload import decompress, read_database


state = module.STATE
player = module.PLAYER_DB[catalogue_dante.RESOURCE_ID]
assert player["face"] == [70, 62, 75, 72, 87, 85]
assert (player["rating"], player["teamid"], player["leagueId"], player["preferredPosition"], player["rareflag"]) == (86, 21, 19, "CB", 90)
assert not player["packEligible"] and not player["marketEligible"]
assert module._player_is_excluded_from_packs(catalogue_dante.RESOURCE_ID, player)
status, _, body = module.route_fut("GET", "/pow/store/game/fifa20/catalog/0/item/list", {}, b"")
entry = next(item for item in json.loads(body)["items"] if item["itemId"] == catalogue_dante.ITEM_ID)
assert entry["level"] == 15 and entry["name"] == "Dante Moments"
assert "Dante_GFX" in entry["description"] and "2012-2013" in entry["description"]
path = "/pow/store/catalog/0/item/15"
request = b'{"currency":"pow_funds","quantity":1}'
before = state.conn.execute("SELECT COUNT(*) FROM items WHERE resource_id=?", (catalogue_dante.RESOURCE_ID,)).fetchone()[0]
status, _, _ = module.route_fut("POST", path, {}, request)
assert status == 403
with state.lock, state.conn:
    state.conn.execute("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (catalogue_xp.PROFILE_KEY, json.dumps({"level": 15, "xp": 14000, "currLevelExpMin": 14000, "currLevelExpMax": 15000})))
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    replies = list(executor.map(lambda number: module.route_fut("POST", path, {}, request), range(3)))
assert all(reply[0] == 200 for reply in replies)
assert sum(not json.loads(reply[2])["alreadyClaimed"] for reply in replies) == 1
assert state.conn.execute("SELECT COUNT(*) FROM items WHERE resource_id=?", (catalogue_dante.RESOURCE_ID,)).fetchone()[0] == before + 1
item = state.owned_player_item_by_resource_id(catalogue_dante.RESOURCE_ID)
if item is None:
    item = json.loads(state.conn.execute("SELECT data FROM items WHERE resource_id=?", (catalogue_dante.RESOURCE_ID,)).fetchone()[0])
wire = module._native_player_item(item)
assert (wire["resourceId"], wire["assetId"], wire["rating"], wire["rareflag"]) == (catalogue_dante.NATIVE_RESOURCE_ID, catalogue_dante.NATIVE_ID, 86, 90)
assert item["pile"] == "unassigned" and item["untradeable"] and item["discardValue"] == 0
status, _, body = module.route_fut("GET", "/ut/game/fifa20/usermassinfo", {}, b"")
assert status == 200 and str(catalogue_dante.NATIVE_RESOURCE_ID).encode() in body
for alias in catalogue_dante.PORTRAIT_ALIASES:
    status, _, body = module.route_fut("GET", f"/fut/playerheads/g4/single/p{alias}.dds", {}, b"")
    assert status == 200 and body == (root / f"assets/playerheads/p{catalogue_dante.RESOURCE_ID}.dds").read_bytes()
status, headers, body = module.route_fut("GET", catalogue_dante.IMAGE_PATH, {}, b"")
assert status == 200 and body.startswith(b"DDS ") and headers["Content-Type"] == "image/vnd-ms.dds"
status, _, head = module.route_fut("HEAD", catalogue_dante.IMAGE_PATH, {}, b"")
assert status == 200 and head == b""
status, _, body = module.route_fut("GET", catalogue_dante.SMALL_IMAGE_PATH, {}, b"")
assert status == 200 and body.startswith(b"DDS ")
source = read_database(decompress((root / "assets/squads/mng-identities-2052.bin").read_bytes()))
payload, report = load_update(root / "assets/squads")
assert report["version"] == 2053
tables = read_database(decompress(payload))
native = {table["shortname"]: table for table in tables}
originals = player_records(next(table for table in source if table["shortname"] == "CZUM"))
records = player_records(native["CZUM"])
assert all(records[identifier] == record for identifier, record in originals.items())
assert set(records) - set(originals) == {catalogue_dante.NATIVE_ID}
descriptors = ET.fromstring(Path(r"E:\FIFA\FIFA SERVEUR\20 fichier frosty\data\db\cards_ng_db-meta.xml").read_text(encoding="utf-8-sig")).find(".//table[@name='players']")
metadata = {field.get("name"): (field.get("shortname"), int(field.get("rangelow", 0))) for field in descriptors.findall("./fields/field")}
fields = columns(native["CZUM"])
record = records[catalogue_dante.NATIVE_ID]
expected = {"overallrating": 86, "headassetid": catalogue_dante.ASSET_ID}
expected.update({name.lower(): max(1, value) for name, value in player["attributes"].items() if name != "gkSpeed"})
for name, value in expected.items():
    shortname, minimum = metadata[name]
    assert integer(record, fields[shortname]) + minimum == value, name
link_fields = columns(native["RrqT"])
links = [row for row in table_rows(native["RrqT"]) if integer(row, link_fields["ykFq"]) == catalogue_dante.NATIVE_ID]
assert len(links) == 1 and integer(links[0], link_fields["mCXg"]) + 1 == 21
print("PASS: level 15 reward, unique unassigned delivery, Dante Moments 86 detailed attributes, Bayern link, dynamic portrait and shield endpoint; existing native players preserved")
