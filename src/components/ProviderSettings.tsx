import { useEffect, useState, type FormEvent } from "react";
import { api, type ModelConfig } from "../api";
import { Icon } from "./icons";

// Where you choose the model provider, model and endpoint. The server keeps the key in a private file and
// restarts the agent with it. It never comes back to the browser, so this only ever shows whether there is one.
export function useModelConfig() {
  const [config, setConfig] = useState<ModelConfig>();
  useEffect(() => {
    void api.modelConfig().then(setConfig).catch(() => undefined);
  }, []);
  return { config, setConfig };
}

const typeLabel = (type: string) => (type === "native" ? "Native provider" : "OpenAI-compatible endpoint");

export function ProviderSettings({ config, onChange }: { config?: ModelConfig; onChange: (config: ModelConfig) => void }) {
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [type, setType] = useState<"native" | "openai-compatible">("native");
  const [baseUrl, setBaseUrl] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [small, setSmall] = useState("");
  const [tutor, setTutor] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();

  useEffect(() => {
    if (!config) return;
    setProvider(config.providerId);
    setModel(config.modelId);
    setType(config.providerType);
    setBaseUrl(config.baseUrl ?? "");
    setName(config.providerName);
    setSmall(config.smallModel === config.modelRef ? "" : config.smallModel);
    setTutor(config.tutorModel === config.modelRef ? "" : config.tutorModel);
    setReviewer(config.reviewerModel === config.modelRef ? "" : config.reviewerModel);
  }, [config]);

  const input = () => ({
    provider_id: provider.trim(),
    model_id: model.trim(),
    provider_type: type,
    base_url: type === "openai-compatible" ? baseUrl.trim() : null,
    provider_name: name.trim() || null,
    small_model: small.trim() || null,
    tutor_model: tutor.trim() || null,
    reviewer_model: reviewer.trim() || null,
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!provider.trim() || !model.trim() || saving) return;
    setSaving(true);
    setError(undefined);
    setNote(undefined);
    try {
      const saved = await api.saveModelConfig({ ...input(), api_key: key.trim() || undefined });
      setKey("");
      onChange(saved as ModelConfig);
      setNote(saved.verified
        ? "Saved, checked with the provider, and the assistant is restarting with it."
        : "Saved. The assistant is restarting; the provider couldn't be checked just now.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!provider.trim() || !model.trim() || testing) return;
    setTesting(true);
    setError(undefined);
    setNote(undefined);
    try {
      const result = await api.testModelConfig({ ...input(), api_key: key.trim() || undefined });
      if (result.ok) setNote(result.message);
      else setError(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  async function removeKey() {
    if (!config) return;
    setError(undefined);
    setNote(undefined);
    try {
      await api.removeModelKey(config.providerId);
      onChange(await api.modelConfig());
      setNote(`Removed the saved key for ${config.providerName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!config) return null;
  return (
    <section className="model-key" aria-label="Model provider">
      <div className="model-key-title">
        <Icon name="lock" size={13} />
        <b>Model provider</b>
        <span className="model-key-state">
          {config.key.configured ? (config.key.source === "saved" ? "Key saved here" : "Key from environment") : "No key"}
        </span>
      </div>
      <p>
        Choose any provider the bundled OpenCode understands, or a custom OpenAI-compatible endpoint. The key
        stays on this computer and never returns to the browser.
      </p>
      <form onSubmit={(event) => void save(event)}>
        <div className="provider-grid">
          <label>
            <span>Provider ID</span>
            <input
              value={provider}
              onChange={(event) => {
                const id = event.target.value;
                setProvider(id);
                if (config.providers[id]) setType("native");
              }}
              list="rocket-provider-ids"
              placeholder="openai, anthropic, meta, custom…"
              spellCheck={false}
              autoComplete="off"
            />
            <datalist id="rocket-provider-ids">
              {Object.entries(config.providers).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
              <option value="meta">Meta Model API</option>
              <option value="custom">Custom OpenAI-compatible endpoint</option>
            </datalist>
          </label>
          <label>
            <span>Model ID</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-5.1, claude-sonnet-4-5, muse-spark-1.3…" spellCheck={false} autoComplete="off" />
          </label>
          <label>
            <span>Connection</span>
            <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
              <option value="native">Native OpenCode provider</option>
              <option value="openai-compatible">OpenAI-compatible endpoint</option>
            </select>
          </label>
          <label>
            <span>Display name (optional)</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={config.providerName} autoComplete="off" />
          </label>
        </div>
        {type === "openai-compatible" && (
          <label>
            <span>API base URL</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://your-api.example.com/v1" spellCheck={false} autoComplete="off" />
          </label>
        )}
        <input
          type="password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={config.key.configured ? "Replace the saved key (leave empty to keep it)" : "Paste the API key"}
          autoComplete="off"
          spellCheck={false}
          aria-label="API key"
        />
        <details className="provider-roles">
          <summary>Per-role models (optional)</summary>
          <p>Leave a field empty to inherit the main model. Write provider/model, or just a model ID for this provider.</p>
          <input value={small} onChange={(event) => setSmall(event.target.value)} placeholder={`Small/helper model (default ${config.smallModel})`} spellCheck={false} />
          <input value={tutor} onChange={(event) => setTutor(event.target.value)} placeholder={`Tutor model (default ${config.tutorModel})`} spellCheck={false} />
          <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder={`Reviewer model (default ${config.reviewerModel})`} spellCheck={false} />
        </details>
        <div className="model-key-actions">
          <button className="btn primary" type="submit" disabled={!provider.trim() || !model.trim() || saving}>
            {saving ? "Checking…" : "Save"}
          </button>
          <button className="btn" type="button" onClick={() => void test()} disabled={!provider.trim() || !model.trim() || testing}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          {config.key.source === "saved" && (
            <button className="btn" type="button" onClick={() => void removeKey()}>
              Remove key
            </button>
          )}
        </div>
      </form>
      <p className="assistant-hint">
        {config.providerName} · {typeLabel(config.providerType)} · {config.modelRef}
      </p>
      {error && <p className="model-key-error">{error}</p>}
      {note && <p className="model-key-note">{note}</p>}
    </section>
  );
}
