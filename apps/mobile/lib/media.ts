const SUPABASE_STORAGE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1`;

type ImageVariant = 'thumb' | 'feed' | 'detail';

const VARIANT_PARAMS: Record<ImageVariant, { width: number; quality: number; format: string }> = {
  thumb:  { width: 120, quality: 60,  format: 'avif' },
  feed:   { width: 400, quality: 75,  format: 'avif' },
  detail: { width: 800, quality: 85,  format: 'avif' },
};

/**
 * Returns a Supabase image transform URL for post media.
 * Swap SUPABASE_STORAGE_URL to Cloudflare Images URL here when migrating — zero component changes.
 */
export function getPostImageUrl(path: string, variant: ImageVariant): string {
  const p = VARIANT_PARAMS[variant];
  const qs = new URLSearchParams({
    width:   String(p.width),
    quality: String(p.quality),
    format:  p.format,
  }).toString();
  return `${SUPABASE_STORAGE_URL}/render/image/public/post-media/${path}?${qs}`;
}
