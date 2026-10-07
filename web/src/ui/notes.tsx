import { useI18n } from '../i18n';

// A notification's title and body are translation keys; a parameter that is itself a key is translated too.
export function useNoteText() {
  const { t, has } = useI18n();
  return (n: { title: string; body?: string | null; params?: unknown }) => {
    const raw = (typeof n.params === 'string' ? JSON.parse(n.params) : n.params ?? {}) as Record<string, unknown>;
    const p = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' && /^[a-z_]+\.[a-z_.]+$/.test(v) && has(v) ? t(v) : v]));
    return { title: t(n.title, p), body: n.body ? t(n.body, p) : null };
  };
}
