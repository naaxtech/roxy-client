# Product Photos — Design Spec
**Date:** 2026-04-23
**Apps:** roxy-studio · roxy-client (mobile)
**Status:** Approved

---

## 1. Overview

Business owners on Roxy Studio can upload up to **4 photos per product**. The first photo is the cover (thumbnail shown in product lists). Buyers on the mobile client see a swipeable gallery in the product detail sheet, with Add to Cart and Buy Now actions.

---

## 2. Storage & Data

### Supabase Storage Bucket
- **Bucket:** `product-photos` (public read)
- **File path:** `{business_id}/{product_id}/{uuid}.{ext}`
- **Accepted types:** JPEG, PNG, WebP
- **Max file size:** 5 MB per file
- **RLS:** authenticated business owner can INSERT/DELETE files scoped to their own products

### Database
- `product_photos` table — no schema changes (existing columns: `id, product_id, url, alt_text, position, created_at`)
- `position = 0` = cover photo
- **Trigger update:** `check_product_photo_limit` — change max from 5 → 4
- **Migration:** `044_product_photos_bucket.sql`

---

## 3. Studio — Seller Photo Management

### Product List Table
- Cover photo thumbnail (40×40px) shown next to product name
- If no photos: show category initial placeholder (same as mobile fallback)

### Product Form (create + edit)
Photos section below existing fields:

```
Photos  (3/4)
┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐
│ 🖼️  │ │ 🖼️  │ │ 🖼️  │ │    +     │
│      │ │      │ │      │ │  Add     │
│[COVER]│ │  [✕] │ │  [✕] │ │  Photo   │
└──────┘ └──────┘ └──────┘ └──────────┘
First photo is the cover. Click any photo to make it the cover.
```

**Behaviour:**
- Slot 0 = cover, always first, labelled `COVER`
- Click any non-cover photo → promotes to cover (swaps `position` values with slot 0)
- **[✕]** deletes photo (confirm dialog) and re-sequences remaining positions
- **+ Add Photo** opens file picker; disabled when 4 photos exist
- Upload happens **immediately on file select** (not on form save)
- In-flight upload: spinner overlay on slot
- Upload error: inline message under slot, slot resets to empty
- File validation (client-side): type + size checked before upload starts

### Server Actions (`products/actions.ts`)
- `uploadProductPhoto(productId, file)` — upload to Storage, insert row into `product_photos`
- `deleteProductPhoto(photoId, storagePath)` — delete from Storage + DB, re-sequence positions
- `setCoverPhoto(photoId, productId)` — swap `position` of selected photo with current cover (position 0)

---

## 4. Mobile — Buyer Experience

### Product Card (in BusinessDetailSheet Products tab)
- Shows `product_photos[0].url` as cover thumbnail (already implemented)
- Dot indicators below image if product has >1 photo (e.g. `● ○ ○`)
- No photos → category initial placeholder (already implemented)

### Product Detail Sheet (new component: `ProductDetailSheet.tsx`)
Replaces the existing variant picker modal in `ProductCard`. Opens on card tap.

```
┌─────────────────────────────┐
│                        [✕]  │
│ ┌─────────────────────────┐ │
│ │   ←  [photo 1 of 3]  →  │ │  swipe left/right
│ └─────────────────────────┘ │
│          ●  ○  ○            │  dot indicators
│                             │
│ Handmade Candle Set         │
│ $24.99                      │
│                             │
│ Variant:  [Lavender ▾]      │
│ Qty:      [─]  1  [+]       │
│                             │
│ ┌─────────────────────────┐ │
│ │     Add to Cart  🛒     │  primary (filled)
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │       Buy Now  ⚡       │  secondary (outlined)
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

**Gallery behaviour:**
- Horizontal swipe through photos, dot indicators track position
- 1 photo → no dots, no swipe gesture
- 0 photos → static placeholder, no dots

**Add to Cart:**
- Calls `marketplaceStore.addToCart({ product, variant, quantity })`
- Sheet closes, cart FAB badge increments
- Toast: "Added to cart"

**Buy Now:**
- Does NOT touch the cart (existing cart preserved)
- Opens `CheckoutSheet` directly with a single-item payload `{ product, variant, quantity }`
- On purchase complete: returns to detail sheet (or closes to BusinessDetailSheet)

**Cart management (already built — no changes):**
- `CartDrawer`: qty stepper ([─]/[+]), [Remove] button per item
- Qty → 0 removes item
- `marketplaceStore.updateQuantity()` + `removeFromCart()` already wired

---

## 5. Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/044_product_photos_bucket.sql` | New — bucket + RLS + trigger update |
| `apps/studio/app/(dashboard)/products/page.tsx` | Add cover thumbnail column |
| `apps/studio/app/(dashboard)/products/ProductForm.tsx` | Add Photos section |
| `apps/studio/app/(dashboard)/products/actions.ts` | Add upload/delete/setCover actions |
| `apps/mobile/components/build/ProductCard.tsx` | Add dot indicators, open ProductDetailSheet on tap |
| `apps/mobile/components/build/ProductDetailSheet.tsx` | New — gallery + variant picker + Add to Cart + Buy Now |
| `apps/mobile/store/marketplaceStore.ts` | Add `buyNow()` action |

**No changes:**
- `CartDrawer.tsx`, `CheckoutSheet.tsx`, `OrderConfirmationSheet.tsx`
- `types/marketplace.ts`
- All existing cart store logic

---

## 6. Out of Scope (future)
- Image resizing / CDN (Cloudflare Images)
- NSFW content moderation
- Virus scanning
- Multi-region storage
