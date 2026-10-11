import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

/**
 * Cloudflare Turnstile challenge for the web build (lib/captcha.ts).
 *
 * Renders nothing on native and nothing without a site key. On web it loads
 * Cloudflare's script once, renders the widget into a plain div and reports
 * each fresh token (and `null` when a token expires or errors), so the auth
 * call always carries a live one.
 * src: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ · 2026-10-11
 */

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadScript(): Promise<Turnstile> {
  const w = globalThis as unknown as { turnstile?: Turnstile; document?: Document };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  return new Promise((resolve, reject) => {
    const doc = w.document;
    if (!doc) { reject(new Error('no document')); return; }
    let script = doc.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (!script) {
      script = doc.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      doc.head.appendChild(script);
    }
    script.addEventListener('load', () => (w.turnstile ? resolve(w.turnstile) : reject(new Error('turnstile missing'))));
    script.addEventListener('error', () => reject(new Error('turnstile failed to load')));
  });
}

export function TurnstileWidget({
  siteKey,
  onToken,
  resetKey = 0,
}: {
  siteKey: string | null;
  onToken: (token: string | null) => void;
  /** Bump after each auth attempt: a Turnstile token is single-use. */
  resetKey?: number;
}) {
  const hostRef = useRef<View>(null);
  const widgetId = useRef<string | null>(null);
  const api = useRef<Turnstile | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (Platform.OS !== 'web' || !siteKey) return undefined;
    let cancelled = false;
    loadScript()
      .then((t) => {
        const el = hostRef.current as unknown as HTMLElement | null;
        if (cancelled || !el) return;
        api.current = t;
        widgetId.current = t.render(el, {
          sitekey: siteKey,
          theme: 'auto',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));
    return () => {
      cancelled = true;
      if (api.current && widgetId.current) api.current.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey > 0 && api.current && widgetId.current) {
      onTokenRef.current(null);
      api.current.reset(widgetId.current);
    }
  }, [resetKey]);

  if (Platform.OS !== 'web' || !siteKey) return null;
  return <View ref={hostRef} testID="turnstile-widget" style={{ minHeight: 65, marginTop: 12, alignItems: 'center' }} />;
}
