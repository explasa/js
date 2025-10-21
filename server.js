// 修改 server.js
const express = require('express');
const path = require('path');
const { exec, execSync } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 使用 /tmp 或内存文件系统
const WORK_DIR = '/tmp/web-shell' || '/dev/shm/web-shell';

// 创建可写的工作目录
try {
  if (!fs.existsSync(WORK_DIR)) {
    fs.mkdirSync(WORK_DIR, { recursive: true });
  }
  console.log(`Working directory: ${WORK_DIR}`);
} catch (error) {
  console.log('Cannot create working directory, using current directory');
}

app.use(express.json());
app.use(express.static('public'));

// 安全命令检查 - 允许在临时目录操作
function isSafeCommand(command) {
  const dangerousCommands = [
    'rm -rf', 'sudo', 'passwd', 'chmod 777', 'dd if=', 
    'mkfs', 'fdisk', '> /dev/sda', ':(){ :|: & };:',
    'wget', 'curl', 'bash -c', 'sh -c'
  ];
  
  return !dangerousCommands.some(dangerous => 
    command.toLowerCase().includes(dangerous.toLowerCase())
  );
}

// 专门处理 alpine 下载和执行的端点
app.post('/api/setup-alpine', async (req, res) => {
  try {
    const commands = [
      `cd ${WORK_DIR}`,
      'wget -q https://github.com/rxyxxy/tm/releases/download/test/alpine.tar.gz',
      'tar xzf alpine.tar.gz',
      'rm alpine.tar.gz'
    ];

    let output = '';
    for (const cmd of commands) {
      try {
        const result = execSync(cmd, { 
          timeout: 30000,
          encoding: 'utf8'
        });
        output += `$ ${cmd}\n${result}\n`;
      } catch (error) {
        output += `$ ${cmd}\nError: ${error.message}\n`;
        throw error;
      }
    }

    res.json({
      success: true,
      output: output,
      message: 'Alpine environment setup completed'
    });

  } catch (error) {
    res.json({
      success: false,
      error: `Setup failed: ${error.message}`,
      suggestion: 'Try using /tmp or /dev/shm directory manually'
    });
  }
});

// 在 proot 中执行命令
app.post('/api/proot-exec', async (req, res) => {
  const { command } = req.body;
  
  if (!command) {
    return res.json({ 
      success: false, 
      error: 'No command provided' 
    });
  }

  try {
    const prootCommand = `cd ${WORK_DIR} && proot -0 -r alpine -b /proc -b /sys -b /dev -b /etc/resolv.conf:/etc/resolv.conf /bin/sh -c "${command.replace(/"/g, '\\"')}"`;
    
    const { stdout, stderr } = await new Promise((resolve, reject) => {
      exec(prootCommand, { 
        timeout: 30000,
        encoding: 'utf8'
      }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    });

    res.json({
      success: true,
      command: command,
      output: stdout || stderr
    });

  } catch (error) {
    res.json({
      success: false,
      error: `Proot execution failed: ${error.message}`
    });
  }
});

// 原有的命令执行端点（修改工作目录）
app.post('/api/execute', (req, res) => {
  const { command } = req.body;
  
  if (!command) {
    return res.json({ 
      success: false, 
      error: 'No command provided' 
    });
  }

  if (!isSafeCommand(command)) {
    return res.json({ 
      success: false, 
      error: 'Command not allowed for security reasons' 
    });
  }

  console.log(`Executing command: ${command}`);
  
  // 在可写目录执行命令
  exec(command, { 
    timeout: 15000,
    cwd: WORK_DIR,  // 使用可写目录
    encoding: 'utf8'
  }, (error, stdout, stderr) => {
    res.json({
      success: !error,
      command: command,
      output: stdout || stderr,
      error: error ? error.message : null
    });
  });
});

app.get('/api/system', (req, res) => {
  const systemInfo = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cwd: process.cwd(),
    workDir: WORK_DIR,
    writable: isWritable(WORK_DIR),
    timestamp: new Date().toISOString()
  };
  res.json(systemInfo);
});

function isWritable(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Web Shell Server running on http://localhost:${PORT}`);
  console.log(`📁 Work directory: ${WORK_DIR}`);
  console.log(`📝 Writable: ${isWritable(WORK_DIR)}`);
});
