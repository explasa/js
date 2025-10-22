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

// 中间件
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// 会话中间件
app.use((req, res, next) => {
  const sessionId = req.headers['session-id'] || req.query.sessionId || 'default';
  
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      currentDir: WORK_DIR,
      env: { ...process.env },
      history: []
    });
  }
  
  req.session = sessions.get(sessionId);
  next();
});

// 安全命令检查
function isSafeCommand(command) {
  const dangerousCommands = [
    'rm -rf /', 'sudo', 'passwd', 'chmod 777', 'dd if=',
    'mkfs', 'fdisk', '> /dev/sda', ':(){ :|: & };:'
  ];
  
  const safeCommands = [
    'ls', 'pwd', 'whoami', 'echo', 'cat', 'find', 'grep',
    'uname', 'df', 'ps', 'top', 'free', 'date', 'which',
    'head', 'tail', 'wc', 'du', 'file', 'stat', 'id',
    'env', 'printenv', 'hostname', 'uptime', 'cd',
    'mkdir', 'touch', 'rm ', 'cp ', 'mv '
  ];
  
  const isDangerous = dangerousCommands.some(dangerous => 
    command.toLowerCase().includes(dangerous.toLowerCase())
  );
  
  const isSafe = safeCommands.some(safe => 
    command.toLowerCase().startsWith(safe.toLowerCase())
  );
  
  return !isDangerous && isSafe;
}

// CD 命令处理
function handleCdCommand(command, currentDir) {
  const cdMatch = command.match(/^cd\s+(.+)$/);
  if (cdMatch) {
    const targetDir = cdMatch[1].trim();
    let newDir = targetDir;
    
    if (targetDir === '~') {
      newDir = process.env.HOME || '/';
    } else if (targetDir === '-') {
      // 返回上一个目录（简化实现）
      newDir = currentDir;
    }
    
    try {
      const resolvedPath = path.resolve(currentDir, newDir);
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

// 命令执行端点
app.post('/api/execute', (req, res) => {
  const { command } = req.body;
  const session = req.session;
  
  if (!command) {
    return res.status(400).json({ 
      success: false, 
      error: 'No command provided' 
    });
  }

  console.log(`[${req.headers['session-id'] || 'default'}] Executing: ${command} in ${session.currentDir}`);
  
  // 安全检查
  if (!isSafeCommand(command)) {
    return res.status(403).json({ 
      success: false, 
      error: 'Command not allowed for security reasons' 
    });
  }

  // 处理 cd 命令
  const cdResult = handleCdCommand(command, session.currentDir);
  if (cdResult) {
    if (cdResult.success) {
      session.currentDir = cdResult.newDir;
    }
    session.history.push(command);
    
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
    env: { ...process.env, ...session.env }
  }, (error, stdout, stderr) => {
    session.history.push(command);
    
    const response = {
      success: !error,
      command: command,
      output: stdout || stderr,
      error: error ? error.message : null,
      currentDir: session.currentDir,
      type: 'exec'
    };
    
    res.json(response);
  });
});

// 文件上传端点
app.post('/api/upload', (req, res) => {
  const { filename, content, encoding = 'utf8' } = req.body;
  
  if (!filename || content === undefined) {
    return res.status(400).json({ 
      success: false, 
      error: 'Filename and content are required' 
    });
  }

  // 安全文件名检查
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ 
      success: false, 
      error: 'Invalid filename' 
    });
  }

  try {
    const filePath = path.join(UPLOAD_DIR, filename);
    
    if (encoding === 'base64') {
      const buffer = Buffer.from(content, 'base64');
      fs.writeFileSync(filePath, buffer);
    } else {
      fs.writeFileSync(filePath, content, 'utf8');
    }
    
    const stats = fs.statSync(filePath);
    
    res.json({
      success: true,
      message: `File ${filename} created successfully`,
      path: filePath,
      size: stats.size
    });
    
  } catch (error) {
    res.status(500).json({
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
    res.status(500).json({
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

// 获取当前目录信息
app.get('/api/pwd', (req, res) => {
  const session = req.session;
  res.json({
    currentDir: session.currentDir,
    history: session.history.slice(-10)
  });
});

// 重置会话
app.post('/api/reset', (req, res) => {
  const sessionId = req.headers['session-id'] || req.query.sessionId || 'default';
  sessions.set(sessionId, {
    currentDir: WORK_DIR,
    env: { ...process.env },
    history: []
  });
  
  res.json({
    success: true,
    message: 'Session reset successfully'
  });
});

// 获取系统信息
app.get('/api/system', (req, res) => {
  const session = req.session;
  
  // 检查目录可写性
  let writable = false;
  try {
    const testFile = path.join(WORK_DIR, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    writable = true;
  } catch (error) {
    writable = false;
  }
  
  const systemInfo = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    currentDir: session.currentDir,
    workDir: WORK_DIR,
    uploadDir: UPLOAD_DIR,
    writable: writable,
    sessionId: req.headers['session-id'] || req.query.sessionId || 'default',
    timestamp: new Date().toISOString()
  };
  
  res.json(systemInfo);
});

// 健康检查端点
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 404 处理 for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API endpoint ${req.originalUrl} not found`
  });
});

// 主页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 全局错误处理
app.use((error, req, res, next) => {
  console.error('Server Error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 Web Shell Server running on http://localhost:${PORT}`);
  console.log(`📁 Writable directory: ${WORK_DIR}`);
  console.log(`📁 Upload directory: ${UPLOAD_DIR}`);
  console.log(`🔧 Available API endpoints:`);
  console.log(`   POST /api/execute - Execute command`);
  console.log(`   POST /api/upload - Upload file`);
  console.log(`   GET  /api/files - List files`);
  console.log(`   GET  /api/system - System info`);
  console.log(`   POST /api/reset - Reset session`);
  console.log(`   GET  /api/health - Health check`);
});
