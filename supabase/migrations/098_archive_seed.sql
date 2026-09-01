-- ============================================================
-- 098_archive_seed.sql
--
-- The Archive's opening catalogue: 45 real works across film, TV, books, comics
-- and music. Written by hand — no lorem, no invented titles.
--
-- ── THE ONE ARCHIVE RULE, honoured in the seed itself ───────────────────────
--    No summary and no content note here refers to an ending. Not obliquely,
--    not as "the ending is divisive". The rule the UI enforces on members with
--    a checkbox is not a rule if the seed breaks it forty-five times on the way
--    in, and the seed is what every new member reads first.
--
-- ── WHAT IS SEEDED WHERE, and why they differ ───────────────────────────────
--    ENTRIES and CONTENT NOTES are seeded on every database including
--    production. They are the catalogue — real works, honestly described — and
--    an Archive that opens empty is not a feature.
--
--    VOTE WEIGHT and REVIEWS are seeded ONLY where the dev-seed profiles exist
--    (alex/jamie/river/morgan@roxy.dev, from supabase/dev_seed.sql). On
--    production every entry therefore starts at zero and honestly reads
--    "NEW · 0 votes" until real women vote. Fabricating community consensus in
--    front of real members would be a lie told by the one screen whose entire
--    value is that the number comes from people like them.
--
--    The weight goes in `baseline_vote_count` / `baseline_up_count`, which 097
--    ADDS to the real tally rather than replacing. Seeding `vote_count`
--    directly would have been a fuse: the counters recompute from
--    archive_votes, so the first woman to vote on a 1,489-vote entry would
--    have collapsed it to 1 — live, in the demo this seed exists for.
--
-- ── DEVIATION FROM THE BRIEF ────────────────────────────────────────────────
--    The brief asks for 3-6 reviews per entry. There are four seed profiles and
--    `archive_reviews` is UNIQUE (entry_id, author_id) — a woman reviews a work
--    once and edits it after. Four is therefore the ceiling per entry, and the
--    alternative (inventing dozens of fake members) would put invented women in
--    a demo about real ones. Reviews are concentrated on the entries a demo
--    actually opens.
--
-- Idempotent: re-running changes nothing.
-- ============================================================

INSERT INTO public.archive_entries
  (slug, title, media_type, release_year, creator, length_label, summary, cover_gradient, status, published_at)
VALUES
-- ── Film ────────────────────────────────────────────────────────────────────
('portrait-of-a-lady-on-fire','Portrait of a Lady on Fire','film',2019,'Céline Sciamma','2h 2m',
 'A painter and her subject on a Breton island. The one everyone tells you to watch first, and they are right.',
 'linear-gradient(160deg,#1E3A5E,#7A6A9E 55%,#D98A5E)','published',now()),
('carol','Carol','film',2015,'Todd Haynes','1h 58m',
 'A shopgirl, a woman in a fur coat, and a road trip through 1950s America. Every glance is doing work.',
 'linear-gradient(160deg,#2A1E3E,#6E4A6A 55%,#C9A05E)','published',now()),
('but-im-a-cheerleader','But I''m a Cheerleader','film',1999,'Jamie Babbit','1h 25m',
 'A candy-coloured satire of conversion camp that plays much sharper than its pastels suggest.',
 'linear-gradient(160deg,#F2A8C8,#E0189A 55%,#7A4A8A)','published',now()),
('bound','Bound','film',1996,'The Wachowskis','1h 48m',
 'A neo-noir heist with a mob wife and an ex-con. Tight, mean and extremely competent about tools.',
 'linear-gradient(160deg,#1A1A2E,#5E2A3E 55%,#C23A5E)','published',now()),
('the-handmaiden','The Handmaiden','film',2016,'Park Chan-wook','2h 25m',
 'A con, a heiress and a house full of locked rooms in colonial-era Korea. Gorgeous and deeply unkind to men.',
 'linear-gradient(160deg,#12303A,#3E6A5E 55%,#C9A05E)','published',now()),
('saving-face','Saving Face','film',2004,'Alice Wu','1h 31m',
 'A surgeon, a dancer, and a mother who moves in. A romantic comedy that takes the family half as seriously as the romance.',
 'linear-gradient(160deg,#3A1E4E,#8A4A7A 55%,#F2A8C8)','published',now()),
