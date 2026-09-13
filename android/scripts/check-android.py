#!/usr/bin/env python3
"""Validate Android XML and package references; Gradle is required for Kotlin compilation."""
import pathlib, sys, xml.etree.ElementTree as ET
root = pathlib.Path(__file__).resolve().parents[1]
main = root/'app/src/main'; errors = []; namespace = '{http://schemas.android.com/apk/res/android}'
for p in sorted(main.rglob('*.xml')):
    if 'jniLibs' in p.parts: continue
    try: ET.parse(p)
    except ET.ParseError as e: errors.append(f'{p.name}: {e}')
manifest = ET.parse(main/'AndroidManifest.xml').getroot(); app = manifest.find('application')
for component in list(app):
    name = component.get(namespace+'name', '')
    if name.startswith('.') and not (main/'java/com/aidot/mini'/(name[1:]+'.kt')).is_file(): errors.append('Missing component: '+name)
service = app.find('service')
if service.get(namespace+'exported') != 'false': errors.append('Server service must remain non-exported')
if service.get(namespace+'foregroundServiceType') != 'specialUse': errors.append('Review foreground service use case')
if app.get(namespace+'extractNativeLibs') != 'true': errors.append('ProcessBuilder runtime must be extracted')
for name in ['gradlew','gradlew.bat','gradle/wrapper/gradle-wrapper.jar','gradle/wrapper/gradle-wrapper.properties']:
    if not (root/name).is_file(): errors.append('Missing Gradle wrapper: '+name)
for error in errors: print('FAIL',error)
print(f'Android metadata: {len(errors)} errors. Run ./gradlew :app:assembleDebug for actual Kotlin/Java/APK verification.')
sys.exit(bool(errors))
