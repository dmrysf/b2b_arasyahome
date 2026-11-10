#!/usr/bin/env bash
set -Eeuo pipefail

# Exercises the real B2B deploy, rollback and validator scripts against a throw-away fake cPanel home.
workspace="$(mktemp -d "${TMPDIR:-/tmp}/arasya-b2b-deploy-test.XXXXXX")"
[[ "$workspace" == *"/arasya-b2b-deploy-test."* ]] || exit 1
cleanup() { rm -rf -- "$workspace"; }
trap cleanup EXIT
fail() { printf 'FAIL B2B deploy test: %s\n' "$1" >&2; exit 1; }
scripts=(scripts/cpanel-deploy.sh scripts/cpanel-rollback-b2b.sh scripts/b2b-release-common.sh scripts/validate-b2b-release.sh scripts/generate-sha256s.sh)
[[ -f dist/index.html && -f dist/.htaccess ]] || fail "run the production build first"

# cPanel deploy shells have no /dev/fd; process substitution there silently skips loops.
if grep -nE '<\(|>\(' "${scripts[@]}"; then fail "deploy scripts must not use process substitution"; fi
if grep -nE '^[^#]*/dev/fd' "${scripts[@]}"; then fail "deploy scripts must not use /dev/fd"; fi

create_release() {
  local target="$1" sha="$2" marker="$3" version="${4:-0.10.0}"
  mkdir -p "$target/dist" "$target/scripts"
  cp -R dist/. "$target/dist/"
  rm -f "$target/dist/release.json" "$target/dist/SHA256SUMS"
  printf 'window.__ARASYA_RELEASE_MARKER__=%q;\n' "$marker" > "$target/dist/assets/release-$marker.js"
  sed "s#</body>#<script type=\"module\" src=\"/assets/release-$marker.js\"></script></body>#" "$target/dist/index.html" > "$target/dist/index.next"
  mv "$target/dist/index.next" "$target/dist/index.html"
  printf '{\n  "commit": "%s",\n  "version": "%s",\n  "builtAt": "2026-10-04T00:00:00Z",\n  "preview": false\n}\n' "$sha" "$version" > "$target/dist/release.json"
  /bin/bash scripts/generate-sha256s.sh "$target/dist"
  /bin/bash scripts/validate-b2b-release.sh "$target/dist" "$sha" >/dev/null
  cp .cpanel.yml "$target/.cpanel.yml"
  cp "${scripts[@]}" "$target/scripts/"
  chmod +x "$target/scripts/"*.sh
  /bin/bash "$target/scripts/generate-sha256s.sh" "$target"
}
active() { tr -d '[:space:]' < "$storage/active-release"; }

sha_a="$(printf 'a%.0s' {1..40})"; sha_b="$(printf 'b%.0s' {1..40})"; sha_c="$(printf 'c%.0s' {1..40})"; sha_d="$(printf 'd%.0s' {1..40})"
for name in a b c d; do sha_var="sha_$name"; create_release "$workspace/release-$name" "${!sha_var}" "$name"; done

test_home="$workspace/home"; live="$test_home/public_html/b2b.arasyahome.ro"; storage="$test_home/arasya-b2b-releases"
mkdir -p "$live/.well-known" "$live/cgi-bin" "$test_home/public_html/dashboard.arasyahome.ro" "$test_home/staff.arasyahome.ro" "$test_home/api.arasyahome.ro" "$test_home/arasya-config" "$test_home/arasya-operations-api"
printf 'acme\n' > "$live/.well-known/acme.txt"; printf 'cgi\n' > "$live/cgi-bin/keep.txt"
printf 'wordpress\n' > "$test_home/public_html/index.php"; printf 'dashboard\n' > "$test_home/public_html/dashboard.arasyahome.ro/index.html"; printf 'staff\n' > "$test_home/staff.arasyahome.ro/index.html"
printf 'api\n' > "$test_home/api.arasyahome.ro/index.php"; printf 'secret\n' > "$test_home/arasya-config/secrets.json"
snapshot() { (cd "$test_home" && find public_html/index.php public_html/dashboard.arasyahome.ro staff.arasyahome.ro api.arasyahome.ro arasya-config arasya-operations-api -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum); }
before_roots="$(snapshot)"

