import { create } from 'zustand';
import { supabase, callEdgeFunction } from '../lib/supabase';
import { logError } from '../lib/errorLogger';

/**
 * The invite gate.
 *
 * Roxy is invite-only: you cannot create an account without a code a community
 * issued, and a human decides on every application. This store owns the
 * applicant's side of that — validating a code before signup, tracking which
 * criteria have been satisfied, and holding the decision.
 *
 * It deliberately knows nothing about safety ratings or watchlist flags. Those
 * live in application_reviews, which the applicant's own RLS policies cannot
 * reach, and they are never fetched here.
 */

/**
 * Every reason a code does not get her through the gate.
 *
 * All but `unavailable` are the server's verdict on the code itself.
 * `unavailable` is the local one: we never reached the server, so we know
 * nothing about the code and must not pretend otherwise.
 */
export type CodeRejection =
  | 'invalid'
  | 'revoked'
  | 'expired'
  | 'exhausted'
  | 'locked'
  | 'rate_limited'
  | 'unavailable';

export type VettingStatus = 'pending' | 'approved' | 'rejected';

/**
 * What actually became of a submitted legal name.
 *
 * A boolean cannot describe this operation honestly. The name and the criterion
 * that scores it live in two tables with different permissions, the client can
 * only write one of them, and the write it can make is irreversible from here —
 * so "it worked" and "it didn't" are not the only two outcomes, and reporting
 * only those is what made this lose data (see saveLegalName).
 */
export type LegalNameOutcome =
  /** Name stored and the criterion marked. Nothing outstanding. */
  | 'saved'
  /** Name stored — permanently and correctly — but the criterion is not yet marked. */
  | 'saved_unscored'
  /** A name is already on file for this application; it can only be given once. */
  | 'already_saved'
  /** Nothing was written. Safe to retry. */
  | 'failed';

export interface Criterion {
  id: string;
  key: string;
  kind: 'attribute' | 'question';
  label: string;
  description: string | null;
  prompt: string | null;
  points: number;
  is_required: boolean;
  sort_order: number;
  /** NULL means the criterion applies everywhere; set, it is that community's own question. */
  community_id: string | null;
}

export interface ApplicationState {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  submitted_at: string;
  /**
   * When she pressed "Send for review" (130 / G-14). Null is a draft: no
   * reviewer can see it, and it is not in anyone's queue.
   */
  ready_at?: string | null;
  decided_at: string | null;
  rejected_until: string | null;
  /** The reviewer's reason CATEGORY (never the private note) — G-12. */
  decision_reason?: DecisionReason | null;
  community_id: string;
}

/** Reviewer-chosen rejection category, shown to her. The free-text note is never shown. */
export type DecisionReason = 'not_verified' | 'not_known' | 'incomplete' | 'safety' | 'other';

export const DECISION_REASON_COPY: Record<DecisionReason, string> = {
  not_verified: "We couldn't confirm enough about you to be sure Roxy is the right fit right now.",
  not_known: "The community that invited you didn't feel they knew you well enough yet.",
  incomplete: "Your application didn't give the reviewer enough to go on.",
  safety: 'The reviewer had a safety concern they could not resolve.',
  other: 'The reviewer decided not to approve it this time.',
};

/**
 * Why a held code could not open an application, in words she can act on.
 * Every one leaves her somewhere recoverable (G-15): she keeps her account,
 * nothing is unlocked, and she can try another code.
 */
export type RedeemFailure =
  | CodeRejection
  | 'cooldown'
  | 'already_member'
  | 'deleted';

/** Why "Send for review" was refused, from submit_application(). */
export type SubmitFailure =
  | 'join_reason_too_short'
  | 'missing_required'
  | 'no_application'
  | 'already_decided'
  | 'unavailable';

/** The server's minimum for the join reason (130: join_reason earns its point at 40 chars). */
export const JOIN_REASON_MIN = 40;

export type SubmitOutcome = { ok: true } | { ok: false; reason: SubmitFailure; missing?: string[] };

/** Her own appeal, as aa_own lets her read it. Outcome is set by resolve_appeal (130). */
export interface AppealState {
  requested_at: string;
  resolved_at: string | null;
  outcome: 'upheld' | 'overturned' | null;
}

/** What became of "Ask us to look again". A duplicate is not a failure. */
export type AppealOutcome = 'sent' | 'already_sent' | 'failed';

/** application_appeals.reason CHECK: 10..2000 characters after trim (070). */
export const APPEAL_MIN = 10;

