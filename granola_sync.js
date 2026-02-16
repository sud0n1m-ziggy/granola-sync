#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const zlib = require('zlib');
const { execSync } = require('child_process');

const { loadConfig } = require('./config');

const SUPABASE_PATH = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Granola',
  'supabase.json',
);
const API_ENDPOINT = 'https://api.granola.ai/v2/get-documents';
const TRANSCRIPT_ENDPOINT = 'https://api.granola.ai/v1/get-document-transcript';
const LOG_FILE = path.join(__dirname, 'granola_sync.log');
const ERROR_SLEEP_MS = 60_000;
const TRANSCRIPT_DELAY_MS = 500;

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function log(message) {
  const line = `[${formatTimestamp()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch (error) {
    // Ignore logging failures
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    once: false,
    configPath: null,
    showHelp: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--once') {
      options.once = true;
    } else if (arg === '--config') {
      const next = args[i + 1];
      if (!next) {
        throw new Error('--config flag requires a path');
      }
      options.configPath = next;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.showHelp = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`GranolaSync (Node.js)

Usage:
  node granola_sync.js            Run in loop mode (default interval)
  node granola_sync.js --once     Run a single sync and exit
  node granola_sync.js --config path/to/config.json
`);
}

function readToken() {
  if (!fs.existsSync(SUPABASE_PATH)) {
    log(`ERROR: Granola auth file not found at ${SUPABASE_PATH}`);
    log('Open Granola to refresh your session.');
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(SUPABASE_PATH, 'utf8'));
  } catch (error) {
    log(`ERROR: Failed to parse ${SUPABASE_PATH}: ${error.message}`);
    return null;
  }

  let tokens = payload.workos_tokens;
  if (!tokens) {
    log('ERROR: workos_tokens missing. Sign into Granola again.');
    return null;
  }

  if (typeof tokens === 'string') {
    try {
      tokens = JSON.parse(tokens);
    } catch (error) {
      log(`ERROR: Invalid workos_tokens JSON: ${error.message}`);
      return null;
    }
  }

  const token = tokens.access_token;
  if (!token) {
    log('ERROR: No access_token found in workos_tokens.');
    return null;
  }

  const obtainedAtMs = Number(tokens.obtained_at) || 0;
  const expiresInSeconds = Number(tokens.expires_in) || 0;
  if (obtainedAtMs > 0 && expiresInSeconds > 0) {
    const expiresAt = obtainedAtMs + expiresInSeconds * 1000;
    if (Date.now() > expiresAt) {
      log('WARNING: Token appears to be expired. Open Granola to refresh.');
    }
  }

  return token;
}

function fetchDocumentsPage(token, limit, offset) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ limit, offset, include_last_viewed_panel: true });
    const request = https.request(
      API_ENDPOINT,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Accept-Encoding': 'gzip, deflate',
        },
      },
      (response) => {
        let stream = response;
        const encoding = (response.headers['content-encoding'] || '').toLowerCase();
        if (encoding === 'gzip') {
          stream = response.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = response.pipe(zlib.createInflate());
        }

        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode && response.statusCode >= 400) {
            const error = new Error(`Granola API returned ${response.statusCode}`);
            error.statusCode = response.statusCode;
            error.body = responseBody;
            reject(error);
            return;
          }

          try {
            const data = responseBody ? JSON.parse(responseBody) : {};
            resolve(data);
          } catch (error) {
            reject(new Error(`Failed to parse API response: ${error.message}`));
          }
        });
      },
    );

    request.on('error', (error) => reject(error));
    request.write(body);
    request.end();
  });
}

async function fetchDocuments(token) {
  const limit = 100;
  let offset = 0;
  const allDocs = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await fetchDocumentsPage(token, limit, offset);
    const docs = Array.isArray(response.docs) ? response.docs : [];
    
    allDocs.push(...docs);
    
    if (docs.length < limit) {
      break;
    }
    
    offset += limit;
  }

  return allDocs;
}

function fetchTranscript(token, documentId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ document_id: documentId });
    const request = https.request(
      TRANSCRIPT_ENDPOINT,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Accept-Encoding': 'gzip, deflate',
        },
      },
      (response) => {
        let stream = response;
        const encoding = (response.headers['content-encoding'] || '').toLowerCase();
        if (encoding === 'gzip') {
          stream = response.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = response.pipe(zlib.createInflate());
        }

        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8');
          
          if (response.statusCode === 404) {
            resolve(null);
            return;
          }
          
          if (response.statusCode && response.statusCode >= 400) {
            const error = new Error(`Transcript API returned ${response.statusCode}`);
            error.statusCode = response.statusCode;
            error.body = responseBody;
            reject(error);
            return;
          }

          try {
            const data = responseBody ? JSON.parse(responseBody) : null;
            const utterances = Array.isArray(data) ? data : (data && Array.isArray(data.utterances) ? data.utterances : null);
            resolve(utterances);
          } catch (error) {
            reject(new Error(`Failed to parse transcript response: ${error.message}`));
          }
        });
      },
    );

    request.on('error', (error) => reject(error));
    request.write(body);
    request.end();
  });
}

function formatSecondsToTimestamp(seconds) {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  
  const pad = (num) => String(num).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

function formatTranscriptFromUtterances(utterances, meetingTitle, meetingDate) {
  const lines = [
    `# Transcript: ${meetingTitle}`,
    `*${meetingDate || 'Unknown date'}*`,
    '',
  ];

  if (!Array.isArray(utterances) || utterances.length === 0) {
    return null;
  }

  utterances.forEach((utterance) => {
    if (!utterance) {
      return;
    }
    const timestamp = utterance.start_timestamp ? formatSecondsToTimestamp(utterance.start_timestamp) : '00:00:00';
    const source = utterance.source || 'Unknown';
    const text = (utterance.text || '').trim();

    if (text) {
      lines.push(`**[${timestamp}] ${source}:** ${text}`);
      lines.push('');
    }
  });

  return lines.join('\n');
}

