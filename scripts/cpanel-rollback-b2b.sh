#!/usr/bin/env bash
set -Eeuo pipefail

# Re-activates a retained, checksum-verified B2B release: a specific source commit or --previous.
# DRY_RUN=1 validates the candidate and prints what would be activated without changing anything.
repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$repository_root/scripts/b2b-release-common.sh"
for command in rsync sha256sum php mv cp find sort tr grep date sed; do b2b_require_command "$command"; done
[[ $# -eq 1 ]] || b2b_fail "Utilizare: cpanel-rollback-b2b.sh <sourceCommit|--previous>"
deploy_path="$(b2b_resolve_path "${B2B_DEPLOY_PATH:-$HOME/public_html/b2b.arasyahome.ro}")"
storage_path="$(b2b_resolve_path "${B2B_RELEASE_STORAGE_PATH:-$HOME/arasya-b2b-releases}")"
b2b_guard_targets "$deploy_path" "$storage_path" "$repository_root"
current="$(b2b_read_pointer "$storage_path/active-release")"
if [[ "$1" == "--previous" ]]; then target="$(b2b_read_pointer "$storage_path/previous-release")"; else target="$1"; b2b_validate_sha "$target"; fi
[[ "$target" != "$current" ]] || b2b_fail "Release-ul cerut este deja activ."
retained="$storage_path/$target"; resolved_storage="$(cd -- "$storage_path" && pwd -P)"
resolved_retained="$(cd -- "$retained" 2>/dev/null && pwd -P)" || b2b_fail "Release-ul de rollback nu există."
[[ "${resolved_retained%/*}" == "$resolved_storage" && "${resolved_retained##*/}" == "$target" ]] || b2b_fail "Release-ul de rollback a ieșit din stocarea controlată."
/bin/bash "$repository_root/scripts/validate-b2b-release.sh" "$resolved_retained" "$target" >/dev/null || b2b_fail "Release-ul de rollback $target nu trece validarea."
if [[ "${DRY_RUN:-0}" == "1" ]]; then b2b_log "Ar activa commit B2B: $target (activ acum: $current)"; exit 0; fi
b2b_activate_release "$resolved_retained" "$deploy_path" "$storage_path" "$target" rollback
b2b_log "Activat commit B2B: $target"
