import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { callEdgeFunction } from './supabase';
import { logError } from './errorLogger';

/**
 * GDPR Art. 15(3) data export — delivery side.
 *
 * The `gdpr-export` edge function already assembles the copy she is entitled
 * to, including the whole invite-gate record (legal name, answers, verification
 * outcomes, appeals, processors) because none of it is readable anywhere else
 * in the app. This module is the half that hands it over: JSON to a file, file
 * to the OS share sheet, browser download on web.
 *
 * PII contract: the payload is the most sensitive object in the product. It is
 * serialised, written, shared, and dropped. It never reaches a console, a
 * breadcrumb, an analytics property, or an error report — only `logError` with
 * the caught error and a context label is allowed on the failure path.
 */

/** Share-sheet surface of expo-sharing, kept minimal so the guarded require can be shape-checked. */
type SharingModule = {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (
    url: string,
    options?: { mimeType?: string; UTI?: string; dialogTitle?: string },
  ) => Promise<void>;
};

/**
 * Shape-check a candidate expo-sharing module. Truthiness is not enough: metro
 * resolves absent native packages to an EMPTY module on web, and an empty
 * object is truthy (CLAUDE.md anti-pattern #3).
 */
export function resolveSharingModule(mod: unknown): SharingModule | null {
  const candidate = (mod as { default?: unknown })?.default ?? mod;
  const shape = candidate as Partial<SharingModule> | null | undefined;
  return typeof shape?.isAvailableAsync === 'function' && typeof shape?.shareAsync === 'function'
    ? (shape as SharingModule)
    : null;
}

// Guarded require — expo-sharing 12.0.1 resolves its native module with
// `requireNativeModule('ExpoSharing')`, which THROWS at import time on any
// binary built before this dependency was added. A bare import would take the
// whole Settings screen down for everyone on an older build instead of
// degrading this one button, so it is guarded exactly like the Daily.co import
// in lib/video/DailyProvider.ts.
// src: https://github.com/expo/expo/blob/sdk-51/packages/expo-sharing/src/ExpoSharing.ts · expo-sharing 12.0.1 · 2026-08-05
let sharing: SharingModule | null = null;
try {
  sharing = resolveSharingModule(require('expo-sharing'));
} catch {
  sharing = null;
}

/**
 * What actually happened to her file. Every branch is a delivery she can
 * verify — there is deliberately no "queued" or "pending" state, because the
 * bug being fixed here was exactly a success message for work nobody had
 * scheduled.
 */
export type DataExportOutcome =
  | { status: 'shared'; fileName: string }
  | { status: 'downloaded'; fileName: string }
  | { status: 'saved'; fileName: string; fileUri: string }
  | { status: 'error'; message: string };

const GENERIC_FAILURE = 'Roxy could not put your data export together. Please try again.';

/** `roxy-data-export-YYYY-MM-DD.json`, in her own timezone so the date matches her day. */
export function exportFileName(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `roxy-data-export-${year}-${month}-${day}.json`;
}

type BrowserGlobals = {
  doc: Pick<Document, 'createElement'>;
  url: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  BlobCtor: typeof Blob;
};

/**
 * expo-file-system has no web implementation — `documentDirectory` and
 * `cacheDirectory` are both null there and `writeAsStringAsync` is
 * unavailable — so web gets an object-URL download instead.
 * src: https://github.com/expo/expo/blob/sdk-51/packages/expo-file-system/src/ExponentFileSystemShim.ts · expo-file-system 17.0.1 · 2026-08-05
 *
 * The DOM globals are typed but not present at runtime on a device, so each one
 * is probed with `typeof` — a bare reference would throw a ReferenceError.
 */
function browserGlobals(): BrowserGlobals | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  if (typeof URL === 'undefined' || typeof Blob === 'undefined') return null;
  if (typeof URL.createObjectURL !== 'function' || typeof URL.revokeObjectURL !== 'function') return null;
  return { doc: document, url: URL, BlobCtor: Blob };
}

function downloadInBrowser(fileName: string, json: string): boolean {
  const browser = browserGlobals();
  if (!browser) return false;

  const objectUrl = browser.url.createObjectURL(
    new browser.BlobCtor([json], { type: 'application/json' }),
  );
  try {
    const anchor = browser.doc.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.click();
  } finally {
    browser.url.revokeObjectURL(objectUrl);
  }
  return true;
}

/**
 * Fetch her export and deliver it as a file.
 *
 * @param now injected only so the filename is assertable without depending on
 *            the day the test runs.
 */
export async function exportUserData(now: Date = new Date()): Promise<DataExportOutcome> {
  const { data, error } = await callEdgeFunction<unknown>('gdpr-export', {});
  if (error || data === null || data === undefined) {
    // The edge function's error strings are developer-authored constants
    // (rate limit, assembly failure) — never payload contents — so this is safe
    // both to log and to show her.
    logError(new Error(`gdpr-export failed: ${error ?? 'empty response'}`), 'dataExport');
    return { status: 'error', message: error ?? GENERIC_FAILURE };
  }

  const fileName = exportFileName(now);

  try {
    const json = JSON.stringify(data, null, 2);

    if (Platform.OS === 'web') {
      if (!downloadInBrowser(fileName, json)) {
        return { status: 'error', message: 'This browser cannot download files. Try Roxy on your phone.' };
      }
      return { status: 'downloaded', fileName };
    }

    // Cache, not documents: the OS can reclaim it, so a file carrying her legal
    // name does not sit in app storage forever after she has saved a copy.
    const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    if (!directory) {
      return { status: 'error', message: 'Roxy could not find anywhere to save the file on this device.' };
    }

    const fileUri = `${directory}${fileName}`;
    await FileSystem.writeAsStringAsync(fileUri, json, { encoding: FileSystem.EncodingType.UTF8 });

    // `sharing` is null on a build that predates the dependency; isAvailableAsync
    // is false where the OS exposes no share sheet.
    const shareSheet = sharing;
    if (shareSheet === null || !(await shareSheet.isAvailableAsync())) {
      return { status: 'saved', fileName, fileUri };
    }

    await shareSheet.shareAsync(fileUri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Your Roxy data export',
    });
    return { status: 'shared', fileName };
  } catch (e) {
    // The caught error only ever describes the filesystem or the share sheet —
    // the payload itself is never passed to a logger.
    logError(e, 'dataExport');
    return { status: 'error', message: GENERIC_FAILURE };
  }
}

/** Alert copy for each outcome. Describes what happened, never what is coming. */
export function describeExportResult(outcome: DataExportOutcome): { title: string; body: string } {
  switch (outcome.status) {
    case 'shared':
      return {
        title: 'Your data is ready',
        body: `Roxy wrote everything to ${outcome.fileName} and opened your share sheet so you could keep a copy.`,
      };
    case 'downloaded':
      return {
        title: 'Your data is ready',
        body: `Roxy downloaded ${outcome.fileName} — check your browser's downloads.`,
      };
    case 'saved':
      return {
        title: 'Saved to this device',
        body: `Roxy wrote everything to ${outcome.fileName}, but this device has no share sheet to pass it to. The file is at:\n\n${outcome.fileUri}`,
      };
    case 'error':
      return { title: 'Export failed', body: outcome.message };
  }
}