/**
 * Each rejection gets its own sentence. "Invalid code" for an expired one sends
 * someone back to the friend who invited them to ask for a code that was never
 * the problem.
 */
export const CODE_MESSAGES: Record<CodeRejection, string> = {
  invalid: "That code isn't recognised. Check for typos — codes never contain I, L, O or U.",
  revoked: 'That code has been turned off by the community that issued it.',
  expired: 'That code has expired. Ask whoever invited you for a fresh one.',
  exhausted: "That code has been used as many times as it was meant to be.",
  locked: 'That code has been locked for security. Ask for a new one.',
  rate_limited: "Too many tries. Give it an hour, then try again.",
  unavailable: "We couldn't reach Roxy just now. Check your connection and try again — your code is fine.",
};

interface GateState {
  /** A code the server has confirmed. Held only until signup completes. */
  validatedCode: string | null;
  validatedCommunityName: string | null;
  checking: boolean;
  codeError: CodeRejection | null;

  application: ApplicationState | null;
  criteria: Criterion[];
  metCriterionIds: Set<string>;
  score: number;
  loadingApplication: boolean;
  loadError: string | null;
  /**
   * Set when a held code could not open her application after signup (G-15).
   * She keeps her account and lands on a recoverable screen — never the app.
   */
  redeemError: RedeemFailure | null;
  submitting: boolean;
  /** Her appeal, once sent (G-12). Null: none sent, or not loaded yet. */
  appeal: AppealState | null;

  validateCode: (code: string) => Promise<boolean>;
  clearCode: () => void;
  submitApplicationForCode: () => Promise<string | null>;
  /** "Send for review" (G-14). The application enters the queue only here. */
  submitForReview: () => Promise<SubmitOutcome>;
  loadApplication: () => Promise<void>;
  saveAnswer: (criterionId: string, answer: string) => Promise<boolean>;
  saveLegalName: (name: string) => Promise<LegalNameOutcome>;
  startVerification: () => Promise<string | null>;
  requestAppeal: (reason: string) => Promise<AppealOutcome>;
  loadAppeal: () => Promise<void>;
  grantVerificationConsent: () => Promise<boolean>;
  reset: () => void;
}

/**
 * The wording she agreed to, versioned.
 *
 * Art. 7(1) requires being able to demonstrate consent, and "she ticked a box"
 * is not demonstrable if nobody can say what the box said. Bump this whenever
 * the consent copy on the application screen changes — never edit the copy in
 * place without bumping it.
 */
export const CONSENT_POLICY_VERSION = '2026-08-02';

export const REDEEM_MESSAGES: Record<RedeemFailure, string> = {
  ...CODE_MESSAGES,
  cooldown: "You can apply again once your waiting period ends. We'll keep your account safe until then.",
  already_member: "You're already a member — no code needed.",
  deleted: 'This account is being deleted, so it can no longer apply.',
};

const isRejection = (value: unknown): value is CodeRejection =>
  typeof value === 'string' && value in CODE_MESSAGES;

const isRedeemFailure = (value: unknown): value is RedeemFailure =>
  typeof value === 'string' && value in REDEEM_MESSAGES;

/** Postgres unique/primary-key violation. */
const PK_CONFLICT = '23505';

/**
 * The RPC exists in our code before it exists in the database.
 *
 * PostgREST answers PGRST202 when a function is not in its schema cache;
 * Postgres answers 42883 if the call reaches it. Either means "not deployed
 * yet", which is an expected state during rollout and not a fault worth paging
 * anyone about — every other error from the same call is real and gets logged.
 */
const isMissingFunction = (error: { code?: string } | null): boolean =>
  error?.code === 'PGRST202' || error?.code === '42883';

const APPLICATION_FIELDS =
  'id, status, submitted_at, ready_at, decided_at, rejected_until, decision_reason, community_id';

