import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";

const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

test("authenticated cloud saves create Base records and schedule a Lark event", async () => {
  const sessionToken = "test-session-token";
  const env = await makeEnv(sessionToken);
  const ctx = makeCtx();
  const lark = installFakeLark();

  try {
    for (let i = 1; i <= 5; i++) {
      const res = await worker.fetch(
        jsonRequest("/api/items/save", {
          url: `https://example.com/article-${i}`,
          title: `Article ${i}`,
        }, sessionToken),
        env,
        ctx
      );
      await assertOk(res);
      await ctx.drain();
    }

    assert.equal(env.DB.tables.users[0].base_app_token, "base-token-1");
    assert.equal(env.DB.tables.users[0].base_table_id, "table-1");
    assert.equal(env.DB.tables.users[0].calendar_id, "primary-calendar-1");
    assert.equal(lark.recordCreates.length, 5);
    assert.equal(lark.events.length, 1);
    assert.equal(lark.recordUpdates.length, 5);
    assert.equal(env.DB.tables.reading_items.length, 5);
    assert.equal(env.DB.tables.reading_items.every((item) => item.status === "scheduled"), true);
    assert.equal(env.DB.tables.reading_items.every((item) => item.calendar_event_id === "event-1"), true);

    const list = await worker.fetch(
      new Request("https://reading-block.example.com/api/items", {
        headers: {
          Origin: EXTENSION_ORIGIN,
          Authorization: `Bearer ${sessionToken}`,
        },
      }),
      env,
      ctx
    );
    await assertOk(list);
    const body = await list.json();
    assert.equal(body.items.length, 5);
    assert.equal(body.items.every((item) => item.status === "scheduled"), true);
  } finally {
    lark.restore();
  }
});

