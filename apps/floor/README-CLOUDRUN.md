# Floor Panel - Cloud Run Deployment Guide

This guide provides instructions for containerizing the **Floor Panel** application and deploying it to **Google Cloud Run**.

## Prerequisites

1. **Google Cloud SDK**: Install the [gcloud CLI](https://cloud.google.com/sdk/docs/install).
2. **Docker**: Ensure Docker is installed and running locally (if building locally).
3. **GCP Project**: Set up a Google Cloud Project with billing enabled.
4. **Permissions**: Ensure you have the `Cloud Run Admin`, `Artifact Registry Writer`, and `Storage Admin` roles on your GCP account.

---

## 1. Setup GCP Artifact Registry

Create a repository in Artifact Registry to host your Docker image:

```bash
gcloud artifacts repositories create floor-panel-repo \
    --repository-format=docker \
    --location=asia-east1 \
    --description="Docker repository for floor panel"
```

Configure Docker to authenticate with Artifact Registry:

```bash
gcloud auth configure-docker asia-east1-docker.pkg.dev
```

---

## 2. Build the Docker Image

Navigate to the Floor Panel directory:

```bash
cd apps/floor
```

### Option A: Build Locally (Requires Docker)
Run `docker build` and pass your production environment variables using `--build-arg`:

```bash
docker build \
  --build-arg VITE_SUPABASE_URL="https://your-supabase-url.supabase.co" \
  --build-arg VITE_SUPABASE_ANON_KEY="your-anon-key-here" \
  -t asia-east1-docker.pkg.dev/[PROJECT_ID]/floor-panel-repo/floor-panel:latest .
```
*(Replace `[PROJECT_ID]` with your actual Google Cloud Project ID)*

### Option B: Build via Cloud Build (No Local Docker Required)
You can delegate the build process to Google Cloud Build using the local context:

```bash
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions=_VITE_SUPABASE_URL="https://your-supabase-url.supabase.co",_VITE_SUPABASE_ANON_KEY="your-anon-key-here" \
  .
```
*(See the Appendix below if you wish to use a `cloudbuild.yaml` file)*

---

## 3. Push the Image to Artifact Registry

If you chose **Option A** (built locally), push the image to GCP:

```bash
docker push asia-east1-docker.pkg.dev/[PROJECT_ID]/floor-panel-repo/floor-panel:latest
```

---

## 4. Deploy to Google Cloud Run

Deploy the container image to Cloud Run:

```bash
gcloud run deploy floor-panel \
  --image=asia-east1-docker.pkg.dev/[PROJECT_ID]/floor-panel-repo/floor-panel:latest \
  --region=asia-east1 \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080
```

Once the deployment completes, the gcloud CLI will output the Service URL (e.g., `https://floor-panel-xxxxxx-de.a.run.app`).

---

## Appendix: Cloud Build Configuration (Optional)

If you prefer using **Cloud Build**, create a `cloudbuild.yaml` file in `apps/floor/` with the following content:

```yaml
steps:
  # Build the container image
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '--build-arg'
      - 'VITE_SUPABASE_URL=${_VITE_SUPABASE_URL}'
      - '--build-arg'
      - 'VITE_SUPABASE_ANON_KEY=${_VITE_SUPABASE_ANON_KEY}'
      - '-t'
      - 'asia-east1-docker.pkg.dev/$PROJECT_ID/floor-panel-repo/floor-panel:$COMMIT_SHA'
      - '-t'
      - 'asia-east1-docker.pkg.dev/$PROJECT_ID/floor-panel-repo/floor-panel:latest'
      - '.'

  # Push the container image to Artifact Registry
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'push'
      - 'asia-east1-docker.pkg.dev/$PROJECT_ID/floor-panel-repo/floor-panel:latest'

images:
  - 'asia-east1-docker.pkg.dev/$PROJECT_ID/floor-panel-repo/floor-panel:latest'
```
