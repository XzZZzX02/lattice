import type { ExtensionMessage, ExtensionResponse } from "./types";

export interface StorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface Tab { id?: number; openerTabId?: number; active?: boolean }
interface MessageSender { tab?: Tab; url?: string; id?: string }
type MessageListener = (message: ExtensionMessage, sender: MessageSender, respond: (value: ExtensionResponse) => void) => boolean | void;
type StorageListener = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void;

export interface ExtensionPlatform {
  runtime: {
    id?: string;
    sendMessage(message: ExtensionMessage): Promise<ExtensionResponse>;
    onMessage: { addListener(listener: MessageListener): void };
  };
  storage: {
    local: StorageArea;
    session: StorageArea;
    onChanged: { addListener(listener: StorageListener): void; removeListener(listener: StorageListener): void };
  };
  tabs: {
    onCreated: { addListener(listener: (tab: Tab) => void): void };
    create?(properties: { url: string; active: boolean }): Promise<Tab>;
    get?(id: number): Promise<Tab>;
    update?(id: number, properties: { active?: boolean; autoDiscardable?: boolean }): Promise<Tab>;
    sendMessage?(id: number, message: import("./tree-types").SurfaceRequest, options?: { frameId: number }): Promise<ExtensionResponse>;
  };
}

export function platform(): ExtensionPlatform {
  return (globalThis as typeof globalThis & { chrome: ExtensionPlatform }).chrome;
}

export async function request(message: ExtensionMessage): Promise<Extract<ExtensionResponse, { ok: true }>> {
  const result = await platform().runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || "扩展已更新，请刷新 ChatGPT 页面。");
  return result;
}
