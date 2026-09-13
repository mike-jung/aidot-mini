Third-party runtime notices

This APK includes a pinned Android/Bionic runtime from the official Termux package repository.
Exact package versions, architectures and SHA-256 values are in android/runtime-packages.json.
The package binaries were modified only to normalize dynamic library names for APK extraction
and remove Termux-specific runtime search paths; see runtime-manifest.json and import-runtime.py.
The Termux app itself is not bundled.

Node.js (and its bundled components): share/doc/nodejs-lts/copyright
ICU: share/doc/libicu/LICENSE
c-ares: share/doc/c-ares/copyright
zlib: share/doc/zlib/copyright
LLVM libc++: LLVM-libcxx-LICENSE.txt
OpenSSL 3.6.3: OpenSSL-LICENSE.txt
SQLite: public domain; https://sqlite.org/copyright.html

Source/build recipes:
https://github.com/termux/termux-packages/tree/master/packages/nodejs-lts
https://github.com/termux/termux-packages/tree/master/packages/libc%2B%2B
https://github.com/termux/termux-packages/tree/master/packages/libicu
https://github.com/termux/termux-packages/tree/master/packages/c-ares
https://github.com/termux/termux-packages/tree/master/packages/libsqlite
https://github.com/termux/termux-packages/tree/master/packages/openssl
https://github.com/termux/termux-packages/tree/master/packages/zlib

Additional license copies:
https://raw.githubusercontent.com/llvm/llvm-project/main/libcxx/LICENSE.TXT
https://raw.githubusercontent.com/openssl/openssl/openssl-3.6.3/LICENSE.txt

The application Kotlin shell also uses AndroidX core/core-ktx 1.15.0 and AppCompat 1.7.0,
licensed under Apache License 2.0. Source: https://android.googlesource.com/platform/frameworks/support/
The Kotlin standard library 2.1.20 is distributed under Apache License 2.0:
https://github.com/JetBrains/kotlin/tree/v2.1.20
Apache License 2.0 text is included in OpenSSL-LICENSE.txt and LLVM-libcxx-LICENSE.txt.
