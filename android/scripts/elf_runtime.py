"""Small, read-only ELF64 inspector used by Android packaging gates."""
import struct

def inspect(data):
    if data[:6] != b'\x7fELF\x02\x01':
        raise ValueError('Expected little-endian ELF64')
    machine = struct.unpack_from('<H', data, 18)[0]
    phoff = struct.unpack_from('<Q', data, 32)[0]
    entsize, count = struct.unpack_from('<HH', data, 54)
    loads, dynamic = [], None
    for i in range(count):
        kind, flags, off, addr, _, size, memsize, align = struct.unpack_from('<IIQQQQQQ', data, phoff + i * entsize)
        if kind == 1: loads.append((off, addr, size, align))
        if kind == 2: dynamic = (off, size)
    tags = []
    if dynamic:
        for off in range(dynamic[0], sum(dynamic), 16):
            tag, val = struct.unpack_from('<qQ', data, off)
            if tag == 0: break
            tags.append((tag, val))
    straddr = next((val for tag, val in tags if tag == 5), None)
    table = next((off + straddr - addr for off, addr, size, _ in loads if straddr is not None and addr <= straddr < addr + size), None)
    def string(index):
        start = table + index
        return data[start:data.index(b'\0', start)].decode('utf8')
    if table is None: raise ValueError('Missing dynamic string table')
    return {'machine': machine, 'loads': loads, 'needed': [string(v) for k, v in tags if k == 1],
            'soname': [string(v) for k, v in tags if k == 14], 'runpath': [string(v) for k, v in tags if k in (15, 29)]}
