#!/usr/bin/env bash
set -Eeuo pipefail

# Activates the verified B2B release contained in this deploy-branch checkout. The production server needs
# no Node or Vite: GitHub Actions built, tested and checksummed the release. Releases are retained by source commit
# outside the public web root; activation is additive and switches index.html last.
repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$repository_root/scripts/b2b-release-common.sh"
for command in rsync sha256sum php mv cp mkdir find sort stat tr grep rm xargs date sed; do b2b_require_command "$command"; done
gc_dry_run="${B2B_RELEASE_GC_DRY_RUN:-0}"
[[ "$gc_dry_run" == "0" || "$gc_dry_run" == "1" ]] || b2b_fail "B2B_RELEASE_GC_DRY_RUN trebuie să fie 0 sau 1."
release_retention="${B2B_RELEASE_RETENTION:-5}"
[[ "$release_retention" =~ ^[0-9]+$ && "$release_retention" -ge 2 ]] || b2b_fail "B2B_RELEASE_RETENTION trebuie să fie cel puțin 2."

dist_path="$repository_root/dist"
deploy_path="$(b2b_resolve_path "${B2B_DEPLOY_PATH:-$HOME/public_html/b2b.arasyahome.ro}")"
storage_path="$(b2b_resolve_path "${B2B_RELEASE_STORAGE_PATH:-$HOME/arasya-b2b-releases}")"
b2b_guard_targets "$deploy_path" "$storage_path" "$repository_root"

[[ -f "$repository_root/SHA256SUMS" ]] || b2b_fail "Lipsește manifestul SHA256 al pachetului deploy."
(cd -- "$repository_root" && sha256sum -c SHA256SUMS >/dev/null 2>&1) || b2b_fail "Integritatea pachetului deploy a eșuat."
/bin/bash "$repository_root/scripts/validate-b2b-release.sh" "$dist_path" >/dev/null || b2b_fail "Release-ul din pachet este invalid."
commit="$(b2b_release_commit "$dist_path")"; b2b_validate_sha "$commit"

if [[ "${DRY_RUN:-0}" == "1" ]]; then b2b_log "Dry-run valid pentru commit $commit → $deploy_path"; exit 0; fi

staging="$storage_path/.staging-$commit-$$"; retained="$storage_path/$commit"
cleanup() { [[ -d "$staging" ]] && rm -rf -- "$staging"; return 0; }
trap cleanup EXIT
mkdir -p -- "$storage_path" "$deploy_path"
chmod 0750 "$storage_path"
resolved_storage="$(cd -- "$storage_path" && pwd -P)"
[[ "${retained%/*}" == "$resolved_storage" ]] || b2b_fail "Release-ul a ieșit din stocarea controlată."

if [[ -d "$retained" ]]; then
  /bin/bash "$repository_root/scripts/validate-b2b-release.sh" "$retained" "$commit" >/dev/null || b2b_fail "Release-ul reținut $commit este corupt."
else
  mkdir -- "$staging"
  rsync --archive --delete "$dist_path/" "$staging/"
  /bin/bash "$repository_root/scripts/validate-b2b-release.sh" "$staging" "$commit" >/dev/null || b2b_fail "Release-ul staged este invalid."
  mv -- "$staging" "$retained"
fi

b2b_activate_release "$retained" "$deploy_path" "$storage_path" "$commit" deploy
/bin/bash "$repository_root/scripts/validate-b2b-release.sh" "$retained" "$commit" >/dev/null
b2b_gc_releases "$storage_path" "$deploy_path" "$release_retention" "$gc_dry_run"
trap - EXIT
b2b_log "Activat commit B2B: $commit"
