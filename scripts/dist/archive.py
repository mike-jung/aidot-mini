#!/usr/bin/env python3
"""Portable archive I/O for the release builder; never extracts arbitrary paths."""
import pathlib
import sys
import tarfile
import zipfile


def main():
    command, source, destination = sys.argv[1:4]
    source, destination = pathlib.Path(source), pathlib.Path(destination)
    if command == 'runtime':
        member = sys.argv[4]
        with tarfile.open(source, 'r:gz') as archive:
            item = archive.getmember(member)
            if not item.isfile() or item.size > 200_000_000:
                raise ValueError('Runtime must be a regular file smaller than 200 MB')
            destination.write_bytes(archive.extractfile(item).read())
        return
    if command == 'zip':
        with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for item in sorted(source.rglob('*')):
                if item.is_symlink():
                    raise ValueError('Symlinks are forbidden in portable packages')
                if item.is_file():
                    entry = zipfile.ZipInfo(str(pathlib.PurePosixPath(source.name, *item.relative_to(source).parts)))
                    entry.external_attr = (item.stat().st_mode & 0xFFFF) << 16
                    entry.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(entry, item.read_bytes())
        return
    if command == 'tar':
        with tarfile.open(destination, 'w:gz', compresslevel=6) as archive:
            def normalize(item):
                if not (item.isfile() or item.isdir()):
                    raise ValueError('Only regular files and directories are permitted')
                item.uid = item.gid = item.mtime = 0
                item.uname = item.gname = ''
                return item
            archive.add(source, arcname=source.name, filter=normalize)
        return
    raise ValueError('Unknown archive command')


if __name__ == '__main__':
    main()
