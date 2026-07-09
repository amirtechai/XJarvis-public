const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVERS_PATH = path.join(os.homedir(), '.jarvis', 'servers.json');

function loadServers() {
  try {
    if (!fs.existsSync(SERVERS_PATH)) return [];
    return JSON.parse(fs.readFileSync(SERVERS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function findServer(name) {
  const servers = loadServers();
  return servers.find((s) => s.name === name) ?? null;
}

function execRemote(server, cmd) {
  return new Promise((resolve) => {
    const keyFlag = server.keyPath ? `-i ${server.keyPath}` : '';
    const port = server.port ? `-p ${server.port}` : '';
    const safeCmd = cmd.replace(/'/g, "'\\''");
    const sshCmd = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 ${keyFlag} ${port} ${server.user}@${server.host} '${safeCmd}'`;

    exec(sshCmd, { timeout: 15000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout?.trim() ?? '',
        stderr: stderr?.trim() ?? '',
        exitCode: err?.code ?? 0,
      });
    });
  });
}

async function executeRemoteAction(msg, ws) {
  const { serverName, payload } = msg;

  if (!payload) {
    return ws.send(JSON.stringify({ type: 'action_error', message: 'Missing remote command payload' }));
  }

  if (!serverName) {
    return ws.send(JSON.stringify({ type: 'action_error', message: 'Missing serverName' }));
  }

  const server = findServer(serverName);
  if (!server) {
    const servers = loadServers();
    return ws.send(JSON.stringify({
      type: 'action_error',
      message: `Server "${serverName}" not found. Available: ${servers.map((s) => s.name).join(', ') || 'none'}`,
    }));
  }

  const result = await execRemote(server, payload);
  ws.send(JSON.stringify({ type: 'action_result', action: 'remote_shell', serverName, payload, ...result }));
}

function listServers(ws) {
  const servers = loadServers();
  ws.send(JSON.stringify({
    type: 'server_list',
    servers: servers.map(({ name, host, user, port }) => ({ name, host, user, port })),
  }));
}

module.exports = { executeRemoteAction, listServers };
