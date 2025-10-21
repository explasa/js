const express = require('express');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// 安全命令检查
function isSafeCommand(command) {
  const dangerousCommands = [
    'rm -rf', 'sudo', 'passwd', 'chmod 777', 'dd if=', 
    'mkfs', 'fdisk', '> /dev/sda', ':(){ :|: & };:',
    'curl', 'bash -c', 'sh -c'
  ];
  
  return !dangerousCommands.some(dangerous => 
    command.toLowerCase().includes(dangerous.toLowerCase())
  );
}

// 执行命令的 API 端点
app.post('/api/execute', (req, res) => {
  const { command } = req.body;
  
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

  console.log(`Executing command: ${command}`);
  
  // 执行命令
  exec(command, { 
    timeout: 15000,
    cwd: process.cwd(),
    encoding: 'utf8'
  }, (error, stdout, stderr) => {
    res.json({
      success: !error,
      command: command,
      output: stdout || stderr,
      error: error ? error.message : null,
      timestamp: new Date().toISOString()
    });
  });
});

// 获取系统信息的 API
app.get('/api/system', (req, res) => {
  const systemInfo = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cwd: process.cwd(),
    timestamp: new Date().toISOString()
  };
  res.json(systemInfo);
});

// 主页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString() 
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 Web Shell Server running on http://localhost:${PORT}`);
  console.log(`📁 Static files served from: ${path.join(__dirname, 'public')}`);
});
