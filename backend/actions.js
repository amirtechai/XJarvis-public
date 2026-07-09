const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Safe command whitelist — explicit allow-list approach
const SAFE_COMMANDS = [
  /^ls(\s|$)/,
  /^pwd$/,
  /^echo\s/,
  /^cat\s(?!.*\.\.(\/|$))/,      // cat but no path traversal
  /^find\s/,
  /^grep\s/,
  /^ps(\s|$)/,
  /^df(\s|$)/,
  /^du(\s|$)/,
  /^uname(\s|$)/,
  /^whoami$/,
  /^date(\s|$)/,
  /^uptime$/,
  /^which\s/,
  /^env$/,
  /^printenv(\s|$)/,
  /^open\s/,
  /^pbcopy(\s|$)/,
  /^pbpaste$/,
  /^say\s/,
  /^curl\s(?!.*-X\s*(DELETE|PUT|POST))/,  // curl GET only
];

// Commands that require user confirmation before execution
const CONFIRM_PATTERNS = [
  /rm\s/i,
  /mv\s/i,
  /cp\s/i,
  /mkdir\s/i,
  /touch\s/i,
  /chmod\s/i,
  /chown\s/i,
  /kill\s/i,
  /pkill\s/i,
  /brew\s/i,
  /npm\s/i,
  /pip\s/i,
];

const actionLog = [];

function logAction(action, payload, result, remote = false) {
  actionLog.push({
    ts: new Date().toISOString(),
    action,
    payload,
    result: result?.substring?.(0, 500) ?? result,
    remote,
  });
  if (actionLog.length > 200) actionLog.shift();
}

function isCommandSafe(cmd) {
  const trimmed = cmd.trim();
  return SAFE_COMMANDS.some((re) => re.test(trimmed));
}

function commandNeedsConfirm(cmd) {
  const trimmed = cmd.trim();
  return CONFIRM_PATTERNS.some((re) => re.test(trimmed));
}

function execShell(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 10000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout?.trim() ?? '',
        stderr: stderr?.trim() ?? '',
        exitCode: err?.code ?? 0,
      });
    });
  });
}

async function executeAction(msg, ws) {
  const { action, payload } = msg;

  if (action === 'shell') {
    if (!payload || typeof payload !== 'string') {
      return ws.send(JSON.stringify({ type: 'action_error', message: 'Missing shell command payload' }));
    }

    if (commandNeedsConfirm(payload)) {
      ws.send(JSON.stringify({ type: 'action_confirm', action, payload }));
      return;
    }

    if (!isCommandSafe(payload)) {
      logAction(action, payload, 'BLOCKED — not in whitelist');
      return ws.send(JSON.stringify({
        type: 'action_error',
        message: `Command not allowed: "${payload}". Use action_confirm_yes to force.`,
      }));
    }

    const result = await execShell(payload);
    logAction(action, payload, result.stdout || result.stderr);
    ws.send(JSON.stringify({ type: 'action_result', action, payload, ...result }));
    return;
  }

  if (action === 'shell_confirmed') {
    const result = await execShell(payload);
    logAction(action, payload, result.stdout || result.stderr);
    ws.send(JSON.stringify({ type: 'action_result', action: 'shell', payload, ...result }));
    return;
  }

  if (action === 'file_read') {
    try {
      const resolved = path.resolve(os.homedir(), payload);
      const content = fs.readFileSync(resolved, 'utf8');
      logAction(action, payload, `read ${content.length} bytes`);
      ws.send(JSON.stringify({ type: 'action_result', action, payload, stdout: content, stderr: '', exitCode: 0 }));
    } catch (e) {
      ws.send(JSON.stringify({ type: 'action_error', message: e.message }));
    }
    return;
  }

  if (action === 'open_app') {
    const result = await execShell(`open -a "${payload.replace(/"/g, '')}"`);
    logAction(action, payload, result.stdout || result.stderr);
    ws.send(JSON.stringify({ type: 'action_result', action, payload, ...result }));
    return;
  }

  if (action === 'web_search') {
    const encoded = encodeURIComponent(payload);
    const result = await execShell(`open "https://www.google.com/search?q=${encoded}"`);
    logAction(action, payload, 'opened browser');
    ws.send(JSON.stringify({ type: 'action_result', action, payload, stdout: `Searching: ${payload}`, stderr: '', exitCode: 0 }));
    return;
  }

  if (action === 'get_log') {
    ws.send(JSON.stringify({ type: 'action_log', log: actionLog }));
    return;
  }

  ws.send(JSON.stringify({ type: 'action_error', message: `Unknown action: ${action}` }));
}

module.exports = { executeAction, isCommandSafe, commandNeedsConfirm };
