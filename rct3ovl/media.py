"""Text strings (txt) and sounds (snd)."""
from __future__ import annotations

import io
import struct
import wave

from .container import LoaderRef, Ovl, OvlError


def text(ovl: Ovl, ref: LoaderRef) -> str:
    """txt: a NUL-terminated UTF-16LE string (in-game text, localised by the install's language files)."""
    data, _ = ovl.block_bytes(ref.data)
    end = 0
    while end + 1 < len(data) and data[end:end + 2] != b'\0\0':
        end += 2
    return data[:end].decode('utf-16le', errors='replace')


def sound_info(ovl: Ovl, ref: LoaderRef) -> dict:
    """snd (80 B): WAVEFORMATEX (18 B, padded to 20), 10 playback floats/ints, loop flag,
    channel1* (int16 samples), channel1 byte size, channel2*, channel2 byte size."""
    b = ovl.read(ref.data, 80)
    tag, ch, rate, byterate, align, bits = struct.unpack_from('<HHIIHH', b, 0)
    f = struct.unpack_from('<i9f', b, 20)
    loop, c1, s1, c2, s2 = struct.unpack_from('<iIiIi', b, 60)
    return {'format_tag': tag, 'channels': ch, 'rate': rate, 'bits': bits, 'loop': bool(loop),
            'ch1': c1, 'ch1_size': s1, 'ch2': c2, 'ch2_size': s2,
            'params': [round(x, 6) for x in f[1:]]}


def sound_wav(ovl: Ovl, ref: LoaderRef) -> bytes:
    """Sound as a WAV file. Stereo sounds store each channel separately; they are interleaved here."""
    i = sound_info(ovl, ref)
    if i['format_tag'] != 1 or i['bits'] != 16:
        raise OvlError(f'{ref.name}: unsupported sound format {i["format_tag"]}/{i["bits"]} bit')
    import numpy as np
    chans = [np.frombuffer(ovl.read(i['ch1'], i['ch1_size']), '<i2')]
    if i['ch2'] and i['ch2_size']:
        chans.append(np.frombuffer(ovl.read(i['ch2'], i['ch2_size']), '<i2'))
    n = min(len(c) for c in chans)
    pcm = np.stack([c[:n] for c in chans], 1).astype('<i2').tobytes()
    out = io.BytesIO()
    with wave.open(out, 'wb') as w:
        w.setnchannels(len(chans)); w.setsampwidth(2); w.setframerate(i['rate']); w.writeframes(pcm)
    return out.getvalue()
