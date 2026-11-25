'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function writeTempTestCa() {
  const script = [
    "$cert = New-SelfSignedCertificate -Subject 'CN=DailyIssueTlsTest' -CertStoreLocation Cert:\\CurrentUser\\My -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddYears(1) -HashAlgorithm SHA256",
    'try {',
    '  $bytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)',
    '  $b64 = [Convert]::ToBase64String($bytes, "InsertLineBreaks")',
    '  Write-Output "-----BEGIN CERTIFICATE-----"',
    '  Write-Output $b64',
    '  Write-Output "-----END CERTIFICATE-----"',
    '} finally {',
    '  Remove-Item -LiteralPath ("Cert:\\CurrentUser\\My\\" + $cert.Thumbprint) -Force',
    '}',
  ].join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  });
  const text = String(result.stdout || '');
  const match = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/);
  if (!match) {
    throw new Error('TEMP_TEST_CA_FAILED');
  }
  const file = path.join(os.tmpdir(), 'daily-issue-test-ca-' + process.pid + '-' + Date.now() + '.crt');
  fs.writeFileSync(file, match[0] + '\n', 'utf8');
  return {
    path: file,
    cleanup: function () {
      try {
        fs.unlinkSync(file);
      } catch (_) {
        /* ignore */
      }
    },
  };
}

module.exports = { writeTempTestCa: writeTempTestCa };
