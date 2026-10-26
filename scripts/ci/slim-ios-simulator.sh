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

udid="${1:?usage: slim-ios-simulator.sh <udid>}"

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

# Each `simctl spawn` is expensive while the simulator boots, so everything
# runs from a single spawn. The simulator has no shell of its own: this runs
# the host's /bin/sh with the simulator's PATH, and DYLD_ROOT_PATH, which SIP
# strips from the environment, has to be restored for `launchctl` and `log`.
# The calls run in parallel; one at a time they cost about a second each.
in_simulator_script='
export DYLD_ROOT_PATH="$SIMULATOR_ROOT"
mode="$1"; shift
for item in "$@"; do
  if [ "$mode" = services ]; then
    {
      # `system/` prints a deprecation warning and resolves to the user domain.
      launchctl disable "system/$item" >/dev/null 2>&1
      launchctl bootout "system/$item" >/dev/null 2>&1
      echo "stopped $item"
    } &
  else
    {
      if log config --subsystem "$item" --mode level:off,persist:off >/dev/null 2>&1; then
        echo "quiet   $item"
      else
        echo "skip    $item (log config failed)"
      fi
    } &
  fi
done
wait
'

started_at=$(date +%s)
before=$(xcrun simctl spawn "$udid" launchctl list 2>/dev/null | wc -l | tr -d ' ')

xcrun simctl spawn "$udid" /bin/sh -c "$in_simulator_script" sh services "${labels[@]}" | sort
xcrun simctl spawn "$udid" /bin/sh -c "$in_simulator_script" sh logs "${quiet_subsystems[@]}" | sort

after=$(xcrun simctl spawn "$udid" launchctl list 2>/dev/null | wc -l | tr -d ' ')
echo "launchd jobs: $before -> $after ($(( $(date +%s) - started_at ))s)"
