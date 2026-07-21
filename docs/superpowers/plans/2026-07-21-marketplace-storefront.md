# Marketplace Storefront Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the popup-based marketplace (BusinessDetailSheet / ProductDetailSheet modals) with a professional, full-screen storefront — a `/business/[id]` shop page and a `/product/[id]` detail page — that reads like a real commerce app (TikTok Shop / Etsy) and is currency-correct for international buyers.

**Architecture:** Root-level Expo Router routes (`app/business/[id].tsx`, `app/product/[id].tsx`) that overlay the tab bar and return to origin on back — the same pattern already proven for `/community/[id]`. Data comes from the existing `useMarketplaceStore` (products, cart, orders) and `useBuildStore` (businesses, bookmarks); no new backend. A new `lib/currency.ts` replaces every hardcoded `$…toFixed(2)` so prices render in the order/business currency.

**Tech Stack:** Expo Router v3, React Native 0.74, TypeScript strict, Zustand, expo-image, expo-linear-gradient, Ionicons, existing Supabase queries + Stripe CheckoutSheet.

## Global Constraints

Every task's requirements implicitly include these. A reviewer treats a violation as a failed spec:

- **Shippable only.** No `TODO`, placeholder text, dead buttons, or stub screens. Every screen handles loading, empty, and error states. If data can be missing, render a real empty state — never a blank or a crash.
- **No emoji as UI chrome.** Icons are vector (`Ionicons`) or gradient icon plates. Emoji is allowed only inside user-generated content (product names, descriptions the seller typed). Replace any `📷 🛒 ✓ ★` UI emoji with vector equivalents.
- **Currency is never hardcoded.** Use `formatMoney(cents, currency)` (Task 1). Default currency for a business/order is its stored `currency` field (orders have `currency`; when absent default `'usd'`). Never write `` `$${(x/100).toFixed(2)}` ``.
- **Animations:** routes are screens (no modal animation). Any in-screen popovers use `usePopIn` (pop, not fade, not slide-up drawer).
- **Web-responsive:** wrap width math in `useAppWidth()`; images `maxWidth: '100%'`; horizontal content scrolls in its own container. The app already renders inside `WebAppFrame`.
- **Back navigation:** `const goBack = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/build')`. Cold deep links must not dead-end.
- **RLS respected:** reads only through the existing store methods / `supabase` queries already used by the modals. No new direct writes outside the store.
- **Accessibility:** every icon-only button has `accessibilityLabel`; touch targets ≥ 44px.

## Interfaces (already exist — do not redefine)

- `useMarketplaceStore` (`store/marketplaceStore.ts`): `fetchProducts(businessId)`, `productsByBusiness[businessId]: ProductWithVariants[]`, `loadingProducts[businessId]`, `addToCart(businessId, product, variantId, qty)`, `getCartCount(businessId)`, `getCartTotal(businessId)`, `buyNow(...)`, `createOrder(...)`, `cartItems[businessId]: CartItem[]`.
- `useBuildStore` (`store/buildStore.ts`): businesses list, bookmark set, `toggleBookmark`. (Confirm exact names when implementing — read the store.)
- Types (`types/marketplace.ts`): `ProductWithVariants` (`id, business_id, name, description, base_price_cents, category, status, has_variants, product_variants: ProductVariant[], product_photos: ProductPhoto[]`), `ProductVariant` (`id, price_cents, stock, option1_name, option1_value, is_active`), `Order` (`currency, subtotal_cents, shipping_cost_cents, tax_cents, platform_fee_cents, total_cents`), `ShippingAddress` (`name, line1, line2, city, state, postal_code, country`).
- `types` `Business`: `id, name, description, is_wlw_owned, is_verified, location_city, website_url, instagram_handle, logo_url?` (confirm fields when implementing).
- Existing components to reuse: `BusinessPhotoGallery`, `ProductCard`, `CartDrawer`, `CheckoutSheet`, `OrderConfirmationSheet`.

---

### Task 1: `lib/currency.ts` — international money formatting

**Files:**
- Create: `apps/mobile/lib/currency.ts`
- Test: `apps/mobile/__tests__/lib/currency.test.ts`

