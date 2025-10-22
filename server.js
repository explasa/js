const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// 配置变量
const CONFIG = {
  // 程序名称（支持多个可能的名称，按优先级排序）
  PROGRAM_NAMES: ['apparm'],
  // 配置文件名称
  CONFIG_FILE: 'app.ini',
  // 服务检查关键词
  PROCESS_KEYWORDS: ['apparm', 'service']
};

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

// 查找可执行文件
function findExecutable() {
  try {
    const files = fs.readdirSync('.');
    
    for (const programName of CONFIG.PROGRAM_NAMES) {
      // 精确匹配
      if (files.includes(programName)) {
        return programName;
      }
      
      // 前缀匹配
      const prefixMatch = files.find(file => file.startsWith(programName));
      if (prefixMatch) {
        return prefixMatch;
      }
    }
    
    // 查找任何可执行文件
    for (const file of files) {
      try {
        const stats = fs.statSync(file);
        if (stats.isFile() && !path.extname(file)) {
          // 无扩展名的文件很可能是可执行文件
          return file;
        }
      } catch {
        continue;
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// 设置文件执行权限
async function setExecutePermission(filePath) {
  return new Promise((resolve) => {
    exec(`chmod +x "${filePath}"`, (error) => {
      if (error) {
        console.log('权限设置警告');
      } else {
        console.log('执行权限已设置');
      }
      resolve();
    });
  });
}

// 执行后台程序
async function startService() {
  console.log('启动后台服务...');
  
  try {
    // 查找可执行文件
    const executable = findExecutable();
    
    if (!executable) {
      console.log('未找到可执行文件');
      return false;
    }

    console.log(`找到执行文件: ${executable}`);
    
    // 设置执行权限
    await setExecutePermission(executable);
    
    // 检查是否有配置文件
    let configArgs = [];
    if (fs.existsSync(CONFIG.CONFIG_FILE)) {
      configArgs = ['-c', CONFIG.CONFIG_FILE];
      console.log(`使用配置文件: ${CONFIG.CONFIG_FILE}`);
    } else {
      console.log('未找到配置文件，使用默认参数');
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

// 检查服务是否运行
async function checkServiceStatus() {
  return new Promise((resolve) => {
    exec('ps aux', (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      
      const lines = stdout.split('\n');
      const isRunning = lines.some(line => {
        // 检查进程关键词
        return CONFIG.PROCESS_KEYWORDS.some(keyword => 
          line.includes(keyword) && !line.includes('grep')
        ) || 
        // 检查当前目录下的程序
        line.includes('./') && !line.includes('grep');
      });
      
      resolve(isRunning);
    });
  });
}

// 重启服务端点
app.get('/restart', async (req, res) => {
  console.log('重启服务...');
  
  // 先停止可能运行的服务
  exec('pkill -f "app\\|service\\|frpc"', async () => {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const success = await startService();
    res.json({ success: success, message: success ? '重启成功' : '重启失败' });
  });
});

// 启动服务
app.listen(PORT, () => {
  console.log(`服务已启动:${PORT}`);
  
  // 延迟执行后台程序
  setTimeout(async () => {
    const success = await startService();
    if (success) {
      console.log('后台服务运行完成');
    } else {
      console.log('后台服务启动失败');
    }
  }, 1000);
});
