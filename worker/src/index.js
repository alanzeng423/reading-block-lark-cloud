import { findNextFreeSlotInTimeZone, zonedDateKey } from "../../extension/src/lib/slots.js";

const LARK_OPEN_API = "https://open.larksuite.com/open-apis";
const LARK_AUTH_URL = "https://accounts.larksuite.com/open-apis/authen/v1/authorize";
const CALLBACK_PATH = "/auth/lark/callback";
const EXTENSION_ZIP_KEY = "reading-block-lark-extension.zip";
const EXTENSION_ZIP_PATH = `/downloads/${EXTENSION_ZIP_KEY}`;
const DEFAULT_SETTINGS = {
  days: [1, 2, 3, 4, 5],
  windowStart: "14:00",
  windowEnd: "18:00",
  blockMinutes: 30,
  minLeadMinutes: 120,
  batchSize: 5,
  lookaheadDays: 14,
  eventTitle: "Reading Block",
  reminderMinutes: 10,
};

const BASE_FIELDS = {
  title: "Title",
  url: "URL",
  domain: "Domain",
  status: "Status",
  savedAt: "Saved At",
  readAt: "Read At",
  scheduledStart: "Scheduled Start",
  scheduledEnd: "Scheduled End",
  calendarEventId: "Calendar Event ID",
  batchId: "Batch ID",
  source: "Source",
};

