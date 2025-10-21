// server.js - 恢复可写目录
const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 可写目录配置
const WORK_DIR = '/tmp/web-shell-writable';
const UPLOAD_DIR = path.join(WORK_DIR, 'uploads');

// 确保可写目录存在
try {
  if (!fs.existsSync(WORK_DIR)) {
    fs.mkdirSync(WORK_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  console.log(`✅ Writable directory: ${WORK_DIR}`);
} catch (error) {
  console.error(`❌ Cannot create writable directory: ${error.message}`);
}

// 会话存储
const sessions = new Map();

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// 会话中间件
app.use((req, res, next) => {
  const sessionId = req.headers['session-id'] || 'default';
  
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      currentDir: WORK_DIR,  // 默认使用可写目录
      env: { ...process.env },
      history: []
    });
  }
  
  req.session = sessions.get(sessionId);
  next();
});

// 安全命令检查 - 允许写入操作
function isSafeCommand(command) {
  const dangerousCommands = [
    'rm -rf /', 'sudo', 'passwd', 'chmod 777', 'dd if=',
    'mkfs', 'fdisk', '> /dev/sda', ':(){ :|: & };:',
    'wget http://', 'curl http://'
  ];
  
  // 允许的安全写入命令
  const safeWriteCommands = [
    'echo', 'touch', 'mkdir', 'cat >', 'cat >>',
    'cp', 'mv', 'rm ', 'find', 'grep'
  ];
  
  const isDangerous = dangerousCommands.some(dangerous => 
    command.toLowerCase().includes(dangerous.toLowerCase())
  );
  
  const isSafeWrite = safeWriteCommands.some(safe => 
    command.toLowerCase().startsWith(safe.toLowerCase())
  );
  
  return !isDangerous || isSafeWrite;
}

// 文件上传端点
app.post('/api/upload', (req, res) => {
  const { filename, content, encoding = 'utf8' } = req.body;
  
  if (!filename || !content) {
    return res.json({ 
      success: false, 
      error: 'Filename and content are required' 
    });
  }

  // 安全文件名检查
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.json({ 
      success: false, 
      error: 'Invalid filename' 
    });
  }

  try {
    const filePath = path.join(UPLOAD_DIR, filename);
    
    if (encoding === 'base64') {
      // Base64 解码
      const buffer = Buffer.from(content, 'base64');
      fs.writeFileSync(filePath, buffer);
    } else {
      // 普通文本
      fs.writeFileSync(filePath, content, 'utf8');
    }
    
    res.json({
      success: true,
      message: `File ${filename} created successfully`,
      path: filePath,
      size: fs.statSync(filePath).size
    });
    
  } catch (error) {
    res.json({
      success: false,
      error: `File creation failed: ${error.message}`
    });
  }
});

// 文件列表端点
app.get('/api/files', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).map(filename => {
      const filePath = path.join(UPLOAD_DIR, filename);
      const stats = fs.statSync(filePath);
      return {
        name: filename,
        path: filePath,
        size: stats.size,
        modified: stats.mtime,
        isDirectory: stats.isDirectory()
      };
    });
    
    res.json({
      success: true,
      files: files,
      count: files.length
    });
    
  } catch (error) {
    res.json({
      success: false,
      error: `Cannot read directory: ${error.message}`
    });
  }
});

// 文件下载端点
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOAD_DIR, filename);
  
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.download(filePath, filename);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 原有的命令执行端点（支持写入）
app.post('/api/execute', (req, res) => {
  const { command } = req.body;
  const session = req.session;
  
  if (!command) {
    return res.json({ 
      success: false, 
      error: 'No command provided' 
    });
  }

  // 安全检查
  if (!isSafeCommand(command)) {
    return res.json({ 
      success: false, 
      error: 'Command not allowed for security reasons' 
    });
  }

  console.log(`Executing: ${command} in ${session.currentDir}`);
  
  // 处理 cd 命令
  const cdResult = this.handleCdCommand(command, session.currentDir);
  if (cdResult) {
    if (cdResult.success) {
      session.currentDir = cdResult.newDir;
      session.history.push(command);
    }
    
    return res.json({
      success: cdResult.success,
      command: command,
      output: cdResult.output,
      currentDir: session.currentDir,
      type: 'cd'
    });
  }

  // 执行其他命令
  exec(command, { 
    timeout: 15000,
    cwd: session.currentDir,
    encoding: 'utf8',
    env: session.env
  }, (error, stdout, stderr) => {
    session.history.push(command);
    
    res.json({
      success: !error,
      command: command,
      output: stdout || stderr,
      error: error ? error.message : null,
      currentDir: session.currentDir,
      type: 'exec'
    });
  });
});

// CD 命令处理
function handleCdCommand(command, currentDir) {
  const cdMatch = command.match(/^cd\s+(.+)$/);
  if (cdMatch) {
    const targetDir = cdMatch[1].trim();
    let newDir = targetDir;
    
    if (targetDir === '~') {
      newDir = process.env.HOME || '/';
    }
    
    const resolvedPath = path.resolve(currentDir, newDir);
    
    try {
      const stats = fs.statSync(resolvedPath);
      if (stats.isDirectory()) {
        return {
          type: 'cd',
          success: true,
          newDir: resolvedPath,
          output: `Changed directory to: ${resolvedPath}`
        };
      } else {
        return {
          type: 'cd',
          success: false,
          newDir: currentDir,
          output: `cd: ${targetDir}: Not a directory`
        };
      }
    } catch (error) {
      return {
        type: 'cd',
        success: false,
        newDir: currentDir,
        output: `cd: ${targetDir}: No such file or directory`
      };
    }
  }
  return null;
}

// 获取系统信息
app.get('/api/system', (req, res) => {
  const session = req.session;
  const systemInfo = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    currentDir: session.currentDir,
    workDir: WORK_DIR,
    uploadDir: UPLOAD_DIR,
    writable: true,
    timestamp: new Date().toISOString()
  };
  res.json(systemInfo);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Web Shell with File Support running on http://localhost:${PORT}`);
  console.log(`📁 Writable directory: ${WORK_DIR}`);
  console.log(`📁 Upload directory: ${UPLOAD_DIR}`);
});
