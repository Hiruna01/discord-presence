"""Generate the code-drawn Frame app and extension icons, without external assets."""
import math
import struct
import subprocess
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def png(path, size, painter, samples=2):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            colors = [painter((x + (sx + .5) / samples) / size, (y + (sy + .5) / samples) / size)
                      for sy in range(samples) for sx in range(samples)]
            rows.extend(round(sum(c[i] for c in colors) / len(colors)) for i in range(4))
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 6, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def rounded(x, y, left, top, right, bottom, radius):
    dx = max(left + radius - x, 0, x - (right - radius))
    dy = max(top + radius - y, 0, y - (bottom - radius))
    return left <= x <= right and top <= y <= bottom and dx * dx + dy * dy <= radius * radius


def icon(x, y):
    if not rounded(x, y, .06, .06, .94, .94, .20):
        return (0, 0, 0, 0)
    glow = max(0, 1 - math.hypot(x - .5, y - .58) * 2)
    color = (int(26 + glow * 17), int(28 + glow * 6), int(34 + glow * 5), 255)
    # A slightly tilted frame, with a warm coral gradient.
    angle = -.105
    px = (x - .5) * math.cos(angle) + (y - .5) * math.sin(angle) + .5
    py = -(x - .5) * math.sin(angle) + (y - .5) * math.cos(angle) + .5
    if rounded(px, py, .22, .30, .78, .70, .105):
        color = (255, int(120 - (py - .3) * 95), int(108 - (py - .3) * 70), 255)
    if .425 <= px <= .64 and abs(py - .5) < (.64 - px) * .65:
        color = (255, 249, 239, 255)
    return color


def tray(x, y):
    if rounded(x, y, .12, .22, .88, .78, .15):
        if .41 <= x <= .68 and abs(y - .5) < (.68 - x) * .67:
            return (0, 0, 0, 0)
        return (0, 0, 0, 255)
    return (0, 0, 0, 0)


png(ROOT / 'assets/icon.png', 1024, icon, samples=1)
png(ROOT / 'assets/tray.png', 22, tray, samples=4)
png(ROOT / 'assets/tray@2x.png', 44, tray, samples=4)
for size in [16, 32, 48, 128]:
    png(ROOT / f'extension/icons/{size}.png', size, icon, samples=3)
iconset = ROOT / 'assets/Frame.iconset'
iconset.mkdir(exist_ok=True)
for size in [16, 32, 128, 256, 512]:
    for scale in [1, 2]:
        suffix = '@2x' if scale == 2 else ''
        subprocess.run(['sips', '-z', str(size * scale), str(size * scale), str(ROOT / 'assets/icon.png'),
                        '--out', str(iconset / f'icon_{size}x{size}{suffix}.png')], check=True, stdout=subprocess.DEVNULL)
# Modern macOS ICNS containers accept PNG representations directly.
representations = [('ic07', 'icon_128x128.png'), ('ic08', 'icon_256x256.png'),
                   ('ic09', 'icon_512x512.png'), ('ic10', 'icon_512x512@2x.png'),
                   ('ic11', 'icon_16x16@2x.png'), ('ic12', 'icon_32x32@2x.png'),
                   ('ic13', 'icon_128x128@2x.png'), ('ic14', 'icon_256x256@2x.png')]
parts = []
for kind, filename in representations:
    data = (iconset / filename).read_bytes()
    parts.append(kind.encode() + struct.pack('!I', len(data) + 8) + data)
contents = b''.join(parts)
(ROOT / 'assets/Frame.icns').write_bytes(b'icns' + struct.pack('!I', len(contents) + 8) + contents)
print('Created app, menu-bar, and Chrome icons.')
