import json
import re
from pathlib import Path


PROFILE_KEY = "easfc_catalog_profile"
MATCH_XP = 100
WIN_XP = 50
LEVEL_XP = 1000


def profile(state, legacy_path):
    from easfc_catalog import read_profile

    with state.lock:
        saved = state.conn.execute("SELECT value FROM kv WHERE key=?", (PROFILE_KEY,)).fetchone()
        if saved:
            return json.loads(saved[0])
        return read_profile(legacy_path)


def event_identity(event_key):
    key = str(event_key or "").strip()
    if not key:
        return None
    if re.fullmatch(r"[^:]+:[1-9][0-9]*", key):
        return "report:" + key.rsplit(":", 1)[1]
    return key


def award(state, legacy_path, event_key, result=None):
    key = event_identity(event_key)
    if key is None:
        return 0
    amount = MATCH_XP + (WIN_XP if result == "WIN" else 0)
    with state.lock:
        connection = state.conn
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute("CREATE TABLE IF NOT EXISTS mng_catalogue_xp_events (event_key TEXT PRIMARY KEY, xp INTEGER NOT NULL)")
            previous = connection.execute("SELECT xp FROM mng_catalogue_xp_events WHERE event_key=?", (key,)).fetchone()
            delta = max(0, amount - (previous[0] if previous else 0))
            if delta:
                current = profile(state, legacy_path)
                current["xp"] = max(current["xp"], (current["level"] - 1) * LEVEL_XP) + delta
                current["level"] = current["xp"] // LEVEL_XP + 1
                current["currLevelExpMin"] = (current["level"] - 1) * LEVEL_XP
                current["currLevelExpMax"] = current["level"] * LEVEL_XP
                connection.execute("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                                   (PROFILE_KEY, json.dumps(current)))
                connection.execute("INSERT INTO mng_catalogue_xp_events(event_key,xp) VALUES(?,?) ON CONFLICT(event_key) DO UPDATE SET xp=excluded.xp",
                                   (key, amount))
            connection.commit()
            return delta
        except Exception:
            connection.rollback()
            raise


def install(module):
    if getattr(module, "_mng_catalogue_xp_installed", False):
        return
    legacy_path = Path(module.RUNTIME_ROOT) / "data/easfc-profile.json"
    original_record = module.State.record_global_match

    def record_match(state, result, event_key=None):
        recorded = original_record(state, result, event_key)
        if recorded and str(result).upper() in {"WIN", "LOSS", "DRAW"}:
            try:
                gained = award(state, legacy_path, event_key, str(result).upper())
                module.log.info("EASFC catalogue XP awarded=%d source=FUT", gained)
            except Exception:
                module.log.exception("EASFC XP failed; match result preserved")
        return recorded

    module.State.record_global_match = record_match
    if hasattr(module, "_blaze_game_report_result_payload"):
        original_report = module._blaze_game_report_result_payload

        def report(request):
            response = original_report(request)
            try:
                if len(request) > 2 * 1024 * 1024:
                    return response
                identifier = module._tdf_get_int(request, "GRID")
                finished = module._tdf_get_int(request, "FNSH")
                game_type = module._tdf_get_string(request, "GTYP")
                if identifier and identifier > 0 and finished == 1 and game_type:
                    gained = award(module.STATE, legacy_path, f"report:{identifier}")
                    module.log.info("EASFC catalogue XP awarded=%d source=Blaze type=%s", gained, game_type[:80])
                else:
                    module.log.info("EASFC catalogue report ignored: finished=%s typePresent=%s idPresent=%s",
                                    finished, bool(game_type), bool(identifier))
            except Exception:
                module.log.exception("EASFC XP report failed; native response preserved")
            return response

        module._blaze_game_report_result_payload = report
    module._mng_catalogue_xp_installed = True
