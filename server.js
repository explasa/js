// server.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client } = require('ssh2');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ssh' });

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Helper: attempt ssh connection
function createSSHConnection(ws, auth) {
  const conn = new Client();

  conn.on('ready', () => {
    console.log('SSH ready');
    // request a shell (pty)
    conn.shell({ term: auth.term || 'xterm-256color', cols: auth.cols || 80, rows: auth.rows || 24 }, (err, stream) => {
      if (err) {
        ws.send(JSON.stringify({ type: 'stderr', data: 'Shell error: ' + err.message }));
        conn.end();
        return;
      }

      // data from ssh -> client
      stream.on('data', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      stream.stderr.on('data', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      stream.on('close', () => {
        try { ws.close(); } catch(e){ }
        conn.end();
      });

      // store stream on ws for inbound data piping
      ws.sshStream = stream;
    });
  });

  conn.on('error', (err) => {
    console.error('SSH error', err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: 'SSH connection error: ' + err.message }));
      ws.close();
    }
  });

  conn.on('end', () => {
    console.log('SSH ended');
  });

  // Build connection config
  const cfg = {
    host: auth.host || '127.0.0.1', // local host by default
    port: auth.port || 22,
    username: auth.username,
    readyTimeout: 20000,
  };

  if (auth.password) cfg.password = auth.password;
  else if (auth.privateKey) cfg.privateKey = auth.privateKey;
  else if (process.env.SSH_PRIVATE_KEY_PATH && fs.existsSync(process.env.SSH_PRIVATE_KEY_PATH)) {
    cfg.privateKey = fs.readFileSync(process.env.SSH_PRIVATE_KEY_PATH);
  }

  conn.connect(cfg);

  // return conn to allow cleanup if needed
  return conn;
}

wss.on('connection', (ws, req) => {
  console.log('WS connected from', req.socket.remoteAddress);

  let sshConn = null;

  ws.on('message', (msg) => {
    // try parse JSON control messages; otherwise treat as raw input to ssh stream
    // We expect first an auth JSON like: {type:"auth", username:"user", password:"...", host:"127.0.0.1", port:22}
    // resize messages: {type:"resize", cols:..., rows:...}
    try {
      // note: remote clients may send binary shell data (Buffer), so only parse when it's stringified JSON
      if (typeof msg === 'string') {
        const j = JSON.parse(msg);
        if (j.type === 'auth') {
          // require username + (password || privateKey)
          if (!j.username) {
            ws.send(JSON.stringify({ type: 'error', message: 'Missing username' }));
            ws.close();
            return;
          }
          // If privateKey supplied as text, use it; else password.
          if (j.privateKey) j.privateKey = j.privateKey.replace(/\\n/g, '\n');

          // create the SSH connection
          sshConn = createSSHConnection(ws, {
            host: j.host || '127.0.0.1',
            port: j.port || 22,
            username: j.username,
            password: j.password,
            privateKey: j.privateKey,
            cols: j.cols,
            rows: j.rows,
            term: j.term
          });
        } else if (j.type === 'resize') {
          if (ws.sshStream && ws.sshStream.setWindow) {
            ws.sshStream.setWindow(j.rows, j.cols, j.height || 600, j.width || 800);
          }
        } else if (j.type === 'keepalive') {
          // ignore
        } else {
          // unknown control message
        }
        return;
      }
    } catch (e) {
      // not JSON -> fallthrough to raw
    }

    // raw data (Buffer or string) to write to ssh
    if (ws.sshStream && ws.sshStream.writable) {
      // msg may be Buffer or string; write directly
      ws.sshStream.write(msg);
    } else {
      // Not connected yet
      ws.send(JSON.stringify({ type: 'stderr', data: 'SSH not connected yet. Send auth first.' }));
    }
  });

  ws.on('close', () => {
    console.log('WS closed');
    if (sshConn) {
      try { sshConn.end(); } catch(e){ }
    }
  });

  ws.on('error', (err) => {
    console.error('WS error', err);
    if (sshConn) try { sshConn.end(); } catch(e){ }
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}. Open http://localhost:${PORT}/`);
});
