import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";

function createChrome() {
  const values = {};
  const listeners = {};
  const area = {
    get: async (keys) => Object.fromEntries((keys === null ? Object.keys(values) : typeof keys === "string" ? [keys] : keys).map((key) => [key, values[key]])),
    set: async (items) => { Object.assign(values, items); },
    remove: async (keys) => { for (const key of typeof keys === "string" ? [keys] : keys) delete values[key]; }
  };
  return {
    storage: { local: area, session: area, onChanged: { addListener() {}, removeListener() {} } },
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener(listener) { listeners.message = listener; } } },
    tabs: { onCreated: { addListener(listener) { listeners.created = listener; } } },
    listeners,
    values
  };
}

async function waitFor(check, errors) {
  const deadline = Date.now() + 2500;
  while (!check()) {
    if (errors.length) throw errors[0];
    if (Date.now() >= deadline) throw new Error("Built content script did not finish rendering");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (errors.length) throw errors[0];
}

async function verifyContent(content, html, answerSelector, question, actionId) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(`<!doctype html><title>Bundle startup fixture - ChatGPT</title>${html}`, {
    url: "https://chatgpt.com/c/bundle-check",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  window.chrome = createChrome();
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.Range.prototype.getClientRects = () => [{ left: 80, right: 180, top: 100, bottom: 120, width: 100, height: 20 }];
  window.addEventListener("error", (event) => errors.push(event.error ?? new Error(event.message)));
  window.addEventListener("unhandledrejection", (event) => errors.push(event.reason));

  const answer = window.document.querySelector(answerSelector);
  const parent = answer.parentElement;
  const nativeHtml = answer.innerHTML;
  const citation = answer.querySelector("a");
  const composer = window.document.getElementById("native-composer");
  const nativeAction = window.document.getElementById(actionId);
  const messageId = `message:${answer.getAttribute('data-message-id') || answer.getAttribute('data-chatgpt-selection-message-id')}`;
  let card = { id: 'bundle-tree', rootKey: 'chatgpt:bundle-check', sourceKey: 'chatgpt:bundle-check', sourceUrl: window.location.href, sourceMessageId: messageId, label: 'Native context', collapsed: false, draft: '', createdAt: new Date().toISOString(), targetKey: 'chatgpt:bundle-branch', targetUrl: 'https://chatgpt.com/c/bundle-branch' };
  window.chrome.runtime.sendMessage = async (message) => {
    if (message.type === 'tree:read') return { ok: true, cards: [card], live: { [card.id]: { phase: 'ready', turns: [{ id: 'message:branch-answer', question: 'Explain this term', text: 'A native branch answer', markdown: 'A native [source](https://example.org/branch-source)' }], updatedAt: Date.now() } } };
    if (message.type === 'tree:update') card = { ...card, ...(message.collapsed !== undefined ? { collapsed: message.collapsed } : {}) };
    return { ok: true };
  };
  let nativeClicks = 0;
  nativeAction.addEventListener("click", () => nativeClicks++);
  try {
    assert.equal(typeof window.process, "undefined");
    assert.equal(typeof window.require, "undefined");
    assert.equal(typeof window.Buffer, "undefined");
    window.eval(content);
    const shadow = () => window.document.getElementById("lattice-chatgpt-extension")?.shadowRoot;
    await waitFor(() => shadow()?.querySelector("[aria-label='置顶回答 1']")?.disabled === false, errors);
    const floating = () => shadow()?.querySelector('.floating-tree');
    assert.equal(floating(), null, 'Loading saved cards must not open a popover over the main conversation');
    const openReference = () => answer.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 100, clientY: 110 }));
    openReference();
    await waitFor(() => floating()?.querySelector('.thread-answer'), errors);
    assert.equal(floating().getAttribute('aria-modal'), 'false');
    assert.equal(floating().querySelector('.thread-answer a').href, 'https://example.org/branch-source');
    assert.ok(floating().querySelector('.thread-question').textContent.includes('Explain this term'));
    assert.equal(shadow().querySelectorAll(".answer-card").length, 1);
    assert.ok(shadow().querySelector(".answer-card").textContent.includes(question));
    assert.equal(answer.parentElement, parent);
    assert.equal(answer.innerHTML, nativeHtml);
    assert.equal(answer.querySelector("a"), citation);
    assert.equal(window.document.getElementById("native-composer"), composer);
    nativeAction.click();
    assert.equal(nativeClicks, 1);

    for (const label of ["分支", "思维图"]) {
      [...shadow().querySelectorAll(".tabs button")].find((button) => button.textContent === label).click();
      await waitFor(() => shadow().querySelector(label === "分支" ? ".branch-map .react-flow" : ".mind-map .react-flow"), errors);
    }
    shadow().querySelector("[aria-label='收起工作区']").click();
    await waitFor(() => window.document.documentElement.dataset.latticeOpen === "false", errors);
    assert.equal(answer.dataset.latticeActive, "false");
    // Main-line focus dismisses the surface; the original quote opens it again
    // even when the auxiliary workspace is closed.
    composer.dispatchEvent(new window.Event('focusin', { bubbles: true }));
    await waitFor(() => !floating(), errors);
    openReference();
    await waitFor(() => floating()?.querySelector('.thread-answer'), errors);
    assert.equal(answer.innerHTML, nativeHtml);
    assert.equal(window.document.getElementById('native-composer'), composer);
  } finally { window.close(); }
}

export async function verifyExtensionBundle(directory) {
  const [content, background] = await Promise.all(["content.js", "background.js"].map((file) => readFile(resolve(directory, file), "utf8")));
  // Guarded `typeof process` in React's error fallback is valid. Unreplaced env reads are not.
  for (const script of [content, background]) assert.doesNotMatch(script, /\bprocess\s*\.\s*env\b/, "An extension bundle still depends on process.env");
  await verifyContent(content, `<main><article><div data-message-author-role="user" data-message-id="user-one">Keep native features</div></article><article data-turn-id="turn-one"><div data-message-author-role="assistant" data-message-id="answer-one"><p>Native answer with a <a href="https://example.org/source">citation</a>.</p></div><button id="native-action">Native action</button></article><textarea id="native-composer"></textarea></main>`, "[data-message-id='answer-one']", "Keep native features", "native-action");
  const currentChat = await readFile(new URL("./fixtures/current-chat.html", import.meta.url), "utf8");
  await verifyContent(content, currentChat, "[data-chatgpt-selection-message-id='answer-current']", "Keep current native features", "current-native-action");

  const chrome = createChrome();
  const worker = { chrome, crypto: webcrypto, URL, console };
  assert.equal(typeof worker.process, "undefined");
  runInNewContext(background, worker, { filename: "background.js", timeout: 2500 });
  assert.equal(typeof chrome.listeners.message, "function");
  assert.equal(typeof chrome.listeners.created, "function");
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Built service worker did not respond")), 2500);
    chrome.listeners.message({ type: "presentation:mutate", key: "chatgpt:bundle-check", mutation: { type: "favorite", messageId: "message:answer-one", favorite: true } }, { tab: { id: 1 }, url: "https://chatgpt.com/c/bundle-check" }, (response) => { clearTimeout(timeout); resolve(response); });
  });
  assert.equal(result.ok, true);
  assert.deepEqual([...result.presentation.favorites], ["message:answer-one"]);
  console.log("Built extension verified without Node globals (legacy/current DOM, quote click, floating tree, main-line dismissal, graphs, native controls, service worker).");
}
