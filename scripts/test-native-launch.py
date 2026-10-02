#!/usr/bin/env python3
"""Launch-contract regression checks. Not a substitute for simulator/device launch.

python3 scripts/test-native-launch.py [--baseline-ref SHA] [--app-bundle PATH]
The baseline mode reads Git objects without changing the checkout.
"""
import argparse
import plistlib
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--baseline-ref')
parser.add_argument('--app-bundle', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]

def source(path):
    if args.baseline_ref:
        return subprocess.check_output(['git', 'show', f'{args.baseline_ref}:{path}'], cwd=root)
    return (root / path).read_bytes()

checks = []
def check(condition, label):
    checks.append(bool(condition))
    print(('PASS ' if condition else 'FAIL ') + label)

def manifest_checks(info, label, resolved=False):
    manifest = info.get('UIApplicationSceneManifest', {})
    configs = manifest.get('UISceneConfigurations', {}).get('UIWindowSceneSessionRoleApplication', [])
    delegates = [c.get('UISceneDelegateClassName', '') for c in configs]
    expected = 'The_Rise.RiseSceneDelegate' if resolved else '$(PRODUCT_MODULE_NAME).RiseSceneDelegate'
    check(expected in delegates, label + ': scene delegate registered')
    check(manifest.get('UIApplicationSupportsMultipleScenes') is False, label + ': single scene explicitly retained')
    for key in ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSLocationWhenInUseUsageDescription']:
        check(bool(info.get(key, '').strip()), label + ': ' + key)

info = plistlib.loads(source('ios/TheRise/TheRise/Info.plist'))
manifest_checks(info, 'source plist')
swift = source('ios/TheRise/TheRise/AppDelegate.swift').decode()
check('class RiseSceneDelegate: UIResponder, UIWindowSceneDelegate' in swift, 'scene delegate implemented in compiled AppDelegate source')
check('UIWindow(windowScene: windowScene)' in swift, 'window attached to connecting scene')
check('UIWindow(frame: UIScreen.main.bounds)' not in swift, 'legacy application-owned window removed')
check('window.rootViewController = RiseViewController()' in swift and 'window.makeKeyAndVisible()' in swift, 'scene still presents the web container')
if args.app_bundle:
    manifest_checks(plistlib.loads((args.app_bundle / 'Info.plist').read_bytes()), 'built plist', resolved=True)
    check((args.app_bundle / 'Web/the-rise-app.html').is_file(), 'HTML is bundled at the native load path')
    check((args.app_bundle / 'Web/the-rise-app.html').read_bytes() == (root / 'ios/TheRise/TheRise/Web/the-rise-app.html').read_bytes(), 'built HTML matches snapshot source')
print(f'{sum(checks)}/{len(checks)} launch-contract checks passed')
raise SystemExit(0 if all(checks) else 1)
