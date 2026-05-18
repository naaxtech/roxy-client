import { Platform } from 'react-native';

const SUPABASE_STORAGE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1`;

type ImageVariant = 'thumb' | 'feed' | 'detail';

const VARIANT_PARAMS: Record<ImageVariant, { width: number; quality: number; format: string }> = {
  thumb:  { width: 120, quality: 60,  format: 'webp' },
  feed:   { width: 400, quality: 75,  format: 'webp' },
  detail: { width: 800, quality: 85,  format: 'webp' },
};

/** Web Image often fails on AVIF transforms; external URLs skip transforms. */
export function getPostImageUrl(path: string, variant: ImageVariant): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const p = VARIANT_PARAMS[variant];
  const format = Platform.OS === 'web' ? 'origin' : p.format;
  const qs = new URLSearchParams({
    width: String(p.width),
    quality: String(p.quality),
    format,
  }).toString();
  return `${SUPABASE_STORAGE_URL}/render/image/public/post-media/${path}?${qs}`;
}

export function getVideoPlaybackUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${SUPABASE_STORAGE_URL}/object/public/post-media/${url}`;
}
