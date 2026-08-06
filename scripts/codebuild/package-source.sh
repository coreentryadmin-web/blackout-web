#!/usr/bin/env bash
# Package the repo as a CodeBuild S3 source and upload it.
#
# WHY AN S3 SOURCE (and not a GitHub source): a CodeBuild GitHub source needs a durable stored
# credential (OAuth app or a long-lived PAT) registered with `codebuild import-source-credentials`.
# The whole point of this pipeline is that a GitHub outage must not be able to freeze production
# deploys — pointing the build at github.com puts GitHub straight back on the critical path. An S3
# source removes GitHub from the build path entirely. The tradeoff is that pushing to `main` cannot
# auto-trigger a build; that is intentional for now (manual `start-build` only). If an auto-trigger
# is wanted later, add a GitHub source + webhook, and note the buildspec already resolves the image
# tag from CODEBUILD_RESOLVED_SOURCE_VERSION in that case with no edits needed.
#
# The zip is `git archive` of a committed ref — tracked files only, no node_modules, no .next, no
# .git, no local dirt — plus a single generated `.codebuild-source-commit` file carrying the SHA.
# That file is how the build knows which commit it is building: with an S3 source there is no git
# metadata in the build container and CODEBUILD_RESOLVED_SOURCE_VERSION is the S3 version id, not
# a commit SHA. The image tag must be the real SHA so an image is always traceable to a commit.
#
# Usage:
#   scripts/codebuild/package-source.sh [ref]        # default: origin/main
#
# Then start a build (build+push only — this does NOT deploy):
#   aws codebuild start-build --project-name blackout-web-image-build --region us-east-1
set -euo pipefail

REF="${1:-origin/main}"
BUCKET="${CODEBUILD_SOURCE_BUCKET:-blackout-codebuild-177922194517}"
KEY="${CODEBUILD_SOURCE_KEY:-source/blackout-web-source.zip}"
REGION="${AWS_REGION:-us-east-1}"

SHA="$(git rev-parse "${REF}")"
if ! printf '%s' "${SHA}" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "FATAL: '${REF}' did not resolve to a 40-char commit SHA (got '${SHA}')." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
ZIP="${WORK}/source.zip"

echo "Packaging ${REF} @ ${SHA}"
git archive --format=zip "${SHA}" -o "${ZIP}"

# Stamp the commit INTO the archive. Written to a staging dir and added with `zip -j` so the entry
# lands at the archive root next to deploy/Dockerfile, where the buildspec looks for it.
printf '%s\n' "${SHA}" > "${WORK}/.codebuild-source-commit"
( cd "${WORK}" && zip -q -j "${ZIP}" .codebuild-source-commit )

echo "Uploading to s3://${BUCKET}/${KEY}"
aws s3 cp "${ZIP}" "s3://${BUCKET}/${KEY}" --region "${REGION}" --only-show-errors

# Keep an immutable per-SHA copy alongside the fixed key the project reads. The project's source
# location is a single fixed key that every package overwrites, so without this there is no way to
# re-run an older build. The bucket lifecycle expires everything under source/ after 30 days.
aws s3 cp "${ZIP}" "s3://${BUCKET}/source/archive/blackout-web-${SHA}.zip" --region "${REGION}" --only-show-errors

echo "Done. Source ${SHA} is staged at s3://${BUCKET}/${KEY}"
echo "Start a build with:"
echo "  aws codebuild start-build --project-name blackout-web-image-build --region ${REGION}"
