'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = __dirname;
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, 'config.json');
const EXAMPLE_CONFIG_PATH = path.join(PROJECT_ROOT, 'config.example.json');

const DEFAULT_CONFIG = {
  output_dir: path.join(os.homedir(), 'granola-meetings'),
  sync_interval_minutes: 60,
  remote: {
    enabled: false,
    host: '',
    path: path.join(os.homedir(), 'granola-meetings'),
    method: 'rsync',
  },
};

function expandPath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }

  if (value === '~') {
    return os.homedir();
  }

  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }

  if (value.startsWith('~')) {
    return path.join(os.homedir(), value.slice(1));
  }

  return value;
}

function resolvePath(candidate) {
  if (!candidate) {
    return null;
  }
  const expanded = expandPath(candidate);
  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
}

function readJson(filePath) {
  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Failed to read config at ${filePath}: ${error.message}`);
  }
}

function loadConfig(customPath) {
  const candidates = [];
  if (customPath) {
    candidates.push(resolvePath(customPath));
  }
  candidates.push(DEFAULT_CONFIG_PATH);
  candidates.push(EXAMPLE_CONFIG_PATH);

  let raw = null;
  let source = null;

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      raw = readJson(candidate);
      source = candidate;
      break;
    }
  }

  const baseDir = source ? path.dirname(source) : PROJECT_ROOT;
  const config = {
    ...DEFAULT_CONFIG,
    ...(raw || {}),
    remote: {
      ...DEFAULT_CONFIG.remote,
      ...(raw && typeof raw.remote === 'object' ? raw.remote : {}),
    },
  };

  config.output_dir = formatPathValue(config.output_dir, baseDir);

  if (config.remote && typeof config.remote.path === 'string') {
    config.remote.path = formatPathValue(config.remote.path, baseDir);
  }

  config.sync_interval_minutes = Number(config.sync_interval_minutes) || DEFAULT_CONFIG.sync_interval_minutes;
  config.remote.method = config.remote.method || 'rsync';

  return { config, source };
}

function formatPathValue(value, baseDir) {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }
  const expanded = expandPath(value);
  return path.isAbsolute(expanded) ? expanded : path.resolve(baseDir, expanded);
}

module.exports = {
  loadConfig,
  expandPath,
};
