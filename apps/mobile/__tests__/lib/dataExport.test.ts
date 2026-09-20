export {};

// jest.mock factories are hoisted above the imports — see CLAUDE.md anti-pattern #2.
// expo-file-system is mocked with __esModule so `import * as FileSystem` keeps a
// live reference to THIS object; without it babel's interop copies the constants
// by value and a per-test override of cacheDirectory would never be seen.
jest.mock('expo-file-system', () => ({
  __esModule: true,
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  writeAsStringAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-sharing', () => ({
  __esModule: true,
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
jest.mock('../../lib/supabase', () => ({
  __esModule: true,
  callEdgeFunction: jest.fn(),
}));
jest.mock('../../lib/errorLogger', () => ({
  __esModule: true,
  logError: jest.fn(),
}));

import { Platform } from 'react-native';
import {
  exportUserData,
  exportFileName,
  describeExportResult,
  resolveSharingModule,
  type DataExportOutcome,
} from '../../lib/dataExport';

const FileSystem = jest.requireMock('expo-file-system');
const Sharing = jest.requireMock('expo-sharing');
const { callEdgeFunction } = jest.requireMock('../../lib/supabase');
const { logError } = jest.requireMock('../../lib/errorLogger');

// Fixed local noon so the filename assertion holds in every CI timezone —
// see .claude/rules/tests.md ("a test must not depend on the day it runs").
const FIXED_NOW = new Date(2026, 7, 5, 12, 0, 0);
const FILE_NAME = 'roxy-data-export-2026-08-05.json';
const FILE_URI = `file:///cache/${FILE_NAME}`;

// The invite-gate record is the reason this export exists: none of it is
// readable anywhere else in the app, and it carries her legal name.
const LEGAL_NAME = 'Rosalind Marguerite Vasquez';
const PAYLOAD = {
  ok: true,
  summary: { profile: 1, messages: 42, posts: 7 },
  membership: {
    legal_name: LEGAL_NAME,
    answers: [{ question: 'Why Roxy?', answer: 'I want a room that is ours' }],
    verification: { outcome: 'approved', reviewed_at: '2026-06-01T09:00:00+00:00' },
    appeals: [{ submitted_at: '2026-05-30T09:00:00+00:00', outcome: 'upheld' }],
    processors: ['supabase', 'stripe'],
  },
  withheld: ['internal_safety_assessment', 'reviewer_access_log'],
};

const originalOS = Platform.OS;

function setOS(os: string): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  FileSystem.cacheDirectory = 'file:///cache/';
  FileSystem.documentDirectory = 'file:///docs/';
  FileSystem.writeAsStringAsync.mockResolvedValue(undefined);
  Sharing.isAvailableAsync.mockResolvedValue(true);
  Sharing.shareAsync.mockResolvedValue(undefined);
  callEdgeFunction.mockResolvedValue({ data: PAYLOAD, error: null });
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.restoreAllMocks();
});

describe('exportFileName', () => {
  it('names the file for the day the export was taken', () => {
    expect(exportFileName(FIXED_NOW)).toBe(FILE_NAME);
  });

  it('zero-pads single-digit months and days so the name sorts', () => {
    expect(exportFileName(new Date(2026, 0, 9, 12, 0, 0))).toBe('roxy-data-export-2026-01-09.json');
  });
});

// expo-sharing resolves its native module with requireNativeModule(), which
// THROWS at import time on a binary built before the dependency was added, and
// metro resolves absent native packages to an EMPTY module on web. Neither may
// reach the share call — the guard is what keeps Settings loadable at all.
describe('resolveSharingModule', () => {
  it('accepts a module that really exposes the share sheet', () => {
    const mod = { isAvailableAsync: jest.fn(), shareAsync: jest.fn() };
    expect(resolveSharingModule(mod)).toBe(mod);
  });

  it('rejects the empty module metro substitutes on web', () => {
    expect(resolveSharingModule({})).toBeNull();
  });

  it('rejects a half-shaped module rather than trusting truthiness', () => {
    expect(resolveSharingModule({ shareAsync: jest.fn() })).toBeNull();
    expect(resolveSharingModule(undefined)).toBeNull();
    expect(resolveSharingModule(null)).toBeNull();
  });
});

describe('exportUserData on a device', () => {
  beforeEach(() => setOS('ios'));

  // The regression this whole module exists for: settings.tsx destructured the
  // edge-function response into `_data` and threw it away, then told her a
  // download was coming that nothing had scheduled.
  it('writes the payload to a file and hands that file to the share sheet', async () => {
    const outcome = await exportUserData(FIXED_NOW);

    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(FILE_URI, expect.any(String), {
      encoding: 'utf8',
    });
    expect(JSON.parse(FileSystem.writeAsStringAsync.mock.calls[0][1])).toEqual(PAYLOAD);
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      FILE_URI,
      expect.objectContaining({ mimeType: 'application/json', UTI: 'public.json' }),
    );
    expect(outcome).toEqual({ status: 'shared', fileName: FILE_NAME });
  });

  // Art. 15(3) is a right to a COPY. Summarising the gate record would defeat
  // the point — she cannot read any of it anywhere else in the app.
  it('keeps the invite-gate record whole rather than summarising it', async () => {
    await exportUserData(FIXED_NOW);

    const written = JSON.parse(FileSystem.writeAsStringAsync.mock.calls[0][1]);
    expect(written.membership).toEqual(PAYLOAD.membership);
    expect(written.withheld).toEqual(PAYLOAD.withheld);
  });

  it('still saves the file when the platform has no share sheet', async () => {
    Sharing.isAvailableAsync.mockResolvedValue(false);

    const outcome = await exportUserData(FIXED_NOW);

    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledTimes(1);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'saved', fileName: FILE_NAME, fileUri: FILE_URI });
  });

  it('surfaces the server refusal instead of claiming success', async () => {
    callEdgeFunction.mockResolvedValue({ data: null, error: 'Rate limit exceeded' });

    const outcome = await exportUserData(FIXED_NOW);

    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'error', message: 'Rate limit exceeded' });
  });

  it('treats an empty response as a failure, not an empty export', async () => {
    callEdgeFunction.mockResolvedValue({ data: null, error: null });

    const outcome = await exportUserData(FIXED_NOW);

    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(outcome.status).toBe('error');
  });

  it('reports a write failure instead of promising a file that does not exist', async () => {
    FileSystem.writeAsStringAsync.mockRejectedValue(new Error('ENOSPC: no space left on device'));

    const outcome = await exportUserData(FIXED_NOW);

    expect(outcome.status).toBe('error');
    expect(logError).toHaveBeenCalledWith(expect.any(Error), 'dataExport');
  });

  it('fails cleanly when the device exposes no writable directory', async () => {
    FileSystem.cacheDirectory = null;
    FileSystem.documentDirectory = null;

    const outcome = await exportUserData(FIXED_NOW);

    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(outcome.status).toBe('error');
  });
});

