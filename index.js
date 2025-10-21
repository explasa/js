const readline = require('readline');

class JSShell {
  constructor() {
    this.variables = new Map();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'js> '
    });
    
    this.init();
  }

  init() {
    console.log('JavaScript Interactive Shell');
    console.log('Type ".help" for commands\n');
    
    this.rl.prompt();
    
    this.rl.on('line', (line) => {
      this.handleInput(line.trim());
    });

    this.rl.on('close', () => {
      console.log('\nGoodbye!');
      process.exit(0);
    });
  }

  async handleInput(input) {
    if (!input) {
      this.rl.prompt();
      return;
    }

    // 内置命令
    if (input.startsWith('.')) {
      this.handleBuiltinCommand(input);
      return;
    }

    // 执行 JavaScript 代码
    try {
      if (input.includes('=') && !input.includes('==') && !input.includes('===')) {
        // 变量赋值
        this.handleVariableAssignment(input);
      } else if (input.startsWith('console.')) {
        // 直接执行 console 命令
        eval(input);
      } else {
        // 尝试作为表达式执行
        const result = eval(input);
        console.log(result);
      }
    } catch (error) {
      // 如果不是有效的 JS，尝试作为系统命令执行
      await this.executeSystemCommand(input);
    }
    
    this.rl.prompt();
  }

  handleBuiltinCommand(command) {
    const parts = command.split(' ');
    const cmd = parts[0];
    
    switch (cmd) {
      case '.exit':
        this.rl.close();
        break;
      case '.help':
        this.showHelp();
        break;
      case '.vars':
        this.showVariables();
        break;
      case '.clear':
        console.clear();
        break;
      case '.pwd':
        console.log(process.cwd());
        break;
      case '.ls':
        this.executeSystemCommand('ls -la');
        break;
      default:
        console.log(`Unknown command: ${cmd}`);
    }
    this.rl.prompt();
  }

  handleVariableAssignment(input) {
    const [varName, ...valueParts] = input.split('=');
    const varNameClean = varName.trim();
    const value = valueParts.join('=').trim();
    
    try {
      // 尝试解析值
      const parsedValue = eval(value);
      this.variables.set(varNameClean, parsedValue);
      console.log(`${varNameClean} = ${parsedValue}`);
    } catch (error) {
      // 如果解析失败，存储为字符串
      this.variables.set(varNameClean, value);
      console.log(`${varNameClean} = "${value}"`);
    }
  }

  async executeSystemCommand(command) {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000
      });
      
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    } catch (error) {
      console.error(`Command failed: ${error.message}`);
    }
  }

  showHelp() {
    console.log(`
Available commands:
  .exit     - Exit the shell
  .help     - Show this help
  .vars     - Show all variables
  .clear    - Clear the screen
  .pwd      - Show current directory
  .ls       - List files
  
JavaScript features:
  x = 10          - Assign variable
  console.log(x)  - Print variable
  Math.PI         - Use Math object
  5 + 3 * 2       - Calculate expressions
  
System commands:
  ls, pwd, whoami - Execute system commands
    `);
  }

  showVariables() {
    if (this.variables.size === 0) {
      console.log('No variables defined');
      return;
    }
    
    console.log('\nVariables:');
    this.variables.forEach((value, key) => {
      console.log(`  ${key} = ${value}`);
    });
  }
}

// 启动 shell
new JSShell();