# Fake-mic input for Chromium (--use-file-for-fake-audio-capture): 48 kHz mono 16-bit,
# a 1 kHz beep (80 ms) every 500 ms, 4 s long (Chromium loops it).
import math, struct, wave, sys
sr, secs = 48000, 4.0
out = sys.argv[1]
frames = bytearray()
for i in range(int(sr * secs)):
    t = i / sr
    within = t % 0.5
    s = 0.5 * math.sin(2 * math.pi * 1000 * t) if within < 0.08 else 0.0
    frames += struct.pack("<h", int(round(s * 32767)))
with wave.open(out, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(bytes(frames))
print("wrote", out, len(frames) // 2, "frames")
