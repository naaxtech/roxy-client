-- 027_impact_website_url.sql
ALTER TABLE impact_projects ADD COLUMN IF NOT EXISTS website_url text;
