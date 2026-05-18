# One-time Supabase CLI setup for roxy-client
# Run from repo root: .\scripts\setup-supabase.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Supabase = Join-Path $Root "node_modules\.bin\supabase.cmd"
if (-not (Test-Path $Supabase)) {
  Write-Host "Installing dependencies..."
  npm install
}

$ProjectRef = "ptymtdlysqbpxzlgsshp"

Write-Host "`n=== Step 1: Login ===" -ForegroundColor Cyan
Write-Host "A browser window will open. Sign in to Supabase and approve the CLI."
& $Supabase login

Write-Host "`n=== Step 2: Link project ($ProjectRef) ===" -ForegroundColor Cyan
Write-Host "You will be prompted for your database password (Supabase Dashboard -> Project Settings -> Database)."
& $Supabase link --project-ref $ProjectRef

Write-Host "`n=== Step 3: Verify ===" -ForegroundColor Cyan
& $Supabase projects list
& $Supabase migration list

Write-Host "`nDone. You can now run: npm run db:push" -ForegroundColor Green
