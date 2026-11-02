"""Fine holographic grain for the Ultimate rares' silver foil (src/card/tex/grain.png).

The real cards (Baron Nashor UNL-238, Packed Amphitheater RAD-184) show their
rainbow as a fine prismatic grain, not as large cracked-ice shards. The shine
multiplies this tile in: values between ~.5 and 1, a few px per grain,
tileable (generated in the frequency domain, so the edges wrap).

    python3 scripts/gen-grain.py
"""
import numpy as np
from PIL import Image

N = 256
rng = np.random.default_rng(238)

# band-limited noise: keep frequencies whose period is ~3-8 px
f = np.fft.fftfreq(N)
fx, fy = np.meshgrid(f, f)
r = np.hypot(fx, fy)
band = np.exp(-((r - 0.2) / 0.07) ** 2)
noise = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((N, N))) * band))
noise = (noise - noise.mean()) / noise.std()

# a few brighter specks, like the facets of the film that catch the light
specks = (rng.random((N, N)) > 0.985).astype(float)
specks = np.real(np.fft.ifft2(np.fft.fft2(specks) * np.exp(-(r / 0.25) ** 2)))
specks /= specks.max()

v = 0.76 + 0.13 * noise + 0.35 * specks
v = np.clip(v, 0.5, 1.0)
Image.fromarray((v * 255).round().astype(np.uint8), 'L').save('src/card/tex/grain.png', optimize=True)
print('src/card/tex/grain.png', v.min().round(3), v.mean().round(3), v.max().round(3))
