// service-worker.js
// ---------------------------------------------------------------------------
// A toolbar click saves the current page. Connected browsers save through the
// self-hosted Worker into Lark Base, where scheduling happens in Cloudflare.
// If cloud sync is unavailable, the page is still kept in local Chrome storage.
// ---------------------------------------------------------------------------

import { addItem, deleteItem } from "./lib/storage.js";
import { getCloudSession, saveCloudItem } from "./lib/cloud.js";

const DASHBOARD = "src/options.html";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "open-list",
      title: "Reading list",
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: "open-settings",
      title: "Settings",
      contexts: ["action"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  const hash = info.menuItemId === "open-settings" ? "#settings" : "#reading-list";
  chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD) + hash });
});

chrome.action.onClicked.addListener((tab) => {
  saveCurrentTab(tab).catch((err) => console.error("Reading Block:", err));
});

async function saveCurrentTab(tab) {
  const url = tab?.url || "";
  if (!/^https?:/i.test(url)) return;
  if (tab.id == null) return;

  const cloudSession = await getCloudSession();
  if (cloudSession?.sessionToken) {
    try {
      await saveCloudItem({ url, title: tab.title });
      showInPageToast(tab.id, { note: "Saved to Lark Base" });
      return;
    } catch (err) {
      console.error("Reading Block: cloud save failed", err);
    }
  }

  const item = await addItem({ url, title: tab.title });
  showInPageToast(tab.id, {
    savedId: item.id,
    note: cloudSession?.sessionToken ? "Saved locally. Reconnect cloud sync." : "Saved locally. Connect Lark to sync.",
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "UNDO_SAVE") return undefined;
  deleteItem(message.id)
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

async function showInPageToast(tabId, opts) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: deepreadToast,
      args: [opts],
    });
  } catch (_) {
    // Some pages forbid injection. The save still happened.
  }
}

function deepreadToast(opts) {
  const HOST_ID = "__readingblock_toast__";
  const old = document.getElementById(HOST_ID);
  if (old) old.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;right:12px;top:12px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });

  const box = document.createElement("div");
  box.style.cssText =
    "display:flex;align-items:center;gap:11px;padding:11px 13px 11px 15px;" +
    "border-radius:12px;background:#f7f1e4;color:#241d13;border:1px solid #d8cbae;" +
    "box-shadow:0 12px 32px -12px rgba(40,30,12,.5);" +
    "font-family:'Avenir Next',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;" +
    "font-size:14px;line-height:1.3;opacity:0;transform:translateY(-10px);" +
    "transition:opacity .22s ease,transform .22s ease;";

  const dot = document.createElement("span");
  dot.style.cssText = "width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:#1c6b54;";

  const text = document.createElement("div");
  const line1 = document.createElement("div");
  line1.textContent = "Saved to Reading Block";
  line1.style.cssText = "font-weight:500;";
  text.append(line1);
  if (opts.note) {
    const line2 = document.createElement("div");
    line2.textContent = opts.note;
    line2.style.cssText = "color:#6d6049;margin-top:2px;font-size:13px;";
    text.append(line2);
  }

  const undo = document.createElement("button");
  undo.textContent = "Undo";
  undo.style.cssText =
    "background:none;border:none;color:#1c6b54;font-weight:700;font-family:inherit;" +
    "font-size:14px;cursor:pointer;padding:4px 6px;border-radius:6px;margin-left:2px;align-self:center;";
  undo.addEventListener("mouseenter", () => (undo.style.background = "rgba(28,107,84,.10)"));
  undo.addEventListener("mouseleave", () => (undo.style.background = "none"));

  if (opts.savedId) box.append(dot, text, undo);
  else box.append(dot, text);
  shadow.append(box);
  document.body.appendChild(host);

  requestAnimationFrame(() => {
    box.style.opacity = "1";
    box.style.transform = "translateY(0)";
  });

  function close() {
    box.style.opacity = "0";
    box.style.transform = "translateY(-10px)";
    setTimeout(() => host.remove(), 260);
  }

  let timer = setTimeout(close, 3000);
  if (opts.savedId) {
    undo.addEventListener("click", () => {
      clearTimeout(timer);
      try {
        chrome.runtime.sendMessage({ type: "UNDO_SAVE", id: opts.savedId });
      } catch (_) {}
      text.replaceChildren(document.createTextNode("Removed"));
      undo.remove();
      timer = setTimeout(close, 1300);
    });
  }
}