function formatTranscript(panels) {
  const lines = [];
  if (!Array.isArray(panels)) {
    return lines;
  }

  panels.forEach((panel) => {
    if (panel && panel.type === 'transcript_panel' && Array.isArray(panel.children)) {
      panel.children.forEach((child) => {
        if (!child) {
          return;
        }
        const speaker = child.speaker || 'Unknown';
        const textParts = Array.isArray(child.children) ? child.children : [];
        const text = textParts
          .map((segment) => (segment && typeof segment.text === 'string' ? segment.text : ''))
          .filter(Boolean)
          .join(' ')
          .trim();

        if (text) {
          lines.push(`**${speaker}:** ${text}`);
          lines.push('');
        }
      });
    }
  });

  return lines;
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function saveMeeting(outputDir, doc, token) {
  if (!doc || !doc.id) {
    return { status: 'skipped', changed: false, needsTranscript: false };
  }

  const docId = String(doc.id);
  const meetingDir = path.join(outputDir, docId);
  ensureDir(meetingDir);

  const metaPath = path.join(meetingDir, 'metadata.json');
  const transcriptJsonPath = path.join(meetingDir, 'transcript.json');
  let status = 'new';
  let needsTranscript = false;

  if (fs.existsSync(metaPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (existing.updated_at === doc.updated_at) {
        needsTranscript = !fs.existsSync(transcriptJsonPath);
        return { status: 'unchanged', changed: false, needsTranscript };
      }
      status = 'updated';
    } catch (error) {
      status = 'updated';
    }
  }

  const metadata = {
    id: docId,
    title: doc.title || 'Untitled',
    created_at: doc.created_at || null,
    updated_at: doc.updated_at || null,
    attendees: Array.isArray(doc.people) ? doc.people : doc.people ? [doc.people] : [],
    calendar_event: doc.calendar_event || null,
  };

  writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);
  writeFile(path.join(meetingDir, 'document.json'), `${JSON.stringify(doc, null, 2)}\n`);

  // Save notes using notes_markdown or notes_plain
  const notesMarkdown = doc.notes_markdown;
  const notesPlain = doc.notes_plain;
  const notes = doc.notes || doc.summary;
  
  if (notesMarkdown) {
    const notesMd = `# Notes: ${metadata.title}\n\n${notesMarkdown}\n`;
    writeFile(path.join(meetingDir, 'notes.md'), notesMd);
  } else if (notesPlain) {
    const notesMd = `# Notes: ${metadata.title}\n\n${notesPlain}\n`;
    writeFile(path.join(meetingDir, 'notes.md'), notesMd);
  } else if (notes !== undefined && notes !== null) {
    let notesBody;
    if (typeof notes === 'string') {
      notesBody = notes.trim();
    } else {
      notesBody = JSON.stringify(notes, null, 2);
    }
    const notesMd = `# Notes: ${metadata.title}\n\n${notesBody}\n`;
    writeFile(path.join(meetingDir, 'notes.md'), notesMd);
  }

  // Check if we need to fetch transcript
  needsTranscript = !fs.existsSync(transcriptJsonPath);

  return { status, changed: true, needsTranscript };
}

