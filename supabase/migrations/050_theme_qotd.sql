-- supabase/migrations/050_theme_qotd.sql

-- 1. Theme preference column on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme_preference text
  NOT NULL DEFAULT 'dark'
  CHECK (theme_preference IN ('light', 'dark'));

-- 2. Question of the Day table
CREATE TABLE IF NOT EXISTS public.questions_of_the_day (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  question      text        NOT NULL CHECK (char_length(question) BETWEEN 10 AND 280),
  source        text        NOT NULL CHECK (source IN ('staff', 'community')),
  community_id  uuid        REFERENCES public.communities(id) ON DELETE CASCADE,
  posted_by     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  active_date   date        NOT NULL DEFAULT current_date,
  answer_count  int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, active_date),
  UNIQUE NULLS NOT DISTINCT (source, community_id, active_date)
);

-- 3. QOTD Answers table
CREATE TABLE IF NOT EXISTS public.qotd_answers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid        NOT NULL REFERENCES public.questions_of_the_day(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content     text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, user_id)
);

-- 4. answer_count sync trigger
CREATE OR REPLACE FUNCTION public.sync_qotd_answer_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.questions_of_the_day
      SET answer_count = answer_count + 1 WHERE id = NEW.question_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.questions_of_the_day
      SET answer_count = GREATEST(0, answer_count - 1) WHERE id = OLD.question_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_qotd_answer_count ON public.qotd_answers;
CREATE TRIGGER trg_qotd_answer_count
  AFTER INSERT OR DELETE ON public.qotd_answers
  FOR EACH ROW EXECUTE FUNCTION public.sync_qotd_answer_count();

-- 5. RLS
ALTER TABLE public.questions_of_the_day ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qotd_answers ENABLE ROW LEVEL SECURITY;

-- Questions: all authenticated users can read
CREATE POLICY "qotd_read" ON public.questions_of_the_day
  FOR SELECT TO authenticated USING (true);

-- Questions: staff can insert global; community admins/mods can insert community-scoped
CREATE POLICY "qotd_staff_insert" ON public.questions_of_the_day
  FOR INSERT TO authenticated
  WITH CHECK (
    (source = 'staff' AND EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_staff = true
    ))
    OR
    (source = 'community' AND community_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = questions_of_the_day.community_id
        AND user_id = auth.uid()
        AND role IN ('admin', 'moderator')
    ))
  );

-- Answers: users read all, insert own, delete own
CREATE POLICY "qotd_answers_read" ON public.qotd_answers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "qotd_answers_insert" ON public.qotd_answers
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "qotd_answers_delete" ON public.qotd_answers
  FOR DELETE TO authenticated USING (user_id = auth.uid());
