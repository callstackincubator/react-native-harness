#!/usr/bin/env bash
# Stops the simulator services that cost the most CPU in a test run and
# silences the noisiest log subsystems, so a freshly booted simulator stops
# competing with the app under test on small CI runners.
#
# Usage: slim-ios-simulator.sh <udid>
#
# Run it right after `simctl boot`. Every service needs both `disable` and
# `bootout`: disable alone does not stop on-demand launches later in the boot.
# The state lives in the simulator's memory, so it has to be applied after
# every boot.
#
# Measured on the iOS 26.4 runtime (23E254a): these labels account for about
# 90% of the CPU time that stopping all 57 candidate services saved over the
# first 12 minutes after boot. mediaanalysisd alone is about a third of all
# guest CPU time, in a burst of about three cores for over a minute.
set -uo pipefail

export udid="${1:?usage: slim-ios-simulator.sh <udid>}"

# Kept on purpose (Harness or the app depends on them): launchd_sim,
# SpringBoard, backboardd, runningboardd, PosterBoard, logd, diagnosticd,
# ReportCrash, tccd, testmanagerd, installd, lsd, securityd, trustd, cfprefsd,
# SimRenderServer, locationd. searchd is kept too: stopping it was followed by
# a runaway Spotlight process once, and it saves little.
labels=(
  # Photo and media analysis; the single largest cost after first boot.
  com.apple.mediaanalysisd
  com.apple.mediaanalysisd.service
  com.apple.photoanalysisd
  # Home screen widgets; chronod launches every widget extension.
  com.apple.chronod
  # Shortcuts, Siri and Apple Intelligence.
  com.apple.siriactionsd
  com.apple.assistantd
  com.apple.intelligenceplatformd
  com.apple.biomed
  # Health and fitness.
  com.apple.healthd
  com.apple.healthappd
  com.apple.fitnessintelligenced
)

# The simulator rejects a system-wide log level, but accepts it per subsystem.
# These were the loudest at idle; Harness reads none of them.
quiet_subsystems=(
  com.apple.locationd.Position
  com.apple.locationd.Utility
  com.apple.network
  com.apple.CFNetwork
  com.apple.icloudMCCKit
)

parallelism="${SLIM_PARALLELISM:-8}"

# One `simctl spawn` per call: running a host shell inside the simulator to
# batch them works on some machines but aborts in dyld on the CI runners.
stop_service() {
  # `system/` prints a deprecation warning and resolves to the user domain.
  if xcrun simctl spawn "$1" launchctl disable "system/$2" >/dev/null 2>&1; then
    xcrun simctl spawn "$1" launchctl bootout "system/$2" >/dev/null 2>&1
    echo "stopped $2"
  else
    echo "skip    $2 (disable failed)"
  fi
}

quiet_subsystem() {
  if xcrun simctl spawn "$1" log config --subsystem "$2" \
    --mode level:off,persist:off >/dev/null 2>&1; then
    echo "quiet   $2"
  else
    echo "skip    $2 (log config failed)"
  fi
}
export -f stop_service quiet_subsystem

started_at=$(date +%s)
output=$(
  {
    printf 'stop_service %s\n' "${labels[@]}"
    printf 'quiet_subsystem %s\n' "${quiet_subsystems[@]}"
  } | xargs -P "$parallelism" -L 1 bash -c '"$0" "$udid" "$1"' 2>&1
)
echo "$output" | sort
echo "done in $(( $(date +%s) - started_at ))s"

if ! grep -q '^stopped ' <<<"$output"; then
  echo "::warning::Simulator slimming stopped no services; the run will be slower."
fi
