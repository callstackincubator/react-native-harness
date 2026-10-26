#!/usr/bin/env bash
# Stops simulator services a Harness test run never uses, and silences the
# noisiest log subsystems, so a freshly booted simulator stops competing with
# the app under test on small CI runners.
#
# Usage: slim-ios-simulator.sh <udid>
#
# Safe to run more than once: `disable` keeps a service from being started
# later in this boot, `bootout` stops it if it is already running. The state
# lives in the simulator's memory, so it has to be applied after every boot.
#
# Labels were taken from the iOS 26.4 runtime (23E254a). Unknown labels are
# reported and skipped; they never fail the script.
set -uo pipefail

udid="${1:?usage: slim-ios-simulator.sh <udid>}"
parallelism="${SLIM_PARALLELISM:-8}"

# Kept on purpose (Harness or the app depends on them): launchd_sim,
# SpringBoard, backboardd, runningboardd, PosterBoard, logd, diagnosticd,
# ReportCrash, tccd, testmanagerd, installd, lsd, securityd, trustd, cfprefsd,
# SimRenderServer, locationd.
labels=(
  # Photo and media analysis; several cores of CPU right after first boot.
  com.apple.mediaanalysisd
  com.apple.mediaanalysisd.service
  com.apple.photoanalysisd
  com.apple.cloudphotod
  # Home screen widgets; chronod launches every widget extension.
  com.apple.chronod
  # Personal data, sync and iCloud.
  com.apple.remindd
  com.apple.calaccessd
  com.apple.contactsd
  com.apple.contacts.postersyncd
  com.apple.apsd
  com.apple.cloudd
  com.apple.bird
  com.apple.appleaccountd
  com.apple.icloudmailagent
  com.apple.dataaccess.dataaccessd
  com.apple.itunescloudd
  com.apple.mediastream.mstreamd
  com.apple.familycircled
  com.apple.familynotification
  com.apple.nanoprefsyncd.2
  com.apple.nanonewscd
  # Health and fitness.
  com.apple.healthd
  com.apple.healthappd
  com.apple.fitnessintelligenced
  com.apple.finhealthd
  # Intelligence, Siri and suggestions.
  com.apple.generativeexperiencesd
  com.apple.intelligenceplatformd
  com.apple.intelligencecontextd
  com.apple.intelligenceflowd
  com.apple.intelligencetasksd
  com.apple.callintelligenced
  com.apple.knowledgeconstructiond
  com.apple.biomed
  com.apple.biomesyncd
  com.apple.suggestd
  com.apple.assistantd
  com.apple.assistant_cdmd
  com.apple.assistant_service
  com.apple.siri.context.service
  com.apple.siriactionsd
  com.apple.siriinferenced
  com.apple.siriknowledged
  com.apple.sirittsd
  # Search indexing.
  com.apple.searchd
  com.apple.spotlightknowledged
  com.apple.spotlightknowledged.updater
  com.apple.corespotlightservice
  # Other apps' background daemons.
  com.apple.appstored
  com.apple.jetpackassetd
  com.apple.gamed
  com.apple.weatherd
  com.apple.newsd
  com.apple.routined
  com.apple.Maps.mapssyncd
  com.apple.ScreenTimeAgent
  com.apple.UsageTrackingAgent
  com.apple.shazamd
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

started_at=$(date +%s)
before=$(xcrun simctl spawn "$udid" launchctl list 2>/dev/null | wc -l | tr -d ' ')

slim_label() {
  local udid="$1" label="$2"
  # `system/` prints a deprecation warning and resolves to the user domain.
  xcrun simctl spawn "$udid" launchctl disable "system/$label" >/dev/null 2>&1 || {
    echo "skip $label (disable failed)"
    return 0
  }
  xcrun simctl spawn "$udid" launchctl bootout "system/$label" >/dev/null 2>&1 || true
  echo "ok   $label"
}
export -f slim_label

printf '%s\n' "${labels[@]}" |
  xargs -P "$parallelism" -I{} bash -c 'slim_label "$0" "$1"' "$udid" {} |
  sort

for subsystem in "${quiet_subsystems[@]}"; do
  xcrun simctl spawn "$udid" log config --subsystem "$subsystem" \
    --mode level:off,persist:off >/dev/null 2>&1 &&
    echo "quiet $subsystem" ||
    echo "skip $subsystem (log config failed)"
done

after=$(xcrun simctl spawn "$udid" launchctl list 2>/dev/null | wc -l | tr -d ' ')
echo "launchd jobs: $before -> $after ($(( $(date +%s) - started_at ))s)"
