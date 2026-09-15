const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function cors(request) {
  const origin = request.headers.get('origin') || '*';
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
    'vary': 'Origin'
  };
}

function reply(request, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...cors(request) }
  });
}

function nowMs() { return Date.now(); }
function cleanText(value, max = 80) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}
function bearer(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}
async function bodyJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('application/json')) throw new HttpError(415, 'JSON_REQUIRED');
  try { return await request.json(); }
  catch { throw new HttpError(400, 'INVALID_JSON'); }
}

async function upsertProfile(db, profile) {
  await db.prepare(`
    INSERT INTO social_profiles(user_id, persona_id, username, avatar_url, updated_at)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      persona_id=excluded.persona_id,
      username=excluded.username,
      avatar_url=excluded.avatar_url,
      updated_at=excluded.updated_at
  `).bind(profile.id, profile.personaId, profile.username, profile.avatarUrl, nowMs()).run();
}

async function authenticate(request, env) {
  const token = bearer(request);
  if (!token) throw new HttpError(401, 'UNAUTHORIZED');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const tokenHash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  const raw = await env.AUTH_DB.prepare(`
    SELECT u.id, u.username, u.persona_id, u.status, s.expires_at
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=?
    LIMIT 1
  `).bind(tokenHash).first();
  if (!raw || raw.status !== 'active' || Number(raw.expires_at) <= Math.floor(Date.now() / 1000)) {
    throw new HttpError(401, 'UNAUTHORIZED');
  }
  const id = Number(raw.id);
  const personaId = Number(raw.persona_id || 0);
  const username = cleanText(raw.username, 32);
  if (!Number.isSafeInteger(id) || id <= 0 || !username) throw new HttpError(401, 'INVALID_PROFILE');
  const profile = {
    id,
    personaId: Number.isSafeInteger(personaId) && personaId > 0 ? personaId : 0,
    username,
    avatarUrl: ''
  };
  await upsertProfile(env.SOCIAL_DB, profile);
  return { profile };
}

function publicPresence(row) {
  const lastSeenAt = Number(row.last_seen_at || 0);
  const fresh = lastSeenAt > 0 && nowMs() - lastSeenAt <= 90000;
  const stored = cleanText(row.presence_state || 'offline', 32).toLowerCase();
  const state = fresh && stored !== 'offline' ? stored : 'offline';
  return {
    state,
    statusText: state === 'offline' ? '' : cleanText(row.status_text || '', 80),
    lastSeenAt
  };
}

async function listFriends(db, userId) {
  const result = await db.prepare(`
    SELECT p.user_id, p.persona_id, p.username, p.avatar_url,
           pr.state AS presence_state, pr.status_text, pr.last_seen_at
    FROM friendships f
    JOIN social_profiles p ON p.user_id=f.friend_id
    LEFT JOIN presence pr ON pr.user_id=p.user_id
    WHERE f.user_id=?
    ORDER BY LOWER(p.username)
  `).bind(userId).all();
  return (result.results || []).map(row => ({
    id: Number(row.user_id),
    personaId: Number(row.persona_id || 0),
    username: String(row.username || ''),
    avatarUrl: String(row.avatar_url || ''),
    presence: publicPresence(row)
  }));
}

async function listRequests(db, userId) {
  const result = await db.prepare(`
    SELECT r.id, r.sender_id, r.created_at, p.username, p.avatar_url,
           pr.state AS presence_state, pr.status_text, pr.last_seen_at
    FROM friend_requests r
    JOIN social_profiles p ON p.user_id=r.sender_id
    LEFT JOIN presence pr ON pr.user_id=p.user_id
    WHERE r.receiver_id=? AND r.status='pending'
    ORDER BY r.created_at DESC
    LIMIT 100
  `).bind(userId).all();
  return (result.results || []).map(row => ({
    requestId: Number(row.id),
    senderId: Number(row.sender_id),
    username: String(row.username || ''),
    avatarUrl: String(row.avatar_url || ''),
    createdAt: Number(row.created_at || 0),
    presence: publicPresence(row)
  }));
}