function shellQuote(value) {
  if (!value) {
    return "''";
  }
  if (/^[A-Za-z0-9_\/:.=+-]+$/.test(value)) {
    return value;
  }
  const escaped = value.replace(/'/g, "'\"'\"'");
  return "'" + escaped + "'";
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function syncRemote(config, outputDir) {
  const remote = config.remote || {};
  if (!remote.enabled) {
    return;
  }

  if (!remote.host || !remote.path) {
    log('Remote sync skipped: host or path missing.');
    return;
  }

  const method = remote.method === 'scp' ? 'scp' : 'rsync';
  const source = ensureTrailingSlash(outputDir);
  const target = ensureTrailingSlash(`${remote.host}:${remote.path}`);

  if (method === 'rsync') {
    const cmd = `rsync -avz --delete ${shellQuote(source)} ${shellQuote(target)}`;
    log(`Remote sync via rsync → ${remote.host}:${remote.path}`);
    try {
      execSync(cmd, { stdio: 'pipe' });
      log('Remote sync complete.');
    } catch (error) {
      log(`Remote sync failed: ${error.message}`);
    }
  } else {
    const cmd = `scp -r ${shellQuote(source)} ${shellQuote(target)}`;
    log(`Remote sync via scp → ${remote.host}:${remote.path}`);
    try {
      execSync(cmd, { stdio: 'pipe' });
      log('Remote sync complete.');
    } catch (error) {
      log(`Remote sync failed: ${error.message}`);
    }
  }
}

async function syncOnce(config) {
  const token = readToken();
  if (!token) {
    return;
  }

  const outputDir = config.output_dir;
  ensureDir(outputDir);

  log('Fetching meetings from Granola...');
  let documents;
  try {
    documents = await fetchDocuments(token);
  } catch (error) {
    if (error.statusCode === 401) {
      log('ERROR: Unauthorized. Token expired? Open Granola to refresh.');
    } else {
      log(`ERROR: Failed to fetch meetings: ${error.message}`);
    }
    return;
  }

  log(`Found ${documents.length} meetings.`);

  let newCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let skippedCount = 0;
  const transcriptQueue = [];

  for (const doc of documents) {
    const result = await saveMeeting(outputDir, doc, token);
    switch (result.status) {
      case 'new':
        newCount += 1;
        log(`  NEW: ${doc.title || doc.id}`);
        break;
      case 'updated':
        updatedCount += 1;
        log(`  UPDATED: ${doc.title || doc.id}`);
        break;
      case 'unchanged':
        unchangedCount += 1;
        break;
      default:
        skippedCount += 1;
    }

    if (result.needsTranscript) {
      transcriptQueue.push(doc);
    }
  }

  log(`Sync complete → ${newCount} new, ${updatedCount} updated, ${unchangedCount} unchanged, ${skippedCount} skipped.`);

  // Fetch transcripts for documents that need them
  if (transcriptQueue.length > 0) {
    log(`Fetching transcripts for ${transcriptQueue.length} meetings...`);
    let transcriptFetchedCount = 0;
    let transcriptSkippedCount = 0;

    for (const doc of transcriptQueue) {
      const docId = String(doc.id);
      const meetingDir = path.join(outputDir, docId);
      const transcriptJsonPath = path.join(meetingDir, 'transcript.json');
      const transcriptMdPath = path.join(meetingDir, 'transcript.md');

      try {
        const utterances = await fetchTranscript(token, docId);

        if (utterances && utterances.length > 0) {
          writeFile(transcriptJsonPath, `${JSON.stringify(utterances, null, 2)}\n`);

          const meetingTitle = doc.title || 'Untitled';
          const meetingDate = doc.created_at || 'Unknown date';
          const transcriptMd = formatTranscriptFromUtterances(utterances, meetingTitle, meetingDate);

          if (transcriptMd) {
            writeFile(transcriptMdPath, transcriptMd);
          }

          transcriptFetchedCount += 1;
          log(`  TRANSCRIPT: ${doc.title || doc.id}`);
        } else {
          transcriptSkippedCount += 1;
        }

        // Rate limiting: wait 500ms between requests
        await sleep(TRANSCRIPT_DELAY_MS);
      } catch (error) {
        log(`  ERROR fetching transcript for ${doc.title || doc.id}: ${error.message}`);
        transcriptSkippedCount += 1;
      }
    }

    log(`Transcripts fetched: ${transcriptFetchedCount}, skipped/unavailable: ${transcriptSkippedCount}`);
  }

  syncRemote(config, outputDir);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let args;
  try {
    args = parseArgs();
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exit(1);
  }

  if (args.showHelp) {
    printHelp();
    process.exit(0);
  }

  let configEntry;
  try {
    configEntry = loadConfig(args.configPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const { config, source } = configEntry;

  log('GranolaSync starting...');
  if (source) {
    log(`Using config: ${source}`);
  } else {
    log('Using built-in defaults (no config file found).');
  }
  log(`Output directory: ${config.output_dir}`);
  log(`Remote sync: ${config.remote.enabled ? 'enabled' : 'disabled'}`);

  if (args.once) {
    await syncOnce(config);
    return;
  }

  const intervalMinutes = Number(config.sync_interval_minutes) || 60;
  log(`Loop mode: syncing every ${intervalMinutes} minutes. Press Ctrl+C to exit.`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await syncOnce(config);
    } catch (error) {
      log(`Unexpected error during sync: ${error.message}`);
      await sleep(ERROR_SLEEP_MS);
    }

    try {
      await sleep(intervalMinutes * 60 * 1000);
    } catch (error) {
      log(`Sleep interrupted: ${error.message}`);
    }
  }
}

main().catch((error) => {
  log(`Fatal error: ${error.message}`);
  process.exit(1);
});
