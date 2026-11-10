import { createInterface } from 'node:readline';

// Asks for a new password twice without echoing it to the screen.
//
// On a terminal the input is read in raw mode and nothing is shown. When
// stdin is piped (scripts, tests: `printf 'pw\npw\n' | npm run ...`) it reads
// one line per question instead. A single reader serves both questions,
// because a second readline would miss lines the first one already buffered.
export async function promptNewPassword(minLength: number): Promise<string> {
  const ask = process.stdin.isTTY ? askHidden : lineReader();
  const password = await ask(`New password (min ${minLength} characters): `);
  const repeated = await ask('Repeat the password: ');
  if (password !== repeated) {
    throw new Error('The passwords do not match');
  }
  return password;
}

function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') {
          finish();
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          // Ctrl+C
          finish();
          reject(new Error('Cancelled'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on('data', onData);
  });
}

function lineReader(): (question: string) => Promise<string> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let closed = false;
  rl.on('line', (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else lines.push(line);
  });
  rl.on('close', () => {
    closed = true;
    for (const next of waiting.splice(0)) next('');
  });

  return (question) => {
    process.stdout.write(question + '\n');
    const line = lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (closed) return Promise.resolve('');
    return new Promise((resolve) => waiting.push(resolve));
  };
}