export default {
  async fetch(request, env, ctx) {
    try {
      return withCors(request, await route(request, env, ctx));
    } catch (err) {
      console.error("reading-block-api error", err);
      return withCors(request, json({ ok: false, error: err.message || "Internal error" }, err.status || 500));
    }
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  if (isDisallowedBrowserOrigin(request)) return json({ ok: false, error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return corsPreflight();
  if (url.pathname === "/health") return json({ ok: true, service: "reading-block-api" });
  if (url.pathname === EXTENSION_ZIP_PATH && (request.method === "GET" || request.method === "HEAD")) {
    return serveExtensionZip(env, request.method);
  }

  if (url.pathname === "/auth/lark/start" && request.method === "POST") {
    return startLarkAuth(request, env);
  }
  if (url.pathname === CALLBACK_PATH && request.method === "GET") {
    return handleLarkCallback(request, env, ctx);
  }
  if (url.pathname === "/auth/lark/poll" && request.method === "GET") {
    return pollLarkAuth(request, env);
  }

  if (url.pathname.startsWith("/api/")) {
    const auth = await requireSession(request, env);
    if (url.pathname === "/api/me" && request.method === "GET") return getMe(env, auth.user);
    if (url.pathname === "/api/items" && request.method === "GET") return listItems(env, auth.user);
    if (url.pathname === "/api/items/save" && request.method === "POST") {
      return saveItem(request, env, auth.user, ctx);
    }
    const itemMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (itemMatch && request.method === "PATCH") {
      return updateItem(request, env, auth.user, decodeURIComponent(itemMatch[1]));
    }
    if (itemMatch && request.method === "DELETE") {
      return deleteCloudItem(env, auth.user, decodeURIComponent(itemMatch[1]));
    }
    if (url.pathname === "/api/settings" && request.method === "GET") {
      return json({ ok: true, settings: parseSettings(auth.user.settings_json) });
    }
    if (url.pathname === "/api/settings" && request.method === "PUT") {
      return updateSettings(request, env, auth.user);
    }
    if (url.pathname === "/api/schedule/run" && request.method === "POST") {
      const result = await maybeSchedule(env, auth.user.id);
      return json({ ok: true, schedule: result });
    }
  }

  return json({ ok: false, error: "Not found" }, 404);
}

async function startLarkAuth(request, env) {
  assertConfigured(env);
  const now = Date.now();
  const state = randomId();
  const loginId = randomId();
  const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(64)));
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const redirectUri = `${env.PUBLIC_BASE_URL}${CALLBACK_PATH}`;
  const scopes = env.LARK_OAUTH_SCOPES || "";

  await env.DB.prepare(
    `INSERT INTO oauth_states
      (state, login_id, code_verifier, status, created_at, expires_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`
  )
    .bind(state, loginId, codeVerifier, now, now + 10 * 60 * 1000)
    .run();

  const authUrl = new URL(LARK_AUTH_URL);
  authUrl.searchParams.set("client_id", env.LARK_APP_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  return json({ ok: true, loginId, authUrl: authUrl.toString(), expiresAt: now + 10 * 60 * 1000 });
}

async function handleLarkCallback(request, env, ctx) {
  assertConfigured(env);
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const denied = url.searchParams.get("error");
  const row = await env.DB.prepare("SELECT * FROM oauth_states WHERE state = ?").bind(state).first();

  if (!row || row.expires_at < Date.now()) {
    return htmlPage("Login expired", "Please return to the extension and start login again.", 400);
  }
  if (denied) {
    await markAuthFailed(env, state, denied);
    return htmlPage("Login cancelled", "You can close this tab and try again from the extension.", 400);
  }
  if (!code) {
    await markAuthFailed(env, state, "Missing OAuth code");
    return htmlPage("Login failed", "Lark did not return an authorization code.", 400);
  }

  try {
    const token = await exchangeCode(env, code, row.code_verifier);
    const userInfo = await larkJson("/authen/v1/user_info", {
      method: "GET",
      token: token.access_token,
    });
    const user = await upsertUserFromOAuth(env, token, userInfo.data);
    const sessionToken = await createSession(env, user.id, request.headers.get("User-Agent") || "");
    await env.DB.prepare(
      "UPDATE oauth_states SET status = 'complete', session_token = ?, error = NULL WHERE state = ?"
    )
      .bind(sessionToken, state)
      .run();
    return htmlPage("Reading Block is connected", "You can close this tab and return to Chrome.");
  } catch (err) {
    await markAuthFailed(env, state, err.message || "OAuth failed");
    return htmlPage("Login failed", escapeHtml(err.message || "OAuth failed"), 500);
  }
}

async function pollLarkAuth(request, env) {
  const loginId = new URL(request.url).searchParams.get("login_id") || "";
  const row = await env.DB.prepare("SELECT * FROM oauth_states WHERE login_id = ?").bind(loginId).first();
  if (!row) return json({ ok: false, error: "Unknown login request" }, 404);
  if (row.expires_at < Date.now()) return json({ ok: false, status: "expired" }, 410);
  if (row.status === "failed") return json({ ok: false, status: "failed", error: row.error || "Login failed" });
  if (row.status !== "complete") return json({ ok: true, status: row.status });

  await env.DB.prepare("DELETE FROM oauth_states WHERE login_id = ?").bind(loginId).run();
  return json({ ok: true, status: "complete", sessionToken: row.session_token });
}

async function getMe(env, user) {
  const ensured = await ensureUserBase(env, user.id);
  return json({
    ok: true,
    user: {
      id: ensured.id,
      name: ensured.name,
      openId: ensured.lark_open_id,
      tenantKey: ensured.tenant_key,
      baseUrl: ensured.base_url,
      hasBase: !!ensured.base_table_id,
    },
    settings: parseSettings(ensured.settings_json),
  });
}

async function serveExtensionZip(env, method) {
  if (!env.DOWNLOADS) return json({ ok: false, error: "Downloads bucket is not configured." }, 500);
  const object = method === "HEAD" ? await env.DOWNLOADS.head(EXTENSION_ZIP_KEY) : await env.DOWNLOADS.get(EXTENSION_ZIP_KEY);
  if (!object) return json({ ok: false, error: "Download not found." }, 404);

  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set("Content-Type", "application/zip");
  headers.set("Content-Disposition", `attachment; filename="${EXTENSION_ZIP_KEY}"`);
  headers.set("Cache-Control", "public, max-age=300");
  headers.set("ETag", object.httpEtag || `"${object.etag}"`);
  headers.set("Content-Length", String(object.size));

  return new Response(method === "HEAD" ? null : object.body, { headers });
}

async function listItems(env, user) {
  const rows = await env.DB.prepare(
    `SELECT id, url, title, domain, status, saved_at, read_at, scheduled_start,
            scheduled_end, calendar_event_id, batch_id, base_record_id
       FROM reading_items
      WHERE user_id = ? AND status != 'deleted'
      ORDER BY saved_at DESC
      LIMIT 200`
  )
    .bind(user.id)
    .all();

  return json({ ok: true, items: (rows.results || []).map(fromItemRow) });
}

async function saveItem(request, env, user, ctx) {
  const body = await readJson(request);
  const url = String(body.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return json({ ok: false, error: "Only http/https URLs can be saved." }, 400);

  const title = truncate(String(body.title || url).trim(), 1000);
  const domain = domainOf(url);
  const source = truncate(String(body.source || "chrome-extension").trim(), 100);

  const existing = await env.DB.prepare(
    `SELECT * FROM reading_items
      WHERE user_id = ? AND url = ? AND status IN ('waiting', 'scheduled')
      ORDER BY saved_at DESC
      LIMIT 1`
  )
    .bind(user.id, url)
    .first();
  if (existing) return json({ ok: true, item: fromItemRow(existing), duplicate: true });

  const ensured = await ensureUserBase(env, user.id);
  const token = await getValidAccessToken(env, ensured);
  const now = Date.now();
  const record = await createBaseRecord(env, token, ensured, {
    title,
    url,
    domain,
    status: "waiting",
    savedAt: now,
    source,
  });

  const itemId = randomId();
  await env.DB.prepare(
    `INSERT INTO reading_items
      (id, user_id, base_record_id, url, title, domain, status, saved_at,
       source_device, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?)`
  )
    .bind(itemId, user.id, record.record_id, url, title, domain, now, source, now, now)
    .run();

  ctx.waitUntil(
    maybeSchedule(env, user.id).catch((err) => {
      console.error("reading-block-api schedule failed", err);
    })
  );
  return json({ ok: true, item: { id: itemId, url, title, domain, status: "waiting", savedAt: now } });
}

async function updateSettings(request, env, user) {
  const body = await readJson(request);
  const next = normalizeSettings({ ...parseSettings(user.settings_json), ...(body.settings || body) });
  await env.DB.prepare("UPDATE users SET settings_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(next), Date.now(), user.id)
    .run();
  return json({ ok: true, settings: next });
}

async function updateItem(request, env, user, itemId) {
  const body = await readJson(request);
  const item = await getItemForUser(env, user.id, itemId);
  const read = !!body.read;
  const now = Date.now();
  const nextStatus = read ? "read" : "waiting";
  const readAt = read ? now : null;
  const scheduledStart = read ? item.scheduled_start : null;
  const scheduledEnd = read ? item.scheduled_end : null;
  const calendarEventId = read ? item.calendar_event_id : null;
  const batchId = read ? item.batch_id : null;

  await env.DB.prepare(
    `UPDATE reading_items
        SET status = ?,
            read_at = ?,
            scheduled_start = ?,
            scheduled_end = ?,
            calendar_event_id = ?,
            batch_id = ?,
            updated_at = ?
      WHERE id = ? AND user_id = ?`
  )
    .bind(nextStatus, readAt, scheduledStart, scheduledEnd, calendarEventId, batchId, now, item.id, user.id)
    .run();

  if (item.base_record_id) {
    const ensured = await ensureUserBase(env, user.id);
    const token = await getValidAccessToken(env, ensured);
    await updateBaseRecord(env, token, ensured, item.base_record_id, {
      [BASE_FIELDS.status]: nextStatus,
      [BASE_FIELDS.readAt]: readAt,
      [BASE_FIELDS.scheduledStart]: scheduledStart,
      [BASE_FIELDS.scheduledEnd]: scheduledEnd,
      [BASE_FIELDS.calendarEventId]: calendarEventId,
      [BASE_FIELDS.batchId]: batchId,
    });
  }

  return json({
    ok: true,
    item: fromItemRow({
      ...item,
      status: nextStatus,
      read_at: readAt,
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      calendar_event_id: calendarEventId,
      batch_id: batchId,
    }),
  });
}

async function deleteCloudItem(env, user, itemId) {
  const item = await getItemForUser(env, user.id, itemId);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE reading_items
        SET status = 'deleted',
            updated_at = ?
      WHERE id = ? AND user_id = ?`
  )
    .bind(now, item.id, user.id)
    .run();

  if (item.base_record_id) {
    const ensured = await ensureUserBase(env, user.id);
    const token = await getValidAccessToken(env, ensured);
    await updateBaseRecord(env, token, ensured, item.base_record_id, {
      [BASE_FIELDS.status]: "deleted",
    });
  }

  return json({ ok: true });
}

async function maybeSchedule(env, userId) {
  const lock = await acquireScheduleLock(env, userId);
  if (!lock) return { skipped: true, reason: "lock-held" };

  try {
    let user = await getUserById(env, userId);
    user = await ensureUserBase(env, user.id);
    const settings = parseSettings(user.settings_json);
    const rows = await env.DB.prepare(
      `SELECT * FROM reading_items
        WHERE user_id = ? AND status = 'waiting'
        ORDER BY saved_at ASC
        LIMIT ?`
    )
      .bind(user.id, settings.batchSize)
      .all();

    const batch = rows.results || [];
    if (batch.length < settings.batchSize) {
      return { skipped: true, reason: "not-enough-items", waiting: batch.length };
    }

    const token = await getValidAccessToken(env, user);
    const now = new Date();
    const timeMax = new Date(now);
    timeMax.setDate(timeMax.getDate() + settings.lookaheadDays + 1);
    const calendarId = await ensureCalendarId(env, token, user);
    const busy = await getFreeBusy(token, user.lark_open_id, now.toISOString(), timeMax.toISOString());
    const timeZone = env.DEFAULT_TIME_ZONE || "Asia/Shanghai";
    const blockedDays = await getBlockedDays(env, user.id, now.getTime(), timeMax.getTime(), timeZone);
    const slot = findNextFreeSlotInTimeZone(busy, settings, now, blockedDays, timeZone);
    if (!slot) return { skipped: true, reason: "no-free-slot" };

    const event = await createCalendarEvent(env, token, calendarId, settings, batch, slot);
    const batchId = randomId();
    const recordIds = batch.map((item) => item.base_record_id).filter(Boolean);
    const itemIds = batch.map((item) => item.id);
    const nowMs = Date.now();

    await env.DB.prepare(
      `UPDATE reading_items
          SET status = 'scheduled',
              scheduled_start = ?,
              scheduled_end = ?,
              calendar_event_id = ?,
              batch_id = ?,
              updated_at = ?
        WHERE user_id = ? AND id IN (${itemIds.map(() => "?").join(",")})`
    )
      .bind(slot.start.getTime(), slot.end.getTime(), event.event_id, batchId, nowMs, user.id, ...itemIds)
      .run();

    await Promise.all(
      recordIds.map((recordId) =>
        updateBaseRecord(env, token, user, recordId, {
          [BASE_FIELDS.status]: "scheduled",
          [BASE_FIELDS.scheduledStart]: slot.start.getTime(),
          [BASE_FIELDS.scheduledEnd]: slot.end.getTime(),
          [BASE_FIELDS.calendarEventId]: event.event_id,
          [BASE_FIELDS.batchId]: batchId,
        })
      )
    );

    return {
      scheduled: true,
      eventId: event.event_id,
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      itemCount: batch.length,
    };
  } finally {
    await env.DB.prepare("DELETE FROM schedule_locks WHERE user_id = ?").bind(userId).run();
  }
}

async function ensureUserBase(env, userId) {
  let user = await getUserById(env, userId);
  if (user.base_app_token && user.base_table_id) return user;

  const token = await getValidAccessToken(env, user);
  const base = await larkJson("/bitable/v1/apps", {
    method: "POST",
    token,
    body: {
      name: `Reading Block - ${user.name || "My List"}`,
      time_zone: env.DEFAULT_TIME_ZONE || "Asia/Shanghai",
    },
  });
  const app = base.data?.app;
  if (!app?.app_token) throw new Error("Lark created a Base but returned no app_token.");

  const table = await larkJson(`/bitable/v1/apps/${encodeURIComponent(app.app_token)}/tables`, {
    method: "POST",
    token,
    body: {
      table: {
        name: "Reading Items",
        default_view_name: "All Items",
        fields: baseTableFields(),
      },
    },
  });
  const tableId = table.data?.table_id;
  if (!tableId) throw new Error("Lark created a table but returned no table_id.");

  await env.DB.prepare(
    "UPDATE users SET base_app_token = ?, base_table_id = ?, base_url = ?, updated_at = ? WHERE id = ?"
  )
    .bind(app.app_token, tableId, app.url || null, Date.now(), user.id)
    .run();

  return getUserById(env, user.id);
}

async function ensureCalendarId(env, token, user) {
  if (user.calendar_id) return user.calendar_id;
  const res = await larkJson("/calendar/v4/calendars/primary", { method: "POST", token });
  const entry = res.data?.calendars?.find((it) => it.calendar?.type === "primary") || res.data?.calendars?.[0];
  const calendarId = entry?.calendar?.calendar_id;
  if (!calendarId) throw new Error("Could not resolve your primary Lark calendar.");
  await env.DB.prepare("UPDATE users SET calendar_id = ?, updated_at = ? WHERE id = ?")
    .bind(calendarId, Date.now(), user.id)
    .run();
  return calendarId;
}

async function createBaseRecord(_env, token, user, item) {
  const fields = {
    [BASE_FIELDS.title]: item.title,
    [BASE_FIELDS.url]: { text: item.title, link: item.url },
    [BASE_FIELDS.domain]: item.domain,
    [BASE_FIELDS.status]: item.status,
    [BASE_FIELDS.savedAt]: item.savedAt,
    [BASE_FIELDS.source]: item.source,
  };
  const res = await larkJson(
    `/bitable/v1/apps/${encodeURIComponent(user.base_app_token)}/tables/${encodeURIComponent(
      user.base_table_id
    )}/records`,
    {
      method: "POST",
      token,
      query: { client_token: randomUuid() },
      body: { fields },
    }
  );
  return res.data?.record || {};
}

async function updateBaseRecord(_env, token, user, recordId, fields) {
  return larkJson(
    `/bitable/v1/apps/${encodeURIComponent(user.base_app_token)}/tables/${encodeURIComponent(
      user.base_table_id
    )}/records/${encodeURIComponent(recordId)}`,
    {
      method: "PUT",
      token,
      query: { client_token: randomUuid() },
      body: { fields },
    }
  );
}

async function getFreeBusy(token, openId, start, end) {
  const res = await larkJson("/calendar/v4/freebusy/list", {
    method: "POST",
    token,
    query: { user_id_type: "open_id" },
    body: {
      time_min: start,
      time_max: end,
      user_id: openId,
      include_external_calendar: true,
      only_busy: true,
    },
  });
  return (res.data?.freebusy_list || []).map((b) => ({
    start: b.start_time,
    end: b.end_time,
  }));
}

async function createCalendarEvent(env, token, calendarId, settings, batch, slot) {
  const res = await larkJson(`/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    token,
    query: { idempotency_key: randomId() },
    body: {
      summary: settings.eventTitle,
      description: buildEventDescription(env, batch),
      need_notification: false,
      start_time: { timestamp: unixSeconds(slot.start), timezone: env.DEFAULT_TIME_ZONE || "Asia/Shanghai" },
      end_time: { timestamp: unixSeconds(slot.end), timezone: env.DEFAULT_TIME_ZONE || "Asia/Shanghai" },
      vchat: { vc_type: "no_meeting" },
      free_busy_status: "busy",
      reminders: [{ minutes: settings.reminderMinutes }],
    },
  });
  const event = res.data?.event;
  if (!event?.event_id) throw new Error("Lark created the event but returned no event_id.");
  return event;
}

async function getBlockedDays(env, userId, startMs, endMs, timeZone) {
  const rows = await env.DB.prepare(
    `SELECT scheduled_start
       FROM reading_items
      WHERE user_id = ?
        AND status = 'scheduled'
        AND scheduled_start >= ?
        AND scheduled_start <= ?`
  )
    .bind(userId, startMs, endMs)
    .all();
  return new Set((rows.results || []).map((row) => zonedDateKey(Number(row.scheduled_start), timeZone)));
}

async function exchangeCode(env, code, codeVerifier) {
  const redirectUri = `${env.PUBLIC_BASE_URL}${CALLBACK_PATH}`;
  const res = await fetch(`${LARK_OPEN_API}/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: env.LARK_APP_ID,
      client_secret: env.LARK_APP_SECRET,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  return parseLarkOAuthResponse(await res.json());
}

async function refreshAccessToken(env, refreshToken) {
  const res = await fetch(`${LARK_OPEN_API}/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: env.LARK_APP_ID,
      client_secret: env.LARK_APP_SECRET,
      refresh_token: refreshToken,
    }),
  });
  return parseLarkOAuthResponse(await res.json());
}

