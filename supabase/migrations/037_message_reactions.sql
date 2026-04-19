CREATE TABLE public.message_reactions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    uuid        NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji         text        NOT NULL CHECK (char_length(emoji) <= 8),
  created_at    timestamptz DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reactions_select" ON public.message_reactions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
      WHERE m.id = message_reactions.message_id
        AND auth.uid() = ANY(c.participant_ids)
    )
  );

CREATE POLICY "reactions_insert" ON public.message_reactions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "reactions_delete" ON public.message_reactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX idx_reactions_message ON public.message_reactions (message_id);
CREATE INDEX idx_reactions_user    ON public.message_reactions (user_id);
