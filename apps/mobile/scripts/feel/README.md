# Feel gate (Wave 3, lane E)

Static half of the feel budgets in `polish/motion-spec.md` §2 (F2, F5, F7/F11, F12, F13) and
the §3.3 haptic map, run by jest in CI.

| File | What |
|---|---|
| `feelStaticScan.ts` | The scanner: the jest port of the Phase A `feel-static-scan.cjs`. Rules read code with comments blanked out. |
| `feelGate.ts` | Ratchet, tightening, target gaps, §4.2 lane owner of a file. |
| `feelGateConfig.ts` | The allowlist (target exceptions, each with a reason) and `HAPTIC_SITES`, the §3.3 map placed in files. |
| `feel-baseline.json` | Per gated rule and file, the counts on main 50b1f5d. They may only go down. |
| `__tests__/feel/feelGate.test.ts` | The gate. |

## Rules

- **Gate (CI):** per gated rule and file, `current <= max(baseline, allowlist)`. A new file starts
  at 0. Fixing a file never fails the gate.
- **Target (spec):** per gated rule and file, `current <= allowlist` (0 when unlisted), and every
  `required` haptic site exists. The owner lanes (§4.2) drive the gaps to zero.
- Haptics: every call goes through `lib/haptics` with a §3.3 kind (`selection`, `light`,
  `medium`, `success`) at a `HAPTIC_SITES` file. Wave 1/2 names (`select`, `tap`, `tapLight`,
  `celebrate`, `warning`, ternaries = `dynamic`) only ratchet down.
- Retire code by commenting it out: comments do not count.

## Commands (from apps/mobile)

```
npx jest __tests__/feel                                   # the gate + its unit tests
FEEL_REPORT=<out.json> npx jest __tests__/feel/feelGate   # summary + per-file gaps (lane, action)
FEEL_SCAN_REF=polish/w3-b npx jest __tests__/feel/feelGate  # gate a branch without checking it out
FEEL_RATCHET_WRITE=1 npx jest __tests__/feel/feelGate     # after a merge: lower the baseline, commit it
```

Never raise a baseline count by hand. A legitimate exception is an allowlist entry with a reason
in `feelGateConfig.ts` (lane E reviews it).
