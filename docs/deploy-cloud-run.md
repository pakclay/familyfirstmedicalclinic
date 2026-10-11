# Deploying to Google Cloud Run

Production moved from Vercel to Cloud Run on 2026-10-11 (see `DECISIONS.md`).
The database stays on **Supabase**: only the app moves. Everything runs in
Singapore (`asia-southeast1`), next to the Supabase database. That matters
because every query is a round trip (see the `sin1` entry in `DECISIONS.md`).

How a deploy works: CI passes on `master`, then `.github/workflows/deploy.yml`
runs migrations against Supabase, builds the `Dockerfile`, pushes it to
Artifact Registry and rolls out a new Cloud Run revision. It stays switched
off until the repository variables in step 6 exist.

## Cost

Google requires a billing account even when usage stays inside the free
tier. A clinic's traffic should cost close to nothing, but Google decides
which regions and services are free. **Set a budget alert (step 1)** so a
surprise is an email, not an invoice. `min-instances=0` keeps an idle
service at no compute cost. The trade-off is a few seconds of cold start on
the first request after a quiet spell.

## One-time setup

Run these in **Google Cloud Shell** (console.cloud.google.com → the `>_`
icon). `gcloud` is already installed and signed in there. Change the first
three lines to match your setup.

### 1. Project, billing, budget

```bash
PROJECT_ID=familyfirst-prod
REGION=asia-southeast1
GITHUB_REPO=pakclay/familyfirstmedicalclinic

gcloud projects create "$PROJECT_ID"
gcloud config set project "$PROJECT_ID"
# Link a billing account: console → Billing → Link a billing account, then
# Billing → Budgets & alerts → create a small monthly budget (e.g. $5).
```

### 2. APIs and the image repository

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

gcloud artifacts repositories create familyfirst \
  --repository-format=docker --location="$REGION"

# Keep only the 5 newest images, so storage stays inside the free 0.5 GB.
cat > /tmp/cleanup.json <<'EOF'
[{"name":"keep-recent","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":5}},
 {"name":"delete-rest","action":{"type":"Delete"},"condition":{"tagState":"any"}}]
EOF
gcloud artifacts repositories set-cleanup-policies familyfirst \
  --location="$REGION" --policy=/tmp/cleanup.json
```

### 3. Secrets (copied from Vercel)

Copy the current values from Vercel → Project → Settings → Environment
Variables. Keep exactly the same `DATABASE_URL`, `APP_DATABASE_URL` (the
transaction pooler, port 6543, `?connection_limit=5`) and `AUTH_SECRET`.
Keeping `AUTH_SECRET` the same means nobody is signed out at cutover.

```bash
printf '%s' 'postgresql://…5432/postgres'  | gcloud secrets create database-url     --data-file=-
printf '%s' 'postgresql://…6543/postgres?connection_limit=5' | gcloud secrets create app-database-url --data-file=-
printf '%s' '<AUTH_SECRET from Vercel>'    | gcloud secrets create auth-secret      --data-file=-
```

If you use a real notification provider (`NOTIFICATION_CHANNEL=sms` or
`messenger`), create those secrets the same way (`semaphore-api-key`,
`meta-page-access-token`, `meta-app-secret`). You attach them in step 7.

### 4. Service accounts

There are two accounts. One *runs* the app and can read only the two
runtime secrets. The other *deploys* it from GitHub.

```bash
gcloud iam service-accounts create familyfirst-run --display-name="Family First app runtime"
gcloud iam service-accounts create deployer --display-name="GitHub Actions deployer"

RUN_SA=familyfirst-run@$PROJECT_ID.iam.gserviceaccount.com
DEPLOY_SA=deployer@$PROJECT_ID.iam.gserviceaccount.com

for s in app-database-url auth-secret; do
  gcloud secrets add-iam-policy-binding $s --member="serviceAccount:$RUN_SA" --role=roles/secretmanager.secretAccessor
done
# The deployer reads both DB URLs to run migrations + ensure-app-role.
for s in database-url app-database-url; do
  gcloud secrets add-iam-policy-binding $s --member="serviceAccount:$DEPLOY_SA" --role=roles/secretmanager.secretAccessor
