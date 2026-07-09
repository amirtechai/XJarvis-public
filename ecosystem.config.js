// PM2 ecosystem — alternative to launchd. Install with: npm i -g pm2
// Start all:   pm2 start ecosystem.config.js
// Persist:     pm2 save && pm2 startup

const path = require('path');

const ROOT = __dirname;
const PYTHON = process.env.PYTHON_BIN || 'python3';

const common = {
  cwd: ROOT,
  restart_delay: 3000,
  max_restarts: 10,
  exp_backoff_restart_delay: 100,
  watch: false,
  max_memory_restart: '500M',
  out_file: path.join(ROOT, 'logs', 'pm2-out.log'),
  error_file: path.join(ROOT, 'logs', 'pm2-error.log'),
  combine_logs: true,
  log_date_format: 'YYYY-MM-DD HH:mm:ss',
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'jarvis-backend',
      script: 'backend/server.js',
      env: { NODE_ENV: 'production' },
    },
    {
      ...common,
      name: 'jarvis-frontend',
      script: 'npm',
      args: 'start',
      env: { NODE_ENV: 'production', PORT: '3000' },
    },
    {
      ...common,
      name: 'jarvis-vision',
      script: PYTHON,
      args: '-m vision.service',
      env: { JARVIS_BUS_URL: 'ws://localhost:3001' },
    },
    {
      ...common,
      name: 'jarvis-voice',
      script: PYTHON,
      args: '-m voice.service',
      env: { JARVIS_BUS_URL: 'ws://localhost:3001' },
    },
  ],
};
