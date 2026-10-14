#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="kdxmwqxlhswcgwanlump"

echo "=== Deploying to Supabase Production (${PROJECT_REF}) ==="

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "Checking Supabase login status..."
  if ! npx supabase projects list >/dev/null 2>&1; then
    echo "ERROR: SUPABASE_ACCESS_TOKEN is not set and CLI is not logged in."
    echo "Please set SUPABASE_ACCESS_TOKEN or run 'npx supabase login'."
    echo "To generate a token: https://supabase.com/dashboard/account/tokens"
    exit 1
  fi
fi

echo "1. Pushing database migrations to ${PROJECT_REF}..."
npx supabase db push --project-ref "${PROJECT_REF}"

echo "2. Deploying Edge Functions..."
echo "  Deploying trip-api..."
npx supabase functions deploy trip-api --project-ref "${PROJECT_REF}"

echo "  Deploying member-api..."
npx supabase functions deploy member-api --project-ref "${PROJECT_REF}"

echo "  Deploying auth-api..."
npx supabase functions deploy auth-api --project-ref "${PROJECT_REF}"

echo "=== Production Deployment Complete ==="