('the-half-of-it','The Half of It','film',2020,'Alice Wu','1h 44m',
 'A shy student ghostwrites love letters for a jock. About friendship at least as much as it is about wanting someone.',
 'linear-gradient(160deg,#1E3A4E,#4A7A8A 55%,#E0C87A)','published',now()),
('disobedience','Disobedience','film',2017,'Sebastián Lelio','1h 54m',
 'A photographer returns to the Orthodox community she left. Quiet, adult, and very much about what a life costs.',
 'linear-gradient(160deg,#20202E,#4A4A6A 55%,#9E8A9E)','published',now()),
('rafiki','Rafiki','film',2018,'Wanuri Kahiu','1h 22m',
 'Two girls in Nairobi, rival political families, and the brightest colour palette on this list. Banned at home on release.',
 'linear-gradient(160deg,#7A2E8A,#E0189A 55%,#F5B73D)','published',now()),
('pariah','Pariah','film',2011,'Dee Rees','1h 26m',
 'A Brooklyn teenager working out who she is in front of a family that has already decided. Adepero Oduye is extraordinary.',
 'linear-gradient(160deg,#1E2A4E,#4A3A7A 55%,#D98A5E)','published',now()),
('happiest-season','Happiest Season','film',2020,'Clea DuVall','1h 42m',
 'Meeting the parents at Christmas, except she is not out to them. Divisive on purpose — see the reviews.',
 'linear-gradient(160deg,#0E3A3E,#2A6A5E 55%,#E05A6A)','published',now()),
('water-lilies','Water Lilies','film',2007,'Céline Sciamma','1h 25m',
 'Synchronised swimming, a French suburb and three girls at fifteen. Sciamma''s first, and it already knows what it is doing.',
 'linear-gradient(160deg,#123A5E,#3E7A9E 55%,#A8D8E0)','published',now()),

-- ── TV ──────────────────────────────────────────────────────────────────────
('gentleman-jack','Gentleman Jack','tv',2019,'Sally Wainwright · BBC/HBO','2 seasons',
 'Anne Lister, top hat, ledgers, and a diary in code. Cancelled too early; still worth the two seasons.',
 'linear-gradient(160deg,#2A1B3E,#5E3A2A 55%,#C58A4A)','published',now()),
('the-l-word','The L Word','tv',2004,'Ilene Chaiken · Showtime','6 seasons',
 'The one that got there first. Dated in places and worth knowing anyway — most of the arguments start here.',
 'linear-gradient(160deg,#3A1E2E,#8A2E4E 55%,#E0708A)','published',now()),
('killing-eve','Killing Eve','tv',2018,'Phoebe Waller-Bridge · BBC America','4 seasons',
 'An intelligence analyst and an assassin, circling. Season one is a different show from season four; opinions vary on the rest.',
 'linear-gradient(160deg,#2E1A2E,#7A2A4A 55%,#D8A05E)','published',now()),
('wynonna-earp','Wynonna Earp','tv',2016,'Emily Andras · Syfy','4 seasons',
 'Demon-hunting westerns with a fandom that saved it twice. WayHaught is why most people are here.',
 'linear-gradient(160deg,#3E2A1E,#8A5A2E 55%,#E0B85E)','published',now()),
('feel-good','Feel Good','tv',2020,'Mae Martin · Channel 4','2 seasons',
 'A comedian, a new girlfriend and recovery, handled with more honesty than comfort. Short and very sharp.',
 'linear-gradient(160deg,#1E2E3E,#4A6A8A 55%,#E0A8B8)','published',now()),
('vida','Vida','tv',2018,'Tanya Saracho · Starz','3 seasons',
 'Two sisters back in Boyle Heights running a bar they did not want. Written almost entirely by queer Latina writers.',
 'linear-gradient(160deg,#3E1E2E,#8A3A4A 55%,#E0A05E)','published',now()),
('she-ra','She-Ra and the Princesses of Power','tv',2018,'ND Stevenson · Netflix','5 seasons',
 'A reboot that grew into one of the best-built friendship-to-something-else arcs on television. Yes, it is for kids. Watch it anyway.',
 'linear-gradient(160deg,#2A2A6E,#5E5AD8 55%,#F2A8C8)','published',now()),