async function handleSearch(request, env, me, url) {
  const q = cleanText(url.searchParams.get('q'), 32);
  if (q.length < 2) return reply(request, { ok: true, users: [] });
  const like = `%${q.toLowerCase().replace(/[%_]/g, '')}%`;
  const result = await env.SOCIAL_DB.prepare(`
    SELECT p.user_id, p.persona_id, p.username, p.avatar_url,
      CASE WHEN f.friend_id IS NOT NULL THEN 1 ELSE 0 END AS is_friend,
      outreq.id AS outgoing_request_id,
      inreq.id AS incoming_request_id,
      pr.state AS presence_state, pr.status_text, pr.last_seen_at
    FROM social_profiles p
    LEFT JOIN friendships f ON f.user_id=? AND f.friend_id=p.user_id
    LEFT JOIN friend_requests outreq ON outreq.sender_id=? AND outreq.receiver_id=p.user_id AND outreq.status='pending'
    LEFT JOIN friend_requests inreq ON inreq.sender_id=p.user_id AND inreq.receiver_id=? AND inreq.status='pending'
    LEFT JOIN presence pr ON pr.user_id=p.user_id
    WHERE p.user_id<>? AND LOWER(p.username) LIKE ?
    ORDER BY CASE WHEN LOWER(p.username)=LOWER(?) THEN 0 ELSE 1 END, LOWER(p.username)
    LIMIT 20
  `).bind(me.id, me.id, me.id, me.id, like, q).all();
  const users = (result.results || []).map(row => ({
    id: Number(row.user_id), personaId: Number(row.persona_id || 0),
    username: String(row.username || ''), avatarUrl: String(row.avatar_url || ''),
    relationship: Number(row.is_friend) ? 'friend' : row.outgoing_request_id ? 'outgoing' : row.incoming_request_id ? 'incoming' : 'none',
    requestId: Number(row.outgoing_request_id || row.incoming_request_id || 0),
    presence: publicPresence(row)
  }));
  return reply(request, { ok: true, users });
}

async function sendFriendRequest(request, env, me) {
  const body = await bodyJson(request);
  const username = cleanText(body.username, 32);
  if (username.length < 2) throw new HttpError(400, 'INVALID_USERNAME');
  const target = await env.SOCIAL_DB.prepare(
    'SELECT user_id, username FROM social_profiles WHERE LOWER(username)=LOWER(?) LIMIT 1'
  ).bind(username).first();
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND');
  const targetId = Number(target.user_id);
  if (targetId === me.id) throw new HttpError(409, 'CANNOT_ADD_SELF');
  const existingFriend = await env.SOCIAL_DB.prepare(
    'SELECT 1 AS ok FROM friendships WHERE user_id=? AND friend_id=? LIMIT 1'
  ).bind(me.id, targetId).first();
  if (existingFriend) return reply(request, { ok: true, relationship: 'friend' });

  const reverse = await env.SOCIAL_DB.prepare(`
    SELECT id FROM friend_requests
    WHERE sender_id=? AND receiver_id=? AND status='pending'
    ORDER BY id DESC LIMIT 1
  `).bind(targetId, me.id).first();
  if (reverse) {
    const ts = nowMs();
    await env.SOCIAL_DB.batch([
      env.SOCIAL_DB.prepare("UPDATE friend_requests SET status='accepted', responded_at=? WHERE id=? AND status='pending'").bind(ts, Number(reverse.id)),
      env.SOCIAL_DB.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_id,created_at) VALUES(?,?,?)').bind(me.id, targetId, ts),
      env.SOCIAL_DB.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_id,created_at) VALUES(?,?,?)').bind(targetId, me.id, ts)
    ]);
    return reply(request, { ok: true, relationship: 'friend', autoAccepted: true });
  }

  const outgoing = await env.SOCIAL_DB.prepare(`
    SELECT id FROM friend_requests
    WHERE sender_id=? AND receiver_id=? AND status='pending'
    ORDER BY id DESC LIMIT 1
  `).bind(me.id, targetId).first();
  if (outgoing) return reply(request, { ok: true, relationship: 'outgoing', requestId: Number(outgoing.id) });

  const recent = await env.SOCIAL_DB.prepare(`
    SELECT COUNT(*) AS c FROM friend_requests
    WHERE sender_id=? AND created_at>?
  `).bind(me.id, nowMs() - 3600000).first();
  if (Number(recent?.c || 0) >= 30) throw new HttpError(429, 'RATE_LIMITED');

  const result = await env.SOCIAL_DB.prepare(`
    INSERT INTO friend_requests(sender_id,receiver_id,status,created_at)
    VALUES(?,?,'pending',?)
  `).bind(me.id, targetId, nowMs()).run();
  return reply(request, { ok: true, relationship: 'outgoing', requestId: Number(result.meta?.last_row_id || 0) }, 201);
}