async function getValidAccessToken(env, user) {
  if (user.access_token_expires_at > Date.now() + 5 * 60 * 1000) {
    return decryptText(env, user.encrypted_access_token);
  }
  if (!user.encrypted_refresh_token) throw new Error("Lark login expired. Please sign in again.");

  const refreshToken = await decryptText(env, user.encrypted_refresh_token);
  const token = await refreshAccessToken(env, refreshToken);
  await updateUserTokens(env, user.id, token);
  return token.access_token;
}

async function upsertUserFromOAuth(env, token, info) {
  const now = Date.now();
  const openId = info.open_id;
  if (!openId) throw new Error("Lark user_info returned no open_id.");
  const existing = await env.DB.prepare("SELECT id FROM users WHERE lark_open_id = ?").bind(openId).first();
  const userId = existing?.id || randomId();
  const settingsJson = JSON.stringify(DEFAULT_SETTINGS);
  const encryptedAccess = await encryptText(env, token.access_token);
  const encryptedRefresh = token.refresh_token ? await encryptText(env, token.refresh_token) : null;
  const accessExpiresAt = now + token.expires_in * 1000;
  const refreshExpiresAt = token.refresh_token_expires_in
    ? now + token.refresh_token_expires_in * 1000
    : null;

  if (existing) {
    await env.DB.prepare(
      `UPDATE users
          SET lark_union_id = ?, tenant_key = ?, name = ?, email = ?,
              encrypted_access_token = ?, encrypted_refresh_token = ?,
              access_token_expires_at = ?, refresh_token_expires_at = ?,
              token_scope = ?, updated_at = ?
        WHERE id = ?`
    )
      .bind(
        info.union_id || null,
        info.tenant_key || null,
        info.name || null,
        info.email || null,
        encryptedAccess,
        encryptedRefresh,
        accessExpiresAt,
        refreshExpiresAt,
        token.scope || null,
        now,
        userId
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO users
        (id, lark_open_id, lark_union_id, tenant_key, name, email,
         encrypted_access_token, encrypted_refresh_token, access_token_expires_at,
         refresh_token_expires_at, token_scope, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        userId,
        openId,
        info.union_id || null,
        info.tenant_key || null,
        info.name || null,
        info.email || null,
        encryptedAccess,
        encryptedRefresh,
        accessExpiresAt,
        refreshExpiresAt,
        token.scope || null,
        settingsJson,
        now,
        now
      )
      .run();
  }
  return getUserById(env, userId);
}

async function updateUserTokens(env, userId, token) {
  const now = Date.now();
  const encryptedAccess = await encryptText(env, token.access_token);
  const encryptedRefresh = token.refresh_token ? await encryptText(env, token.refresh_token) : null;
  await env.DB.prepare(
    `UPDATE users
        SET encrypted_access_token = ?,
            encrypted_refresh_token = COALESCE(?, encrypted_refresh_token),
            access_token_expires_at = ?,
            refresh_token_expires_at = COALESCE(?, refresh_token_expires_at),
            token_scope = COALESCE(?, token_scope),
            updated_at = ?
      WHERE id = ?`
  )
    .bind(
      encryptedAccess,
      encryptedRefresh,
      now + token.expires_in * 1000,
      token.refresh_token_expires_in ? now + token.refresh_token_expires_in * 1000 : null,
      token.scope || null,
      now,
      userId
    )
    .run();
}

async function larkJson(path, { method, token, query, body }) {
  const url = new URL(`${LARK_OPEN_API}${path}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || Number(data.code) !== 0) {
    const msg = data.msg || data.error_description || data.error || `Lark API failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function requireSession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw httpError("Missing session token", 401);
  const tokenHash = await sessionTokenHash(env, token);
  const session = await env.DB.prepare("SELECT * FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first();
  if (!session || session.expires_at < Date.now()) throw httpError("Session expired", 401);
  const user = await getUserById(env, session.user_id);
  await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
    .bind(Date.now(), session.id)
    .run();
  return { session, user };
}

async function createSession(env, userId, userAgent) {
  const token = randomId() + randomId();
  const tokenHash = await sessionTokenHash(env, token);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(randomId(), userId, tokenHash, now, now + 90 * 24 * 60 * 60 * 1000, userAgent)
    .run();
  return token;
}

async function acquireScheduleLock(env, userId) {
  const now = Date.now();
  await env.DB.prepare("DELETE FROM schedule_locks WHERE user_id = ? AND locked_until < ?")
    .bind(userId, now)
    .run();
  const res = await env.DB.prepare(
    "INSERT OR IGNORE INTO schedule_locks (user_id, locked_until, created_at) VALUES (?, ?, ?)"
  )
    .bind(userId, now + 2 * 60 * 1000, now)
    .run();
  return (res.meta?.changes || 0) > 0;
}

async function getUserById(env, id) {
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  if (!user) throw httpError("User not found", 404);
  return user;
}

async function getItemForUser(env, userId, itemId) {
  const item = await env.DB.prepare("SELECT * FROM reading_items WHERE id = ? AND user_id = ?")
    .bind(itemId, userId)
    .first();
  if (!item) throw httpError("Item not found", 404);
  return item;
}

async function markAuthFailed(env, state, error) {
  await env.DB.prepare("UPDATE oauth_states SET status = 'failed', error = ? WHERE state = ?")
    .bind(error, state)
    .run();
}

function parseLarkOAuthResponse(data) {
  if (String(data.code) !== "0") {
    throw new Error(data.error_description || data.error || data.msg || "Lark OAuth failed");
  }
  if (!data.access_token) throw new Error("Lark OAuth returned no access_token.");
  return data;
}

function baseTableFields() {
  return [
    { field_name: BASE_FIELDS.title, type: 1, ui_type: "Text" },
    { field_name: BASE_FIELDS.url, type: 15, ui_type: "Url" },
    { field_name: BASE_FIELDS.domain, type: 1, ui_type: "Text" },
    {
      field_name: BASE_FIELDS.status,
      type: 3,
      ui_type: "SingleSelect",
      property: {
        options: [
          { name: "waiting", color: 0 },
          { name: "scheduled", color: 1 },
          { name: "read", color: 2 },
          { name: "deleted", color: 3 },
        ],
      },
    },
    { field_name: BASE_FIELDS.savedAt, type: 5, ui_type: "DateTime" },
    { field_name: BASE_FIELDS.readAt, type: 5, ui_type: "DateTime" },
    { field_name: BASE_FIELDS.scheduledStart, type: 5, ui_type: "DateTime" },
    { field_name: BASE_FIELDS.scheduledEnd, type: 5, ui_type: "DateTime" },
    { field_name: BASE_FIELDS.calendarEventId, type: 1, ui_type: "Text" },
    { field_name: BASE_FIELDS.batchId, type: 1, ui_type: "Text" },
    { field_name: BASE_FIELDS.source, type: 1, ui_type: "Text" },
  ];
}

function buildEventDescription(env, items) {
  const lines = items.map((it, i) => `${i + 1}. ${it.title}\n   ${it.url}`);
  return [
    "Your reading list for this session:",
    "",
    ...lines,
    "",
    `Open Reading Block: ${env.PUBLIC_BASE_URL || "https://your-worker.example.com"}`,
  ].join("\n");
}

function parseSettings(text) {
  const saved = safeJson(text) || {};
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...saved });
}

function normalizeSettings(settings) {
  return {
    days: Array.isArray(settings.days)
      ? settings.days.map(Number).filter((n) => n >= 0 && n <= 6)
      : DEFAULT_SETTINGS.days,
    windowStart: typeof settings.windowStart === "string" ? settings.windowStart : DEFAULT_SETTINGS.windowStart,
    windowEnd: typeof settings.windowEnd === "string" ? settings.windowEnd : DEFAULT_SETTINGS.windowEnd,
    blockMinutes: clampInt(settings.blockMinutes, 5, 240, DEFAULT_SETTINGS.blockMinutes),
    minLeadMinutes: clampInt(settings.minLeadMinutes, 0, 1440, DEFAULT_SETTINGS.minLeadMinutes),
    batchSize: clampInt(settings.batchSize, 1, 20, DEFAULT_SETTINGS.batchSize),
    lookaheadDays: clampInt(settings.lookaheadDays, 1, 60, DEFAULT_SETTINGS.lookaheadDays),
    eventTitle: truncate(String(settings.eventTitle || DEFAULT_SETTINGS.eventTitle), 200),
    reminderMinutes: clampInt(settings.reminderMinutes, -20160, 20160, DEFAULT_SETTINGS.reminderMinutes),
  };
}

function fromItemRow(row) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    domain: row.domain,
    status: row.status,
    read: row.status === "read",
    savedAt: row.saved_at,
    savedAtISO: row.saved_at ? new Date(Number(row.saved_at)).toISOString() : null,
    readAt: row.read_at,
    readAtISO: row.read_at ? new Date(Number(row.read_at)).toISOString() : null,
    scheduledStart: row.scheduled_start,
    scheduledStartISO: row.scheduled_start ? new Date(Number(row.scheduled_start)).toISOString() : null,
    scheduledEnd: row.scheduled_end,
    scheduledEndISO: row.scheduled_end ? new Date(Number(row.scheduled_end)).toISOString() : null,
    calendarEventId: row.calendar_event_id,
    batchId: row.batch_id,
    baseRecordId: row.base_record_id,
    batchedAt: row.scheduled_start ? new Date(Number(row.scheduled_start)).toISOString() : null,
  };
}