# Correct root only.
for wrong in "$test_home/public_html" "$test_home/staff.arasyahome.ro" "$test_home/api.arasyahome.ro" "$test_home" "$test_home/public_html/trendhome.ro" "$test_home/public_html/b2b" "$test_home/public_html/dashboard.arasyahome.ro"; do
  if HOME="$test_home" B2B_DEPLOY_PATH="$wrong" DRY_RUN=1 /bin/bash "$workspace/release-a/scripts/cpanel-deploy.sh" >/dev/null 2>&1; then fail "deploy accepted forbidden root $wrong"; fi
done
if HOME="$test_home" B2B_RELEASE_STORAGE_PATH="$test_home/public_html/releases" DRY_RUN=1 /bin/bash "$workspace/release-a/scripts/cpanel-deploy.sh" >/dev/null 2>&1; then fail "deploy accepted public release storage"; fi
if HOME="$test_home" B2B_RELEASE_STORAGE_PATH="$test_home/arasya-dashboard-releases" DRY_RUN=1 /bin/bash "$workspace/release-a/scripts/cpanel-deploy.sh" >/dev/null 2>&1; then fail "deploy accepted the Dashboard release storage"; fi
if HOME="$test_home" B2B_RELEASE_STORAGE_PATH="$test_home/arasya-staff-releases" DRY_RUN=1 /bin/bash "$workspace/release-a/scripts/cpanel-deploy.sh" >/dev/null 2>&1; then fail "deploy accepted the Staff release storage"; fi
HOME="$test_home" DRY_RUN=1 /bin/bash "$workspace/release-a/scripts/cpanel-deploy.sh" | grep -qF "$(cd "$live" && pwd -P)" || fail "dry-run did not target the B2B root"
[[ ! -e "$storage/active-release" ]] || fail "dry-run changed the active pointer"

# Release metadata must match the source commit.
mismatch="$workspace/mismatch"; cp -R "$workspace/release-a/dist" "$mismatch"
if /bin/bash scripts/validate-b2b-release.sh "$mismatch" "$sha_b" >/dev/null 2>&1; then fail "validator accepted a release for another source commit"; fi
sed 's/"preview": false/"preview": true/' "$mismatch/release.json" > "$mismatch/release.next"; mv "$mismatch/release.next" "$mismatch/release.json"; /bin/bash scripts/generate-sha256s.sh "$mismatch"
if /bin/bash scripts/validate-b2b-release.sh "$mismatch" >/dev/null 2>&1; then fail "validator accepted a preview release"; fi

# Invalid checksum aborts before anything changes.
corrupt="$workspace/corrupt"; cp -R "$workspace/release-a" "$corrupt"; printf '\n<!-- tampered -->\n' >> "$corrupt/dist/index.html"
if HOME="$test_home" /bin/bash "$corrupt/scripts/cpanel-deploy.sh" >/dev/null 2>&1; then fail "deploy accepted a tampered package"; fi
[[ ! -e "$storage/active-release" && ! -f "$live/index.html" ]] || fail "tampered package changed the live root"
unlisted="$workspace/unlisted"; cp -R "$workspace/release-a/dist" "$unlisted"; printf 'x' > "$unlisted/assets/extra.js"
if /bin/bash scripts/validate-b2b-release.sh "$unlisted" >/dev/null 2>&1; then fail "validator accepted an unlisted extra file"; fi

# Deploy A, then B: B active, A recorded as previous, both asset sets kept for rollback.
HOME="$test_home" /bin/bash "$workspace/release-a/scripts/cpanel-deploy.sh" >/dev/null
[[ "$(active)" == "$sha_a" ]] || fail "release A was not activated"
grep -q 'release-a.js' "$live/index.html" || fail "release A index was not activated"
HOME="$test_home" /bin/bash "$workspace/release-b/scripts/cpanel-deploy.sh" >/dev/null
[[ "$(active)" == "$sha_b" && "$(tr -d '[:space:]' < "$storage/previous-release")" == "$sha_a" ]] || fail "release B / previous pointer is wrong"
[[ -f "$live/assets/release-a.js" && -f "$live/assets/release-b.js" ]] || fail "additive activation removed rollback assets"
grep -q "deploy $sha_b $sha_a" "$storage/release-history.log" || fail "release history is missing the B deploy"
[[ "$(stat -c '%a' "$storage" 2>/dev/null || stat -f '%Lp' "$storage")" == "750" ]] || fail "release storage is not private"