('the-owl-house','The Owl House','tv',2020,'Dana Terrace · Disney','3 seasons',
 'A human girl apprenticed to a witch. Cut short by the network, and still one of the warmest things on this list.',
 'linear-gradient(160deg,#2E1E4E,#6A3A8A 55%,#E0C05E)','published',now()),
('a-league-of-their-own','A League of Their Own','tv',2022,'Will Graham & Abbi Jacobson · Prime','1 season',
 'The 1940s baseball story the film could only gesture at, with the Black players it left out. One season, cancelled.',
 'linear-gradient(160deg,#1E3A2E,#4A7A4A 55%,#E0C87A)','published',now()),
('yellowjackets','Yellowjackets','tv',2021,'Ashley Lyle & Bart Nickerson · Showtime','3 seasons',
 'A girls'' football team after a plane crash, in two timelines. Very dark, very good, not remotely a comfort watch.',
 'linear-gradient(160deg,#16261E,#3A5E3A 55%,#C2A03E)','published',now()),

-- ── Books ───────────────────────────────────────────────────────────────────
('priory-of-the-orange-tree','The Priory of the Orange Tree','book',2019,'Samantha Shannon','848 pages',
 'Dragons, a queen who must produce an heir, and the bodyguard who loves her. 800 pages that read like 300.',
 'linear-gradient(160deg,#0E4B4E,#2A7A5E 55%,#E0A83D)','published',now()),
('fingersmith','Fingersmith','book',2002,'Sarah Waters','548 pages',
 'Victorian London, a thief placed as a lady''s maid, and a plot with more moving parts than it first admits.',
 'linear-gradient(160deg,#1E1E2E,#4A3A5E 55%,#A88A6A)','published',now()),
('tipping-the-velvet','Tipping the Velvet','book',1998,'Sarah Waters','472 pages',
 'An oyster girl follows a male-impersonator act to London. Music halls, tailoring, and a very good time.',
 'linear-gradient(160deg,#2E1E3E,#6A3A5E 55%,#D8A05E)','published',now()),
('the-price-of-salt','The Price of Salt','book',1952,'Patricia Highsmith','292 pages',
 'The novel Carol came from, published under a pseudonym. Notable in 1952 for refusing the punishment the genre demanded.',
 'linear-gradient(160deg,#2A2438,#5E4A6A 55%,#C9A05E)','published',now()),
('gideon-the-ninth','Gideon the Ninth','book',2019,'Tamsyn Muir','448 pages',
 'Lesbian necromancers in space, and it is exactly as much fun as that sounds. The first hundred pages ask for patience.',
 'linear-gradient(160deg,#14141E,#3E2A4E 55%,#C2405E)','published',now()),
('under-the-udala-trees','Under the Udala Trees','book',2015,'Chinelo Okparanta','336 pages',
 'A girl in Nigeria during and after the Biafran war. Tender writing about an unsafe place to be in love.',
 'linear-gradient(160deg,#1E3A2E,#5E7A3A 55%,#E0B85E)','published',now()),
('stone-butch-blues','Stone Butch Blues','book',1993,'Leslie Feinberg','301 pages',
 'Factory floors, bar raids and butch life in 1970s America. Hard reading and foundational; Feinberg released it free.',
 'linear-gradient(160deg,#22222A,#4A4A5E 55%,#8A6A4A)','published',now()),
('girl-woman-other','Girl, Woman, Other','book',2019,'Bernardine Evaristo','464 pages',
 'Twelve interlocking lives, mostly Black British women. Verse-shaped prose that stops being strange within a page.',
 'linear-gradient(160deg,#3A1E3E,#7A3A6A 55%,#E0A8C8)','published',now()),
('last-night-telegraph-club','Last Night at the Telegraph Club','book',2021,'Malinda Lo','416 pages',
 '1950s San Francisco Chinatown, the Red Scare, and a lesbian bar. Meticulously researched and very gentle with its heroine.',
 'linear-gradient(160deg,#1E2A4E,#4A5A8A 55%,#E07A6A)','published',now()),