function jsonRequest(path, body, sessionToken) {
  return new Request(`https://reading-block.example.com${path}`, {
    method: "POST",
    headers: {
      Origin: EXTENSION_ORIGIN,
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function assertOk(res) {
  if (res.status !== 200) {
    assert.fail(`Expected 200 but got ${res.status}: ${await res.text()}`);
  }
}

async function makeEnv(sessionToken) {
  const sessionHash = await sessionTokenHash("session-secret", sessionToken);
  const accessToken = await encryptText(base64Key(), "lark-access-token");
  const now = Date.now();
  return {
    APP_ENV: "test",
    PUBLIC_BASE_URL: "https://reading-block.example.com",
    LARK_APP_ID: "cli_test",
    LARK_APP_SECRET: "app-secret",
    LARK_OAUTH_SCOPES:
      "offline_access base:app:create base:table:create base:record:create base:record:update calendar:calendar:readonly calendar:calendar.free_busy:read calendar:calendar.event:create",
    DEFAULT_TIME_ZONE: "Asia/Shanghai",
    SESSION_SECRET: "session-secret",
    TOKEN_ENCRYPTION_KEY: base64Key(),
    DB: new FakeD1({
      users: [
        {
          id: "user-1",
          lark_open_id: "ou_user_1",
          lark_union_id: "on_union_1",
          tenant_key: "tenant-1",
          name: "Test User",
          email: "test@example.com",
          encrypted_access_token: accessToken,
          encrypted_refresh_token: null,
          access_token_expires_at: now + 60 * 60 * 1000,
          refresh_token_expires_at: null,
          token_scope: null,
          base_app_token: null,
          base_table_id: null,
          base_url: null,
          calendar_id: null,
          settings_json: JSON.stringify({
            days: [1, 2, 3, 4, 5],
            windowStart: "14:00",
            windowEnd: "18:00",
            blockMinutes: 30,
            minLeadMinutes: 0,
            batchSize: 5,
            lookaheadDays: 14,
            eventTitle: "Reading Block",
            reminderMinutes: 10,
          }),
          created_at: now,
          updated_at: now,
        },
      ],
      sessions: [
        {
          id: "session-1",
          user_id: "user-1",
          token_hash: sessionHash,
          created_at: now,
          expires_at: now + 60 * 60 * 1000,
          last_seen_at: null,
          user_agent: "test",
        },
      ],
      oauth_states: [],
      reading_items: [],
      schedule_locks: [],
    }),
  };
}

function makeCtx() {
  const pending = [];
  return {
    waitUntil(promise) {
      pending.push(promise);
    },
    async drain() {
      while (pending.length) {
        await pending.shift();
      }
    },
  };
}

function installFakeLark() {
  const originalFetch = globalThis.fetch;
  const calls = {
    recordCreates: [],
    recordUpdates: [],
    events: [],
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(init.body) : {};
    if (url.pathname === "/open-apis/bitable/v1/apps") {
      return jsonResponse({ code: 0, data: { app: { app_token: "base-token-1", url: "https://example.larksuite.com/base/base-token-1" } } });
    }
    if (url.pathname === "/open-apis/bitable/v1/apps/base-token-1/tables") {
      return jsonResponse({ code: 0, data: { table_id: "table-1" } });
    }
    if (url.pathname === "/open-apis/bitable/v1/apps/base-token-1/tables/table-1/records" && init.method === "POST") {
      calls.recordCreates.push(body.fields);
      return jsonResponse({ code: 0, data: { record: { record_id: `record-${calls.recordCreates.length}` } } });
    }
    if (url.pathname.startsWith("/open-apis/bitable/v1/apps/base-token-1/tables/table-1/records/") && init.method === "PUT") {
      calls.recordUpdates.push(body.fields);
      return jsonResponse({ code: 0, data: { record: { record_id: url.pathname.split("/").at(-1) } } });
    }
    if (url.pathname === "/open-apis/calendar/v4/calendars/primary") {
      return jsonResponse({
        code: 0,
        data: {
          calendars: [{ calendar: { calendar_id: "primary-calendar-1", type: "primary", role: "owner" } }],
        },
      });
    }
    if (url.pathname === "/open-apis/calendar/v4/freebusy/list") {
      return jsonResponse({ code: 0, data: { freebusy_list: [] } });
    }
    if (url.pathname === "/open-apis/calendar/v4/calendars/primary-calendar-1/events") {
      calls.events.push(body);
      return jsonResponse({ code: 0, data: { event: { event_id: `event-${calls.events.length}` } } });
    }
    throw new Error(`Unexpected fake Lark request: ${init.method || "GET"} ${url.pathname}`);
  };
  return {
    ...calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

class FakeD1 {
  constructor(tables) {
    this.tables = tables;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    if (this.sql === "SELECT * FROM sessions WHERE token_hash = ?") {
      return this.db.tables.sessions.find((row) => row.token_hash === this.args[0]) || null;
    }
    if (this.sql === "SELECT * FROM users WHERE id = ?") {
      return this.db.tables.users.find((row) => row.id === this.args[0]) || null;
    }
    if (this.sql.startsWith("SELECT * FROM reading_items WHERE user_id = ? AND url = ?")) {
      return (
        this.db.tables.reading_items
          .filter((row) => row.user_id === this.args[0] && row.url === this.args[1] && ["waiting", "scheduled"].includes(row.status))
          .sort((a, b) => b.saved_at - a.saved_at)[0] || null
      );
    }
    throw new Error(`Unsupported FakeD1 first SQL: ${this.sql}`);
  }

  async all() {
    if (this.sql.startsWith("SELECT id, url, title, domain, status, saved_at")) {
      return {
        results: this.db.tables.reading_items
          .filter((row) => row.user_id === this.args[0] && row.status !== "deleted")
          .sort((a, b) => b.saved_at - a.saved_at)
          .slice(0, 200),
      };
    }
    if (this.sql.startsWith("SELECT * FROM reading_items WHERE user_id = ? AND status = 'waiting'")) {
      return {
        results: this.db.tables.reading_items
          .filter((row) => row.user_id === this.args[0] && row.status === "waiting")
          .sort((a, b) => a.saved_at - b.saved_at)
          .slice(0, Number(this.args[1])),
      };
    }
    if (this.sql.startsWith("SELECT scheduled_start FROM reading_items")) {
      return {
        results: this.db.tables.reading_items.filter(
          (row) =>
            row.user_id === this.args[0] &&
            row.status === "scheduled" &&
            row.scheduled_start >= this.args[1] &&
            row.scheduled_start <= this.args[2]
        ),
      };
    }
    throw new Error(`Unsupported FakeD1 all SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql === "UPDATE sessions SET last_seen_at = ? WHERE id = ?") {
      const row = this.db.tables.sessions.find((it) => it.id === this.args[1]);
      if (row) row.last_seen_at = this.args[0];
      return changes(row ? 1 : 0);
    }
    if (this.sql.startsWith("UPDATE users SET base_app_token = ?")) {
      const row = this.db.tables.users.find((it) => it.id === this.args[4]);
      Object.assign(row, {
        base_app_token: this.args[0],
        base_table_id: this.args[1],
        base_url: this.args[2],
        updated_at: this.args[3],
      });
      return changes(1);
    }
    if (this.sql === "UPDATE users SET calendar_id = ?, updated_at = ? WHERE id = ?") {
      const row = this.db.tables.users.find((it) => it.id === this.args[2]);
      Object.assign(row, { calendar_id: this.args[0], updated_at: this.args[1] });
      return changes(1);
    }
    if (this.sql.startsWith("INSERT INTO reading_items")) {
      const [id, userId, baseRecordId, url, title, domain, savedAt, sourceDevice, createdAt, updatedAt] = this.args;
      this.db.tables.reading_items.push({
        id,
        user_id: userId,
        base_record_id: baseRecordId,
        url,
        title,
        domain,
        status: "waiting",
        saved_at: savedAt,
        read_at: null,
        scheduled_start: null,
        scheduled_end: null,
        calendar_event_id: null,
        batch_id: null,
        source_device: sourceDevice,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return changes(1);
    }
    if (this.sql === "DELETE FROM schedule_locks WHERE user_id = ? AND locked_until < ?") {
      const before = this.db.tables.schedule_locks.length;
      this.db.tables.schedule_locks = this.db.tables.schedule_locks.filter(
        (row) => !(row.user_id === this.args[0] && row.locked_until < this.args[1])
      );
      return changes(before - this.db.tables.schedule_locks.length);
    }
    if (this.sql === "INSERT OR IGNORE INTO schedule_locks (user_id, locked_until, created_at) VALUES (?, ?, ?)") {
      if (this.db.tables.schedule_locks.some((row) => row.user_id === this.args[0])) return changes(0);
      this.db.tables.schedule_locks.push({ user_id: this.args[0], locked_until: this.args[1], created_at: this.args[2] });
      return changes(1);
    }
    if (this.sql === "DELETE FROM schedule_locks WHERE user_id = ?") {
      const before = this.db.tables.schedule_locks.length;
      this.db.tables.schedule_locks = this.db.tables.schedule_locks.filter((row) => row.user_id !== this.args[0]);
      return changes(before - this.db.tables.schedule_locks.length);
    }
    if (this.sql.startsWith("UPDATE reading_items SET status = 'scheduled'")) {
      const [start, end, eventId, batchId, updatedAt, userId, ...itemIds] = this.args;
      let count = 0;
      for (const row of this.db.tables.reading_items) {
        if (row.user_id === userId && itemIds.includes(row.id)) {
          Object.assign(row, {
            status: "scheduled",
            scheduled_start: start,
            scheduled_end: end,
            calendar_event_id: eventId,
            batch_id: batchId,
            updated_at: updatedAt,
          });
          count++;
        }
      }
      return changes(count);
    }
    throw new Error(`Unsupported FakeD1 run SQL: ${this.sql}`);
  }
}

function changes(count) {
  return { meta: { changes: count } };
}

async function sessionTokenHash(secret, token) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function encryptText(keyText, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawKey = Uint8Array.from(atob(keyText), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
  return `${base64Url(iv)}.${base64Url(cipher)}`;
}

function base64Key() {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
