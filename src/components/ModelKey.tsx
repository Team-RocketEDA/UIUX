import { useEffect, useState, type FormEvent } from "react";
import { api, type ModelKeyStatus } from "../api";
import { Icon } from "./icons";

// Where you bring your Meta Model API key. The server keeps it in a private file and restarts the agent with
// it. It never comes back to the browser, so this only ever shows whether there is one.
export function useModelKey() {
  const [status, setStatus] = useState<ModelKeyStatus>();
  useEffect(() => {
    void api.modelKey().then(setStatus).catch(() => undefined);
  }, []);
  return { status, setStatus };
}

export function ModelKeyForm({ status, onChange }: { status?: ModelKeyStatus; onChange: (status: ModelKeyStatus) => void }) {
  const [value, setValue] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!value.trim() || saving) return;
    setSaving(true);
    setError(undefined);
    setNote(undefined);
    try {
      const saved = await api.saveModelKey(value);
      setValue("");
      setReplacing(false);
      onChange(saved);
      setNote(saved.verified ? "Saved and accepted by Meta's API. The assistant is restarting with it." : "Saved, but Meta's API couldn't check it just now. The assistant is restarting with it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setError(undefined);
    setNote(undefined);
    try {
      onChange(await api.removeModelKey());
      setNote("Removed from this computer.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!status) return null;
  const showForm = !status.configured || replacing;

  return (
    <section className="model-key" aria-label="Meta Model API key">
      <div className="model-key-title">
        <Icon name="lock" size={13} />
        <b>Meta Model API key</b>
        {status.configured && <span className="model-key-state">{status.source === "saved" ? "Saved on this computer" : "From .env"}</span>}
      </div>
      {!status.configured && (
        <p>
          The assistant runs on Meta's Muse models with your own key.{" "}
          <a href="https://dev.meta.ai/docs/authentication" target="_blank" rel="noreferrer">
            Get a key
          </a>
          . It stays on this computer. Everything else in the IDE works without one.
        </p>
      )}
      {showForm ? (
        <form onSubmit={(event) => void save(event)}>
          <input
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Paste your key"
            autoComplete="off"
            spellCheck={false}
            aria-label="Meta Model API key"
          />
          <button className="btn primary" type="submit" disabled={!value.trim() || saving}>
            {saving ? "Checking…" : "Save"}
          </button>
          {replacing && (
            <button className="btn" type="button" onClick={() => setReplacing(false)}>
              Cancel
            </button>
          )}
        </form>
      ) : (
        <div className="model-key-actions">
          <button className="btn" onClick={() => setReplacing(true)}>
            Replace
          </button>
          {status.source === "saved" && (
            <button className="btn" onClick={() => void remove()}>
              Remove
            </button>
          )}
        </div>
      )}
      {error && <p className="model-key-error">{error}</p>}
      {note && <p className="model-key-note">{note}</p>}
    </section>
  );
}
