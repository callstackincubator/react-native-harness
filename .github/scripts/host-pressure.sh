#!/usr/bin/env bash
# Samples macOS host pressure while an iOS simulator boots and Harness runs,
# so CI runs can be compared on numbers rather than wall time alone.
#
#   host-pressure.sh start         start sampling in the background
#   host-pressure.sh mark <name>   record a named point in time
#   host-pressure.sh stop          stop sampling and write a summary
#
# Memory demand is Anonymous + Wired + Compressor pages: unlike "used" or
# "free", it does not hide new demand behind reclaimed file cache.
set -euo pipefail

dir="${HOST_PRESSURE_DIR:-${RUNNER_TEMP:-/tmp}/host-pressure}"
samples="$dir/samples.tsv"
markers="$dir/markers.tsv"
summary="$dir/summary.md"

sample() {
  local cpu vm
  # The second row covers the last second; the first is since boot.
  cpu="$(iostat -n 0 -c 2 -w 1 | tail -n 1)"
  vm="$(vm_stat)"
  awk -v now="$(date +%s)" -v cpu="$cpu" \
    -v host_procs="$(ps -A -o pid= | wc -l | tr -d ' ')" \
    -v sim_procs="$(ps -axo command= | grep -c -E 'RuntimeRoot|CoreSimulator/Devices/' || true)" '
    /page size of/ { for (i = 1; i <= NF; i++) if ($i == "of") page = $(i + 1) }
    /^Anonymous pages:/ { anon = $NF + 0 }
    /^Pages wired down:/ { wired = $NF + 0 }
    /^Pages occupied by compressor:/ { comp = $NF + 0 }
    /^Swapouts:/ { swapouts = $NF + 0 }
    END {
      split(cpu, c, " ")
      mb = page / 1048576
      printf "%d\t%d\t%.2f\t%d\t%d\t%d\t%d\t%d\n", now, c[3], c[4], \
        (anon + wired + comp) * mb, comp * mb, swapouts * mb, host_procs, sim_procs
    }' <<<"$vm" >>"$samples"
}

case "${1:-}" in
  start)
    mkdir -p "$dir"
    printf 'time\tidle_pct\tload_1m\tdemand_mb\tcompressor_mb\tswapped_out_mb\thost_procs\tsim_procs\n' >"$samples"
    : >"$markers"
    nohup bash -c "while :; do '$0' sample || true; sleep 4; done" >/dev/null 2>&1 &
    echo $! >"$dir/pid"
    "$0" mark start
    ;;
  sample)
    sample
    ;;
  mark)
    printf '%d\t%s\n' "$(date +%s)" "$2" >>"$markers"
    ;;
  stop)
    "$0" mark stop
    kill "$(cat "$dir/pid")" 2>/dev/null || true
    # One row per span between consecutive markers, in time order.
    sort -n -k1,1 "$markers" | awk -F '\t' '
      NR == FNR { t[++m] = $1; name[m] = $2; next }
      FNR > 1 { s[++n] = $0 }
      END {
        print "| Phase | Seconds | Samples | Peak demand MB | Peak compressor MB | Swapped out MB | Peak load | Mean idle % | Peak sim procs |"
        print "|---|---|---|---|---|---|---|---|---|"
        for (k = 1; k < m; k++) {
          cnt = 0; pd = 0; pc = 0; pl = 0; idle = 0; ps = 0; first = -1; last = 0
          for (i = 1; i <= n; i++) {
            split(s[i], f, "\t")
            if (f[1] < t[k] || f[1] >= t[k + 1]) continue
            cnt++; idle += f[2]
            if (f[3] > pl) pl = f[3]
            if (f[4] > pd) pd = f[4]
            if (f[5] > pc) pc = f[5]
            if (f[8] > ps) ps = f[8]
            if (first < 0) first = f[6]
            last = f[6]
          }
          printf "| %s → %s | %d | %d | %d | %d | %d | %.1f | %.0f | %d |\n", name[k], name[k + 1], \
            t[k + 1] - t[k], cnt, pd, pc, (first < 0 ? 0 : last - first), pl, (cnt ? idle / cnt : 0), ps
        }
      }' - "$samples" >"$summary"
    cat "$summary"
    ;;
  *)
    echo "usage: $0 start | mark <name> | stop" >&2
    exit 1
    ;;
esac