function assertConfigured(env) {
  if (!env.PUBLIC_BASE_URL || !/^https:\/\//i.test(env.PUBLIC_BASE_URL)) {
    throw new Error("PUBLIC_BASE_URL must be configured as an https:// URL.");
  }
  if (!env.LARK_APP_ID || env.LARK_APP_ID.startsWith("REPLACE_")) {
    throw new Error("LARK_APP_ID is not configured.");
  }
  if (!env.LARK_APP_SECRET) throw new Error("LARK_APP_SECRET secret is not configured.");
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET secret is not configured.");
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY secret is not configured.");
}

async function encryptText(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env);
  const bytes = new TextEncoder().encode(text);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  return `${base64Url(iv)}.${base64Url(cipher)}`;
}

async function decryptText(env, packed) {
  const [ivText, cipherText] = String(packed || "").split(".");
  if (!ivText || !cipherText) throw new Error("Encrypted token is malformed.");
  const key = await encryptionKey(env);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(ivText) },
    key,
    base64UrlToBytes(cipherText)
  );
  return new TextDecoder().decode(plain);
}

async function encryptionKey(env) {
  const raw = base64ToBytes(env.TOKEN_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (_) {
    return {};
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function withCors(request, response) {
  const origin = request.headers.get("Origin") || "";
  if (!isAllowedCorsOrigin(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.append("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isDisallowedBrowserOrigin(request) {
  const origin = request.headers.get("Origin");
  return !!origin && !isAllowedCorsOrigin(origin);
}

function isAllowedCorsOrigin(origin) {
  return origin.startsWith("chrome-extension://");
}

function htmlPage(title, message, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<body style="font:16px system-ui;margin:48px;line-height:1.5">` +
      `<h1>${escapeHtml(title)}</h1><p>${message}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function randomId() {
  return base64Url(crypto.getRandomValues(new Uint8Array(24)));
}

function randomUuid() {
  return crypto.randomUUID ? crypto.randomUUID() : randomId();
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

function unixSeconds(date) {
  return String(Math.floor(date.getTime() / 1000));
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max) : text;
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function sha256Base64Url(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64Url(new Uint8Array(digest));
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sessionTokenHash(env, token) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlToBytes(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return base64ToBytes(padded);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}