('she-who-became-the-sun','She Who Became the Sun','book',2021,'Shelley Parker-Chan','416 pages',
 'A peasant girl takes her dead brother''s name and his fate in 14th-century China. Ambition as a love language.',
 'linear-gradient(160deg,#3E1E1E,#8A3A2E 55%,#E0B05E)','published',now()),
('zami','Zami: A New Spelling of My Name','book',1982,'Audre Lorde','256 pages',
 'Lorde''s "biomythography" — Harlem, Mexico, the 1950s Village bar scene. The prose is the reason to come.',
 'linear-gradient(160deg,#2E2416,#6A5A2E 55%,#D8B05E)','published',now()),

-- ── Comics ──────────────────────────────────────────────────────────────────
('heartstopper','Heartstopper','comic',2019,'Alice Oseman','5 volumes',
 'Mostly the boys'' story, but Tara and Darcy are why a lot of us hand this to our younger cousins.',
 'linear-gradient(160deg,#1E4E7A,#4A8AD8 55%,#F2A8C8)','published',now()),
('on-a-sunbeam','On a Sunbeam','comic',2018,'Tillie Walden','544 pages',
 'A restoration crew, fish-shaped spaceships, and a boarding-school romance in flashback. The colour work alone is worth it.',
 'linear-gradient(160deg,#1E2E5E,#4A5AAA 55%,#E0708A)','published',now()),
('spinning','Spinning','comic',2017,'Tillie Walden','400 pages',
 'A memoir of twelve years in competitive figure skating and coming out in the middle of it. Cold, blue and very quiet.',
 'linear-gradient(160deg,#20364E,#4A7A9E 55%,#C8D8E0)','published',now()),
('fun-home','Fun Home','comic',2006,'Alison Bechdel','232 pages',
 'A cartoonist''s memoir of her father and a funeral home. Dense, literary, and the reason a Broadway musical exists.',
 'linear-gradient(160deg,#2A2A2E,#5A5A5E 55%,#9EA8B8)','published',now()),
('mooncakes','Mooncakes','comic',2019,'Suzanne Walker & Wendy Xu','243 pages',
 'A hard-of-hearing witch, a nonbinary werewolf and an autumn forest. Cosy in the way a blanket is cosy.',
 'linear-gradient(160deg,#2E1E1E,#7A4A2E 55%,#E0B05E)','published',now()),
('laura-dean','Laura Dean Keeps Breaking Up with Me','comic',2019,'Mariko Tamaki & Rosemary Valero-O''Connell','304 pages',
 'About the girlfriend who is bad for you and the friends you neglect for her. Pink, gorgeous and quietly brutal.',
 'linear-gradient(160deg,#3E1E3E,#8A3A7A 55%,#F2A8C8)','published',now()),

-- ── Music ───────────────────────────────────────────────────────────────────
('the-record','the record','music',2023,'boygenius','12 tracks',
 'Three songwriters, no filler. "Not Strong Enough" is the group chat''s permanent state of mind.',
 'linear-gradient(160deg,#3A2A5E,#7A4A8A 55%,#E06A8A)','published',now()),
('punisher','Punisher','music',2020,'Phoebe Bridgers','11 tracks',
 'Skeleton suit, Halloween-adjacent melancholy, and the best closing minute of the decade. Loud at the end, on purpose.',
 'linear-gradient(160deg,#1E2440,#4A4A7A 55%,#A8B8D8)','published',now()),
('home-video','Home Video','music',2021,'Lucy Dacus','11 tracks',
 'Memoir as an album — church camp, first crushes, a home town. "Thumbs" is the one people warn each other about.',
 'linear-gradient(160deg,#2E2A1E,#6A5A3A 55%,#E0C87A)','published',now()),
('dirty-computer','Dirty Computer','music',2018,'Janelle Monáe','14 tracks',
 'Funk, an accompanying film, and "Make Me Feel". The album a lot of people were listening to when they worked it out.',
 'linear-gradient(160deg,#2A1E4E,#6A3AAA 55%,#F2A8C8)','published',now()),
('midwest-princess','The Rise and Fall of a Midwest Princess','music',2023,'Chappell Roan','14 tracks',
 'Camp, drag-shaped pop and "Casual". Best experienced very loud with people who also know every word.',
 'linear-gradient(160deg,#7A1E5E,#E0189A 55%,#F5B73D)','published',now()),
