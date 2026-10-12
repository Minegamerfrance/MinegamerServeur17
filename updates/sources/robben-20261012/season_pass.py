from __future__ import annotations

import copy
import hashlib
import json
import re
import time
import urllib.parse
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any
from otw_objectives import OBJECTIVES as OTW_OBJECTIVES, group as otw_group, claim_group as claim_otw_group, install_report_capture, match_context, win_increments
from otw_rewards import SIDE_REWARDS, build_item as build_otw_reward_item, grant as grant_otw_reward, install as install_otw_rewards
from season_pass_custom_packs import ICON_MAX_85_PACK_ID, install as install_season_pass_custom_packs
from foundation_objectives import CATEGORY_ID as FOUNDATION_CATEGORY_ID, GROUP_ID as FOUNDATION_GROUP_ID, OBJECTIVES as FOUNDATION_OBJECTIVES, group as foundation_group, claim_group as claim_foundation_group, match_increments as foundation_match_increments
from arnautovic_objectives import CATEGORY_ID as OTW_CATEGORY_ID, GROUP_ID as ARNAUTOVIC_GROUP_ID, OBJECTIVES as ARNAUTOVIC_OBJECTIVES, group as arnautovic_group, claim_group as claim_arnautovic_group, match_increments as arnautovic_match_increments
from falcao_prime_objectives import GROUP_ID as FALCAO_PRIME_GROUP_ID, OBJECTIVES as FALCAO_PRIME_OBJECTIVES, group as falcao_prime_group, claim_group as claim_falcao_prime_group, match_increments as falcao_prime_match_increments, unlocked as falcao_prime_unlocked
from league_objectives import GROUPS as LEAGUE_GROUPS, OBJECTIVES as LEAGUE_OBJECTIVES, OBJECTIVE_GROUPS as LEAGUE_OBJECTIVE_GROUPS, groups as league_groups, claim_group as claim_league_group, match_increments as league_match_increments, unlocked as league_unlocked, unlocked_upgrades as league_unlocked_upgrades
from league_objectives import SIDE_REWARDS as LEAGUE_SIDE_REWARDS, grant_side_reward as grant_league_side_reward
from bojan_objectives import CATEGORY_ID as MNG_FUT_CATEGORY_ID, GROUP_ID as BOJAN_GROUP_ID, OBJECTIVES as BOJAN_OBJECTIVES, group as bojan_group, claim_group as claim_bojan_group, match_increments as bojan_match_increments

from otw_duo_objectives import GROUP_ID as OTW_DUO_GROUP_ID, OBJECTIVES as OTW_DUO_OBJECTIVES, group as otw_duo_group, claim_group as claim_otw_duo_group, match_increments as otw_duo_match_increments, match_context, attach_match_stats, grant_side_reward as grant_otw_duo_side_reward

CAMPAIGN_ID = 1
STATE_KEY = "mng_season_pass_1"
TOLISSO_ID = 50551331
MAX_LEVEL = 40
MAX_XP = MAX_LEVEL * 1000
PLAYER_REWARDS = {5: 1526753157, 8: 33798144, 10: 50514928, 15: 352541554, 18: 33793491, 20: 50482164, 22: 16786230, 25: 352538130, 30: 50509872, 35: 352500139, 40: TOLISSO_ID}
LOAN_REWARDS = {8: 10, 18: 10, 22: 10}
DAILY_OBJECTIVES = (
    (101, "Bienvenue au club", "Connectez-vous à FUT aujourd'hui.", "login", 1, 250),
    (102, "Sur le terrain", "Terminez un match FUT aujourd'hui.", "matches", 1, 300),
    (103, "La victoire", "Gagnez un match FUT aujourd'hui.", "wins", 1, 350),
    (104, "Nouvel élément", "Ouvrez un pack aujourd'hui.", "packs", 1, 150),
)
SEASON_OBJECTIVES = (
    (201, "Dix rencontres", "Terminez 10 matchs FUT.", "matches", 10, 1000),
    (202, "Cinq victoires", "Gagnez 5 matchs FUT.", "wins", 5, 1000),
    (203, "Spécialiste des DCE", "Terminez 3 défis de création d'équipe.", "sbc", 3, 1000),
    (204, "Collectionneur", "Ouvrez 10 packs.", "packs", 10, 500),
)


