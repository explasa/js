// server.js - 添加会话管理
const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 会话存储（内存中）
const sessions = new Map();

// 中间件 - 处理会话
app.use(express.json());
app.use(express.static('public'));

// 会话中间件
app.use((req, res, next) => {
  const sessionId = req.headers['session-id'] || 'default';
  
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      currentDir: process.cwd(),
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
    'rm -rf', 'sudo', 'passwd', 'chmod 777', 'dd if=', 
    'mkfs', 'fdisk', '> /dev/sda', ':(){ :|: & };:'
  ];
  
  return !dangerousCommands.some(dangerous => 
    command.toLowerCase().includes(dangerous.toLowerCase())
  );
}

// 处理 cd 命令
function handleCdCommand(command, currentDir) {
  const cdMatch = command.match(/^cd\s+(.+)$/);
  if (cdMatch) {
    const targetDir = cdMatch[1].trim();
    
    // 处理特殊目录
    let newDir = targetDir;
    if (targetDir === '~') {
      newDir = process.env.HOME || '/';
    } else if (targetDir === '-') {
      // 这里可以实现返回上一个目录，需要额外存储
      newDir = currentDir;
    }
    
    // 解析路径
    const resolvedPath = path.resolve(currentDir, newDir);
    
    // 检查目录是否存在且可访问
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

// 命令执行端点
app.post('/api/execute', (req, res) => {
  const { command } = req.body;
  const sessionId = req.headers['session-id'] || 'default';
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

  console.log(`[${sessionId}] Executing: ${command} in ${session.currentDir}`);
  
  // 处理 cd 命令
  const cdResult = handleCdCommand(command, session.currentDir);
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
    cwd: session.currentDir,  // 使用会话的当前目录
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

// 获取当前目录信息
app.get('/api/pwd', (req, res) => {
  const session = req.session;
  res.json({
    currentDir: session.currentDir,
    history: session.history.slice(-10) // 最近10条历史
  });
});

// 重置会话
app.post('/api/reset', (req, res) => {
  const sessionId = req.headers['session-id'] || 'default';
  sessions.set(sessionId, {
    currentDir: process.cwd(),
    env: { ...process.env },
    history: []
  });
  
  res.json({
    success: true,
    message: 'Session reset'
  });
});

app.get('/api/system', (req, res) => {
  const session = req.session;
  const systemInfo = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    currentDir: session.currentDir,
    sessionId: req.headers['session-id'] || 'default',
    timestamp: new Date().toISOString()
  };
  res.json(systemInfo);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Web Shell with Session Support running on http://localhost:${PORT}`);
});