export const useGateStore = create<GateState>((set, get) => ({
  validatedCode: null,
  validatedCommunityName: null,
  checking: false,
  codeError: null,

  application: null,
  criteria: [],
  metCriterionIds: new Set(),
  score: 0,
  loadingApplication: false,
  loadError: null,
  redeemError: null,
  submitting: false,
  appeal: null,

  validateCode: async (code) => {
    set({ checking: true, codeError: null });

    // Goes through an edge function rather than straight to Postgres: the
    // rate limit is keyed on a hashed IP, and only the server can see one.
    const { data, error } = await callEdgeFunction<{
      ok: boolean;
      reason?: string;
      community_name?: string | null;
    }>('validate-invite-code', { code: code.trim().toUpperCase() });

    // A transport failure is not a verdict. This branch used to report
    // 'invalid', so an undeployed function or a dropped connection told a woman
    // holding a perfectly good code that her code was wrong — on the first
    // screen of the app, with nothing to do but go back to whoever invited her
    // and repeat it. It also returned silently, so nobody found out. Say what
    // actually happened, and log it.
    if (error || !data) {
      logError(error ?? 'validate-invite-code returned no data', 'gateStore.validateCode');
      set({ checking: false, codeError: 'unavailable' });
      return false;
    }

    if (!data.ok) {
      set({
        checking: false,
        codeError: isRejection(data.reason) ? data.reason : 'invalid',
      });
      return false;
    }

    set({
      checking: false,
      codeError: null,
      validatedCode: code.trim().toUpperCase(),
      validatedCommunityName: data.community_name ?? null,
    });
    return true;
  },

  clearCode: () => set({ validatedCode: null, validatedCommunityName: null, codeError: null }),

  /**
   * Redeem the held code into an application (130: redeem_invite_code).
   *
   * The server locks the code row, rate-limits the caller, is idempotent on
   * retry (a dropped response cannot burn a second use) and refuses to touch
   * an approved member. Any failure leaves her signed in on a recoverable
   * screen with a sentence she can act on — never with access (G-15).
   */
  submitApplicationForCode: async () => {
    const code = get().validatedCode;
    if (!code) return null;

    const { data, error } = await supabase.rpc('redeem_invite_code', { p_code: code });

    if (error || !data) {
      logError(error ?? 'redeem_invite_code returned no data', 'gateStore.submitApplicationForCode');
      set({ redeemError: 'unavailable' });
      return null;
    }

    const result = data as { ok: boolean; reason?: string; application_id?: string };
    if (!result.ok) {
      set({ redeemError: isRedeemFailure(result.reason) ? result.reason : 'invalid' });
      // A code the server judged is spent for her; keeping it would only
      // replay the same refusal on the next screen.
      if (result.reason !== 'unavailable' && result.reason !== 'rate_limited') {
        set({ validatedCode: null, validatedCommunityName: null });
      }
      return null;
    }

    // The code has done its job. Holding it after this point serves nothing
    // and gives a device-level attacker something to steal.
    set({ validatedCode: null, validatedCommunityName: null, redeemError: null });
    return result.application_id ?? null;
  },

  submitForReview: async () => {
    set({ submitting: true });
    let data: unknown;
    let error: unknown;
    try {
      ({ data, error } = await supabase.rpc('submit_application'));
    } catch (e) {
      // A thrown request (socket dropped) must not leave the button busy forever.
      error = e;
    } finally {
      set({ submitting: false });
    }

    if (error || !data) {
      logError(error ?? 'submit_application returned no data', 'gateStore.submitForReview');
      return { ok: false, reason: 'unavailable' };
    }
    const result = data as { ok: boolean; reason?: SubmitFailure; missing?: string[]; ready_at?: string };
    if (!result.ok) {
      return { ok: false, reason: result.reason ?? 'unavailable', missing: result.missing };
    }
    set((s) => ({
      application: s.application
        ? { ...s.application, ready_at: result.ready_at ?? new Date().toISOString() }
        : s.application,
    }));
    return { ok: true };
  },

  loadApplication: async () => {
    set({ loadingApplication: true, loadError: null });

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      set({ loadingApplication: false, loadError: 'Not signed in.' });
      return;
    }

    const [appRes, criteriaRes] = await Promise.all([
      supabase
        .from('membership_applications')
        .select(APPLICATION_FIELDS)
        .eq('auth_user_id', auth.user.id)
        .maybeSingle(),
      supabase
        .from('verification_criteria')
        .select(
          'id, key, kind, label, description, prompt, points, is_required, sort_order, community_id',
        )
        .eq('is_active', true)
        .order('sort_order'),
    ]);

    if (appRes.error) {
      logError(appRes.error, 'gateStore.loadApplication');
      set({ loadingApplication: false, loadError: 'Could not load your application.' });
      return;
    }

    let application = (appRes.data as ApplicationState | null) ?? null;
    const allCriteria = (criteriaRes.data as Criterion[] | null) ?? [];

    // Recovery point for every signup path that isn't the email form. Apple and
    // Google sign-in complete via redirect, so there is no point in that flow
    // where the code can be redeemed — the account simply appears. Without this,
    // an OAuth signup lands on the pending screen with no application, no
    // reviewer, and no way forward.
    if (!application && get().validatedCode) {
      const created = await get().submitApplicationForCode();
      if (created) {
        const { data: retry } = await supabase
          .from('membership_applications')
          .select(APPLICATION_FIELDS)
          .eq('auth_user_id', auth.user.id)
          .maybeSingle();
        application = (retry as ApplicationState | null) ?? null;
      }
    }

    let metCriterionIds = new Set<string>();
    if (application) {
      const { data: met } = await supabase
        .from('application_criteria_met')
        .select('criterion_id')
        .eq('application_id', application.id);
      metCriterionIds = new Set((met ?? []).map((r: { criterion_id: string }) => r.criterion_id));
    }

    // vc_read lets her SELECT every active criterion on the platform, including
    // other communities' own questions — but can_self_attest_criterion (081:153)
    // accepts a write only for a criterion that is global or belongs to HER
    // community. Showing an out-of-scope question therefore offers her a field
    // whose save is guaranteed to be refused, and inflates the denominator on
    // the score card with points she cannot earn. Scoped here to match
    // application_missing_required (071:267), which already filters this way.
    const criteria = allCriteria.filter(
      (c) => c.community_id === null || c.community_id === application?.community_id,
    );

    // Computed from the same criteria the server would use, so the number the
    // applicant sees matches the number in the reviewer's queue.
    const score = criteria
      .filter((c) => metCriterionIds.has(c.id))
      .reduce((sum, c) => sum + c.points, 0);

    set({ application, criteria, metCriterionIds, score, loadingApplication: false });
  },

  saveAnswer: async (criterionId, answer) => {
    const application = get().application;
    if (!application) return false;

    const { error } = await supabase.from('application_answers').upsert(
      { application_id: application.id, criterion_id: criterionId, answer: answer.trim() },
      { onConflict: 'application_id,criterion_id' },
    );

    if (error) {
      logError(error, 'gateStore.saveAnswer');
      return false;
    }

    // A trigger marks the criterion met server-side; mirror it rather than
    // refetching so the checklist ticks immediately. The join reason earns
    // its point only at JOIN_REASON_MIN characters (130 / G-24), so a short
    // one is saved but not ticked — matching what the reviewer will see.
    const criterion = get().criteria.find((c) => c.id === criterionId);
    if (criterion?.key === 'join_reason' && answer.trim().length < JOIN_REASON_MIN) return true;
    set((s) => {
      const metCriterionIds = new Set(s.metCriterionIds).add(criterionId);
      const score = s.criteria
        .filter((c) => metCriterionIds.has(c.id))
        .reduce((sum, c) => sum + c.points, 0);
      return { metCriterionIds, score };
    });
    return true;
  },

  /**
   * Store the applicant's legal name and mark the criterion it satisfies.
   *
   * This used to insert the name and then upsert into application_criteria_met.
   * That upsert could never succeed: migration 071 gives that table exactly two
   * policies, acm_own and acm_reviewer, and both are FOR SELECT. Every write to
   * it goes through SECURITY DEFINER — the trigger on application_answers, or
   * the KYC webhook on the service role. There is no INSERT policy for anyone,
   * so the client's upsert was refused every single time.
   *
   * The damage was in what happened next: it returned false *after* the name
   * had already been written. applicant_identity.application_id is a PRIMARY
   * KEY with an INSERT-only policy and no UPDATE policy — a name can be given
   * once and never corrected — and there is no SELECT policy either, so nothing
   * here can read back whether it is already stored. So the applicant was told
   * "Could not save", her name was on file regardless, and retrying hit the
   * primary key and told her the same thing again. Permanently stuck, with the
   * most sensitive field in the application already handed over.
   *
   * The fix keeps the half that works and stops lying about the half that does
   * not. Once the insert succeeds the name is stored and cannot be rolled back
   * from a client, so from that point the outcome is never 'failed'. The
   * criterion is then marked through mark_criterion_met — a SECURITY DEFINER
   * RPC that is NOT DEPLOYED YET and is another agent's migration to write. Its
   * absence is handled as the expected state it currently is: the caller gets
   * 'saved_unscored' and tells the applicant the truth, which is that her name
   * is safe and the point it earns is still coming. When the RPC lands this
   * code starts returning 'saved' with no further change.
   */
  saveLegalName: async (name) => {
    const application = get().application;
    if (!application) return 'failed';

    // 130 / G-19: one SECURITY DEFINER call stores the name AND marks its
    // criterion, and a second call while she is pending corrects it instead
    // of hitting a primary key. Nothing is ever half-written.
    const { error } = await supabase.rpc('save_applicant_legal_name', { p_name: name.trim() });

    if (error && isMissingFunction(error)) {
      return saveLegalNameLegacy(application.id, name, get().criteria);
    }
    if (error) {
      logError(error, 'gateStore.saveLegalName');
      return 'failed';
    }

    const criterion = get().criteria.find((c) => c.key === 'legal_name');
    if (!criterion) return 'saved';

    set((s) => {
      const metCriterionIds = new Set(s.metCriterionIds).add(criterion.id);
      const score = s.criteria
        .filter((c) => metCriterionIds.has(c.id))
        .reduce((sum, c) => sum + c.points, 0);
      return { metCriterionIds, score };
    });
    return 'saved';
  },

  startVerification: async () => {
    const { data, error } = await callEdgeFunction<{ verification_url: string }>(
      'kyc-create-session',
      {},
    );
    if (error || !data?.verification_url) {
      logError(error ?? 'no verification url', 'gateStore.startVerification');
      return null;
    }
    return data.verification_url;
  },

  grantVerificationConsent: async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return false;

    // Append-only: a withdrawal is a new row, never an edit. The trail is only
    // worth having if it cannot be rewritten after the fact.
    const { error } = await supabase.from('consent_events').insert({
      user_id: auth.user.id,
      purpose: 'identity_verification',
      granted: true,
      policy_version: CONSENT_POLICY_VERSION,
    });

    if (error) {
      logError(error, 'gateStore.grantVerificationConsent');
      return false;
    }
    return true;
  },

  // Appeals are append-only (130 / G-24): one per application, never edited.
  // The 130 column grant allows INSERT (application_id, reason) only; aa_own
  // lets her read it back, and resolve_appeal (staff) sets the outcome.
  requestAppeal: async (reason) => {
    const application = get().application;
    const text = reason.trim();
    if (!application || text.length < APPEAL_MIN) return 'failed';

    const { error } = await supabase
      .from('application_appeals')
      .insert({ application_id: application.id, reason: text });

    if (error) {
      // UNIQUE (application_id): she has already asked. That is a fact to
      // state, not an error to log or retry.
      if (error.code === PK_CONFLICT) return 'already_sent';
      logError(error, 'gateStore.requestAppeal');
      return 'failed';
    }
    set({ appeal: { requested_at: new Date().toISOString(), resolved_at: null, outcome: null } });
    return 'sent';
  },

  loadAppeal: async () => {
    const application = get().application;
    if (!application) return;
    const { data, error } = await supabase
      .from('application_appeals')
      .select('requested_at, resolved_at, outcome')
      .eq('application_id', application.id)
      .maybeSingle();
    if (error) {
      logError(error, 'gateStore.loadAppeal');
      return;
    }
    set({ appeal: (data as AppealState | null) ?? null });
  },

  reset: () =>
    set({
      validatedCode: null,
      validatedCommunityName: null,
      checking: false,
      codeError: null,
      application: null,
      criteria: [],
      metCriterionIds: new Set(),
      score: 0,
      loadingApplication: false,
      loadError: null,
      redeemError: null,
      submitting: false,
      appeal: null,
    }),
}));

