# Independent Python reference for the loop length rule (IEEE-754 doubles, same as JS).
def loop_frames(bpm, bars, sr, beats=4):
    exact = bars * beats * 60 / bpm * sr
    base = max(1, int(exact + 0.5))           # Math.round for positives
    ok = lambda n: n >= 1 and (n / sr) * sr == n
    cands = sorted({base} | {base + d for d in range(1, 65)} | {base - d for d in range(1, 65)},
                   key=lambda n: (n != base, abs(n - exact)))
    return next(n for n in cands if ok(n))