describe('exportUserData PII handling', () => {
  beforeEach(() => setOS('android'));

  // This payload is the most sensitive object in the product. The only place it
  // is allowed to land is the file the user receives.
  it('never routes the payload through a console sink', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );

    await exportUserData(FIXED_NOW);

    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs a failure without carrying any payload contents into the log', async () => {
    FileSystem.writeAsStringAsync.mockRejectedValue(new Error('disk full'));

    await exportUserData(FIXED_NOW);

    expect(logError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(LEGAL_NAME);
    expect(JSON.stringify(logError.mock.calls)).not.toContain('Why Roxy?');
  });
});

describe('exportUserData in a browser', () => {
  const originalDocument = (globalThis as { document?: unknown }).document;
  const originalUrl = (globalThis as { URL?: unknown }).URL;
  let anchor: { href: string; download: string; click: jest.Mock };
  let createdBlob: { parts: string[]; type: string } | null;

  class FakeBlob {
    constructor(parts: string[], options?: { type?: string }) {
      createdBlob = { parts, type: options?.type ?? '' };
    }
  }

  beforeEach(() => {
    setOS('web');
    createdBlob = null;
    anchor = { href: '', download: '', click: jest.fn() };
    (globalThis as { document?: unknown }).document = { createElement: jest.fn(() => anchor) };
    (globalThis as { URL?: unknown }).URL = {
      createObjectURL: jest.fn(() => 'blob:roxy-export'),
      revokeObjectURL: jest.fn(),
    };
    (globalThis as { Blob?: unknown }).Blob = FakeBlob;
  });

  afterEach(() => {
    (globalThis as { document?: unknown }).document = originalDocument;
    (globalThis as { URL?: unknown }).URL = originalUrl;
  });

  it('downloads the file through the browser rather than app storage', async () => {
    const outcome = await exportUserData(FIXED_NOW);

    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(anchor.download).toBe(FILE_NAME);
    expect(anchor.href).toBe('blob:roxy-export');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(createdBlob?.type).toBe('application/json');
    expect(JSON.parse(createdBlob?.parts[0] ?? '{}')).toEqual(PAYLOAD);
    expect(outcome).toEqual({ status: 'downloaded', fileName: FILE_NAME });
  });

  it('fails loudly when the browser cannot build a download', async () => {
    delete (globalThis as { document?: unknown }).document;

    const outcome = await exportUserData(FIXED_NOW);

    expect(outcome.status).toBe('error');
  });
});

describe('describeExportResult', () => {
  const outcomes: DataExportOutcome[] = [
    { status: 'shared', fileName: FILE_NAME },
    { status: 'downloaded', fileName: FILE_NAME },
    { status: 'saved', fileName: FILE_NAME, fileUri: FILE_URI },
  ];

  // The old copy said "Download will be available shortly" for a download that
  // was never scheduled. Never promise a future delivery again.
  it('never promises a delivery that is not already done', () => {
    outcomes.forEach((outcome) => {
      const { body } = describeExportResult(outcome);
      expect(body).not.toMatch(/shortly|will be (available|ready)|coming soon/i);
      expect(body).toContain(FILE_NAME);
    });
  });

  it('tells her where an unshared file actually is', () => {
    const { body } = describeExportResult({
      status: 'saved',
      fileName: FILE_NAME,
      fileUri: FILE_URI,
    });
    expect(body).toContain(FILE_URI);
  });

  it('passes the failure reason straight through', () => {
    const { title, body } = describeExportResult({ status: 'error', message: 'Rate limit exceeded' });
    expect(title).toBeTruthy();
    expect(body).toContain('Rate limit exceeded');
  });
});
