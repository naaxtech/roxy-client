-- supabase/migrations/006_build_tab.sql

CREATE TABLE public.businesses (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name             text    NOT NULL,
  description      text,
  category         text,
  location_city    text,
  website_url      text,
  instagram_handle text,
  logo_url         text,
  is_verified      boolean NOT NULL DEFAULT false,
  is_wlw_owned     boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.impact_projects (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id      uuid    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title           text    NOT NULL,
  description     text,
  category        text    NOT NULL DEFAULT 'mutual_aid'
                          CHECK (category IN ('mutual_aid','visibility','education','safety')),
  goal_amount     numeric,
  raised_amount   numeric NOT NULL DEFAULT 0,
  supporter_count integer NOT NULL DEFAULT 0,
  status          text    NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','completed','paused')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.businesses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impact_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "biz_select"    ON public.businesses      FOR SELECT TO authenticated USING (true);
CREATE POLICY "biz_insert"    ON public.businesses      FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "biz_update"    ON public.businesses      FOR UPDATE TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "biz_delete"    ON public.businesses      FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE POLICY "impact_select" ON public.impact_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "impact_insert" ON public.impact_projects FOR INSERT TO authenticated WITH CHECK (creator_id = auth.uid());
CREATE POLICY "impact_update" ON public.impact_projects FOR UPDATE TO authenticated USING (creator_id = auth.uid());
CREATE POLICY "impact_delete" ON public.impact_projects FOR DELETE TO authenticated USING (creator_id = auth.uid());

CREATE INDEX idx_biz_wlw       ON public.businesses(is_wlw_owned);
CREATE INDEX idx_biz_category  ON public.businesses(category);
CREATE INDEX idx_impact_status ON public.impact_projects(status);

DO $$
DECLARE v_owner uuid;
BEGIN
  SELECT id INTO v_owner FROM public.profiles LIMIT 1;
  IF v_owner IS NOT NULL THEN
    INSERT INTO public.businesses (owner_id, name, description, category, location_city, is_wlw_owned, is_verified)
    VALUES
      (v_owner, 'Lavender Books', 'Queer bookshop and community space', 'retail', 'London', true, true),
      (v_owner, 'Wildflower Studio', 'Photography for the queer community', 'creative', 'Manchester', true, false),
      (v_owner, 'Queerly Coaching', 'Life coaching for LGBTQ+ professionals', 'services', 'Remote', true, false);

    INSERT INTO public.impact_projects (creator_id, title, description, category, goal_amount, raised_amount, supporter_count, status)
    VALUES
      (v_owner, 'Safety Fund for Trans Women', 'Emergency housing and legal support fund', 'safety', 5000, 1250, 23, 'active'),
      (v_owner, 'Queer Visibility Zine', 'Community-made zine distributed at Pride events', 'visibility', 800, 800, 47, 'completed');
  END IF;
END $$;
