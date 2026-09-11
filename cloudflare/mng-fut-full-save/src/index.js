// MNG FUT FULL CLOUD SAVE Worker v2.1.0
// Dedicated sidecar Worker.
// Authentication is delegated to the existing MNG FUT API /api/me endpoint.
// No password, signing key or account secret is stored here.

const MAX_SAVE_BYTES = 12 * 1024 * 1024;
const CHUNK_CHARS = 180000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function getBearer(request) {
  const value = request.headers.get("authorization") || "";
  return /^Bearer\s+.+/i.test(value) ? value : "";
}

function profileFromMePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload.profile || payload.user || payload.data?.profile || payload.data?.user || payload;
  const id = Number(p?.id ?? p?.userId ?? 0);
  const personaId = Number(p?.personaId ?? 0);
  const username = String(p?.username ?? p?.name ?? "").trim();
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { id, personaId, username };
}

async function authenticate(request, env) {
  const authorization = getBearer(request);
  if (!authorization) return { ok: false, status: 401, error: "AUTH_REQUIRED" };

  const base = String(env.AUTH_API_BASE_URL || "https://mng-fut-api.minegamerfrance.workers.dev").replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}/api/me`, {
      method: "GET",
      headers: {
        authorization,
        accept: "application/json",
        "user-agent": "MNG-FUT-Full-Save/2.1.0"
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status || 401, error: String(payload?.error || "AUTH_REJECTED") };
    const profile = profileFromMePayload(payload);
    if (!profile) return { ok: false, status: 401, error: "AUTH_PROFILE_INVALID" };
    return { ok: true, profile };
  } catch {
    return { ok: false, status: 503, error: "AUTH_API_UNAVAILABLE" };
  }
}

function getDb(env) {
  return env.FULL_SAVE_DB || env.DB || null;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
}

function safeSave(save, profile) {
  if (!save || typeof save !== "object") throw new Error("SAVE_INVALID");
  if (Number(save.schemaVersion) !== 1) throw new Error("SAVE_SCHEMA_UNSUPPORTED");
  if (String(save.game || "fifa17") !== "fifa17") throw new Error("SAVE_WRONG_GAME");
  if (Number(save.userId) > 0 && Number(save.userId) !== Number(profile.id)) throw new Error("SAVE_WRONG_USER");
  if (Number(save.personaId) > 0 && Number(profile.personaId) > 0 && Number(save.personaId) !== Number(profile.personaId)) {
    throw new Error("SAVE_WRONG_PERSONA");
  }
  if (!save.state || typeof save.state !== "object" || Number(save.state.version) !== 1 || !Array.isArray(save.state.items)) {
    throw new Error("SAVE_STATE_INVALID");
  }
  return save;
}

async function getMeta(db, userId) {
  return await db.prepare(
    "SELECT user_id, revision, save_id, schema_version, byte_size, sha256, updated_at FROM mng_fut_full_saves WHERE user_id=?"
  ).bind(userId).first();
}

async function readSave(db, userId, meta) {
  const rows = await db.prepare(
    "SELECT chunk_index, chunk_text FROM mng_fut_full_save_chunks WHERE user_id=? AND save_id=? ORDER BY chunk_index ASC"
  ).bind(userId, meta.save_id).all();

  const chunks = Array.isArray(rows?.results) ? rows.results : [];
  if (!chunks.length) throw new Error("SAVE_CHUNKS_MISSING");

  const text = chunks.map(row => String(row.chunk_text || "")).join("");
  const byteSize = new TextEncoder().encode(text).byteLength;
  if (byteSize !== Number(meta.byte_size)) throw new Error("SAVE_SIZE_MISMATCH");

  const hash = await sha256Hex(text);
  if (hash !== String(meta.sha256)) throw new Error("SAVE_HASH_MISMATCH");

  return JSON.parse(text);
}

async function handleGet(db, profile) {
  const meta = await getMeta(db, profile.id);
  if (!meta) return json({ ok: false, error: "SAVE_NOT_FOUND" }, 404);

  try {
    const save = await readSave(db, profile.id, meta);
    return json({
      ok: true,
      revision: Number(meta.revision),
      updatedAt: String(meta.updated_at || ""),
      byteSize: Number(meta.byte_size) || 0,
      sha256: String(meta.sha256 || ""),
      save
    });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || "SAVE_READ_FAILED") }, 500);
  }
}

async function cleanupUpload(db, userId, saveId) {
  try {
    await db.prepare("DELETE FROM mng_fut_full_save_chunks WHERE user_id=? AND save_id=?").bind(userId, saveId).run();
  } catch {}
}

async function handlePut(request, db, profile) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }

  let save;
  try { save = safeSave(body?.save, profile); }
  catch (error) { return json({ ok: false, error: String(error.message || error) }, 400); }

  const expectedRevision = Math.max(0, Math.floor(Number(body?.expectedRevision) || 0));
  const text = JSON.stringify(save);
  const byteSize = new TextEncoder().encode(text).byteLength;
  if (byteSize > MAX_SAVE_BYTES) return json({ ok: false, error: "SAVE_TOO_LARGE", maxBytes: MAX_SAVE_BYTES }, 413);

  const current = await getMeta(db, profile.id);
  const currentRevision = Math.max(0, Number(current?.revision) || 0);
  if (currentRevision !== expectedRevision) {
    return json({ ok: false, error: "SAVE_CONFLICT", currentRevision }, 409);
  }

  const newRevision = currentRevision + 1;
  const saveId = crypto.randomUUID();
  const hash = await sha256Hex(text);
  const now = new Date().toISOString();
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) chunks.push(text.slice(i, i + CHUNK_CHARS));

  try {
    const statements = chunks.map((chunk, index) =>
      db.prepare(
        "INSERT INTO mng_fut_full_save_chunks(user_id,save_id,chunk_index,chunk_text) VALUES(?,?,?,?)"
      ).bind(profile.id, saveId, index, chunk)
    );
    if (statements.length) await db.batch(statements);

    let writeResult;
    if (current) {
      writeResult = await db.prepare(
        `UPDATE mng_fut_full_saves
         SET revision=?, save_id=?, schema_version=?, byte_size=?, sha256=?, updated_at=?
         WHERE user_id=? AND revision=?`
      ).bind(newRevision, saveId, 1, byteSize, hash, now, profile.id, expectedRevision).run();
    } else {
      writeResult = await db.prepare(
        `INSERT OR IGNORE INTO mng_fut_full_saves
         (user_id,revision,save_id,schema_version,byte_size,sha256,updated_at)
         VALUES(?,?,?,?,?,?,?)`
      ).bind(profile.id, newRevision, saveId, 1, byteSize, hash, now).run();
    }

    const changes = Number(writeResult?.meta?.changes ?? 0);
    if (changes !== 1) {
      await cleanupUpload(db, profile.id, saveId);
      const latest = await getMeta(db, profile.id);
      return json({ ok: false, error: "SAVE_CONFLICT", currentRevision: Number(latest?.revision) || currentRevision }, 409);
    }

    // The metadata now points to saveId. Old chunks are safe to delete.
    await db.prepare(
      "DELETE FROM mng_fut_full_save_chunks WHERE user_id=? AND save_id<>?"
    ).bind(profile.id, saveId).run();

    return json({
      ok: true,
      revision: newRevision,
      byteSize,
      sha256: hash,
      updatedAt: now,
      chunks: chunks.length
    });
  } catch (error) {
    await cleanupUpload(db, profile.id, saveId);
    return json({ ok: false, error: "SAVE_WRITE_FAILED", detail: String(error?.message || error) }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "mng-fut-full-save", version: "2.1.0" });
    }

    if (url.pathname !== "/api/save/full") {
      return json({ ok: false, error: "NOT_FOUND" }, 404);
    }

    const db = getDb(env);
    if (!db) return json({ ok: false, error: "D1_BINDING_MISSING" }, 500);

    const auth = await authenticate(request, env);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    if (request.method === "GET") return handleGet(db, auth.profile);
    if (request.method === "PUT") return handlePut(request, db, auth.profile);

    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }
};
