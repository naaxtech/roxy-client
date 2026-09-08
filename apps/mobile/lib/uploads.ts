import type { ImagePickerAsset } from 'expo-image-picker';
import { supabase } from './supabase';

/**
 * The single supported way to push a picked image into Supabase Storage.
 *
 * WHY THIS FILE EXISTS — do not "simplify" it back to a Blob.
 *
 * `@supabase/storage-js` takes a Blob down a FormData branch:
 *
 *     if (typeof Blob !== 'undefined' && fileBody instanceof Blob) {
 *       body = new FormData()
 *       body.append('', fileBody)      // <- no content-type header set either
 *     }
 *
 * React Native's FormData only understands `string` and `{uri, name, type}`
 * values. An RN Blob keeps its bytes behind a prototype getter, so `getParts()`
 * spreads it to `{_data: {blobId, offset, size}}` — no `uri`, no `string`, and
 * the bytes never cross the bridge. The two platforms then diverge, which is
 * why this stayed invisible for so long:
 *
 *   iOS     — RCTNetworking finds nothing it recognises and treats the part as
 *             null. The upload "succeeds" and stores a 0-byte object.
 *   Android — NetworkingModule raises "Unrecognized FormData part.", which the
 *             app surfaces as a generic network failure.
 *
 * An ArrayBuffer takes the `else` branch instead, which is also the only branch
 * that applies `options.contentType`. Passing contentType is therefore
 * mandatory, not cosmetic: storage-js defaults to `text/plain;charset=UTF-8`,
 * which makes the object serve wrong and breaks every <Image> pointed at it.
 *
 * src: https://github.com/supabase/supabase-js/blob/23f365cf2acac09f7b51cb507e39c1e57a18f5ea/packages/core/storage-js/src/packages/StorageFileApi.ts · @supabase/storage-js 2.105.4 · 2026-08-02
 * src: https://github.com/facebook/react-native/blob/v0.74.5/packages/react-native/Libraries/Network/FormData.js · react-native 0.74.5 · 2026-08-02
 * src: https://github.com/supabase/supabase/blob/master/examples/user-management/expo-user-management/components/Avatar.tsx · @supabase/supabase-js 2.105.4 · 2026-08-02
 */

/** Why an upload failed, as a stable code safe to log and branch on. */
export type UploadFailureReason =
  | 'read_failed'
  | 'empty_file'
  | 'storage_rejected';

/**
 * An upload failure carrying a stable reason code.
 *
 * The message is deliberately free of the storage path, because that path
 * begins with the user's id (CLAUDE.md §10 — a raw user_id never reaches a log
 * or a third-party sink). Bucket, reason and byte count are all safe.
 */
export class UploadError extends Error {
  readonly reason: UploadFailureReason;
  readonly bucket: string;

  constructor(reason: UploadFailureReason, bucket: string, detail: string) {
    super(`upload ${reason} [bucket=${bucket}] ${detail}`);
    this.name = 'UploadError';
    this.reason = reason;
    this.bucket = bucket;
  }
}

/** Mime types expo-image-picker can hand back, mapped to a canonical extension. */
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
};

const DEFAULT_IMAGE_MIME = 'image/jpeg';
const DEFAULT_IMAGE_EXTENSION = 'jpg';

/** A real file extension: short and alphanumeric. Anything else is not one. */
const PLAUSIBLE_EXTENSION = /^[a-z0-9]{1,5}$/;

/** The content type to store the asset as. Never returns undefined. */
export function assetContentType(asset: Pick<ImagePickerAsset, 'mimeType'>): string {
  const mime = asset.mimeType?.trim().toLowerCase();
  return mime && mime.startsWith('image/') ? mime : DEFAULT_IMAGE_MIME;
}

/**
 * The extension to store the asset under.
 *
 * Derived from the mime type first, because `uri.split('.').pop()` is only a
 * file extension on native. On web `ImagePickerAsset.uri` is a `data:` URI, so
 * that trick returns the entire base64 payload — this is not hypothetical, it
 * put an object named `1785187375676-0.data:image/png;base64,ivborw0kggo…`
 * into the production post-media bucket. The URI is consulted only as a
 * fallback, and only when what it yields actually looks like an extension.
 *
 * src: https://github.com/expo/expo/blob/sdk-51/packages/expo-image-picker/src/ExponentImagePicker.web.ts · expo-image-picker 15.1.0 · 2026-08-02
 */
export function assetExtension(asset: Pick<ImagePickerAsset, 'mimeType' | 'uri'>): string {
  const fromMime = MIME_EXTENSIONS[assetContentType(asset)];
  if (fromMime) return fromMime;

  if (!asset.uri.startsWith('data:')) {
    const tail = asset.uri.split('.').pop()?.split('?')[0]?.toLowerCase();
    if (tail && PLAUSIBLE_EXTENSION.test(tail)) return tail;
  }
  return DEFAULT_IMAGE_EXTENSION;
}

/**
 * Read a local asset URI into bytes.
 *
 * `fetch(uri).arrayBuffer()` is the form used by Supabase's own Expo example
 * and works for `file://` (native) and `data:` (web) alike, so it needs no
 * per-platform branch and no extra dependency.
 */
export async function readAssetBytes(uri: string, bucket: string): Promise<ArrayBuffer> {
  let bytes: ArrayBuffer;
  try {
    bytes = await (await fetch(uri)).arrayBuffer();
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'unknown read error';
    throw new UploadError('read_failed', bucket, detail);
  }

  // The exact failure this module exists to prevent. Guarding here means a
  // future regression fails loudly at the client instead of quietly storing a
  // 0-byte object that only shows up as a broken image weeks later.
  if (bytes.byteLength === 0) {
    throw new UploadError('empty_file', bucket, 'read produced 0 bytes');
  }
  return bytes;
}

/**
 * Upload a picked image and return its public URL.
 *
 * `pathPrefix` must be the value the bucket's RLS policy checks as the first
 * path segment — the user's id for `avatars`, `profile-photos` and
 * `post-media`. The policies read
 * `auth.uid()::text = (storage.foldername(name))[1]`, so a wrong prefix is a
 * 403, not a silent mis-file.
 */
export async function uploadImageAsset(params: {
  bucket: string;
  pathPrefix: string;
  fileName: string;
  asset: Pick<ImagePickerAsset, 'mimeType' | 'uri'>;
  upsert: boolean;
}): Promise<string> {
  const { bucket, pathPrefix, fileName, asset, upsert } = params;
  const path = `${pathPrefix}/${fileName}`;
  const bytes = await readAssetBytes(asset.uri, bucket);

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, bytes, { contentType: assetContentType(asset), upsert });

  if (error) {
    throw new UploadError('storage_rejected', bucket, `${error.message} (${bytes.byteLength} bytes)`);
  }
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
