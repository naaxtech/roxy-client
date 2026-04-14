-- 030_business_photos.sql
CREATE TABLE IF NOT EXISTS business_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  url         text NOT NULL,
  sort_order  integer DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

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
