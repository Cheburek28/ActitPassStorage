const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  assert.ok(fs.existsSync(path.join(root, relativePath)), `missing ${relativePath}`);
}

[
  'app/pubspec.yaml',
  'app/lib/main.dart',
  'core/Cargo.toml',
  'core/crates/vault_core/src/lib.rs',
  'core/crates/sync_core/src/lib.rs',
  'core/crates/ffi_api/src/lib.rs',
  'tools/build_android_apk.sh',
  'tools/build_linux_deb.sh',
  'docker/build-env/Dockerfile',
  'docker/linux-deb/Dockerfile',
  'docker-compose.yml',
  'tools/windows/ActitPassStorage.iss',
  '.github/workflows/windows_setup.yml',
].forEach(exists);

const app = read('app/lib/main.dart');
[
  'ActitPassStorage',
  'Папка / SMB / NFS',
  'Почта IMAP/SMTP',
  'WebDAV',
  'SFTP',
  'FTP/FTPS',
  'Как настроить этот способ',
  'Банковская карта',
  'Номер карты',
  'CVV',
  'Пароль интернет-банка',
  'Icons.visibility',
  'ChoiceChip',
  'CircleAvatar(backgroundColor: color.bg)',
].forEach((needle) => assert.ok(app.includes(needle), `Flutter app missing ${needle}`));

assert.ok(app.includes("FieldDefinition(id: 'number', label: 'Номер карты', type: 'custom_secret', required: true)"));
assert.ok(app.includes("FieldDefinition(id: 'cvv', label: 'CVV', type: 'password', secret: true)"));
assert.ok(app.includes("FieldDefinition(id: 'account', label: 'Номер счета', type: 'custom_secret', required: true)"));

const androidScript = read('tools/build_android_apk.sh');
assert.ok(androidScript.includes('flutter build apk --debug'));
assert.ok(androidScript.includes('ActitPassStorage-android-debug.apk'));

const debScript = read('tools/build_linux_deb.sh');
assert.ok(debScript.includes('flutter build linux --release'));
assert.ok(debScript.includes('dpkg-deb --build'));
assert.ok(debScript.includes('actit-pass-storage_${VERSION}_${ARCH}.deb'));

const workflow = read('.github/workflows/windows_setup.yml');
assert.ok(workflow.includes('windows-latest'));
assert.ok(workflow.includes('flutter build windows --release'));
assert.ok(workflow.includes('ActitPassStorage-Setup-0.1.0.exe'));

const dockerfile = read('docker/build-env/Dockerfile');
[
  'FROM ubuntu:24.04',
  'ANDROID_HOME=/opt/android-sdk',
  'FLUTTER_HOME=/opt/flutter',
  'libgtk-3-dev',
  'ninja-build',
  'cmake',
  'openjdk-17-jdk',
  'nodejs',
  'npm',
  'sdkmanager',
  'platforms;android-36',
  'ndk;28.2.13676358',
  'rustup target add',
  'flutter precache --linux --android',
  'google-chrome-stable_current_amd64.deb',
].forEach((needle) => assert.ok(dockerfile.includes(needle), `Dockerfile missing ${needle}`));

const compose = read('docker-compose.yml');
[
  'version: "3.3"',
  'docker/build-env/Dockerfile',
  'docker/linux-deb/Dockerfile',
  './dist:/workspace/dist',
  'flutter-cache:',
  'flutter-linux-cache:',
  'gradle-cache:',
  'pub-cache:',
  'build-apk:',
  'build-deb:',
  'tools/build_android_apk.sh',
  'tools/build_linux_deb.sh',
].forEach((needle) => assert.ok(compose.includes(needle), `docker-compose missing ${needle}`));

const linuxDebDockerfile = read('docker/linux-deb/Dockerfile');
[
  'FROM ubuntu:20.04',
  'FLUTTER_HOME=/opt/flutter',
  'libgtk-3-dev',
  'libwebp-dev',
  'flutter precache --linux',
].forEach((needle) => assert.ok(linuxDebDockerfile.includes(needle), `Linux deb Dockerfile missing ${needle}`));

const pkg = JSON.parse(read('package.json'));
[
  'docker:build-image',
  'docker:test',
  'docker:apk',
  'docker:deb',
  'docker:release',
].forEach((script) => assert.ok(pkg.scripts[script], `package script missing ${script}`));
assert.ok(pkg.scripts['docker:apk'].includes('docker-compose run --rm build-apk'));
assert.ok(pkg.scripts['docker:deb'].includes('docker-compose run --rm build-deb'));
assert.ok(pkg.scripts['docker:apk'].includes('docker-compose build build-apk'));
assert.ok(pkg.scripts['docker:deb'].includes('docker-compose build build-deb'));
assert.ok(pkg.scripts['docker:release'].includes('docker-compose run --rm build-apk'));
assert.ok(pkg.scripts['docker:release'].includes('docker-compose run --rm build-deb'));
assert.ok(pkg.scripts['docker:release'].includes('docker-compose build build-apk build-deb'));
assert.ok(pkg.scripts['docker:build-image'].includes('COMPOSE_HTTP_TIMEOUT=300'));
assert.ok(pkg.scripts['docker:test'].includes('COMPOSE_HTTP_TIMEOUT=300'));

const rustVault = read('core/crates/vault_core/src/lib.rs');
assert.ok(rustVault.includes('built_in_card_hides_only_cvv'));
assert.ok(rustVault.includes('bank_account_number_is_visible_but_password_is_secret'));

console.log('packaging_scaffold.test.js: all tests passed');
