#!/usr/bin/env bash
# Builds the iPhone app and uploads it to TestFlight (Mac only).
#
# Signing uses the Apple account signed in to Xcode (Xcode → Settings → Accounts).
# The upload uses an App Store Connect API key: put AuthKey_<KEY_ID>.p8 in
# ~/.appstoreconnect/private_keys/ and set ASC_KEY_ID and ASC_ISSUER_ID (see ios/README.md).
# Nothing secret is stored in the repository.
#
#   ASC_KEY_ID=… ASC_ISSUER_ID=… scripts/ios-testflight.sh [--skip-upload]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/build/testflight"
BUILD_NUMBER="${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
SKIP_UPLOAD=0
[[ "${1:-}" == "--skip-upload" ]] && SKIP_UPLOAD=1

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

if [[ "$SKIP_UPLOAD" -eq 0 ]]; then
  [[ -n "${ASC_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" ]] || fail "Set ASC_KEY_ID and ASC_ISSUER_ID to your App Store Connect API key's IDs."
  [[ -f "$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8" ]] || fail "Put AuthKey_${ASC_KEY_ID}.p8 in ~/.appstoreconnect/private_keys/."
fi
command -v xcodegen >/dev/null || fail "Install XcodeGen first: brew install xcodegen"

mkdir -p "$OUT"
archive="$OUT/Passclip-$BUILD_NUMBER.xcarchive"
export_dir="$OUT/export-$BUILD_NUMBER"
options="$OUT/ExportOptions.plist"

log "Generating the Xcode project"
xcodegen generate --spec "$ROOT/ios/project.yml" --project "$ROOT/ios" >/dev/null

log "Archiving build $BUILD_NUMBER (log: $OUT/archive-$BUILD_NUMBER.log)"
xcodebuild -project "$ROOT/ios/Passclip.xcodeproj" -scheme Passclip -configuration Release \
  -destination "generic/platform=iOS" -archivePath "$archive" -allowProvisioningUpdates \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" archive >"$OUT/archive-$BUILD_NUMBER.log" 2>&1 \
  || fail "Archive failed. See $OUT/archive-$BUILD_NUMBER.log"

cat >"$options" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST

log "Exporting the app (log: $OUT/export-$BUILD_NUMBER.log)"
xcodebuild -exportArchive -archivePath "$archive" -exportPath "$export_dir" -exportOptionsPlist "$options" \
  -allowProvisioningUpdates >"$OUT/export-$BUILD_NUMBER.log" 2>&1 \
  || fail "Export failed. See $OUT/export-$BUILD_NUMBER.log"
ipa="$export_dir/Passclip.ipa"
[[ -f "$ipa" ]] || fail "No Passclip.ipa in $export_dir"

if [[ "$SKIP_UPLOAD" -eq 1 ]]; then
  log "Skipped the upload. App: $ipa"
  exit 0
fi

log "Uploading to App Store Connect"
for attempt in 1 2 3; do
  if xcrun altool --upload-app -f "$ipa" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" >"$OUT/upload-$BUILD_NUMBER.log" 2>&1; then
    log "Uploaded build $BUILD_NUMBER. It shows in TestFlight after Apple finishes processing (usually 5 to 30 minutes)."
    exit 0
  fi
  log "Upload attempt $attempt failed; see $OUT/upload-$BUILD_NUMBER.log"
  sleep 10
done
fail "Upload failed. See $OUT/upload-$BUILD_NUMBER.log"
