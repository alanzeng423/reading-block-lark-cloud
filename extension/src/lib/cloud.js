import { CLOUD_API_BASE } from "./config.js";

const CLOUD_SESSION_KEY = "cloudSession";

export { CLOUD_API_BASE };

export async function getCloudSession() {
  const data = await chrome.storage.local.get(CLOUD_SESSION_KEY);
  return data[CLOUD_SESSION_KEY] || null;
}

export async function setCloudSession(session) {
  await chrome.storage.local.set({ [CLOUD_SESSION_KEY]: session });
}

export async function clearCloudSession() {
  await chrome.storage.local.remove(CLOUD_SESSION_KEY);
}

export async function startCloudLogin() {
  const start = await fetchJSON("/auth/lark/start", { method: "POST" });
  if (chrome.tabs?.create) await chrome.tabs.create({ url: start.authUrl });
  else globalThis.open?.(start.authUrl, "_blank", "noopener");
  const sessionToken = await pollLogin(start.loginId);
  const session = { sessionToken, connectedAt: new Date().toISOString() };
  await setCloudSession(session);
  return session;
}

export async function getCloudMe() {
  return apiFetch("/api/me");
}

export async function listCloudItems() {
  const data = await apiFetch("/api/items");
  return data.items || [];
}

export async function saveCloudItem({ url, title }) {
  return apiFetch("/api/items/save", {
    method: "POST",
    body: { url, title, source: "chrome-extension" },
  });
}

export async function setCloudItemRead(id, read) {
  const data = await apiFetch(`/api/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { read },
  });
  return data.item;
}

export async function deleteCloudItem(id) {
  return apiFetch(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function updateCloudSettings(settings) {
  const data = await apiFetch("/api/settings", {
    method: "PUT",
    body: { settings },
  });
  return data.settings;
}

async function pollLogin(loginId) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const data = await fetchJSON(`/auth/lark/poll?login_id=${encodeURIComponent(loginId)}`);
    if (data.status === "complete" && data.sessionToken) return data.sessionToken;
    if (data.status === "failed" || data.status === "expired") {
      throw new Error(data.error || `Login ${data.status}`);
    }
    await sleep(1800);
  }
  throw new Error("Login timed out. Please try again.");
}

async function apiFetch(path, opts = {}) {
  const session = await getCloudSession();
  if (!session?.sessionToken) throw new Error("Not connected to Lark cloud sync.");
  return fetchJSON(path, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${session.sessionToken}`,
    },
  });
}

async function fetchJSON(path, opts = {}) {
  const base = String(CLOUD_API_BASE || "").replace(/\/+$/, "");
  const res = await fetch(`${base}${path}`, {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Cloud API error (${res.status})`);
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
