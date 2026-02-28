import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function isLikelyCi() {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}

function getDesktopPathWindows() {
  try {
    const cmd = "[Environment]::GetFolderPath('Desktop')";
    const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });
    return output.trim();
  } catch {
    const userProfile = process.env.USERPROFILE || '';
    if (!userProfile) {
      return '';
    }
    return path.join(userProfile, 'Desktop');
  }
}

function createWindowsShortcut() {
  const repoRoot = process.cwd();
  const launcherPath = path.join(repoRoot, 'tools', 'launch-archipel.cmd');
  if (!fs.existsSync(launcherPath)) {
    return;
  }

  const desktopPath = getDesktopPathWindows();
  if (!desktopPath || !fs.existsSync(desktopPath)) {
    return;
  }

  const shortcutPath = path.join(desktopPath, 'Archipel.lnk');
  const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/\\/g, '\\\\')}')
$Shortcut.TargetPath = '${launcherPath.replace(/\\/g, '\\\\')}'
$Shortcut.WorkingDirectory = '${repoRoot.replace(/\\/g, '\\\\')}'
$Shortcut.Description = 'Lancer Archipel et ouvrir l interface web'
$Shortcut.WindowStyle = 1
$Shortcut.Save()
`;

  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );
}

function main() {
  if (isLikelyCi()) {
    return;
  }

  if (process.platform !== 'win32') {
    return;
  }

  try {
    createWindowsShortcut();
    console.log('[Archipel] Raccourci Bureau cree: Archipel.lnk');
  } catch {
    // Fallback silencieux: ne bloque jamais l'installation.
  }
}

main();