done
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOY_SA" --role=roles/run.developer
gcloud artifacts repositories add-iam-policy-binding familyfirst --location="$REGION" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/artifactregistry.writer
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser
```

### 5. Keyless GitHub → Google auth (Workload Identity Federation)

GitHub doesn't store a Google key. Only workflows running in this repository,
in the `production` environment, can act as the deployer.

```bash
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers create-oidc github \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '$GITHUB_REPO' && assertion.sub == 'repo:$GITHUB_REPO:environment:production'"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$GITHUB_REPO"

echo "GCP_WORKLOAD_IDENTITY_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github"
echo "GCP_SERVICE_ACCOUNT=$DEPLOY_SA"
```

### 6. Create the (public) service with a placeholder

Create the service here rather than from GitHub. Making it public needs
`setIamPolicy`, which the deployer doesn't have and shouldn't have.

```bash
gcloud run deploy familyfirst --region="$REGION" \
  --image=us-docker.pkg.dev/cloudrun/container/hello \
  --service-account="$RUN_SA" --allow-unauthenticated \
  --set-env-vars=NOTIFICATION_CHANNEL=mock
gcloud run services describe familyfirst --region="$REGION" --format='value(status.url)'
# For a real provider instead of mock, later:
#   gcloud run services update familyfirst --region="$REGION" \
#     --update-env-vars=NOTIFICATION_CHANNEL=sms --update-secrets=SEMAPHORE_API_KEY=semaphore-api-key:latest
# (after granting familyfirst-run secretAccessor on that secret).
```

Deploys from GitHub keep these settings. The workflow merges its own
variables with them instead of replacing them.

### 7. GitHub repository variables, then the first deploy

In GitHub, go to Settings → Secrets and variables → Actions → **Variables**
and add:

| Variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | `familyfirst-prod` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | printed by step 5 |
| `GCP_SERVICE_ACCOUNT` | printed by step 5 |
| `APP_URL` | the `run.app` URL printed by step 6 for now; the real domain at cutover |

Then go to Actions → **Deploy** → Run workflow.

## Verify before moving DNS

Use the `https://familyfirst-….run.app` URL printed by the deploy:

1. **Sign-in works.** If it fails with `UntrustedHost`, check `AUTH_URL`.
   Use the `run.app` URL while testing there, then change it to the real
   domain at cutover.
2. **The rate limiter sees real client addresses.** Install a header
   extension (e.g. ModHeader), set `X-Forwarded-For: 1.2.3.4` and
   `X-Real-IP: 1.2.3.4`, and attempt **one** sign-in with a wrong password.
   Then, in the Supabase SQL editor, run:
   `select key, updated_at from rate_limits order by updated_at desc limit 3;`
   The newest `login:…` key must be **your real IP** (whatismyip.com), not
   `1.2.3.4` and not `unknown`. If it isn't, the proxy chain differs from
   what `lib/rate-limit/key.ts` assumes (one trusted hop). Fix that before
   going live, because the login/booking limit would otherwise stop nobody.
3. **HSTS.** `curl -sI https://…run.app/login | grep -i strict-transport`.
4. **Logs.** In the console, go to Cloud Run → familyfirst → Logs. The
   `[server-error]` lines from `instrumentation.ts` and the `[db]` startup
   check appear here. This replaces `vercel logs`.

## Cutover

1. Console → Cloud Run → Manage custom domains → add mapping for the
   clinic's domain (supported in `asia-southeast1`; still a Google
   *preview* feature). Create the DNS records it shows. The TLS
   certificate is issued automatically, which can take up to an hour or so.
   Don't put Firebase Hosting or a load balancer in front without first
   reading the caveat on `parseForwardedFor`, because that adds a proxy hop.
2. Set the `APP_URL` variable to the real domain and run Deploy again. That
   updates `AUTH_URL`/`NEXTAUTH_URL`, which `/q/<token>` status links use.
3. Once traffic is on Cloud Run, in Vercel → Project → Settings → Git, disconnect
   the repository (otherwise both platforms keep running migrations on every
   push, which is harmless but wasteful). Then delete `vercel.json` and the
   Vercel project.

**Rollback** (this replaces `vercel rollback`): Cloud Run → familyfirst →
Revisions → pick the previous one → Manage traffic → 100%. Or run
`gcloud run services update-traffic familyfirst --region=$REGION --to-revisions=<rev>=100`.
Migrations aren't rolled back by this, same as on Vercel.
