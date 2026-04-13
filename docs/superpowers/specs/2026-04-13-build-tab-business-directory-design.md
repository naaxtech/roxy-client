# BUILD Tab — Business Directory & Impact Projects
## Design Spec · 2026-04-13

---

## 1. Scope

Enhance the existing BUILD tab in `apps/mobile` (roxy-client) with:
- Multi-tag chip search for businesses
- Business detail bottom sheet (gallery, links, bookmark)
- Persistent bookmarks (BUILD screen + profile screen)
- Persistent impact project support (DB-backed, trigger-enforced count)
- Business photo gallery (Supabase Storage, max 5 per business)
- "Register your business" permanent footer link

**Explicitly out of scope:**
- In-app business creation (staff-controlled via external form)
- In-app impact project creation (staff-controlled)
- Marketplace / in-app product sales (future session, depends on Stripe Connect)
- Payments on impact project support (deferred until tickets Stripe merges)

---

## 2. Data Layer

### Migrations (reserve numbers 027–030)

**`027_impact_website_url.sql`**
Add `website_url text` column to `impact_projects`.

**`028_user_project_supports.sql`**
```sql
CREATE TABLE user_project_supports (
  user_id    uuid REFERENCES profiles(id) ON DELETE CASCADE,
  project_id uuid REFERENCES impact_projects(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

ALTER TABLE user_project_supports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own supports" ON user_project_supports
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger: keep supporter_count in sync
CREATE OR REPLACE FUNCTION sync_supporter_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE impact_projects
  SET supporter_count = (
    SELECT COUNT(*) FROM user_project_supports
    WHERE project_id = NEW.project_id
  )
  WHERE id = NEW.project_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_supporter_count
AFTER INSERT ON user_project_supports
FOR EACH ROW EXECUTE FUNCTION sync_supporter_count();
```

**`029_user_business_bookmarks.sql`**
```sql
CREATE TABLE user_business_bookmarks (
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, business_id)
);

ALTER TABLE user_business_bookmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own bookmarks" ON user_business_bookmarks
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

**`030_business_photos.sql`**
```sql
CREATE TABLE business_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  url         text NOT NULL,
  sort_order  integer DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- Trigger enforces max 5 photos (more reliable than CHECK subquery under concurrent inserts)
CREATE OR REPLACE FUNCTION enforce_max_photos()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM business_photos WHERE business_id = NEW.business_id) >= 5 THEN
    RAISE EXCEPTION 'Business cannot have more than 5 photos';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_max_photos
BEFORE INSERT ON business_photos
FOR EACH ROW EXECUTE FUNCTION enforce_max_photos();

ALTER TABLE business_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated users read photos" ON business_photos
  FOR SELECT USING (auth.role() = 'authenticated');
-- INSERT/UPDATE/DELETE restricted to staff via service role key only
```

Photos stored in existing `avatars` Supabase Storage bucket under `business-photos/<business_id>/` prefix.

---

## 3. Zustand Store (`buildStore.ts`)

**New state fields:**
```ts
bookmarkedBusinessIds: Set<string>
supportedProjectIds: Set<string>
searchChips: string[]
```

**New actions:**
```ts
toggleBookmark(businessId: string): Promise<void>
  // optimistic: add/remove from set immediately
  // DB: upsert or delete from user_business_bookmarks
  // rollback on failure

supportProject(projectId: string): Promise<void>
  // guard: no-op if already in supportedProjectIds
  // optimistic: add to set, increment supporter_count in local state
  // DB: insert into user_project_supports
  // trigger handles DB count — no manual update needed

setSearchChips(chips: string[]): void
addSearchChip(chip: string): void
  // guard: no duplicate chips (case-insensitive)
removeSearchChip(chip: string): void

loadBookmarks(): Promise<void>
  // fetch user_business_bookmarks for current user → populate set

loadSupports(): Promise<void>
  // fetch user_project_supports for current user → populate set
```

**Search + fetch:**
```ts
loadBusinesses(chips: string[], wlwOnly: boolean): Promise<void>
  // debounced 300ms
  // DB query: name/description/category ilike any active chip (AND per chip)
  // AND is_wlw_owned = true if wlwOnly
  // ORDER BY is_verified DESC, name ASC LIMIT 50