**Interfaces — Produces:**
- `formatMoney(cents: number, currency?: string): string` — divides by 100, formats with the currency's symbol and grouping via `Intl.NumberFormat`. `formatMoney(2000)` → `"$20.00"`; `formatMoney(2000, 'gbp')` → `"£20.00"`; `formatMoney(150000, 'eur')` → `"€1,500.00"`. Unknown/empty currency falls back to `'usd'`.
- `currencyCode(currency?: string): string` — normalized upper-case ISO code (`'usd'` → `'USD'`), default `'USD'`.

- [ ] **Step 1: Write failing test** `__tests__/lib/currency.test.ts` asserting: `formatMoney(2000)==='$20.00'`, `formatMoney(2000,'gbp')==='£20.00'`, `formatMoney(150000,'eur')` contains `'1,500.00'` and `'€'`, `formatMoney(0)==='$0.00'`, `formatMoney(999,'USD')==='$9.99'`, and that an unknown currency `'xxx'`/`''`/`undefined` does not throw and falls back to a `$` result.
- [ ] **Step 2: Run test, verify it fails** (`npx jest currency -t formatMoney`).
- [ ] **Step 3: Implement** using `new Intl.NumberFormat('en', { style: 'currency', currency: code })`. Guard: wrap in try/catch; on RangeError (bad currency code) fall back to `'USD'`. This runs on Hermes + web; `Intl.NumberFormat` currency is supported in Expo 51 (Hermes intl enabled). If a currency the runtime can't render is passed, the try/catch keeps it from crashing.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** `feat(marketplace): currency-aware money formatting helper`.

---

### Task 2: `/business/[id]` — full storefront route

**Files:**
- Create: `apps/mobile/app/business/[id].tsx`
- Modify: `apps/mobile/app/(tabs)/build/index.tsx` (business card `onPress` → `router.push('/business/'+id)`; stop opening `BusinessDetailSheet` as the primary path)
- Reuse: `components/build/BusinessPhotoGallery`, `components/build/ProductCard`, `lib/currency`

**Interfaces — Consumes:** `formatMoney` (Task 1). **Produces:** the `/business/[id]` route; storefront pushes `/product/[id]` (Task 3) on product tap.

**Storefront structure (must all render, with states):**
1. Sticky header: back (vector `arrow-back`), share (`share-outline` → `Share.share`), bookmark (`heart`/`heart-outline`, wired to `useBuildStore` toggle).
2. Hero: gradient banner + logo (or gradient plate with initial), name, verified badge (vector `shield-checkmark` + "Verified WLW Business" when `is_verified`), `location-outline` + city, category chip.
3. Segmented control (pop none — plain tabs): **Shop · About · Photos · Policies**.
4. **Shop**: `fetchProducts(id)` on mount; grid (2-col via `useAppWidth`) of product cards (photo via expo-image, name, `formatMoney(base_price_cents, currency)`); tap → `/product/[id]`. Loading spinner; empty state ("This shop hasn't listed products yet 🌸" is fine — that emoji is copy, but prefer a vector `EmptyState`).
5. **About**: description, WLW/verified, website/instagram rows (vector icons, `Linking.openURL`).
6. **Photos**: `BusinessPhotoGallery`.
7. **Policies** (international commerce clarity): static, honest rows — "Ships internationally where the seller allows", "Secure checkout via Stripe", "Prices shown in {currencyCode}", "Returns handled by the seller — contact before buying". Vector icons. No fabricated guarantees.
8. Bottom cart bar when `getCartCount(id) > 0`: count + `formatMoney(getCartTotal(id), currency)` + "View cart" → opens `CartDrawer` (reuse) which → `CheckoutSheet`.

- [ ] **Step 1:** Read `store/buildStore.ts` + `components/build/BusinessCard`/`ProductCard` + the current `BusinessDetailSheet` to reuse exact data-loading (photos query, bookmark toggle). Confirm `Business` fields + business `currency` source (if none on business, default `'usd'`).
- [ ] **Step 2:** Create `app/business/[id].tsx` implementing the structure above with loading/empty/error states for the business fetch and the products fetch. Root route → overlays tabs; `goBack` per Global Constraints.
- [ ] **Step 3:** In `app/(tabs)/build/index.tsx`, change the business card `onPress` to `router.push('/business/'+item.id)`; leave `BusinessDetailSheet` import only if still used elsewhere (else remove to avoid dead code).
- [ ] **Step 4:** `npx tsc --noEmit` + `npx eslint <changed> --max-warnings 0` clean; `npx jest --ci` still 361+ passing.
- [ ] **Step 5:** Commit `feat(marketplace): full storefront route /business/[id]`.