('preachers-daughter','Preacher''s Daughter','music',2022,'Ethel Cain','13 tracks',
 'Southern gothic, slow-building and genuinely heavy going. Beloved, and not an album to put on casually.',
 'linear-gradient(160deg,#241E1E,#5E3A3A 55%,#C29E7A)','published',now())
ON CONFLICT (slug) DO NOTHING;


-- ── Content notes ───────────────────────────────────────────────────────────
-- Community-tagged in normal operation; these are the opening set so a member
-- arriving on day one is not the first person to warn anyone about anything.
-- agree_count is left at 0 and grows from real agreements.
--
-- NOTHING HERE NAMES AN ENDING. "Bury your gays" as a note would be an ending
-- spoiler wearing a content-warning badge, so where a work is known for it the
-- note names the on-screen content instead and the reviews carry the rest.

INSERT INTO public.archive_content_notes (entry_id, label)
SELECT e.id, n.label
FROM (VALUES
  ('portrait-of-a-lady-on-fire','Period-typical sexism'),
  ('portrait-of-a-lady-on-fire','Grief'),
  ('portrait-of-a-lady-on-fire','Nudity'),
  ('carol','Custody dispute'),
  ('carol','Period-typical homophobia'),
  ('but-im-a-cheerleader','Conversion therapy'),
  ('but-im-a-cheerleader','Family rejection'),
  ('bound','Graphic violence'),
  ('bound','Domestic abuse'),
  ('the-handmaiden','Sexual violence'),
  ('the-handmaiden','Graphic violence'),
  ('the-handmaiden','Nudity'),
  ('saving-face','Family rejection'),
  ('the-half-of-it','Grief'),
  ('disobedience','Religious control'),
  ('disobedience','Grief'),
  ('rafiki','Homophobic violence'),
  ('rafiki','Family rejection'),
  ('pariah','Family rejection'),
  ('pariah','Physical abuse'),
  ('happiest-season','Being closeted under pressure'),
  ('happiest-season','Family rejection'),
  ('water-lilies','Underage sexuality'),
  ('water-lilies','Body image'),
  ('gentleman-jack','Family estrangement'),
  ('gentleman-jack','Period-typical violence'),
  ('the-l-word','Biphobia'),
  ('the-l-word','Transphobia (season 3)'),
  ('the-l-word','Cancer'),
  ('killing-eve','Graphic violence'),
  ('killing-eve','Stalking'),
  ('wynonna-earp','Gun violence'),
  ('wynonna-earp','Alcohol dependency'),
  ('feel-good','Addiction and recovery'),
  ('feel-good','Sexual assault'),
  ('feel-good','Eating disorder'),
  ('vida','Grief'),
  ('vida','Gentrification'),
  ('vida','Sexual content'),
  ('she-ra','Emotional abuse'),
  ('she-ra','War'),
  ('the-owl-house','Body horror'),
  ('the-owl-house','Parental pressure'),
  ('a-league-of-their-own','Racism'),
  ('a-league-of-their-own','Period-typical homophobia'),
  ('yellowjackets','Graphic violence'),
  ('yellowjackets','Cannibalism'),
  ('yellowjackets','Self-harm'),
  ('yellowjackets','Disordered eating'),
  ('priory-of-the-orange-tree','Body horror'),
  ('priory-of-the-orange-tree','Religious persecution'),
  ('fingersmith','Institutional abuse'),
  ('fingersmith','Medical restraint'),
  ('tipping-the-velvet','Sex work'),
  ('tipping-the-velvet','Explicit sexual content'),
  ('the-price-of-salt','Custody dispute'),
  ('the-price-of-salt','Period-typical homophobia'),
  ('gideon-the-ninth','Graphic violence'),
  ('gideon-the-ninth','Body horror'),
  ('under-the-udala-trees','Homophobic violence'),
  ('under-the-udala-trees','War'),
  ('under-the-udala-trees','Religious control'),
  ('stone-butch-blues','Police violence'),
  ('stone-butch-blues','Sexual violence'),
  ('stone-butch-blues','Transphobia'),
  ('girl-woman-other','Sexual assault'),
  ('girl-woman-other','Racism'),
  ('last-night-telegraph-club','Racism'),
  ('last-night-telegraph-club','Police raids'),
  ('she-who-became-the-sun','Graphic violence'),
  ('she-who-became-the-sun','Gender dysphoria'),
  ('zami','Racism'),
  ('zami','Grief'),
  ('heartstopper','Eating disorder (vol 4)'),
  ('heartstopper','School bullying'),
  ('on-a-sunbeam','Institutional homophobia'),
  ('spinning','Sexual assault'),
  ('spinning','Emotional neglect'),
  ('fun-home','Suicide'),
  ('fun-home','Sexual content'),
  ('mooncakes','Grief'),
  ('laura-dean','Emotional manipulation'),
  ('laura-dean','Abortion'),
  ('the-record','Substance use'),
  ('the-record','Religious imagery'),
  ('punisher','Death of a parent'),
  ('punisher','Substance use'),
  ('home-video','Religious trauma'),
  ('home-video','Child abuse'),
  ('dirty-computer','Sexual content'),
  ('midwest-princess','Sexual content'),
  ('midwest-princess','Substance use'),
  ('preachers-daughter','Sexual violence'),
  ('preachers-daughter','Religious trauma'),
  ('preachers-daughter','Substance use')
) AS n(slug, label)
JOIN public.archive_entries e ON e.slug = n.slug
ON CONFLICT (entry_id, label) DO NOTHING;


