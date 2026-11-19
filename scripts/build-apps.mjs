import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const IS_WIN = process.platform === 'win32';
const RELEASE_DIR = path.join(ROOT, 'release');

function logStep(title) {
  console.log(`\n=== ${title} ===`);
}

function run(cmd, extraEnv = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
}

function findJavaHome() {
  if (IS_WIN) {
    const candidates = [
      'C:\\Program Files\\Android\\Android Studio\\jbr',
      'C:\\Program Files\\Microsoft\\jdk-21',
      process.env.JAVA_HOME || '',
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(path.join(c, 'bin', 'java.exe'))) {
        return c;
      }
    }
    const msBase = 'C:\\Program Files\\Microsoft';
    if (fs.existsSync(msBase)) {
      const dirs = fs.readdirSync(msBase).filter((d) => d.startsWith('jdk-21') || d.startsWith('jdk-17'));
      if (dirs.length > 0) {
        return path.join(msBase, dirs[0]);
      }
    }
  }
  return process.env.JAVA_HOME || '';
}

function findAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME || '',
    process.env.ANDROID_SDK_ROOT || '',
    IS_WIN ? path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk') : '',
    !IS_WIN ? path.join(os.homedir(), 'Android', 'Sdk') : '',
    !IS_WIN ? path.join(os.homedir(), 'Library', 'Android', 'sdk') : '',
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || '';
}

function hasInstalledPackage(pkgName) {
  return fs.existsSync(path.join(ROOT, 'node_modules', ...pkgName.split('/'), 'package.json'));
}

function patchAndroidManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return;
  let xml = fs.readFileSync(manifestPath, 'utf8');

  if (!xml.includes('android:usesCleartextTraffic')) {
    xml = xml.replace(/<application\b/, '<application\n        android:usesCleartextTraffic="true"');
  }

  const permissions = [
    'android.permission.INTERNET',
    'android.permission.CAMERA',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_WIFI_STATE',
    'android.permission.POST_NOTIFICATIONS',
  ];

  const missingPerms = permissions
    .filter((perm) => !xml.includes(perm))
    .map((perm) => `    <uses-permission android:name="${perm}" />`);

  if (missingPerms.length > 0) {
    xml = xml.replace('</manifest>', `${missingPerms.join('\n')}\n</manifest>`);
  }

  fs.writeFileSync(manifestPath, xml, 'utf8');
  console.log('Patched AndroidManifest.xml permissions & cleartext LAN support.');
}

function main() {
  const args = new Set(process.argv.slice(2));
  const skipExe = args.has('--apk-only');
  const skipApk = args.has('--exe-only');

  logStep('1/5 Installing project & packaging dependencies');
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    run('npm install --legacy-peer-deps');
  }

  const requiredTooling = [
    'electron',
    'electron-builder',
    '@capacitor/core',
    '@capacitor/cli',
    '@capacitor/android',
    '@capacitor/filesystem',
    '@capacitor/local-notifications',
  ];
  const missingTooling = requiredTooling.filter((pkg) => !hasInstalledPackage(pkg));
  if (missingTooling.length > 0) {
    run(`npm install --no-save --legacy-peer-deps ${missingTooling.join(' ')}`);
  }

  logStep('2/5 Building web assets & icons');
  run('node scripts/apply-desktop-icons.mjs');
  run('npm run build');

  fs.mkdirSync(RELEASE_DIR, { recursive: true });

  if (!skipExe) {
    logStep('3/5 Building Windows .exe installer');
    run('npm run build:exe');
  }

  if (!skipApk) {
    logStep('4/5 Configuring Android project, icons & manifest');
    const androidDir = path.join(ROOT, 'android');
    if (!fs.existsSync(androidDir)) {
      run('npx cap add android');
    }
    patchAndroidManifest(path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml'));
    run('node scripts/apply-android-icons.mjs');
    run('npx cap sync android');

    const sdkDir = findAndroidSdk();
    const javaHome = findJavaHome();

    if (!sdkDir) {
      console.log(
        '\n[Notice] Android SDK not found automatically. Install Android Studio once (with Android SDK), then re-run this script or open the "android" folder in Android Studio -> Build APK(s).'
      );
    } else {
      logStep('5/5 Building Android .apk via Gradle');
      const localProps = path.join(androidDir, 'local.properties');
      const escapedSdk = sdkDir.replace(/\\/g, '\\\\');
      fs.writeFileSync(localProps, `sdk.dir=${escapedSdk}\n`, 'utf8');

      const gradlew = IS_WIN ? 'gradlew.bat' : './gradlew';
      const gradleResult = spawnSync(gradlew, ['assembleDebug'], {
        cwd: androidDir,
        stdio: 'inherit',
        shell: IS_WIN,
        env: {
          ...process.env,
          ...(javaHome ? { JAVA_HOME: javaHome } : {}),
          ANDROID_HOME: sdkDir,
          ANDROID_SDK_ROOT: sdkDir,
        },
      });

      const builtApk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
      if (gradleResult.status === 0 && fs.existsSync(builtApk)) {
        const destApk = path.join(RELEASE_DIR, 'Instrop.apk');
        fs.copyFileSync(builtApk, destApk);
        console.log(`\nAPK ready at: ${destApk}`);
      } else {
        console.log(
          '\n[Notice] Gradle APK build did not complete. Open the "android" folder in Android Studio once to let it download SDK/build-tools, then re-run.'
        );
      }
    }
  }

  logStep('Done');
  console.log(`Check your output files inside: ${RELEASE_DIR}`);
}

main();
