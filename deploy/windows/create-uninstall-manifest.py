#!/usr/bin/env python3
"""Generate exact NSIS payload deletion commands; never recursively delete a root."""
from pathlib import Path
import sys


def nsis_path(value: str) -> str:
    if any(c in value for c in '\r\n"') or ':' in value:
        raise ValueError(f'Unsupported payload filename: {value!r}')
    return value.replace('$', '$$').replace('/', '\\')


def create_manifest(payload: Path, output: Path) -> None:
    payload = payload.resolve(strict=True)
    files, directories = [], set()
    for path in sorted(payload.rglob('*')):
        if path.is_symlink():
            raise ValueError(f'Payload symbolic links are not allowed: {path}')
        rel = path.relative_to(payload)
        if path.is_file():
            files.append(rel.as_posix())
            directories.update(p.as_posix() for p in rel.parents if p != Path('.'))
        elif path.is_dir():
            directories.add(rel.as_posix())
    if not {'runtime/node.exe', 'app/deploy/installed/launch.mjs'}.issubset(files):
        raise ValueError('Windows payload requires runtime/node.exe and installed launcher')
    lines = ['; Generated from this release payload. Preserve every unrelated file.',
             '!macro RemoveInstalledPayload']
    lines += [f'  Delete "$INSTDIR\\{nsis_path(name)}"' for name in files]
    lines += [f'  RMDir "$INSTDIR\\{nsis_path(name)}"' for name in
              sorted(directories, key=lambda s: (s.count('/'), s), reverse=True)]
    lines += ['!macroend', '']
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text('\n'.join(lines), encoding='utf-8')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: create-uninstall-manifest.py PAYLOAD OUTPUT.nsh')
    create_manifest(Path(sys.argv[1]), Path(sys.argv[2]))
