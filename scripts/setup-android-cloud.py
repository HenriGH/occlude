#!/usr/bin/env python3
"""Prepare the Linux cloud build tools without modifying system packages."""
import concurrent.futures
import hashlib
import os
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request

tools = Path('/workspace/.tools')
cache = tools / 'downloads'
cache.mkdir(parents=True, exist_ok=True)
artifacts = [
    ('jdk.deb', 'https://deb.debian.org/debian/pool/main/o/openjdk-21/openjdk-21-jdk-headless_21.0.12.1+1-1~deb13u1_amd64.deb', 'sha256', 'f3abafb6c644b03df042824e707cd211ea33254761d7f7b75be3f8dc0df97c7a'),
    ('jre.deb', 'https://deb.debian.org/debian/pool/main/o/openjdk-21/openjdk-21-jre-headless_21.0.12.1+1-1~deb13u1_amd64.deb', 'sha256', 'e95f36193e45464ac758e5436f940bf3eaecc77de67188275a42104f58aa7674'),
    # Command-line-tools integrity value from Google's repository2-1.xml.
    ('android-cli.zip', 'https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip', 'sha1', 'e025545c62a8e64c7559119566a569fb1dec5f60'),
]


def verified_download(artifact):
    name, url, algorithm, expected = artifact
    path = cache / name
    if not path.exists():
        partial = path.with_suffix('.partial')
        urllib.request.urlretrieve(url, partial)
        if hashlib.new(algorithm, partial.read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'Checksum mismatch: {name}')
        partial.replace(path)
    if hashlib.new(algorithm, path.read_bytes()).hexdigest() != expected:
        raise RuntimeError(f'Checksum mismatch: {name}')
    print(f'Verified {name}', flush=True)


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    list(pool.map(verified_download, artifacts))

jdk = tools / 'java/usr/lib/jvm/java-21-openjdk-amd64'
if not (jdk / 'bin/javac').exists():
    for package in ['jdk.deb', 'jre.deb']:
        subprocess.run(['dpkg-deb', '-x', str(cache / package), str(tools / 'java')], check=True)

sdk = tools / 'android-sdk'
cli = sdk / 'cmdline-tools/latest'
if not cli.exists():
    unpack = tools / 'android-cli-extract'
    subprocess.run(['unzip', '-q', str(cache / 'android-cli.zip'), '-d', str(unpack)], check=True)
    cli.parent.mkdir(parents=True, exist_ok=True)
    (unpack / 'cmdline-tools').rename(cli)

environment = os.environ | {'JAVA_HOME': str(jdk), 'ANDROID_USER_HOME': str(tools / 'android-user-home')}
subprocess.run([str(cli / 'bin/android'), '--no-metrics', f'--sdk={sdk}', 'sdk', 'install',
                'platforms/android-36', 'build-tools/36.0.0', 'platform-tools'], env=environment, check=True)

# Java/Gradle need explicit proxy properties in this cloud machine. Retain any
# unrelated user settings and never copy credentials from a proxy URL.
proxy = urllib.parse.urlsplit(os.environ.get('HTTPS_PROXY', ''))
if proxy.hostname:
    path = tools / 'gradle-home/gradle.properties'
    path.parent.mkdir(parents=True, exist_ok=True)
    properties = {}
    for protocol in ['http', 'https']:
        properties[f'systemProp.{protocol}.proxyHost'] = proxy.hostname
        properties[f'systemProp.{protocol}.proxyPort'] = str(proxy.port or 80)
    hosts = os.environ.get('NO_PROXY', '').split(',')
    if any(hosts):
        properties['systemProp.http.nonProxyHosts'] = '|'.join('*' + h if h.startswith('.') else h for h in hosts if h)
    existing = path.read_text().splitlines() if path.exists() else []
    retained = [line for line in existing if line.partition('=')[0] not in properties]
    path.write_text('\n'.join(retained + [f'{key}={value}' for key, value in properties.items()]) + '\n')

subprocess.run([str(jdk / 'bin/javac'), '-version'], check=True)
print('Android build tools ready. Source scripts/android-cloud-env.sh before building.')