def levels() -> list[dict[str, Any]]:
    result = []
    for level in range(1, MAX_LEVEL + 1):
        if level in PLAYER_REWARDS:
            reward = {"type": "player", "value": PLAYER_REWARDS[level], "count": 1, "isUntradeable": True, "loan": LOAN_REWARDS.get(level, 0), "halId": 0}
        elif level == 38:
            reward = {"type": "pack", "value": ICON_MAX_85_PACK_ID, "count": 1, "isUntradeable": True, "loan": 0, "halId": 4}
        elif level % 5 == 0:
            reward = {"type": "pack", "value": 1010, "count": 2, "isUntradeable": True, "loan": 0, "halId": 4}
        elif level % 2 == 0:
            reward = {"type": "pack", "value": 1010, "count": 1, "isUntradeable": True, "loan": 0, "halId": 4}
        else:
            reward = {"type": "coin", "value": 500 + level * 100, "count": 1, "isUntradeable": False, "loan": 0, "halId": 0}
        result.append({"levelId": level, "milestoneId": level, "level": level, "name": f"Niveau {level}",
                       "levelName": f"Niveau {level}", "xpRequired": level * 1000, "xpThreshold": level * 1000,
                       "score": level * 1000, "rewardsList": [reward], "rewards": [reward], "rewardOptions": [[reward]],
                       "chosenOption": -1, "rewardOptionList": [{"optionId": 0, "hiddenReward": False, "awards": [reward]}]})
    return result