```

---

## 4. Components

All new components in `apps/mobile/components/build/`.

### `ChipSearchBar.tsx`
- Text input + enter/submit adds chip
- Chip row: horizontal `ScrollView` below input
- Duplicate chip guard (case-insensitive)
- Each chip renders as `SearchChip`

### `SearchChip.tsx`
- Pill with label + `×` button
- `onRemove(chip)` callback

### `BusinessDetailSheet.tsx`
Bottom sheet (React Native `Modal` with slide-up animation, no new package).

Layout:
```
[ Logo/Initial ]  Business Name  [ 💜 Bookmark ]
★ Verified WLW Business  (if is_verified)
📍 City  (if set)
────────────────────────────────
BusinessPhotoGallery  (if photos exist)
────────────────────────────────
Description  (if set)

🔗 Links  (section only shown if any link exists)
  🌐 Website        →
  📸 @instagram     →
```
- Null fields omitted entirely (no empty rows)
- Links open via `Linking.openURL`

### `BusinessPhotoGallery.tsx`
- Horizontal `ScrollView` of image thumbnails
- Tap → full-screen `Modal` showing the image at full width (no pinch-to-zoom — deferred)
- Max 5 images per DB constraint
- Graceful empty state: component not rendered if no photos

---

## 5. BUILD Screen Changes (`apps/mobile/app/(tabs)/build/index.tsx`)

**Businesses segment:**
- Replace plain `TextInput` with `ChipSearchBar`
- Add "All" / "Saved" segment toggle above grid
  - "Saved" filters `businesses` to `bookmarkedBusinessIds` only
- `loadBusinesses()` re-fires on chip change (debounced 300ms) and WLW toggle change
- Tap business card → open `BusinessDetailSheet`
- `ListFooterComponent`:
  ```
  Want your business listed here?
  → Register your business  (opens external URL)
  ```
  URL stored as `REGISTER_BUSINESS_URL` constant in `apps/mobile/constants/config.ts` (not hardcoded inline).
  Always visible. When results empty, this is the natural empty state — no separate empty state component needed.

**Impact segment:**
- `loadSupports()` called on mount → populates `supportedProjectIds`
- Support button: outline if not supported, filled if in `supportedProjectIds`
- Tap support → `supportProject(projectId)` → optimistic UI update
- Replace `ImpactDetailModal` with `ImpactDetailSheet` (bottom sheet, same content)
- "Payment coming soon" text removed — clean CTA only

---

## 6. Profile Screen Changes

New "Saved Businesses" section:
- Reads `bookmarkedBusinessIds` from `buildStore`
- Fetches business details for those IDs on mount
- Renders compact rows: logo initial + name + category
- Tap → opens `BusinessDetailSheet`
- Empty state: "No saved businesses yet"

---

## 7. Testing

### Unit tests

`store/buildStore.test.ts` (extend existing):
- `toggleBookmark`: adds ID → second call removes it → rollback on DB failure
- `supportProject`: adds to set + increments count → no-op if already supported
- `addSearchChip`: adds chip → duplicate ignored (case-insensitive) → remove works

`components/build/ChipSearchBar.test.tsx`:
- Enter adds chip to row
- Duplicate chip not added
- `×` removes correct chip, others remain

`components/build/BusinessDetailSheet.test.tsx`:
- No gallery rendered when photos array empty
- Max 5 photos rendered
- Null links not rendered
- Bookmark button toggles between filled/outline

### Integration (migration tests)
- `user_project_supports` composite PK rejects duplicate insert
- `user_business_bookmarks` composite PK rejects duplicate insert
- Trigger: insert into `user_project_supports` → `supporter_count` on `impact_projects` increments
- `business_photos` CHECK constraint rejects 6th photo insert
- RLS: user cannot read another user's bookmarks or supports

---

## 8. Conflict Avoidance (concurrent tickets session)

- Migration numbers 027–030 reserved for this feature
- No Stripe or payment code touched
- `types/index.ts` changes (add `business_photos` type) done as final step after tickets merges, or coordinated manually
- No changes to `_layout.tsx`, `package.json`, or shared edge functions

---

## 9. Out of Scope (Future Sessions)

- **Marketplace** — in-app product/service sales per business, Stripe Connect per business, Roxy fee split. Depends on tickets Stripe Connect merging first.
- **Business creation in-app** — staff-controlled via external form only
- **Impact project donations** — payment integration deferred
- **Push notifications** — when a bookmarked business posts or a project hits a milestone
