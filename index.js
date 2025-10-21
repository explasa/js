const express = require('express');
const app = express();
const { exec } = require('child_process');

app.use(express.static('public'));
app.use(express.json());

// API 端点执行命令
app.post('/execute', (req, res) => {
  const { command } = req.body;
  
  if (!command) {
    return res.json({ error: 'No command provided' });
  }

  // 安全限制：检查危险命令
  const dangerousCommands = ['rm -rf', 'sudo', 'passwd', 'chmod 777'];
  if (dangerousCommands.some(dangerous => command.includes(dangerous))) {
    return res.json({ error: 'Dangerous command not allowed' });
  }

  exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
    res.json({
      command,
      output: stdout || stderr,
      error: error ? error.message : null
    });
  });
});

app.listen(3000, () => {
  console.log('Web Shell running on http://localhost:3000');
});
