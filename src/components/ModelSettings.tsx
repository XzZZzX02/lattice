import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { modelApi } from "../lib/ipc";
import type { ModelProfile, ModelProvider, SaveModelProfileInput } from "../types";

interface ModelSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const emptyProfile: SaveModelProfileInput = {
  name: "",
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  model: "",
  apiKey: ""
};

export function ModelSettings({ open, onOpenChange }: ModelSettingsProps) {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [input, setInput] = useState<SaveModelProfileInput>(emptyProfile);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void modelApi.list().then(setProfiles).catch((reason) => setError(String(reason)));
  }, [open]);

  function update<K extends keyof SaveModelProfileInput>(
    key: K,
    value: SaveModelProfileInput[K]
  ) {
    setInput((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const profile = await modelApi.save(input);
      setProfiles((current) => [...current, profile]);
      setInput(emptyProfile);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function testProfile(profile: ModelProfile) {
    setError(null);
    setTestResult(null);
    try {
      const models = await modelApi.test(profile.id);
      setTestResult(`Connected · ${models.length} model${models.length === 1 ? "" : "s"} available`);
    } catch (reason) {
      setError(String(reason));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>Model profiles</Dialog.Title>
          <Dialog.Description>Credentials are stored in macOS Keychain.</Dialog.Description>
          <Dialog.Close className="dialog-close" aria-label="Close"><X size={18} /></Dialog.Close>
          <div className="profile-list">
            {profiles.map((profile) => (
              <div key={profile.id}>
                <strong>{profile.name}</strong>
                <span>{profile.model}</span>
                <button onClick={() => void testProfile(profile)}>Test</button>
              </div>
            ))}
          </div>
          {testResult && <p className="connection-ok" role="status">{testResult}</p>}
          <form className="model-form" onSubmit={submit}>
            <label>Name<input required maxLength={120} value={input.name} onChange={(e) => update("name", e.target.value)} /></label>
            <label>Provider
              <select value={input.provider} onChange={(e) => update("provider", e.target.value as ModelProvider)}>
                <option value="ollama">Ollama</option>
                <option value="openai_compatible">OpenAI-compatible</option>
              </select>
            </label>
            <label>Base URL<input required value={input.baseUrl} onChange={(e) => update("baseUrl", e.target.value)} /></label>
            <label>Model<input required value={input.model} onChange={(e) => update("model", e.target.value)} /></label>
            {input.provider === "openai_compatible" && (
              <label>API key<input type="password" autoComplete="off" value={input.apiKey} onChange={(e) => update("apiKey", e.target.value)} /></label>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit">Save model</button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