async function resolveRequest(request, env, me, accept) {
  const body = await bodyJson(request);
  const requestId = Number(body.requestId);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) throw new HttpError(400, 'INVALID_REQUEST_ID');
  const row = await env.SOCIAL_DB.prepare(`
    SELECT id,sender_id,receiver_id FROM friend_requests
    WHERE id=? AND receiver_id=? AND status='pending' LIMIT 1
  `).bind(requestId, me.id).first();
  if (!row) throw new HttpError(404, 'REQUEST_NOT_FOUND');
  const senderId = Number(row.sender_id);
  const ts = nowMs();
  if (!accept) {
    await env.SOCIAL_DB.prepare("UPDATE friend_requests SET status='declined', responded_at=? WHERE id=?").bind(ts, requestId).run();
    return reply(request, { ok: true });
  }
  await env.SOCIAL_DB.batch([
    env.SOCIAL_DB.prepare("UPDATE friend_requests SET status='accepted', responded_at=? WHERE id=?").bind(ts, requestId),
    env.SOCIAL_DB.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_id,created_at) VALUES(?,?,?)').bind(me.id, senderId, ts),
    env.SOCIAL_DB.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_id,created_at) VALUES(?,?,?)').bind(senderId, me.id, ts)
  ]);
  return reply(request, { ok: true });
}

async function removeFriend(request, env, me, friendId) {
  if (!Number.isSafeInteger(friendId) || friendId <= 0 || friendId === me.id) throw new HttpError(400, 'INVALID_USER_ID');
  await env.SOCIAL_DB.batch([
    env.SOCIAL_DB.prepare('DELETE FROM friendships WHERE user_id=? AND friend_id=?').bind(me.id, friendId),
    env.SOCIAL_DB.prepare('DELETE FROM friendships WHERE user_id=? AND friend_id=?').bind(friendId, me.id),
    env.SOCIAL_DB.prepare("UPDATE friend_requests SET status='cancelled', responded_at=? WHERE status='pending' AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))")
      .bind(nowMs(), me.id, friendId, friendId, me.id)
  ]);
  return reply(request, { ok: true });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return reply(request, { ok: true, service: 'mng-fut-social', version: '1.0.1', time: nowMs() });
      }
      const { profile: me } = await authenticate(request, env);

      if (url.pathname === '/api/social/me' && request.method === 'GET') {
        const presence = await env.SOCIAL_DB.prepare('SELECT state AS presence_state,status_text,last_seen_at FROM presence WHERE user_id=?').bind(me.id).first() || {};
        return reply(request, { ok: true, profile: me, presence: publicPresence(presence) });
      }
      if (url.pathname === '/api/presence' && request.method === 'POST') {
        const body = await bodyJson(request);
        const allowed = new Set(['online', 'playing_fifa17', 'in_fut', 'away', 'offline']);
        const state = cleanText(body.state, 32).toLowerCase();
        if (!allowed.has(state)) throw new HttpError(400, 'INVALID_PRESENCE');
        const statusText = cleanText(body.statusText, 80);
        await env.SOCIAL_DB.prepare(`
          INSERT INTO presence(user_id,state,status_text,last_seen_at)
          VALUES(?,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,status_text=excluded.status_text,last_seen_at=excluded.last_seen_at
        `).bind(me.id, state, statusText, nowMs()).run();
        return reply(request, { ok: true, state });
      }
      if (url.pathname === '/api/friends' && request.method === 'GET') {
        const friends = await listFriends(env.SOCIAL_DB, me.id);
        const onlineCount = friends.filter(f => f.presence.state !== 'offline').length;
        return reply(request, { ok: true, friends, onlineCount });
      }
      if (url.pathname === '/api/friends/requests' && request.method === 'GET') {
        const requests = await listRequests(env.SOCIAL_DB, me.id);
        return reply(request, { ok: true, requests });
      }
      if (url.pathname === '/api/users/search' && request.method === 'GET') {
        return await handleSearch(request, env, me, url);
      }
      if (url.pathname === '/api/friends/request' && request.method === 'POST') {
        return await sendFriendRequest(request, env, me);
      }
      if (url.pathname === '/api/friends/accept' && request.method === 'POST') {
        return await resolveRequest(request, env, me, true);
      }
      if (url.pathname === '/api/friends/decline' && request.method === 'POST') {
        return await resolveRequest(request, env, me, false);
      }
      const removeMatch = /^\/api\/friends\/(\d+)$/.exec(url.pathname);
      if (removeMatch && request.method === 'DELETE') {
        return await removeFriend(request, env, me, Number(removeMatch[1]));
      }
      throw new HttpError(404, 'NOT_FOUND');
    } catch (error) {
      const status = Number(error?.status || 500);
      const code = cleanText(error?.code || 'INTERNAL_ERROR', 64) || 'INTERNAL_ERROR';
      if (status >= 500) console.error(error);
      return reply(request, { ok: false, error: code, message: status >= 500 ? 'Server error' : cleanText(error?.message || code, 160) }, status);
    }
  }
};