# A partial release cannot activate: a failure before the entrypoint switch keeps B serving.
if HOME="$test_home" ARASYA_TEST_FAIL_BEFORE_INDEX=1 /bin/bash "$workspace/release-d/scripts/cpanel-deploy.sh" >/dev/null 2>&1; then fail "simulated pre-index failure succeeded"; fi
grep -q 'release-b.js' "$live/index.html" || fail "pre-index failure replaced the active index"
[[ "$(active)" == "$sha_b" ]] || fail "pre-index failure changed the pointer"
missing="$workspace/missing-asset"; cp -R "$workspace/release-c" "$missing"; rm "$missing/dist/assets/release-c.js"
/bin/bash scripts/generate-sha256s.sh "$missing/dist"; /bin/bash scripts/generate-sha256s.sh "$missing"
if HOME="$test_home" /bin/bash "$missing/scripts/cpanel-deploy.sh" >/dev/null 2>&1; then fail "deploy accepted a release with a missing referenced asset"; fi
[[ "$(active)" == "$sha_b" ]] || fail "incomplete release changed the pointer"

# Rollback targets the previous verified release; dry-run changes nothing.
HOME="$test_home" DRY_RUN=1 /bin/bash "$workspace/release-b/scripts/cpanel-rollback-b2b.sh" --previous | grep -q "$sha_a" || fail "rollback dry-run did not name release A"
[[ "$(active)" == "$sha_b" ]] || fail "rollback dry-run changed the pointer"
HOME="$test_home" /bin/bash "$workspace/release-b/scripts/cpanel-rollback-b2b.sh" --previous >/dev/null
[[ "$(active)" == "$sha_a" ]] || fail "--previous did not activate A"
grep -q 'release-a.js' "$live/index.html" || fail "rollback did not restore the A entrypoint"
grep -q "rollback $sha_a $sha_b" "$storage/release-history.log" || fail "release history is missing the rollback"
HOME="$test_home" /bin/bash "$workspace/release-a/scripts/cpanel-rollback-b2b.sh" "$sha_b" >/dev/null
[[ "$(active)" == "$sha_b" ]] || fail "explicit rollback to B failed"
if HOME="$test_home" /bin/bash "$workspace/release-a/scripts/cpanel-rollback-b2b.sh" "$sha_c" >/dev/null 2>&1; then fail "rollback accepted a release that was never retained"; fi

# A corrupted retained release is refused for rollback.
printf '\ncorrupt\n' >> "$storage/$sha_a/index.html"
if HOME="$test_home" /bin/bash "$workspace/release-b/scripts/cpanel-rollback-b2b.sh" "$sha_a" >/dev/null 2>&1; then fail "rollback accepted a corrupt retained release"; fi
[[ "$(active)" == "$sha_b" ]] || fail "corrupt rollback changed the pointer"

