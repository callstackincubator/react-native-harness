#!/usr/bin/env bash
# Frees host RAM/IO/disk pressure on ephemeral macOS CI runners by disabling
# host services that cannot affect the behaviour of the code under test:
# Spotlight indexing, Time Machine local snapshots, and unified-log
# persistence.
#
# This is opt-in (see the `reduceHostMemory` action input) and intended only
# for ephemeral CI runners -- it mutates host state (disables Spotlight and
# Time Machine, deletes existing local snapshots) and must never run on a
# machine you care about, such as a self-hosted or shared runner.
#
# Every command below is individually failure-tolerant: a command that is
# unavailable, already disabled, or errors for any other reason must not fail
# this step or the job.

set -u

echo "Disabling Spotlight indexing and deleting existing indexes..."
sudo mdutil -a -i off -d || true

echo "Booting out the Spotlight metadata daemon (com.apple.metadata.mds)..."
sudo launchctl bootout system/com.apple.metadata.mds || true

echo "Disabling Time Machine local snapshots..."
sudo tmutil disable || true

echo "Deleting existing Time Machine local snapshots..."
tmutil listlocalsnapshots / 2>/dev/null | while IFS= read -r snapshot; do
  snapshot_date="${snapshot#com.apple.TimeMachine.}"
  echo "Deleting local snapshot: $snapshot_date"
  sudo tmutil deletelocalsnapshots "$snapshot_date" || true
done

echo "Stopping unified-log persistence..."
sudo log config --mode "persist:off" || true

echo "Done reducing host memory/disk pressure."
