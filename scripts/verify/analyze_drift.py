# Independent reference for loop timing: recomputes the loop length from bpm/bars/sampleRate on its own
# and checks every kick onset logged by the probe against start + k*L.
import json, sys
d = json.load(open(sys.argv[1]))
bpm, bars, sr = d["bpm"], d["bars"], d["sampleRate"]
from ref_timing import loop_frames
L = loop_frames(bpm, bars, sr)                 # independent reference, not the engine code
assert L == d["loopFrames"], f"engine loopFrames {d['loopFrames']} != reference {L}"
onsets = d["onsets"]
first = onsets[0]
kicks = [o for o in onsets if min((o - first) % L, L - (o - first) % L) < 200]   # onsets at loop phase 0
devs = [(o - first) - round((o - first) / L) * L for o in kicks]
ivals = [b - a for a, b in zip(kicks, kicks[1:])]
print(f"reference L = {L} frames ({L / sr:.6f} s) @ {sr} Hz, bpm {bpm}, bars {bars}")
print(f"kick onsets: {len(kicks)}  (loops covered: {round((kicks[-1] - kicks[0]) / L)})  other onsets: {len(onsets) - len(kicks)}")
print(f"intervals: min {min(ivals)} max {max(ivals)} (expected {L} or multiples)")
print(f"max |deviation from first + k*L|: {max(abs(x) for x in devs)} samples")
if d.get("startFrame") is not None:
    print(f"first onset - transport startFrame = {first - d['startFrame']} samples (constant graph latency)")