# Refund guard: a rollback to B2B before 0.10.0 asks the active API release (its own check-rollback.php) how many refund
# movements the ledger holds, and is refused unless the answer is a readable zero. Fake API roots stand in for production.
sha_e="$(printf 'e%.0s' {1..40})"; sha_f="$(printf 'f%.0s' {1..40})"
create_release "$workspace/release-e" "$sha_e" e 0.9.1
create_release "$workspace/release-f" "$sha_f" f 0.10.0
HOME="$test_home" /bin/bash "$workspace/release-e/scripts/cpanel-deploy.sh" >/dev/null
HOME="$test_home" /bin/bash "$workspace/release-f/scripts/cpanel-deploy.sh" >/dev/null
[[ "$(active)" == "$sha_f" ]] || fail "release F was not activated"
fake_api() {
  local root="$1" version="$2" api_sha; api_sha="$(printf '9%.0s' {1..40})"
  mkdir -p "$root/releases/$api_sha/bin"; printf '%s\n' "$api_sha" > "$root/active-release"
  printf '{"sourceCommit":"%s","version":"%s"}\n' "$api_sha" "$version" > "$root/releases/$api_sha/release.json"
  # Stand-in for bin/check-rollback.php: answers from FAKE_REFUNDS ("none" = the field is missing, unset = the check fails).
  printf '%s\n' '<?php $n = getenv("FAKE_REFUNDS"); if ($n === false) exit(1); $s = ["openFinanceCollections" => 0]; if ($n !== "none") $s["refundMovements"] = (int) $n; echo json_encode(["safe" => true, "state" => $s]);' > "$root/releases/$api_sha/bin/check-rollback.php"
}
api268="$workspace/api-268"; fake_api "$api268" 2.68.0
api266="$workspace/api-266"; fake_api "$api266" 2.66.0
refused_rollback() {
  local label="$1" expect="$2"; shift 2; local output
  if output="$(env HOME="$test_home" "$@" /bin/bash "$workspace/release-f/scripts/cpanel-rollback-b2b.sh" "$sha_e" 2>&1)"; then fail "refund guard accepted: $label"; fi
  [[ "$output" == *"$expect"* ]] || fail "refund guard refused for another reason ($label): $output"
  [[ "$(active)" == "$sha_f" ]] || fail "a refused rollback changed the pointer ($label)"
}
refused_rollback 'refund movements exist' 'registrul are 2 mișcări de rambursare' ARASYA_API_ROOT_PATH="$api268" FAKE_REFUNDS=2
refused_rollback 'refund check fails' 'verificarea mișcărilor de rambursare nu a putut rula' ARASYA_API_ROOT_PATH="$api268"
refused_rollback 'API does not report refunds' 'nu raportează mișcările de rambursare' ARASYA_API_ROOT_PATH="$api268" FAKE_REFUNDS=none
refused_rollback 'no active API release' 'release-ul API activ nu poate fi citit' ARASYA_API_ROOT_PATH="$workspace/no-api"
if HOME="$test_home" ARASYA_API_ROOT_PATH="$api268" FAKE_REFUNDS=2 DRY_RUN=1 /bin/bash "$workspace/release-f/scripts/cpanel-rollback-b2b.sh" "$sha_e" >/dev/null 2>&1; then fail "refund guard skipped in dry-run"; fi
HOME="$test_home" ARASYA_API_ROOT_PATH="$api268" FAKE_REFUNDS=0 /bin/bash "$workspace/release-f/scripts/cpanel-rollback-b2b.sh" "$sha_e" >/dev/null || fail "refund guard refused with zero refund movements"
[[ "$(active)" == "$sha_e" ]] || fail "rollback to 0.9.1 with zero refunds did not activate"
HOME="$test_home" /bin/bash "$workspace/release-e/scripts/cpanel-rollback-b2b.sh" "$sha_f" >/dev/null || fail "rollback to 0.10.0 needed the refund guard"
[[ "$(active)" == "$sha_f" ]] || fail "rollback to 0.10.0 did not activate"
HOME="$test_home" ARASYA_API_ROOT_PATH="$api266" /bin/bash "$workspace/release-f/scripts/cpanel-rollback-b2b.sh" "$sha_e" >/dev/null || fail "refund guard refused although the active API predates refunds"
[[ "$(active)" == "$sha_e" ]] || fail "rollback with API 2.66.0 did not activate"

[[ -f "$live/.well-known/acme.txt" && -f "$live/cgi-bin/keep.txt" ]] || fail "preserved live directories changed"
[[ "$(snapshot)" == "$before_roots" ]] || fail "deploy touched WordPress, Dashboard, Staff, API or config roots"
printf 'PASS B2B releases deploy only to b2b.arasyahome.ro, verify checksums and provenance, survive partial failure, roll back to verified releases, and never roll back below 0.10.0 while refund movements exist.\n'