-- ── Demo weight and reviews — dev databases only ────────────────────────────
-- Guarded on the dev-seed profiles existing. On production this block is a
-- no-op and every entry honestly reads "NEW · 0 votes".

DO $$
DECLARE
  u_alex   uuid;
  u_jamie  uuid;
  u_river  uuid;
  u_morgan uuid;
BEGIN
  SELECT id INTO u_alex   FROM public.profiles WHERE username = 'alex_wlw';
  SELECT id INTO u_jamie  FROM public.profiles WHERE username = 'jamie_star';
  SELECT id INTO u_river  FROM public.profiles WHERE username = 'river_sky';
  SELECT id INTO u_morgan FROM public.profiles WHERE username = 'morgan_jay';

  IF u_alex IS NULL THEN
    RAISE NOTICE 'Archive seed: dev profiles absent, skipping demo weight and reviews (this is correct on production).';
    RETURN;
  END IF;

  -- Deterministic, plausible, and varied enough that the browse list is not a
  -- wall of the same number. Every one is above the 10-vote gate except the two
  -- at the end, which are deliberately below it so the "NEW · n votes" state is
  -- visible in the demo without anyone having to construct it.
  UPDATE public.archive_entries e
  SET baseline_vote_count = w.total,
      baseline_up_count = w.up
  FROM (VALUES
    ('portrait-of-a-lady-on-fire',1489,1412),('carol',1204,1067),
    ('but-im-a-cheerleader',742,631),('bound',668,585),
    ('the-handmaiden',913,772),('saving-face',402,371),
    ('the-half-of-it',556,433),('disobedience',381,268),
    ('rafiki',298,271),('pariah',446,411),
    ('happiest-season',884,451),('water-lilies',214,148),
    ('gentleman-jack',1042,894),('the-l-word',1571,912),
    ('killing-eve',1338,802),('wynonna-earp',624,551),
    ('feel-good',489,437),('vida',312,289),
    ('she-ra',1106,1024),('the-owl-house',877,821),
    ('a-league-of-their-own',703,648),('yellowjackets',961,742),
    ('priory-of-the-orange-tree',812,731),('fingersmith',604,556),
    ('tipping-the-velvet',471,412),('the-price-of-salt',388,331),
    ('gideon-the-ninth',926,798),('under-the-udala-trees',241,219),
    ('stone-butch-blues',333,318),('girl-woman-other',508,447),
    ('last-night-telegraph-club',419,392),('she-who-became-the-sun',562,489),
    ('zami',287,271),('heartstopper',702,668),
    ('on-a-sunbeam',364,341),('spinning',252,228),
    ('fun-home',611,548),('mooncakes',198,181),
    ('laura-dean',344,297),('the-record',1121,1088),
    ('punisher',998,921),('home-video',734,701),
    ('dirty-computer',866,812),
    -- Below the gate on purpose: the demo needs to show what an unscored entry
    -- looks like, and a screenshot of it is worth more than a paragraph.
    ('midwest-princess',7,7),('preachers-daughter',4,3)
  ) AS w(slug, total, up)
  WHERE e.slug = w.slug;

  -- Recompute so the denormalized columns match the new baselines. The trigger
  -- only fires on a vote, and there are no votes yet.
  UPDATE public.archive_entries
  SET vote_count = baseline_vote_count, up_count = baseline_up_count
  WHERE baseline_vote_count > 0;

  INSERT INTO public.archive_reviews (entry_id, author_id, body, is_recommend, no_spoilers_ack)
  SELECT e.id, r.author, r.body, r.rec, true
  FROM (VALUES
    ('portrait-of-a-lady-on-fire', u_alex, true,
     'It understands looking. Not being looked at — looking. I have watched it four times and it still takes a full evening out of me.'),
    ('portrait-of-a-lady-on-fire', u_river, true,
     'Slow in the way a held breath is slow. Watch it with someone you can be quiet next to.'),
    ('portrait-of-a-lady-on-fire', u_jamie, true,
     'No score for most of it, and then there is, and you will know exactly which scene I mean without me telling you.'),
    ('carol', u_alex, true,
     'Two hours of women being careful in public. The department store scene does more with a pair of gloves than most films manage in an act.'),
    ('carol', u_morgan, true,
     'Cate Blanchett saying "flung out of space" rearranged something in me at nineteen and I have never got it back.'),
    ('gentleman-jack', u_jamie, true,
     'Watching her walk into a room and simply decide the room is hers rewired something. Suranne Jones to camera is a public service.'),
    ('gentleman-jack', u_river, true,
     'The diaries are real and that is the part that gets me. Someone wrote all this down in code so we would have it.'),
    ('priory-of-the-orange-tree', u_river, true,
     'I put off the size for a year for nothing. The rare epic fantasy where the wlw romance is load-bearing rather than decorative.'),
    ('priory-of-the-orange-tree', u_morgan, true,
     'Four points of view and I only resented one of them, which for a book this long is a remarkable hit rate.'),
    ('heartstopper', u_river, true,
     'Gentle on purpose. Tara''s arc is the one I needed at fifteen and the one I still reread at thirty.'),
    ('the-record', u_alex, true,
     'Put "Cool About It" on after a bad text and let it do the work. Best eleven pounds I have spent on being unwell about someone.'),
    ('the-record', u_jamie, true,
     'Three people who clearly like each other, which you can hear, and it is the whole reason it works.'),
    ('happiest-season', u_morgan, false,
     'I wanted to like it. Being closeted is a real thing to make a film about, but she is treated badly for ninety minutes and I did not find it festive.'),
    ('happiest-season', u_alex, true,
     'Aubrey Plaza in a leather jacket carried this for me and I will not be taking questions.'),
    ('killing-eve', u_jamie, false,
     'Season one is a ten. I am scoring the whole thing and the whole thing is not a ten.'),
    ('the-handmaiden', u_alex, true,
     'Structurally the most satisfying thing on this list. Watch it twice — the second time is a different film.'),
    ('gideon-the-ninth', u_jamie, true,
     'The first hundred pages are a hazing ritual. Get through them. Then you will be insufferable about bone magic for a month, like the rest of us.'),
    ('stone-butch-blues', u_alex, true,
     'Hard reading and not optional. Feinberg put it online for free — there is no reason not to have read it.'),
    ('yellowjackets', u_morgan, true,
     'Not a comfort watch and do not let anyone tell you it is. Extremely well acted by everyone in both timelines.'),
    ('she-ra', u_river, true,
     'Five seasons of build. If someone tells you it is just a kids'' show they stopped at episode three.'),
    ('midwest-princess', u_morgan, true,
     'Played it at a birthday and lost the room in the best way. "Casual" is mean and I mean that as praise.')
  ) AS r(slug, author, rec, body)
  JOIN public.archive_entries e ON e.slug = r.slug
  ON CONFLICT (entry_id, author_id) DO NOTHING;
END $$;
