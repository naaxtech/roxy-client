# Known Failure Patterns — Do Not Repeat
## Append new entries as they are discovered and resolved.

[MISTAKE] Bash subagents cannot write files
[ROOT CAUSE] cat >, printf >, heredoc redirects silently fail or are denied in subagent context
[FIX] Use Write and Edit tools directly in the main conversation
[PREVENTION] Never use bash file-write patterns in any subagent call

[MISTAKE] jest.mock() hoisting causes undefined variables in factory
[ROOT CAUSE] Babel hoists jest.mock() above all variable declarations
[FIX] Inline the factory; use jest.requireMock() for assertions
[PREVENTION] Never reference variables declared before jest.mock() inside its factory

[MISTAKE] Daily.co module-level import crashes Expo Go
[ROOT CAUSE] @daily-co/react-native-daily-js is native-only; module-level import breaks bundler
[FIX] Guarded require() inside try/catch in lib/daily.ts; check isDailyAvailable() before render
[PREVENTION] Never use import from @daily-co at module scope; always check isDailyAvailable()

[MISTAKE] Component function name matches imported type name → Babel Duplicate declaration
[ROOT CAUSE] Both import and function declaration use the same identifier
[FIX] Alias the type import: import type { X as XData } from '...'
[PREVENTION] Always check type import names against function names in same file

[MISTAKE] Supabase Realtime mock missing chain link → "X is not a function"
[ROOT CAUSE] channel() → on() → subscribe() chain must be complete in mock
[FIX] Full chain: channel: jest.fn(() => ({ on: jest.fn(() => ({ subscribe: jest.fn() })) }))
[PREVENTION] Any Realtime mock must include full channel/on/subscribe chain + removeChannel

[MISTAKE] Sentry not receiving source maps after EAS build
[ROOT CAUSE] SENTRY_AUTH_TOKEN set in .env but not in EAS secrets
[FIX] eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value <token>
[PREVENTION] Check EAS secrets dashboard before first build; run sourcemap verification after every build

[MISTAKE] PostHog session replay capturing keyboard input on WLW profile fields
[ROOT CAUSE] maskAllTextAttributes was true at init but overridden in TextInput style
[FIX] Set maskAllTextAttributes at init AND add ph-no-capture class to sensitive inputs
[PREVENTION] Run PostHog replay audit after every new screen — check for unmasked inputs

[MISTAKE] ObservabilityService.initialize() called at module scope
[ROOT CAUSE] Initialized before Expo app is ready (module scope executes before component tree)
[FIX] Call initialize() inside App() useEffect, never at module scope
[PREVENTION] This is in CLAUDE.md section 10. Check before any observability init.

[MISTAKE] Daily.co participantUpdated flooding Sentry with breadcrumbs
[ROOT CAUSE] Event fires ~10x/second during active call; no debounce
[FIX] Use trackMediaState() which debounces at 2s; never raw PostHog/Sentry capture for media events
[PREVENTION] Any Daily.co event handler must use trackMediaState() not direct capture

[MISTAKE] TypeScript errors ignored during session, caught at build
[ROOT CAUSE] tsc --noEmit not run before declaring task done
[FIX] Always run tsc --noEmit as last step before PR
[PREVENTION] QA loop in CLAUDE.md section 15 is mandatory. tsc is step 2. No exceptions.

[MISTAKE] Expo web bundling fails with "unable to resolve expo-*"
[ROOT CAUSE] Web peer deps not installed by default
[FIX] npm install expo-status-bar@~1.12.1 expo-linking expo-constants expo-font expo-asset --legacy-peer-deps
[PREVENTION] Run web build check early in session; install web deps before first web preview

[MISTAKE] DEV_MOCK declared after DB calls in edge function
[ROOT CAUSE] checkRateLimit is a DB call; DEV_MOCK must be declared before it
[FIX] Declare DEV_MOCK immediately after body parse, before any DB operations
[PREVENTION] Edge function structure in CLAUDE.md section 7: order is strict

[MISTAKE] Shared observability package not resolving in monorepo
[ROOT CAUSE] tsconfig paths not configured in each app's tsconfig.json
[FIX] Add paths: { "@roxy/observability": ["../../packages/observability/src"] } to each app's tsconfig.json
[PREVENTION] Check tsconfig paths after any new package is added to monorepo

[MISTAKE] PowerShell Set-Content regex replace corrupted emoji/UTF-8 in source files
[ROOT CAUSE] Windows PowerShell 5.1 Get-Content without -Encoding reads UTF-8 (no BOM) as ANSI; writing back with -Encoding utf8 double-encodes all non-ASCII
[FIX] git checkout the files, re-apply changes with the Edit tool
[PREVENTION] Never bulk-rewrite source files via PowerShell string replace; use the Edit tool (encoding-safe) for all source edits