/**
 * The pre-130 path, kept for a client that reaches a database without
 * save_applicant_legal_name (a rollout window only): insert once, then try to
 * mark the criterion. See the history in the comment on saveLegalName.
 */
async function saveLegalNameLegacy(
  applicationId: string,
  name: string,
  criteria: Criterion[],
): Promise<LegalNameOutcome> {
  const { error } = await supabase
    .from('applicant_identity')
    .insert({ application_id: applicationId, legal_name: name.trim() });

  if (error) {
    // Not a failure to retry — it means she has already given us her name.
    if (error.code === PK_CONFLICT) return 'already_saved';
    logError(error, 'gateStore.saveLegalName');
    return 'failed';
  }

  // Past this line the name is stored. Nothing below may report 'failed'.
  const criterion = criteria.find((c) => c.key === 'legal_name');
  if (!criterion) return 'saved';

  const { error: metError } = await supabase.rpc('mark_criterion_met', {
    p_application_id: applicationId,
    p_criterion_id: criterion.id,
  });

  if (metError) {
    if (!isMissingFunction(metError)) logError(metError, 'gateStore.saveLegalName.met');
    return 'saved_unscored';
  }
  useGateStore.setState((s) => {
    const metCriterionIds = new Set(s.metCriterionIds).add(criterion.id);
    const score = s.criteria
      .filter((c) => metCriterionIds.has(c.id))
      .reduce((sum, c) => sum + c.points, 0);
    return { metCriterionIds, score };
  });
  return 'saved';
}