---

### Task 3: `/product/[id]` — full product detail route

**Files:**
- Create: `apps/mobile/app/product/[id].tsx`
- Modify: `apps/mobile/app/business/[id].tsx` (product tap → `router.push('/product/'+productId)`)
- Reuse: `lib/currency`, `CheckoutSheet`, `useMarketplaceStore`

**Interfaces — Consumes:** `formatMoney`, storefront navigation. Fetch the product: reuse the query shape `ProductWithVariants` (product + `product_variants` + `product_photos`) already used by `ProductDetailSheet`/`fetchProducts`. If the store already has it in `productsByBusiness`, read from there; otherwise fetch by id.

**Structure:** image gallery (horizontal paged via `useAppWidth`, dots), name, `formatMoney(price, currency)` (variant price when selected), category, stock/out-of-stock, description, variant selector (when `has_variants`), qty stepper (1..stock), seller row → `/business/[businessId]`, sticky bottom: **Add to cart** + **Buy now** (→ `CheckoutSheet` with `buyNowItem`). Loading + not-found + out-of-stock states.

- [ ] **Step 1:** Read `ProductDetailSheet.tsx` to reuse the exact variant/qty/price/stock logic and the CheckoutSheet wiring; port it into the route (not a modal).
- [ ] **Step 2:** Create `app/product/[id].tsx`; fetch product by id (with variants + photos) with loading/not-found states; wire add-to-cart (`addToCart`) + buy-now (`CheckoutSheet`).
- [ ] **Step 3:** Wire storefront product cards → `/product/[id]`.
- [ ] **Step 4:** tsc + eslint clean; jest green.
- [ ] **Step 5:** Commit `feat(marketplace): full product detail route /product/[id]`.

---

### Task 4: currency-correct commerce surfaces + retire the modals

**Files:**
- Modify: `components/build/CartDrawer.tsx`, `components/build/CheckoutSheet.tsx`, `components/build/OrderDetailSheet.tsx`, `components/build/ProductCard.tsx`, `components/build/OrderConfirmationSheet.tsx`, `app/(tabs)/build/index.tsx` (impact price copy if any)
- Remove/deprecate: `components/build/BusinessDetailSheet.tsx`, `components/build/ProductDetailSheet.tsx` if no longer referenced (delete only when grep shows zero imports).

**Steps:**
- [ ] **Step 1:** Replace every `` `$${(x/100).toFixed(2)}` `` / `£`/`€` hardcode (14 sites across the 5 files) with `formatMoney(x, order.currency ?? 'usd')`. Checkout/OrderDetail use `order.currency`; ProductCard/Cart use the business/product currency (default `'usd'`).
- [ ] **Step 2:** Confirm CheckoutSheet still shows the subtotal/shipping/tax/total breakdown (it does) and add a one-line "Prices in {currencyCode}" + "Secure checkout · Stripe" note for international clarity. No fabricated tax math — display the values the order already computes.
- [ ] **Step 3:** `grep -rn "BusinessDetailSheet\|ProductDetailSheet" apps/mobile` — if zero non-definition references remain, delete the two modal files; otherwise leave and note in the ledger.
- [ ] **Step 4:** tsc + eslint clean; jest green; `npx expo export --platform web` succeeds.
- [ ] **Step 5:** Commit `refactor(marketplace): currency-correct surfaces; retire detail modals`.

---

## Self-review checklist (run after Task 4)
- Every price on every marketplace screen uses `formatMoney` — grep for `toFixed(2)` in `components/build` and `app/*build*` returns only non-currency uses.
- No `BusinessDetailSheet`/`ProductDetailSheet` modal is the open path; business/product open as routes; back returns correctly.
- Loading, empty, and error states exist on both routes.
- No UI emoji introduced; icons are vector.
- `tsc` clean, `eslint --max-warnings 0` clean, `jest` green, `expo export` succeeds, and a Playwright click-through at 390px + 1280px shows the storefront + product page rendering with real data before any deploy.
