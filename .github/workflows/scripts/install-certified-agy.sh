#!/usr/bin/env bash
# Extract only the officially pinned Antigravity CLI binary after verifying both hashes.
# Usage: install-certified-agy.sh ARCHIVE ARCHIVE_SHA256 BINARY_SHA256 DESTINATION
set -euo pipefail

if [[ "$#" -ne 4 ]]; then
  echo 'AGY_INSTALL_ARGUMENTS_INVALID' >&2
  exit 1
fi
archive="$1"
archive_sha="$2"
binary_sha="$3"
destination="$4"

if [[ ! "$archive_sha" =~ ^[0-9a-f]{64}$ || ! "$binary_sha" =~ ^[0-9a-f]{64}$ ||
      "$destination" != "$HOME/.local/bin/agy" || ! -f "$archive" || -L "$archive" ]]; then
  echo 'AGY_INSTALL_ARGUMENTS_INVALID' >&2
  exit 1
fi

if ! printf '%s  %s\n' "$archive_sha" "$archive" | sha256sum --check --status; then
  echo 'AGY_ARCHIVE_DIGEST_MISMATCH' >&2
  exit 1
fi

if ! entries="$(tar -tzf "$archive")"; then
  echo 'AGY_ARCHIVE_STRUCTURE_INVALID' >&2
  exit 1
fi

candidate_entry=''
while IFS= read -r entry; do
  if [[ "$entry" == 'antigravity' || "$entry" == './antigravity' || "$entry" == */antigravity ]]; then
    if [[ -n "$candidate_entry" || "$entry" == /* || "$entry" == *'/../'* || "$entry" == '../'* ]]; then
      echo 'AGY_ARCHIVE_STRUCTURE_INVALID' >&2
      exit 1
    fi
    candidate_entry="$entry"
  fi
done <<< "$entries"
if [[ -z "$candidate_entry" ]]; then
  echo 'AGY_ARCHIVE_STRUCTURE_INVALID' >&2
  exit 1
fi

temp_dir="$(mktemp -d)"
trap 'rm -rf -- "$temp_dir"' EXIT
if ! tar -xOzf "$archive" -- "$candidate_entry" > "$temp_dir/agy"; then
  echo 'AGY_ARCHIVE_STRUCTURE_INVALID' >&2
  exit 1
fi
if ! printf '%s  %s\n' "$binary_sha" "$temp_dir/agy" | sha256sum --check --status; then
  echo 'AGY_BINARY_DIGEST_MISMATCH' >&2
  exit 1
fi

install -d -m 0755 "$HOME/.local/bin"
install -m 0755 "$temp_dir/agy" "$destination"
echo 'AGY_CERTIFIED_BINARY_INSTALLED'
