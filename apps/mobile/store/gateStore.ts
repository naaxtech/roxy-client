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

export type VettingStatus = 'unvetted' | 'pending' | 'approved' | 'rejected';

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
  decided_at: string | null;
  rejected_until: string | null;
  community_id: string;
}

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

  validateCode: (code: string) => Promise<boolean>;
  clearCode: () => void;
  submitApplicationForCode: () => Promise<string | null>;
  loadApplication: () => Promise<void>;
  saveAnswer: (criterionId: string, answer: string) => Promise<boolean>;
  saveLegalName: (name: string) => Promise<LegalNameOutcome>;
  startVerification: () => Promise<string | null>;
  requestAppeal: (reason: string) => Promise<boolean>;
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

const isRejection = (value: unknown): value is CodeRejection =>
  typeof value === 'string' && value in CODE_MESSAGES;

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

  submitApplicationForCode: async () => {
    const code = get().validatedCode;
    if (!code) return null;

    const { data, error } = await supabase.rpc('create_membership_application', {
      p_code: code,
    });

    if (error) {
      logError(error, 'gateStore.submitApplicationForCode');
      return null;
    }

    // The code has done its job. Holding it after this point serves nothing
    // and gives a device-level attacker something to steal.
    set({ validatedCode: null, validatedCommunityName: null });
    return (data as string) ?? null;
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
        .select('id, status, submitted_at, decided_at, rejected_until, community_id')
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
          .select('id, status, submitted_at, decided_at, rejected_until, community_id')
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
    // refetching so the checklist ticks immediately.
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

    const { error } = await supabase
      .from('applicant_identity')
      .insert({ application_id: application.id, legal_name: name.trim() });

    if (error) {
      // Not a failure to retry — it means she has already given us her name.
      if (error.code === PK_CONFLICT) return 'already_saved';
      logError(error, 'gateStore.saveLegalName');
      return 'failed';
    }

    // Past this line the name is stored. Nothing below may report 'failed'.
    const criterion = get().criteria.find((c) => c.key === 'legal_name');
    if (!criterion) return 'saved';

    const { error: metError } = await supabase.rpc('mark_criterion_met', {
      p_application_id: application.id,
      p_criterion_id: criterion.id,
    });

    if (metError) {
      if (!isMissingFunction(metError)) logError(metError, 'gateStore.saveLegalName.met');
      return 'saved_unscored';
    }

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

  requestAppeal: async (reason) => {
    const application = get().application;
    if (!application) return false;

    const { error } = await supabase
      .from('application_appeals')
      .insert({ application_id: application.id, reason: reason.trim() });

    if (error) {
      logError(error, 'gateStore.requestAppeal');
      return false;
    }
    return true;
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
    }),
}));