class SeasonPass:
    def __init__(self, module, now=None):
        self.module = module
        self.state = module.STATE
        self.now = now or time.time
        with self.state.lock:
            self.state.conn.execute("CREATE TABLE IF NOT EXISTS mng_pass_events(campaign_id INTEGER NOT NULL, event_key TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(campaign_id,event_key))")
            self.state.conn.execute("CREATE TABLE IF NOT EXISTS mng_pass_matches(match_key TEXT PRIMARY KEY, created_at INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0)")
            self.state.conn.execute("CREATE TABLE IF NOT EXISTS mng_pass_match_contexts(match_key TEXT PRIMARY KEY, data TEXT NOT NULL)")
            self.state.conn.commit()

    def _load(self, cursor):
        now = int(self.now())
        day = datetime.fromtimestamp(now, timezone.utc).date().isoformat()
        row = cursor.execute("SELECT value FROM kv WHERE key=?", (STATE_KEY,)).fetchone()
        progress = json.loads(row[0]) if row else {"xp": 0, "startedAt": now, "dailyDate": day,
                                                 "daily": {}, "totals": {}, "claimedObjectives": [], "claimedLevels": []}
        if progress.get("rewardRevision", 1) < 2:
            previous_claims = progress["claimedLevels"]
            progress["claimedLevels"] = [level for level in previous_claims if level not in {10, 20, 30}]
            if 30 in previous_claims and 40 not in progress["claimedLevels"]:
                progress["claimedLevels"].append(40)
            progress["rewardRevision"] = 2
        if progress.get("rewardRevision", 1) < 3:
            progress["claimedLevels"] = [level for level in progress["claimedLevels"] if level not in {8, 18, 22, 38}]
            progress["rewardRevision"] = 3
        if progress.get("rewardRevision", 1) < 4:
            progress["claimedLevels"] = [level for level in progress["claimedLevels"] if level != 22]
            progress["rewardRevision"] = 4
        if progress["dailyDate"] != day:
            progress["dailyDate"] = day
            progress["daily"] = {}
            progress["claimedObjectives"] = [key for key in progress["claimedObjectives"] if not key.startswith("daily:")]
        return progress

    def _save(self, cursor, progress):
        cursor.execute("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (STATE_KEY, json.dumps(progress, ensure_ascii=False)))

    def _transaction(self, operation):
        with self.state.lock:
            self.state.conn.execute("BEGIN IMMEDIATE")
            try:
                cursor = self.state.conn.cursor()
                progress = self._load(cursor)
                result = operation(cursor, progress)
                self._save(cursor, progress)
                self.state.conn.commit()
                return result
            except Exception:
                self.state.conn.rollback()
                raise

    def event(self, event_key, increments, match_xp=0):
        def record(cursor, progress):
            inserted = cursor.execute("INSERT OR IGNORE INTO mng_pass_events(campaign_id,event_key,created_at) VALUES(?,?,?)",
                                      (CAMPAIGN_ID, event_key, int(self.now()))).rowcount
            if not inserted:
                return False
            for counter, amount in increments.items():
                progress["daily"][counter] = progress["daily"].get(counter, 0) + amount
                progress["totals"][counter] = progress["totals"].get(counter, 0) + amount
            progress["xp"] = min(MAX_XP, progress["xp"] + match_xp)
            return True
        return self._transaction(record)

    def login(self):
        day = datetime.fromtimestamp(self.now(), timezone.utc).date().isoformat()
        self.event("login:" + day, {"login": 1})

    def start_match(self, match_key, context=None):
        if match_key:
            with self.state.lock:
                self.state.conn.execute("INSERT OR IGNORE INTO mng_pass_matches(match_key,created_at) VALUES(?,?)", (match_key, int(self.now())))
                snapshot = copy.deepcopy(context or {})
                progress = self._load(self.state.conn.cursor())
                snapshot["foundationPrimeUnlocked"] = falcao_prime_unlocked(progress)
                snapshot["leagueUpgradesUnlocked"] = league_unlocked_upgrades(progress)
                self.state.conn.execute("INSERT OR IGNORE INTO mng_pass_match_contexts(match_key,data) VALUES(?,?)", (match_key, json.dumps(snapshot)))
                self.state.conn.commit()

    def end_match(self, match_key, reason):
        if reason not in {"WIN", "DRAW", "LOSS"} or not match_key:
            return False
        def finish(cursor, progress):
            changed = cursor.execute("UPDATE mng_pass_matches SET completed=1 WHERE match_key=? AND completed=0", (match_key,)).rowcount
            if not changed:
                return False
            for counter in ("matches", "wins") if reason == "WIN" else ("matches",):
                progress["daily"][counter] = progress["daily"].get(counter, 0) + 1
                progress["totals"][counter] = progress["totals"].get(counter, 0) + 1
            row = cursor.execute("SELECT data FROM mng_pass_match_contexts WHERE match_key=?", (match_key,)).fetchone()
            context = json.loads(row[0]) if row else {}
            increments = foundation_match_increments(context, reason)
            increments.update(arnautovic_match_increments(context, reason))
            increments.update(bojan_match_increments(context, reason))
            increments.update(otw_duo_match_increments(context, reason))
            increments.update(league_match_increments(context, reason, progress))
            if falcao_prime_unlocked(progress):
                increments.update(falcao_prime_match_increments(context, reason))
            if reason == "WIN":
                increments.update(win_increments(context))
            for counter, amount in increments.items():
                progress["totals"][counter] = progress["totals"].get(counter, 0) + amount
            progress["xp"] = min(MAX_XP, progress["xp"] + 100)
            return True
        return self._transaction(finish)

    def _objective_key(self, progress, objective_id):
        return f"daily:{progress['dailyDate']}:{objective_id}" if objective_id < 200 else f"season:{objective_id}"

    def _native_award(self, reward):
        kind = reward["type"]
        award = {"awardType": "item" if kind in {"player", "kit", "consumable"} else kind,
                 "awardCount": reward["value"] if kind in {"coin", "xp"} else reward["count"],
                 "halId": int(reward.get("halId", 0)) if kind == "pack" else 0,
                 "loan": int(reward.get("loan", 0)) if kind == "player" else 0,
                 "untradeable": reward.get("isUntradeable", False)}
        if kind == "player":
            preview = self.state.build_player_item(reward["value"], 0, "unassigned", int(reward.get("loan", 0)))
            preview.update({"untradeable": True, "discardValue": 0})
            award["itemData"] = preview
        elif kind in {"kit", "consumable"}:
            award["itemData"] = build_otw_reward_item(self.state, reward, 0)
        return award

    def _categories(self, progress):
        result = []
        for category_id, name, specifications, daily in (
            (1, "Objectifs quotidiens", DAILY_OBJECTIVES, True),
            (2, "Objectifs de saison", SEASON_OBJECTIVES, False),
        ):
            objectives = []
            for objective_id, title, description, counter, target, xp in specifications:
                actual = min(target, progress["daily" if daily else "totals"].get(counter, 0))
                claimed = self._objective_key(progress, objective_id) in progress["claimedObjectives"]
                completed = actual >= target
                reward = {"type": "xp", "value": xp, "count": 1, "isUntradeable": True, "halId": 0, "loan": 0}
                objectives.append({"objectiveId": objective_id, "objectiveName": title, "name": title,
                                   "objectiveDescription": description, "description": description,
                                   "shortDescription": title, "currentProgress": actual, "ruleTargetValue": target,
                                   "xp": xp, "xpReward": xp, "progress": actual, "target": target,
                                   "currentValue": actual, "targetValue": target,
                                   "completed": completed, "isCompleted": completed, "isClaimed": claimed,
                                   "state": 2 if claimed else 1 if completed else 0,
                                   "awardsList": [self._native_award(reward)],
                                   "awards": [dict(reward, **self._native_award(reward))],
                                   "rewardsList": [reward], "rewards": [reward]})
            group_claimed = all(entry["isClaimed"] for entry in objectives)
            group_completed = all(entry["isCompleted"] for entry in objectives)
            group = {"groupId": category_id, "name": name, "groupName": name, "description": name,
                     "title": name, "shortDescription": name,
                     "subtitle": "Connectez-vous, jouez et ouvrez un pack pour gagner de l'XP chaque jour." if daily else "Jouez des matchs, gagnez des victoires, terminez des DCE et ouvrez des packs pour gagner de l'XP.",
                     "groupDescription": name, "groupType": 1, "priority": 0,
                     "startTime": progress["startedAt"], "endTime": 2145916800,
                     "objectivesList": objectives, "objectives": objectives,
                     "awardsList": [],
                     "rewardsList": [], "rewards": [], "completed": group_completed, "isCompleted": group_completed,
                     "isClaimed": group_claimed, "groupState": 2 if group_claimed else 1 if group_completed else 0,
                     "state": 2 if group_claimed else 1 if group_completed else 0}
            group["description"] = group["groupDescription"] = group["subtitle"]
            result.append({"categoryId": category_id, "categoryName": name, "name": name,
                           "type": 1 if daily else 4, "priority": category_id - 1,
                           "groupsList": [group], "groups": [group]})
        groups = [foundation_group(self, progress), falcao_prime_group(self, progress)]
        groups.extend(league_groups(self, progress))
        result.append({"categoryId": FOUNDATION_CATEGORY_ID, "categoryName": "Fondation", "name": "Fondation",
                       "type": 3, "priority": 2, "groupsList": groups, "groups": groups})
        groups = [otw_group(self, progress), arnautovic_group(self, progress)]
        groups[0]["priority"] = 0
        result.append({"categoryId": OTW_CATEGORY_ID, "categoryName": "One to Watch", "name": "One to Watch",
                       "type": 4, "priority": 3, "groupsList": groups, "groups": groups})
        groups = [bojan_group(self, progress), otw_duo_group(self, progress)]
        result.append({"categoryId": MNG_FUT_CATEGORY_ID, "categoryName": "MNG FUT", "name": "MNG FUT",
                       "type": 4, "priority": 4, "groupsList": groups, "groups": groups})
        return result

    def campaign(self):
        self.login()
        def build(cursor, progress):
            milestones = copy.deepcopy(levels())
            for milestone in milestones:
                claimed = milestone["levelId"] in progress["claimedLevels"]
                completed = progress["xp"] >= milestone["xpRequired"]
                milestone.update({"isClaimed": claimed, "claimed": claimed, "isCompleted": completed,
                                  "chosenOption": 0 if claimed else -1,
                                  "completed": completed, "state": 2 if claimed else 1 if completed else 0})
                milestone["rewardOptionList"][0]["awards"] = [self._native_award(milestone["rewardsList"][0])]
            categories = self._categories(progress)
            return {"campaignId": CAMPAIGN_ID, "campaignName": "MNG FUT — Saison 1", "campaignScore": progress["xp"],
                    "title": "MNG FUT — Saison 1", "subtitle": "Objectifs et récompenses MNG",
                    "serverCrtTime": int(self.now()), "hasPreviousCampaign": False,
                    "userXp": progress["xp"], "userXpList": [{"campaignId": CAMPAIGN_ID, "xp": progress["xp"], "userXp": progress["xp"]}],
                    "startTime": progress["startedAt"], "endTime": 2145916800, "active": True,
                    "currentLevel": min(MAX_LEVEL, progress["xp"] // 1000),
                    "categoriesList": categories, "categories": categories,
                    "levelsList": milestones, "levels": milestones, "milestonesList": milestones,
                    "scmpCategoryProgressList": [{"categoryId": category["categoryId"], "groupsList": category["groupsList"]} for category in categories],
                    "needsAutoClaim": False, "needsWorldAutoclaim": False, "needsGroupsRefresh": False}
        return self._transaction(build)

    def claim_objectives(self, objective_ids):
        specifications = {entry[0]: entry for entry in DAILY_OBJECTIVES + SEASON_OBJECTIVES + OTW_OBJECTIVES + FOUNDATION_OBJECTIVES + ARNAUTOVIC_OBJECTIVES + FALCAO_PRIME_OBJECTIVES + LEAGUE_OBJECTIVES + BOJAN_OBJECTIVES + OTW_DUO_OBJECTIVES}
        def claim(cursor, progress):
            validated = []
            for objective_id in sorted(set(objective_ids)):
                if objective_id not in specifications:
                    raise ValueError("OBJECTIVE_NOT_FOUND")
                if objective_id in {entry[0] for entry in FALCAO_PRIME_OBJECTIVES} and not falcao_prime_unlocked(progress):
                    raise ValueError("GROUP_LOCKED")
                if objective_id in LEAGUE_OBJECTIVE_GROUPS and not league_unlocked(progress, LEAGUE_OBJECTIVE_GROUPS[objective_id]):
                    raise ValueError("GROUP_LOCKED")
                entry = specifications[objective_id]
                if progress["daily" if objective_id < 200 else "totals"].get(entry[3], 0) < entry[4]:
                    raise ValueError("OBJECTIVE_NOT_COMPLETE")
                validated.append(entry)
            gained = 0
            items = []
            prizes = []
            for entry in validated:
                key = self._objective_key(progress, entry[0])
                if key not in progress["claimedObjectives"]:
                    progress["claimedObjectives"].append(key)
                    gained += entry[5]
                prizes.extend(grant_otw_duo_side_reward(self, cursor, progress, entry[0]))
                if entry[0] in SIDE_REWARDS:
                    awarded_items, awarded_prizes = grant_otw_reward(self, cursor, progress, entry[0])
                    items.extend(awarded_items)
                    prizes.extend(awarded_prizes)
                if entry[0] in LEAGUE_SIDE_REWARDS:
                    prizes.extend(grant_league_side_reward(self, cursor, progress, entry[0]))
            progress["xp"] = min(MAX_XP, progress["xp"] + gained)
            return {"success": True, "xpAwarded": gained, "userXp": progress["xp"], "campaignScore": progress["xp"],
                    "itemData": items, "rewards": prizes, "awardedPrizes": prizes}
        return self._transaction(claim)

    def claim_level(self, level_id):
        if level_id < 1 or level_id > MAX_LEVEL:
            raise ValueError("LEVEL_NOT_FOUND")
        def claim(cursor, progress):
            milestone = levels()[level_id - 1]
            if progress["xp"] < milestone["xpRequired"]:
                raise ValueError("LEVEL_LOCKED")
            if level_id in progress["claimedLevels"]:
                return {"success": True, "alreadyClaimed": True, "itemData": [], "rewards": [], "awardedPrizes": []}
            reward = milestone["rewardsList"][0]
            items = []
            if reward["type"] == "coin":
                row = cursor.execute("SELECT value FROM kv WHERE key='credits'").fetchone()
                balance = int(json.loads(row[0])) if row else 0
                cursor.execute("INSERT INTO kv(key,value) VALUES('credits',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(balance + reward["value"]),))
            elif reward["type"] == "pack":
                for count in range(reward["count"]):
                    cursor.execute("INSERT INTO unopened_packs(pack_id,data) VALUES(?,?)", (reward["value"], json.dumps({"source": f"MNG Season 1 level {level_id}", "untradeable": True, "isUntradeable": True})))
            else:
                row = cursor.execute("SELECT value FROM kv WHERE key='next_item_id'").fetchone()
                maximum = cursor.execute("SELECT COALESCE(MAX(id),0) FROM items").fetchone()[0]
                item_id = max(int(json.loads(row[0])) if row else 900000000000, maximum) + 1
                item = self.state.build_player_item(reward["value"], item_id, "unassigned", int(reward.get("loan", 0)))
                item.update({"untradeable": True, "discardValue": 0})
                owned = cursor.execute("SELECT id FROM items WHERE resource_id=? AND pile IN ('club','squad') LIMIT 1", (reward["value"],)).fetchone()
                if owned:
                    item["duplicateId"] = int(owned[0])
                cursor.execute("INSERT INTO items(id,resource_id,pile,data) VALUES(?,?,?,?)", (item_id, reward["value"], "unassigned", json.dumps(item)))
                cursor.execute("INSERT INTO kv(key,value) VALUES('next_item_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(item_id),))
                items.append(item)
            progress["claimedLevels"].append(level_id)
            prize = self._native_award(reward)
            prize["awardCount"] = reward["count"]
            prize["awardValue"] = reward["value"]
            if items:
                prize["itemData"] = items[0]
            return {"success": True, "alreadyClaimed": False, "campaignId": CAMPAIGN_ID, "levelId": level_id,
                    "itemData": items, "awards": [reward], "rewards": [reward], "awardedPrizes": [prize], "userXp": progress["xp"]}
        return self._transaction(claim)

    def route(self, method, raw_path, body):
        parsed = urllib.parse.urlsplit(raw_path)
        path = re.sub(r"^/ut/ut/", "/ut/", parsed.path).lower().rstrip("/")
        if "/scmp/" not in path:
            return None
        prefix = "/ut/game/fifa20/scmp/"
        if not path.startswith(prefix):
            return None
        suffix = path[len(prefix):]
        self.module.log.info("SCMP request method=%s path=%s body=%r", method, raw_path, body[:512])
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
            if not isinstance(payload, dict):
                raise ValueError("INVALID_REQUEST")
            query = urllib.parse.parse_qs(parsed.query)
            identifier = lambda key: int(payload.get(key, query.get(key, [0])[0]) or 0)
            if method == "GET":
                campaign = self.campaign()
                details = re.fullmatch(r"(?:campaign/active|learning|world)/category/(\d+)/details", suffix)
                if details:
                    category_id = int(details.group(1))
                    category = next((entry for entry in campaign["categoriesList"] if entry["categoryId"] == category_id), None)
                    if category is None:
                        raise ValueError("CATEGORY_NOT_FOUND")
                    selected = query.get("groupIdList", [])
                    requested = {int(number) for value in selected for number in value.split(",") if number}
                    groups = [group for group in category["groupsList"] if not requested or group["groupId"] in requested]
                    if requested and requested != {group["groupId"] for group in groups}:
                        raise ValueError("GROUP_NOT_FOUND")
                    result = {"campaignId": CAMPAIGN_ID, "categoryId": category_id, "groupsList": groups,
                              "groups": groups, "groupList": groups, "scmpGroupProgressList": groups}
                elif suffix in {"campaign", "campaign/active", "campaign/1", "campaign/1/progress", "campaign/progress", "campaign/user", "campaign/1/user"}:
                    result = campaign
                elif suffix in {"campaign/rewards/all", "learning/campaign/rewards/all", "world/campaign/rewards/all"}:
                    result = {"campaignId": CAMPAIGN_ID, "rewards": [], "rewardsList": [], "itemData": []}
                elif suffix in {"campaign/categories", "campaign/1/categories", "campaign/objectives", "campaign/1/objectives"}:
                    result = campaign
                else:
                    self.module.log.warning("SCMP unsupported request method=%s path=%s", method, raw_path)
                    return 404, {"Cache-Control": "no-store"}, self.module.json_bytes({"code": "SCMP_ROUTE_NOT_FOUND"})
            elif method in {"POST", "PUT"}:
                matched = re.fullmatch(r"(?:campaign/(?:1/)?)?(milestone|level|objective|group)/(\d+)/(?:redeem|claim|reward|rewards)", suffix)
                native_objective = re.fullmatch(r"(?:campaign|learning|world)/group/(\d+)/objective/(\d+)/rewards", suffix)
                native_level = re.fullmatch(r"campaign/level/(\d+)/reward/(\d+)", suffix)
                if native_objective:
                    group_id, number = map(int, native_objective.groups())
                    valid = BOJAN_OBJECTIVES if group_id == BOJAN_GROUP_ID else LEAGUE_GROUPS[group_id]["specifications"] if group_id in LEAGUE_GROUPS else DAILY_OBJECTIVES if group_id == 1 else SEASON_OBJECTIVES if group_id == 2 else OTW_OBJECTIVES if group_id == 3 else FOUNDATION_OBJECTIVES if group_id == FOUNDATION_GROUP_ID else ARNAUTOVIC_OBJECTIVES if group_id == ARNAUTOVIC_GROUP_ID else FALCAO_PRIME_OBJECTIVES if group_id == FALCAO_PRIME_GROUP_ID else ()
                    if number not in {entry[0] for entry in valid}:
                        raise ValueError("OBJECTIVE_NOT_FOUND")
                    kind = "objective"
                elif native_level:
                    number, reward_index = map(int, native_level.groups())
                    if reward_index != 0:
                        raise ValueError("REWARD_OPTION_NOT_FOUND")
                    kind = "level"
                elif re.fullmatch(r"(?:learning|world)/group/(\d+)/rewards", suffix):
                    kind, number = "group", int(suffix.split("/")[2])
                elif matched:
                    kind, number = matched.group(1), int(matched.group(2))
                elif suffix in {"campaign/rewards", "campaign/redeem", "campaign/rewards/redeem", "campaign/milestone/redeem", "campaign/objective/redeem", "campaign/group/redeem"}:
                    kind = "objective" if identifier("objectiveId") else "group" if identifier("groupId") else "level"
                    number = identifier("objectiveId") or identifier("groupId") or identifier("milestoneId") or identifier("levelId")
                else:
                    self.module.log.warning("SCMP unsupported request method=%s path=%s body=%r", method, raw_path, body[:512])
                    return 404, {"Cache-Control": "no-store"}, self.module.json_bytes({"code": "SCMP_ROUTE_NOT_FOUND"})
                if kind == "group":
                    if number not in {1, 2, 3, FOUNDATION_GROUP_ID, ARNAUTOVIC_GROUP_ID, FALCAO_PRIME_GROUP_ID, BOJAN_GROUP_ID} | set(LEAGUE_GROUPS):
                        raise ValueError("GROUP_NOT_FOUND")
                    result = claim_otw_duo_group(self) if number == OTW_DUO_GROUP_ID else claim_bojan_group(self) if number == BOJAN_GROUP_ID else claim_league_group(self, number) if number in LEAGUE_GROUPS else claim_falcao_prime_group(self) if number == FALCAO_PRIME_GROUP_ID else claim_arnautovic_group(self) if number == ARNAUTOVIC_GROUP_ID else claim_foundation_group(self) if number == FOUNDATION_GROUP_ID else claim_otw_group(self) if number == 3 else self.claim_objectives([entry[0] for entry in (DAILY_OBJECTIVES if number == 1 else SEASON_OBJECTIVES)])
                elif kind == "objective":
                    result = self.claim_objectives([number])
                else:
                    result = self.claim_level(number)
                result.update(self.module._credits_payload())
            else:
                return 405, {"Allow": "GET, POST, PUT"}, self.module.json_bytes({"code": "METHOD_NOT_ALLOWED"})
            self.module.log.info("SCMP response method=%s path=%s campaign=%s xp=%s levels=%s", method, raw_path, CAMPAIGN_ID, result.get("userXp"), len(result.get("levelsList", [])))
            return 200, {"Cache-Control": "no-store"}, self.module.json_bytes(result)
        except (ValueError, TypeError, UnicodeDecodeError) as error:
            return 400, {"Cache-Control": "no-store"}, self.module.json_bytes({"success": False, "code": str(error)})

    def observe(self, method, path, request, response, match_key):
        if method not in {"POST", "PUT"} or response.get("success") is False or response.get("error"):
            return
        if path == "/ut/game/fifa20/match":
            if "sqbtOpponentSquadId" in response:
                return
            self.start_match(str(self.state.get("generic_current_match_key", "") or self.state.get("currentMatchGid", "") or ""), match_context(self.module, request))
        elif path == "/ut/game/fifa20/match/end":
            if "squadBattlePoints" in response:
                return
            attach_match_stats(self, match_key, request)
            self.end_match(match_key, str(request.get("endReason", "")).upper())
        elif path == "/ut/game/fifa20/purchased/items" and response.get("itemData"):
            ids = sorted(int(item.get("id", 0)) for item in response["itemData"])
            event_key = "pack:" + hashlib.sha256(json.dumps(ids).encode()).hexdigest()
            self.event(event_key, {"packs": 1})
        elif re.fullmatch(r"/ut/game/fifa20/sbs/challenge/\d+(?:/submit)?", path) and response.get("challengeComplete"):
            completed = response.get("timesCompleted")
            if completed is None:
                return
            challenge_id = int(path.split("/challenge/")[1].split("/")[0])
            with self.state.lock:
                row = self.state.conn.execute("SELECT times_completed FROM sbc_completions WHERE challenge_id=?", (challenge_id,)).fetchone()
            if row and 0 < int(completed) <= int(row[0]):
                self.event(f"sbc:{challenge_id}:{int(completed)}", {"sbc": 1})


def apply(module):
    install_otw_rewards(module)
    install_season_pass_custom_packs(module)
    original_route = module.route_fut
    original_create_pack = module.State.create_pack
    original_discard_items = module.State.discard_items
    original_create_auction = module.State.create_auction
    reward_pack = ContextVar("mng_season_reward_pack", default=False)
    season = SeasonPass(module)
    module.SEASON_PASS = season
    install_report_capture(module)
    original_sb_start = module._sb_start_match
    original_sb_end = module._sb_end_match

    def sb_start(payload, query=None):
        with module._sb_lock:
            result = original_sb_start(payload, query)
            if "sqbtOpponentSquadId" in result:
                snapshot = module._sb_state()
                context = match_context(module, dict(payload, sqbtOpponentSquadId=snapshot["selectedOpponentId"]))
                season.start_match(f"squad_battles:{snapshot['lastMatchStart']}", context)
            return result

    def sb_end(payload):
        with module._sb_lock:
            snapshot = module._sb_state()
            match_start = snapshot.get("lastMatchStart", 0)
            result = original_sb_end(payload)
            settled = module._sb_state()
            if snapshot.get("matchInProgress") and match_start and settled.get("lastSettledMatchStart") == match_start:
                match_key = f"squad_battles:{match_start}"
                reason = str(payload.get("endReason", payload.get("result", ""))).upper()
                if reason in {"QUIT", "DNF", "DISCONNECT", "ABANDONED"}:
                    with season.state.lock, season.state.conn:
                        season.state.conn.execute("UPDATE mng_pass_matches SET completed=1 WHERE match_key=?", (match_key,))
                else:
                    attach_match_stats(season, match_key, payload)
                    season.end_match(match_key, str(result.get("endReason", "")).upper())
            return result

    module._sb_start_match = sb_start
    module._sb_end_match = sb_end

    def create_pack(state, pack_id=1):
        result = original_create_pack(state, pack_id)
        if reward_pack.get():
            with state.lock, state.conn:
                for item in result.get("itemData", []):
                    item.update({"untradeable": True, "discardValue": 0})
                    state.conn.execute("UPDATE items SET data=? WHERE id=?", (json.dumps(item), int(item["id"])))
        return result

    module.State.create_pack = create_pack

    def create_auction(state, *args, **kwargs):
        item = kwargs.get("item_data", args[1] if len(args) > 1 else {})
        if isinstance(item, dict) and item.get("untradeable"):
            raise ValueError("This reward is untradeable")
        return original_create_auction(state, *args, **kwargs)

    def discard_items(state, item_ids):
        cleaned = list(dict.fromkeys(int(item_id) for item_id in item_ids))
        if not any((state.get_item(item_id) or {}).get("untradeable") for item_id in cleaned):
            return original_discard_items(state, cleaned)
        with state.lock:
            state.conn.execute("BEGIN IMMEDIATE")
            try:
                deleted = []
                payout = 0
                for item_id in cleaned:
                    row = state.conn.execute("SELECT resource_id,pile,data FROM items WHERE id=?", (item_id,)).fetchone()
                    if not row or row[1] == "squad":
                        continue
                    item = json.loads(row[2])
                    payout += 0 if item.get("untradeable") else state.player_discard_value(int(row[0]))
                    state.conn.execute("DELETE FROM items WHERE id=?", (item_id,))
                    deleted.append(item_id)
                row = state.conn.execute("SELECT value FROM kv WHERE key='credits'").fetchone()
                balance = (int(json.loads(row[0])) if row else 0) + payout
                state.conn.execute("INSERT INTO kv(key,value) VALUES('credits',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(balance),))
                state.conn.commit()
                return balance, deleted
            except Exception:
                state.conn.rollback()
                raise

    module.State.create_auction = create_auction
    module.State.discard_items = discard_items

    def route(method, raw_path, headers, body):
        method = method.upper()
        handled = season.route(method, raw_path, body)
        if handled is not None:
            return handled
        path = re.sub(r"^/ut/ut/", "/ut/", urllib.parse.urlsplit(raw_path).path).lower().rstrip("/")
        match_key = str(module.STATE.get("generic_current_match_key", "") or module.STATE.get("currentMatchGid", "") or "")
        context_token = None
        if method == "POST" and path in {"/ut/game/fifa20/purchased/items", "/ut/game/fifa20/auctionhouse"}:
            try:
                request = json.loads(body.decode("utf-8")) if body else {}
                if path.endswith("auctionhouse"):
                    item = module.STATE.get_item(int(request.get("itemData", {}).get("id", 0) or 0)) or {}
                    if item.get("untradeable"):
                        return 403, {"Cache-Control": "no-store"}, module.json_bytes({"code": "UNTRADEABLE_ITEM", "reason": "untradeableItem"})
                else:
                    with module.STATE.lock:
                        row = module.STATE.conn.execute("SELECT data FROM unopened_packs WHERE pack_id=? ORDER BY id LIMIT 1", (int(request.get("packId", 3)),)).fetchone()
                    metadata = json.loads(row[0]) if row else {}
                    context_token = reward_pack.set(str(metadata.get("source", "")).startswith(("MNG Season 1 level ", "MNG OTW objective ")))
            except (ValueError, TypeError, AttributeError):
                pass
        try:
            response = original_route(method, raw_path, headers, body)
        finally:
            if context_token is not None:
                reward_pack.reset(context_token)
        if response[0] == 200 and method == "GET" and path == "/ut/game/fifa20/settings":
            result = json.loads(response[2])
            configs = result.setdefault("configs", [])
            existing = next((entry for entry in configs if entry.get("type") == "enableObjectives"), None)
            if existing is None:
                configs.append({"type": "enableObjectives", "value": "1"})
            else:
                existing["value"] = "1"
            response = (response[0], response[1], module.json_bytes(result))
        if response[0] == 200 and method in {"POST", "PUT"}:
            try:
                request = json.loads(body.decode("utf-8")) if body else {}
                result = json.loads(response[2])
                if isinstance(request, dict) and isinstance(result, dict):
                    season.observe(method, path, request, result, match_key)
            except Exception:
                module.log.exception("Season pass progress observation failed: method=%s path=%s", method, path)
        return response

    module.route_fut = route
    module.log.warning("MNG Season Pass active: campaign=1 levels=%s dailyObjectives=4 seasonObjectives=4", MAX_LEVEL)
