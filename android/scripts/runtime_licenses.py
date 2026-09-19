"""Fail closed if a required Android runtime notice is missing, changed, or an HTTP error page."""
import hashlib
import json
import pathlib


def validate_licenses(root, bundled=False):
    root = pathlib.Path(root)
    manifest = json.loads((root/'runtime-license-manifest.json').read_text(encoding='utf-8'))
    inventory = manifest.get('files', {})
    if manifest.get('schema') != 1 or len(inventory) < 6:
        raise ValueError('Missing reviewed Android runtime license inventory')
    base = root/'app/src/main/assets/licenses' if bundled else root/'runtime-licenses'
    for name, expected in inventory.items():
        relative = pathlib.PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Unsafe runtime license path')
        target = base.joinpath(*relative.parts)
        if target.is_symlink() or not target.resolve().is_relative_to(base.resolve()):
            raise ValueError('Linked runtime license: '+name)
        data = target.read_bytes()
        prefix = data[:256].lower().strip()
        if len(data) < 100 or b'404: not found' in prefix or prefix.startswith((b'<html', b'<!doctype', b'<error')):
            raise ValueError('Invalid runtime license content: '+name)
        if len(data) != expected['bytes'] or hashlib.sha256(data).hexdigest() != expected['sha256']:
            raise ValueError('Runtime license hash mismatch: '+name)
    return len(inventory)
