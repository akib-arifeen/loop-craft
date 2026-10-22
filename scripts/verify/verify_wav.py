# Independent WAV check (stdlib only): header, length vs a naively recomputed loop length (loops x L, no tail),
# levels, clipping, sample-exact looping between passes, and the WRAP check: the last pass must equal the
# first pass at the same offset (the export starts with a pre-rolled pass, so the file loops seamlessly).
# usage: verify_wav.py file.wav bpm bars loops
import sys, wave, array
path, bpm, bars, loops = sys.argv[1], float(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
with wave.open(path, "rb") as w:
    ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    raw = w.readframes(n)
from ref_timing import loop_frames
L = loop_frames(bpm, bars, sr)
expect = loops * L
s = array.array("h"); s.frombytes(raw)
left = s[0::ch]
peak = max(abs(x) for x in s) / 32768
rms = (sum(x * x for x in s) / len(s)) ** 0.5 / 32768
clipped = sum(1 for x in s if x >= 32767 or x <= -32768)
print(f"channels {ch}  bits {sw*8}  rate {sr}  frames {n}  expected {expect}  -> {'OK' if n == expect else 'MISMATCH'}")
print(f"peak {peak:.3f}  rms {rms:.4f}  clipped samples {clipped}")
if loops >= 2:
    a0, a1 = L // 4, 3 * L // 4                   # middle half of the first pass
    last = (loops - 1) * L                        # start of the last pass
    wrap = max(abs(left[i] - left[i + last]) for i in range(a0, a1))
    wrap_shift = max(abs(left[i] - left[i + last + 1]) for i in range(a0, a1))
    print(f"WRAP last pass vs first pass max |diff| (same offset): {wrap}  | control, one-sample shift: {wrap_shift}")
if loops >= 3:
    a0, a1 = L + L // 4, L + 3 * L // 4           # middle half of pass 2
    diff = max(abs(left[i] - left[i + L]) for i in range(a0, a1))
    shifted = max(abs(left[i] - left[i + L + 1]) for i in range(a0, a1))
    print(f"pass2 vs pass3 max |diff| (same offset): {diff}  | one-sample shift: {shifted}")
