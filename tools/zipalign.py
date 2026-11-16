#!/usr/bin/env python3
"""极简 zipalign：重写 zip，把 resources.arsc / .so 等按 4 字节对齐并保持不压缩。
Android 11+ 要求 resources.arsc 不压缩；官方 zipalign 是 x86 原生程序，这里用纯 Python 实现。"""
import sys, zlib, struct, zipfile

src, dst = sys.argv[1], sys.argv[2]
align = int(sys.argv[3]) if len(sys.argv) > 3 else 4
stored_names = {'resources.arsc'}

zin = zipfile.ZipFile(src)
items = []
for info in zin.infolist():
    if info.filename.endswith('/'):
        continue
    data = zin.read(info.filename)
    store = info.filename in stored_names or info.filename.endswith('.so')
    if store:
        method, payload = zipfile.ZIP_STORED, data
    else:
        method = zipfile.ZIP_DEFLATED
        co = zlib.compressobj(9, zlib.DEFLATED, -15)
        payload = co.compress(data) + co.flush()
    items.append({
        'name': info.filename.encode('utf-8'),
        'method': method,
        'crc': zlib.crc32(data) & 0xffffffff,
        'csize': len(payload),
        'usize': len(data),
        'payload': payload,
        'date': info.date_time,
    })

out = open(dst, 'wb')
central = []
offset = 0
for it in items:
    base = offset + 30 + len(it['name'])
    extra = b''
    if it['method'] == zipfile.ZIP_STORED:
        pad = (align - base % align) % align
        if pad and pad < 4:
            pad += align
        if pad:
            extra = struct.pack('<HH', 0x9999, pad - 4) + b'\x00' * (pad - 4)
    hdr = struct.pack('<IHHHHHIIIHH', 0x04034B50, 20, 0, it['method'], 0, 0,
                      it['crc'], it['csize'], it['usize'], len(it['name']), len(extra))
    out.write(hdr)
    out.write(it['name'])
    out.write(extra)
    out.write(it['payload'])
    central.append((it, offset, extra))
    offset += len(hdr) + len(it['name']) + len(extra) + len(it['payload'])

cd_start = offset
for it, off, extra in central:
    hdr = struct.pack('<IHHHHHHIIIHHHHHII', 0x02014B50, 20, 20, 0, it['method'], 0, 0,
                      it['crc'], it['csize'], it['usize'], len(it['name']), len(extra),
                      0, 0, 0, 0o100644 << 16, off)
    out.write(hdr)
    out.write(it['name'])
    out.write(extra)
cd_size = out.tell() - cd_start
out.write(struct.pack('<IHHHHIIH', 0x06054B50, 0, 0, len(central), len(central),
                      cd_size, cd_start, 0))
out.close()
print('aligned: %s' % dst)
