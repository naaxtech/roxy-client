'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { formatUtcDate, formatUtcDateTime } from '@/lib/dates';
import {
  decisionLabel,
  idCheckLabel,
  rejectionReasonLabel,
  type IdCheck,
} from '@/lib/applicationQueue';

/**
 * Shape returned by application_review_context (migration 130, section 13).
 * Everything a reviewer needs on one card, nothing she does not: no legal name
 * (that stays behind the logged reveal), no email, no contact details.
 */
export interface ReviewContext {
  application: {
    id: string;
    status: string;
    submitted_at: string | null;
    ready_at: string | null;
    decided_at: string | null;
    decision_reason: string | null;
    community_name: string | null;
  };
  applicant: {
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    /** text[] in the database; older rows may hold a plain string. */
    pronouns: string[] | string | null;
    identity_labels: string[] | null;
    bio: string | null;
    onboarding_completed: boolean | null;
    account_created_at: string | null;
  } | null;
  answers: { key: string; label: string; prompt: string | null; answer: string; answered_at: string | null }[];
  criteria_met: string[];
  missing_required: string[] | null;
  legal_name_on_file: boolean;
  id_check: IdCheck | null;
  code: { label: string | null; is_member_code: boolean | null; minted_by: string | null } | null;
  appeal: {
    id: string;
    reason: string;
    requested_at: string;
    resolved_at: string | null;
    outcome: string | null;
  } | null;
  history: { decision: string; reason: string | null; at: string }[];
}

function initials(name: string | null | undefined): string {
  const s = (name ?? '').trim();
  return s ? s.slice(0, 1).toUpperCase() : '?';
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 text-sm">
      <dt className="text-muted-foreground">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The read-only half of a review: who she is, what she said, how she got here. */
export function ApplicantContextPanel({ ctx }: { ctx: ReviewContext }) {
  const a = ctx.applicant;
  const name = a?.display_name ?? null;
  const pronouns = Array.isArray(a?.pronouns)
    ? a.pronouns.filter(Boolean).join('/')
    : (a?.pronouns ?? '');
  const missing = ctx.missing_required ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10">
          {a?.avatar_url ? <AvatarImage src={a.avatar_url} alt="" /> : null}
          <AvatarFallback>{initials(name ?? a?.username)}</AvatarFallback>
        </Avatar>
        <div className="space-y-0.5 min-w-0">
          <p className="font-semibold">
            {name ?? <span className="text-muted-foreground">No display name yet</span>}
          </p>
          {a?.username && <p className="text-xs text-muted-foreground">@{a.username}</p>}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {pronouns && <Badge variant="outline">{pronouns}</Badge>}
            {(a?.identity_labels ?? []).map((l) => (
              <Badge key={l} variant="secondary">{l}</Badge>
            ))}
          </div>
        </div>
      </div>

      {a?.bio && <p className="text-sm whitespace-pre-wrap">{a.bio}</p>}

      <dl className="space-y-1.5">
        <Row term="Invited by">{ctx.application.community_name ?? 'Unknown community'}</Row>
        <Row term="Invite code">
          {ctx.code ? (
            <span>
              Code “{ctx.code.label ?? 'unlabelled'}”{ctx.code.is_member_code ? ' (member vouch)' : ''}
              {ctx.code.minted_by ? ` · minted by ${ctx.code.minted_by}` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground">No code on record</span>
          )}
        </Row>
        <Row term="ID check">{idCheckLabel(ctx.id_check)}</Row>
        <Row term="Account created">
          {a?.account_created_at ? formatUtcDate(a.account_created_at) : '—'}
        </Row>
        <Row term="Profile set up">{a?.onboarding_completed ? 'Yes' : 'Not yet'}</Row>
        <Row term="Sent for review">
          {ctx.application.ready_at ? formatUtcDateTime(ctx.application.ready_at) : 'Not sent yet (draft)'}
        </Row>
      </dl>

      {missing.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 px-3 py-2 text-sm">
          Missing a required answer ({missing.length}). This application predates
          &ldquo;Send for review&rdquo;, so it may be unfinished.
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Her answers
        </h3>
        {ctx.answers.length === 0 ? (
          <p className="text-sm text-muted-foreground">She has not answered anything.</p>
        ) : (
          <ul className="space-y-3">
            {ctx.answers.map((ans) => (
              <li key={ans.key} className="space-y-1">
                <p className="text-xs font-medium">{ans.prompt ?? ans.label}</p>
                <p className="text-sm whitespace-pre-wrap">{ans.answer}</p>
              </li>
            ))}
          </ul>
        )}
        {ctx.criteria_met.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Criteria met: {ctx.criteria_met.join(' · ')}
          </p>
        )}
      </section>

      {ctx.appeal && (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Her appeal
          </h3>
          <p className="text-sm whitespace-pre-wrap">{ctx.appeal.reason}</p>
          <p className="text-xs text-muted-foreground">
            Sent {formatUtcDate(ctx.appeal.requested_at)}
            {ctx.appeal.outcome ? ` · ${ctx.appeal.outcome}` : ' · open'}
          </p>
        </section>
      )}

      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Decision history
        </h3>
        {ctx.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decisions yet.</p>
        ) : (
          <ol className="space-y-1">
            {ctx.history.map((h, i) => (
              <li key={`${h.decision}-${h.at}-${i}`} className="text-sm flex flex-wrap gap-x-2">
                <span>{decisionLabel(h.decision)}</span>
                {h.reason && (
                  <span className="text-muted-foreground">· {rejectionReasonLabel(h.reason)}</span>
                )}
                <time className="text-xs text-muted-foreground self-center">
                  {formatUtcDateTime(h.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
