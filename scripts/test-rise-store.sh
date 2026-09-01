#!/usr/bin/env bash
# Compiles and runs the RiseStore behaviour tests.
#
# RiseStore imports only Foundation, so this works on any machine with a Swift
# toolchain — it does not need Xcode, a simulator, or a device.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "SKIP: swiftc not installed"
  exit 0
fi

build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT

# Swift only allows top-level statements in a file called main.swift.
cp "$root/scripts/test-rise-store.swift" "$build_dir/main.swift"

swiftc -o "$build_dir/rise-store-tests" \
  "$root/ios/TheRise/TheRise/RiseStore.swift" \
  "$build_dir/main.swift"

# Keep the test's writes out of the real Application Support directory.
HOME="$build_dir" XDG_DATA_HOME="$build_dir/data" TMPDIR="$build_dir/tmp" \
  mkdir -p "$build_dir/data" "$build_dir/tmp"
HOME="$build_dir" XDG_DATA_HOME="$build_dir/data" TMPDIR="$build_dir/tmp" \
  "$build_dir/rise-store-tests"
